// mcp-bridge-server.ts：MCP Bridge HTTP callback server
// 为 OpenClaw 的 mcp-bridge 和 ask-user-question 扩展提供 HTTP 端点。
// 绑定 127.0.0.1 随机端口，仅本地流量。
import crypto from 'crypto'
import http from 'http'
import net from 'net'

import {
  getToolTextPreview,
  looksLikeTransportErrorText,
  serializeForLog,
  serializeToolContentForLog
} from './mcp-log'
import type { McpServerManager } from './mcp-server-manager'
import { getLogger } from '../logging'

const log = (level: string, msg: string): void => {
  const formatted = `[McpBridge:HTTP][${level}] ${msg}`
  try {
    const logger = getLogger('McpBridgeHTTP', 'mcp')
    if (level === 'ERROR') {
      logger.error('mcp.http.error', 'MCP bridge HTTP server emitted an error', {
        message: formatted
      })
    } else if (level === 'WARN') {
      logger.warn('mcp.http.warn', 'MCP bridge HTTP server emitted a warning', {
        message: formatted
      })
    } else {
      logger.info('mcp.http.info', 'MCP bridge HTTP server emitted an info message', {
        message: formatted
      })
    }
  } catch {
    // MCP 日志不能影响本地 callback server。
  }
}

export type AskUserRequest = {
  requestId: string
  questions: Array<{
    question: string
    header?: string
    options: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  }>
}

export type AskUserResponse = {
  behavior: 'allow' | 'deny'
  answers?: Record<string, string>
}

type PendingAskUser = {
  requestId: string
  resolve: (response: AskUserResponse) => void
  timer: ReturnType<typeof setTimeout>
}

export class McpBridgeServer {
  private server: http.Server | null = null
  private _port: number | null = null
  private readonly mcpManager: McpServerManager
  private readonly secret: string
  private readonly pendingAskUser = new Map<string, PendingAskUser>()
  private onAskUserCallback: ((request: AskUserRequest) => void) | null = null
  private onAskUserDismissCallback: ((requestId: string) => void) | null = null

  constructor(mcpManager: McpServerManager, secret: string) {
    this.mcpManager = mcpManager
    this.secret = secret
    log('INFO', 'McpBridgeServer created')
  }

  get port(): number | null {
    return this._port
  }

  get callbackUrl(): string | null {
    return this._port ? `http://127.0.0.1:${this._port}/mcp/execute` : null
  }

  get askUserCallbackUrl(): string | null {
    return this._port ? `http://127.0.0.1:${this._port}/askuser` : null
  }

  /**
   * 注册 AskUserQuestion 请求到达回调。
   * callback 应弹出确认弹窗，最终调用 resolveAskUser()。
   */
  onAskUser(callback: (request: AskUserRequest) => void): void {
    this.onAskUserCallback = callback
  }

  /**
   * 注册 AskUser 请求结束回调（超时或已响应）。
   * callback 应关闭 renderer 中的弹窗。
   */
  onAskUserDismiss(callback: (requestId: string) => void): void {
    this.onAskUserDismissCallback = callback
  }

