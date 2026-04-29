// mcp-server-manager.ts：MCP SDK 连接生命周期管理
// 负责启动/停止 MCP servers、发现 tools、路由 tool 调用。
// 紧密参考 LobsterAI mcpServerManager.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { spawnSync } from 'child_process'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

import type { McpServer, McpToolManifestEntry, StdioConfig, HttpConfig } from '../ai/types'
import { getElectronNodeRuntimePath, getEnhancedEnv } from '../ai/cowork-util'
import {
  getToolTextPreview,
  looksLikeTransportErrorText,
  serializeForLog,
  serializeToolContentForLog,
  truncateForLog
} from './mcp-log'

// ── 内部类型 ──

interface ManagedMcpServer {
  record: McpServer
  client: Client
  transport: Transport
  tools: McpToolManifestEntry[]
  recentStderr: string[]
}

const MAX_RECENT_STDERR_LINES = 20

// ── 日志 ──

const log = (level: string, msg: string): void => {
  const formatted = `[McpBridge:SDK][${level}] ${msg}`
  if (level === 'ERROR') {
    console.error(formatted)
  } else if (level === 'WARN') {
    console.warn(formatted)
  } else {
    console.log(formatted)
  }
}

// ── AbortSignal 竞赛辅助 ──
// signal 触发时立即 reject，原 promise 继续运行但结果丢弃

function raceAbortSignal<T>(promise: Promise<T>, signal: AbortSignal, reason: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(reason))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error(reason))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      }
    )
  })
}

// ── stderr 诊断 ──

function appendRecentStderr(recentStderr: string[], text: string): void {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    recentStderr.push(trimmed)
  }
  if (recentStderr.length > MAX_RECENT_STDERR_LINES) {
    recentStderr.splice(0, recentStderr.length - MAX_RECENT_STDERR_LINES)
  }
}

function summarizeRecentStderr(recentStderr: string[]): string | null {
  if (recentStderr.length === 0) return null
  return truncateForLog(recentStderr.join(' | '))
}

function summarizeConfiguredEnvKeys(env: Record<string, string> | undefined): string {
  const keys = Object.keys(env || {}).sort()
  return keys.length > 0 ? keys.join(', ') : '(none)'
}

function isProxyConfigured(env: Record<string, string>): boolean {
  return !!(env.http_proxy || env.HTTP_PROXY || env.https_proxy || env.HTTPS_PROXY)
}

// ── Windows hidden-subprocess init script ──
// 在 Windows 上防止 stdio MCP server 弹出控制台窗口

const WINDOWS_HIDE_INIT_SCRIPT_NAME = 'mcp-bridge-windows-hide-init.js'
const WINDOWS_HIDE_INIT_SCRIPT_CONTENT = [
  '// Auto-generated: hide subprocess console windows on Windows',
  'const cp = require("child_process");',
  'for (const fn of ["spawn", "execFile"]) {',
  '  const original = cp[fn];',
  '  cp[fn] = function(file, args, options) {',
  '    const addWindowsHide = (o) => ({ ...(o || {}), windowsHide: true });',
  '    if (typeof args === "function" || args === undefined) {',
  '      return original.call(this, file, addWindowsHide(undefined), args);',
  '    }',
  '    return original.call(this, file, addWindowsHide(args), options);',
  '  };',
  '}',
  ''
].join('\n')

function ensureWindowsHideInitScript(): string | null {
  if (process.platform !== 'win32') return null
  try {
    const dir = path.join(app.getPath('userData'), 'mcp-bridge', 'bin')
    fs.mkdirSync(dir, { recursive: true })
    const scriptPath = path.join(dir, WINDOWS_HIDE_INIT_SCRIPT_NAME)
    const existing = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : ''
    if (existing !== WINDOWS_HIDE_INIT_SCRIPT_CONTENT) {
      fs.writeFileSync(scriptPath, WINDOWS_HIDE_INIT_SCRIPT_CONTENT, 'utf8')
    }
    return scriptPath
  } catch (e) {
    log(
      'WARN',
      `Failed to create Windows hide init script: ${e instanceof Error ? e.message : String(e)}`
    )
    return null
  }
}

function prependRequireArg(args: string[], scriptPath: string): string[] {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--require' && args[i + 1] === scriptPath) return args
  }
  return ['--require', scriptPath, ...args]
}

// ── Command Resolution ──
// 打包环境下 node/npx/npm 命令解析：优先系统 Node.js，fallback 到 Electron runtime

interface ResolvedStdioCommand {
  command: string
  args: string[]
  env: Record<string, string> | undefined
}

// 缓存 which node 结果，进程生命周期内只查一次
let _systemNodePath: string | false | undefined

function findSystemNodePath(): string | null {
  if (_systemNodePath !== undefined) {
    return _systemNodePath || null
  }
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which'
    const result = spawnSync(whichCmd, ['node'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true
    })
    if (result.status === 0 && result.stdout) {
      const resolved = result.stdout.trim().split(/\r?\n/)[0].trim()
      if (resolved) {
        _systemNodePath = resolved
        log('INFO', `System Node.js found: ${resolved}`)
        return resolved
      }
    }
  } catch {
    /* ignore */
  }
  _systemNodePath = false
  log('INFO', 'System Node.js not found on PATH')
  return null
}

function isNodeCommand(normalized: string): 'node' | 'npx' | 'npm' | null {
  if (
    normalized === 'node' ||
    normalized === 'node.exe' ||
    normalized.endsWith('\\node.cmd') ||
    normalized.endsWith('/node.cmd')
  ) {
    return 'node'
  }
  if (
    normalized === 'npx' ||
    normalized === 'npx.cmd' ||
    normalized.endsWith('\\npx.cmd') ||
    normalized.endsWith('/npx.cmd')
  ) {
    return 'npx'
  }
  if (
    normalized === 'npm' ||
    normalized === 'npm.cmd' ||
    normalized.endsWith('\\npm.cmd') ||
    normalized.endsWith('/npm.cmd')
  ) {
    return 'npm'
  }
  return null
}

/**
 * 解析 stdio MCP server 的 command/args/env。
 *
 * 打包环境下 node/npx/npm 命令解析顺序：
 * 1. 优先使用系统 Node.js（避免 Electron stdin 兼容性问题）
 * 2. 回退到 Electron runtime（ELECTRON_RUN_AS_NODE=1）
 */