  /** 解决挂起的 AskUser 请求（用户在弹窗中点击后调用） */
  resolveAskUser(requestId: string, response: AskUserResponse): void {
    const pending = this.pendingAskUser.get(requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingAskUser.delete(requestId)
    pending.resolve(response)
  }

  /** 启动 HTTP callback server，监听随机空闲端口 */
  async start(): Promise<number> {
    if (this.server) {
      throw new Error('McpBridgeServer is already running')
    }

    const port = await this.findFreePort()

    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          log(
            'ERROR',
            `Unhandled error in handleRequest: ${err instanceof Error ? err.message : String(err)}`
          )
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })
      })

      srv.on('error', (err) => {
        log('ERROR', `HTTP server error: ${err.message}`)
        reject(err)
      })

      srv.listen(port, '127.0.0.1', () => {
        this._port = port
        this.server = srv
        log('INFO', `McpBridgeServer listening on http://127.0.0.1:${port}`)
        resolve(port)
      })
    })
  }

  /** 停止 HTTP callback server */
  async stop(): Promise<void> {
    if (!this.server) return

    return new Promise((resolve) => {
      this.server!.close(() => {
        log('INFO', 'McpBridgeServer stopped')
        this.server = null
        this._port = null
        resolve()
      })
      // 2 秒后强制关闭残留连接
      setTimeout(() => {
        this.server?.closeAllConnections?.()
      }, 2000)
    })
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    // 验证 secret：同时接受 mcp-bridge 和 ask-user-question 的 header 名
    const authHeader = req.headers['x-mcp-bridge-secret'] || req.headers['x-ask-user-secret']
    if (authHeader !== this.secret) {
      log(
        'WARN',
        `Auth rejected for ${req.url}: header=${authHeader ? 'present-but-mismatch' : 'missing'}`
      )
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    if (req.url?.startsWith('/askuser')) {
      await this.handleAskUser(req, res)
      return
    }

    if (req.url?.startsWith('/mcp/execute')) {
      await this.handleMcpExecute(req, res)
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }

  // ── AskUser 端点 ──
  // 创建 pending Promise → 通知 renderer 弹窗 → 等待用户选择或 120s 超时

  private async handleAskUser(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const ASKUSER_TIMEOUT_MS = 120_000

    try {
      const body = await this.readBody(req)
      const input = JSON.parse(body) as { questions?: unknown[] }
      log(
        'INFO',
        `AskUser request received, questions=${Array.isArray(input.questions) ? input.questions.length : 0}`
      )

      if (!Array.isArray(input.questions) || input.questions.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing or empty "questions" field' }))
        return
      }

      const requestId = crypto.randomUUID()
      log('INFO', `AskUser waiting for user response, requestId=${requestId}`)

      // 创建 Promise：用户响应 或 120s 超时自动 deny
      const userResponse = await new Promise<AskUserResponse>((resolve) => {
        const timer = setTimeout(() => {
          log('INFO', `AskUser timeout, requestId=${requestId}`)
          this.pendingAskUser.delete(requestId)
          this.onAskUserDismissCallback?.(requestId)
          resolve({ behavior: 'deny' })
        }, ASKUSER_TIMEOUT_MS)

        this.pendingAskUser.set(requestId, { requestId, resolve, timer })

        // 通知 PetClaw 弹出确认弹窗
        if (this.onAskUserCallback) {
          this.onAskUserCallback({
            requestId,
            questions: input.questions as AskUserRequest['questions']
          })
        } else {
          log('WARN', 'AskUser callback not registered, denying')
          clearTimeout(timer)
          this.pendingAskUser.delete(requestId)
          resolve({ behavior: 'deny' })
        }
      })

      log('INFO', `AskUser resolved, requestId=${requestId} behavior=${userResponse.behavior}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(userResponse))
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      log('ERROR', `AskUser request error: ${errMsg}`)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ behavior: 'deny' }))
    }
  }

  // ── MCP Execute 端点 ──
  // 解析 {server, tool, args} → 调用 McpServerManager.callTool() → 返回结果

  private async handleMcpExecute(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // 连接中断检测：gateway 断连（如 chat.abort）时取消进行中的 MCP tool 调用。
    // 监听 res（ServerResponse）而非 req（IncomingMessage），因为 req 在 body 读完后
    // 会自动 close，导致 signal 在 callTool 开始前就被 abort。
    // res.close 在 socket 断连时触发，只在响应未完成时才 abort。
    const abortController = new AbortController()
    const onClose = (): void => {
      if (!res.writableFinished) {
        abortController.abort()
      }
    }
    res.on('close', onClose)

    try {
      const body = await this.readBody(req)
      const { server, tool, args } = JSON.parse(body) as {
        server: string
        tool: string
        args: Record<string, unknown>
      }

      log(
        'INFO',
        `Execute request received for server="${server}" tool="${tool}" with arguments ${serializeForLog(args || {})}`
      )

      if (!server || !tool) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing "server" or "tool" field' }))
        return
      }

      const t0 = Date.now()
      const result = await this.mcpManager.callTool(server, tool, args || {}, {
        signal: abortController.signal
      })
      const contentPreview = serializeToolContentForLog(result.content)
      const textPreview = getToolTextPreview(result.content)
      log(
        'INFO',
        `Execute completed for server="${server}" tool="${tool}" in ${Date.now() - t0}ms with isError=${result.isError}. Result=${contentPreview}`
      )
      if (!result.isError && looksLikeTransportErrorText(textPreview)) {
        log(
          'WARN',
          `Execute completed for server="${server}" tool="${tool}" with transport-style error text but isError=false. Result text="${textPreview}"`
        )
      }

      if (!res.writableEnded) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      log('ERROR', `Request handling error: ${errMsg}`)
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            content: [{ type: 'text', text: `Bridge error: ${errMsg}` }],
            isError: true
          })
        )
      }
    } finally {
      res.removeListener('close', onClose)
    }
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer()
      srv.once('error', reject)
      srv.once('listening', () => {
        const addr = srv.address()
        const port = typeof addr === 'object' && addr ? addr.port : 0
        srv.close(() => resolve(port))
      })
      srv.listen(0, '127.0.0.1')
    })
  }
}