async function resolveStdioCommand(server: McpServer): Promise<ResolvedStdioCommand> {
  const config = server.config as StdioConfig
  const stdioCommand = config.command || ''
  let effectiveCommand = stdioCommand
  const stdioArgs = config.args || []
  let effectiveArgs = [...stdioArgs]
  let stdioEnv = config.env && Object.keys(config.env).length > 0 ? { ...config.env } : undefined
  let shouldInjectWindowsHide = false

  const electronNodeRuntimePath = getElectronNodeRuntimePath()

  // Windows 打包环境：node/npx/npm 命令解析
  if (process.platform === 'win32' && app.isPackaged && effectiveCommand) {
    const normalized = effectiveCommand.trim().toLowerCase()
    const nodeCommandType = isNodeCommand(normalized)

    if (nodeCommandType) {
      const systemNode = findSystemNodePath()
      if (systemNode) {
        if (nodeCommandType === 'node') {
          effectiveCommand = systemNode
          log(
            'INFO',
            `"${server.name}": using system Node.js "${systemNode}" (preferred over Electron runtime)`
          )
        } else {
          // npx/npm：直接使用系统命令
          effectiveCommand = stdioCommand
          log('INFO', `"${server.name}": using system "${stdioCommand}" directly`)
        }
      } else {
        // 无系统 Node.js，回退到 Electron runtime
        const withElectronNodeEnv = (
          base: Record<string, string> | undefined
        ): Record<string, string> => ({
          ...(base || {}),
          ELECTRON_RUN_AS_NODE: '1',
          PETCLAW_ELECTRON_PATH: electronNodeRuntimePath
        })

        if (nodeCommandType === 'node') {
          effectiveCommand = electronNodeRuntimePath
          stdioEnv = withElectronNodeEnv(stdioEnv)
          shouldInjectWindowsHide = true
          log(
            'WARN',
            `"${server.name}": no system Node.js found, falling back to Electron runtime (may cause stdin issues)`
          )
        }
        // npx/npm fallback 在 Windows 上不做 Electron 重写，直接使用原命令
      }
    }
  }

  // macOS 打包：检测 command 是否指向 app 自身可执行文件，重写为 Electron helper
  if (
    app.isPackaged &&
    process.platform === 'darwin' &&
    stdioCommand &&
    path.isAbsolute(stdioCommand)
  ) {
    const commandCandidates = new Set([stdioCommand, path.resolve(stdioCommand)])
    const appExecCandidates = new Set([
      process.execPath,
      path.resolve(process.execPath),
      electronNodeRuntimePath,
      path.resolve(electronNodeRuntimePath)
    ])
    try {
      commandCandidates.add(fs.realpathSync.native(stdioCommand))
    } catch {
      /* ignore */
    }
    try {
      appExecCandidates.add(fs.realpathSync.native(process.execPath))
    } catch {
      /* ignore */
    }
    try {
      appExecCandidates.add(fs.realpathSync.native(electronNodeRuntimePath))
    } catch {
      /* ignore */
    }

    if (Array.from(commandCandidates).some((c) => appExecCandidates.has(c))) {
      effectiveCommand = electronNodeRuntimePath
      stdioEnv = {
        ...(stdioEnv || {}),
        ELECTRON_RUN_AS_NODE: '1',
        PETCLAW_ELECTRON_PATH: electronNodeRuntimePath
      }
      log('INFO', `"${server.name}": rewrote macOS command → Electron helper`)
    }
  }

  // Windows：注入 windowsHide init script
  if (process.platform === 'win32' && shouldInjectWindowsHide) {
    const initScript = ensureWindowsHideInitScript()
    if (initScript) {
      effectiveArgs = prependRequireArg(effectiveArgs, initScript)
    }
  }

  return { command: effectiveCommand, args: effectiveArgs, env: stdioEnv }
}

// ── McpServerManager ──

export class McpServerManager {
  private servers: Map<string, ManagedMcpServer> = new Map()
  private _toolManifest: McpToolManifestEntry[] = []

  get toolManifest(): McpToolManifestEntry[] {
    return this._toolManifest
  }

  get isRunning(): boolean {
    return this.servers.size > 0
  }

  /** 启动 MCP servers 并发现 tools。先停止现有连接再重建。 */
  async startServers(enabledServers: McpServer[]): Promise<McpToolManifestEntry[]> {
    if (this.servers.size > 0) {
      log('INFO', `Restarting ${this.servers.size} existing MCP server connections before refresh`)
      await this.stopServers()
    }

    log('INFO', `Starting ${enabledServers.length} MCP servers`)

    // 并行启动所有 server，单个失败不阻塞其他
    const results = await Promise.allSettled(
      enabledServers.map((server) => this.startSingleServer(server))
    )

    // 收集所有成功启动的 server 的 tools
    this._toolManifest = []
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled' && result.value) {
        this._toolManifest.push(...result.value.tools)
      } else if (result.status === 'rejected') {
        log('WARN', `Failed to start MCP server "${enabledServers[i].name}": ${result.reason}`)
      }
    }

    log('INFO', `Discovered ${this._toolManifest.length} tools from ${this.servers.size} servers`)
    return this._toolManifest
  }

  /** 停止所有 MCP server 连接 */
  async stopServers(): Promise<void> {
    log('INFO', `Stopping ${this.servers.size} MCP servers`)
    const closePromises: Promise<void>[] = []

    for (const [name, server] of this.servers) {
      closePromises.push(
        (async () => {
          try {
            await server.client.close()
            log('INFO', `Stopped MCP server "${name}"`)
          } catch (error) {
            log(
              'WARN',
              `Error stopping "${name}": ${error instanceof Error ? error.message : String(error)}`
            )
          }
        })()
      )
    }

    await Promise.allSettled(closePromises)
    this.servers.clear()
    this._toolManifest = []
  }

  /** 在指定 MCP server 上执行 tool 调用。支持 AbortSignal 中断。 */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<{ content: Array<{ type: string; text?: string }>; isError: boolean }> {
    const server = this.servers.get(serverName)
    if (!server) {
      return {
        content: [{ type: 'text', text: `MCP server "${serverName}" not found or not running` }],
        isError: true
      }
    }

    // 请求开始前就已 abort 则直接返回
    if (options?.signal?.aborted) {
      return {
        content: [{ type: 'text', text: 'Tool execution aborted: request cancelled before start' }],
        isError: true
      }
    }

    try {
      const startedAt = Date.now()
      const argsPreview = serializeForLog(args)
      log(
        'INFO',
        `Calling tool "${toolName}" on server "${serverName}" with arguments ${argsPreview}`
      )

      // tool 调用与 AbortSignal 竞赛：gateway 断连时立即返回
      const toolPromise = server.client.callTool({ name: toolName, arguments: args })
      let result: Awaited<typeof toolPromise>
      if (options?.signal) {
        result = await raceAbortSignal(toolPromise, options.signal, `Tool "${toolName}" aborted`)
      } else {
        result = await toolPromise
      }

      const content = Array.isArray(result.content)
        ? (result.content as Array<{ type: string; text?: string }>)
        : [{ type: 'text', text: String(result.content) }]
      const elapsedMs = Date.now() - startedAt
      const contentPreview = serializeToolContentForLog(content)
      const textPreview = getToolTextPreview(content)
      const recentStderr = summarizeRecentStderr(server.recentStderr)
      log(
        'INFO',
        `Tool "${toolName}" on "${serverName}" completed in ${elapsedMs}ms with isError=${result.isError === true}. Result=${contentPreview}`
      )

      // isError=true 或文本看起来像传输错误时记录 warning
      if (result.isError === true) {
        const stderrSuffix = recentStderr ? ` | recent stderr: ${recentStderr}` : ''
        log(
          'WARN',
          `Tool "${toolName}" on "${serverName}" returned isError=true. Result text="${textPreview || '(none)'}"${stderrSuffix}`
        )
      } else if (looksLikeTransportErrorText(textPreview)) {
        const stderrSuffix = recentStderr ? ` | recent stderr: ${recentStderr}` : ''
        log(
          'WARN',
          `Tool "${toolName}" on "${serverName}" returned transport-style error text without isError. Result text="${textPreview}"${stderrSuffix}`
        )
      }
      return { content, isError: result.isError === true }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      const recentStderr = summarizeRecentStderr(server.recentStderr)
      const stderrSuffix = recentStderr ? ` | recent stderr: ${recentStderr}` : ''
      log(
        'ERROR',
        `Tool call "${toolName}" on "${serverName}" failed. Arguments=${serializeForLog(args)}${stderrSuffix} | error=${errMsg}`
      )
      return {
        content: [{ type: 'text', text: `Tool execution error: ${errMsg}` }],
        isError: true
      }
    }
  }

  // ── 内部：单个 server 启动 ──

  private buildRemoteRequestInit(record: McpServer): RequestInit | undefined {
    if (record.transportType === 'stdio') return undefined
    const httpConfig = record.config as HttpConfig
    if (!httpConfig.headers || Object.keys(httpConfig.headers).length === 0) {
      return undefined
    }
    return { headers: { ...httpConfig.headers } }
  }

  private async startSingleServer(record: McpServer): Promise<ManagedMcpServer | null> {
    const recentStderr: string[] = []

    let transport: Transport
    if (record.transportType === 'stdio') {
      const resolved = await resolveStdioCommand(record)
      if (!resolved.command) {
        log('WARN', `Server "${record.name}" has no command, skipping`)
        return null
      }

      // 合并增强 env（PATH、代理等）和 server 自定义 env
      const enhancedEnv = await getEnhancedEnv()
      const spawnEnv: Record<string, string> = {
        ...Object.fromEntries(
          Object.entries(enhancedEnv).filter((e): e is [string, string] => typeof e[1] === 'string')
        ),
        ...(resolved.env || {})
      }
      log(
        'INFO',
        `Starting "${record.name}" via stdio: command=${resolved.command}, args=${serializeForLog(resolved.args)}, configuredEnvKeys=${summarizeConfiguredEnvKeys(resolved.env)}, proxy=${isProxyConfigured(spawnEnv) ? 'enabled' : 'disabled'}`
      )

      const stdioTransport = new StdioClientTransport({
        command: resolved.command,
        args: resolved.args,
        env: spawnEnv
      })
      // 捕获 stderr 用于诊断：tool 调用失败时附带最近的 stderr 输出
      if (stdioTransport.stderr) {
        stdioTransport.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString().trim()
          if (text) {
            appendRecentStderr(recentStderr, text)
            log('WARN', `"${record.name}" stderr: ${text}`)
          }
        })
      }
      transport = stdioTransport
    } else {
      // SSE / Streamable HTTP transport
      const httpConfig = record.config as HttpConfig
      const rawUrl = httpConfig.url?.trim()
      if (!rawUrl) {
        log(
          'WARN',
          `Server "${record.name}" has no URL configured for ${record.transportType} transport`
        )
        return null
      }

      let parsedUrl: URL
      try {
        parsedUrl = new URL(rawUrl)
      } catch (error) {
        log(
          'WARN',
          `Server "${record.name}" has invalid URL "${rawUrl}": ${error instanceof Error ? error.message : String(error)}`
        )
        return null
      }

      const requestInit = this.buildRemoteRequestInit(record)
      if (record.transportType === 'sse') {
        log('INFO', `Starting "${record.name}" via SSE: url=${parsedUrl.toString()}`)
        transport = new SSEClientTransport(parsedUrl, requestInit ? { requestInit } : undefined)
      } else {
        log('INFO', `Starting "${record.name}" via Streamable HTTP: url=${parsedUrl.toString()}`)
        transport = new StreamableHTTPClientTransport(
          parsedUrl,
          requestInit ? { requestInit } : undefined
        )
      }
    }

    // 创建 MCP SDK Client 并连接
    const client = new Client(
      { name: 'petclaw-mcp-bridge', version: '1.0.0' },
      { capabilities: {} }
    )

    try {
      await client.connect(transport)
      log('INFO', `Connected to MCP server "${record.name}"`)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      const stderrSummary =
        recentStderr.length > 0 ? ` | recent stderr: ${summarizeRecentStderr(recentStderr)}` : ''
      log('ERROR', `Failed to connect to "${record.name}": ${errMsg}${stderrSummary}`)
      try {
        await transport.close()
      } catch {
        /* ignore */
      }
      return null
    }

    // 发现 tools
    let tools: McpToolManifestEntry[] = []
    try {
      const result = await client.listTools()
      tools = (result.tools || []).map((t) => ({
        server: record.name,
        name: t.name,
        description: t.description || '',
        inputSchema: (t.inputSchema || {}) as Record<string, unknown>
      }))
      log(
        'INFO',
        `Server "${record.name}": discovered ${tools.length} tools: [${tools.map((t) => t.name).join(', ')}]`
      )
    } catch (error) {
      log(
        'WARN',
        `Failed to list tools from "${record.name}": ${error instanceof Error ? error.message : String(error)}`
      )
    }

    const managed: ManagedMcpServer = { record, client, transport, tools, recentStderr }
    this.servers.set(record.name, managed)
    return managed
  }
}
