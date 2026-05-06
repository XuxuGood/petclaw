// config-sync.ts：将 Openclaw 运行时配置（openclaw.json）与当前 Manager 状态同步
import fs from 'fs'
import path from 'path'

import type { DirectoryManager } from './directory-manager'
import type { ModelRegistry } from '../models/model-registry'
import type { SkillManager } from '../skills/skill-manager'
import type { McpManager } from '../mcp/mcp-manager'
import type { CoworkConfigStore } from '../data/cowork-config-store'
import type { ImGatewayManager } from '../im/im-gateway-manager'
import type { MemorySearchConfigStore } from '../memory/memory-search-config-store'
import type { McpToolManifestEntry } from './types'
import { readAgentsTemplate, buildManagedSections } from './managed-prompts'
import { getLogger } from '../logging/facade'

const logger = getLogger('ConfigSync')

export interface ConfigSyncResult {
  ok: boolean
  changed: boolean
  configPath: string
  error?: string
  // 当 bindings 或 secretEnvVars 或 mcpBridgeConfig 变更时为 true，caller 需要硬重启 gateway
  // （这两类变更无法通过 runtime 热加载生效）
  needsGatewayRestart: boolean
}

/** MCP Bridge 配置：由 McpBridgeServer + McpServerManager 组合提供 */
export interface McpBridgeConfig {
  callbackUrl: string
  askUserCallbackUrl: string
  secret: string
  tools: McpToolManifestEntry[]
}

export interface ConfigSyncOptions {
  configPath: string
  stateDir: string
  workspacePath: string
  skillsDir: string
  coworkConfigStore: CoworkConfigStore
  directoryManager: DirectoryManager
  modelRegistry: ModelRegistry
  skillManager: SkillManager
  mcpManager: McpManager
  imGatewayManager?: ImGatewayManager
  memorySearchConfigStore?: MemorySearchConfigStore
  getRuntimeRoot?: () => string | null
  /** MCP Bridge 配置回调：返回 callbackUrl/secret/tools，无可用时返回 null */
  getMcpBridgeConfig?: () => McpBridgeConfig | null
}

type JsonObject = Record<string, unknown>

interface GatewayConfig extends JsonObject {
  mode: string
  auth: { mode: string; token: string }
  tailscale: { mode: string }
}

interface CronConfig {
  enabled: boolean
  skipMissedJobs: boolean
  maxConcurrentRuns: number
  sessionRetention: string
}

interface ExecApprovalAgentEntry {
  security?: string
  ask?: string
  [key: string]: unknown
}

interface ExecApprovalsFile {
  version: number
  agents?: Record<string, ExecApprovalAgentEntry>
  [key: string]: unknown
}

export class ConfigSync {
  private configPath: string
  private stateDir: string
  private workspacePath: string
  private skillsDir: string
  private coworkConfigStore: CoworkConfigStore
  private directoryManager: DirectoryManager
  private modelRegistry: ModelRegistry
  private skillManager: SkillManager
  private mcpManager: McpManager
  private imGatewayManager?: ImGatewayManager
  private memorySearchConfigStore?: MemorySearchConfigStore
  private getRuntimeRoot: () => string | null
  private getMcpBridgeConfig: (() => McpBridgeConfig | null) | undefined

  // 用于变更检测：bindings 或 env vars 变了需要硬重启 gateway
  private previousBindingsJson: string | undefined
  private previousSecretEnvVarsJson: string | undefined
  // MCP Bridge config 变更检测：plugin config 变了也需要硬重启 gateway
  private previousMcpBridgeConfigJson: string | undefined

  constructor(private opts: ConfigSyncOptions) {
    this.configPath = opts.configPath
    this.stateDir =
      path.basename(opts.stateDir) === 'state' ? opts.stateDir : path.join(opts.stateDir, 'state')
    this.workspacePath = opts.workspacePath
    this.skillsDir = opts.skillsDir
    this.coworkConfigStore = opts.coworkConfigStore
    this.directoryManager = opts.directoryManager
    this.modelRegistry = opts.modelRegistry
    this.skillManager = opts.skillManager
    this.mcpManager = opts.mcpManager
    this.imGatewayManager = opts.imGatewayManager
    this.memorySearchConfigStore = opts.memorySearchConfigStore
    this.getRuntimeRoot = opts.getRuntimeRoot ?? (() => null)
    this.getMcpBridgeConfig = opts.getMcpBridgeConfig
  }

  /**
   * 绑定各 Manager 的 change 事件，变更时自动触发 ConfigSync 同步。
   * 由 index.ts 在 ConfigSync 构造后调用一次，集中管理所有变更源。
   *
   * @param onSynced 每次同步完成后的回调，接收同步原因和结果。
   *   caller 可在此处理需要 gateway 重启等后续操作。
   */
  bindChangeListeners(onSynced?: (reason: string, result: ConfigSyncResult) => void): void {
    const handle = (reason: string): void => {
      const result = this.sync(reason)
      onSynced?.(reason, result)
    }
    this.directoryManager.on('change', () => handle('directory-change'))
    this.modelRegistry.on('change', () => handle('model-change'))
    this.skillManager.on('change', () => handle('skill-change'))
    // mcpManager.on('change') 由 index.ts 管理：
    // MCP CRUD 后需要先 refreshMcpBridge()（连接 -> 发现 tools）再 sync，
    // 不能在这里直接触发 sync（此时 tools 还未更新）。

    // IM 变更使用 600ms debounce：批量切换平台开关等操作会触发连续 change 事件，
    // 合并后只触发一次 sync，避免多次无意义的 gateway 重启判断
    let imDebounceTimer: ReturnType<typeof setTimeout> | null = null
    this.imGatewayManager?.on('change', () => {
      if (imDebounceTimer) clearTimeout(imDebounceTimer)
      imDebounceTimer = setTimeout(() => {
        imDebounceTimer = null
        handle('im-change')
      }, 600)
    })
  }

  sync(reason: string): ConfigSyncResult {
    try {
      const agentsMdChanged = this.syncAgentsMd(this.workspacePath)
      const execApprovalsChanged = this.syncExecApprovalDefaults()
      const configChanged = this.syncOpenClawConfig()

      // 检测 bindings 变更（channel plugins 不支持热加载 bindings）
      const bindingsJson = JSON.stringify(this.buildBindingsConfig())
      const bindingsChanged =
        this.previousBindingsJson !== undefined && bindingsJson !== this.previousBindingsJson
      this.previousBindingsJson = bindingsJson

      // 检测 secretEnvVars 变更（env vars 在进程 spawn 时固定，运行时无法修改）
      const currentEnvVars = this.collectSecretEnvVars()
      const secretEnvVarsJson = JSON.stringify(currentEnvVars)
      const secretEnvVarsChanged =
        this.previousSecretEnvVarsJson !== undefined &&
        secretEnvVarsJson !== this.previousSecretEnvVarsJson
      const changedEnvKeys = secretEnvVarsChanged ? this.diffEnvVarKeys(currentEnvVars) : ''
      this.previousSecretEnvVarsJson = secretEnvVarsJson

      // 检测 MCP Bridge plugin config 变更（tools/callbackUrl 变化需要重启 gateway）
      const mcpBridgeConfig = this.getMcpBridgeConfig?.()
      const mcpBridgeConfigJson = mcpBridgeConfig
        ? JSON.stringify({
            callbackUrl: mcpBridgeConfig.callbackUrl,
            askUserCallbackUrl: mcpBridgeConfig.askUserCallbackUrl,
            tools: mcpBridgeConfig.tools
          })
        : ''
      const mcpBridgeConfigChanged =
        this.previousMcpBridgeConfigJson !== undefined &&
        mcpBridgeConfigJson !== this.previousMcpBridgeConfigJson
      this.previousMcpBridgeConfigJson = mcpBridgeConfigJson

      const needsGatewayRestart = bindingsChanged || secretEnvVarsChanged || mcpBridgeConfigChanged

      // 诊断日志：记录每次同步结果和变更明细
      if (configChanged || agentsMdChanged || needsGatewayRestart) {
        logger.warn('sync.changed', 'Config sync changed runtime inputs', {
          reason,
          configChanged,
          agentsMdChanged,
          execApprovalsChanged,
          bindingsChanged,
          secretEnvVarsChanged,
          changedEnvKeys,
          mcpBridgeConfigChanged,
          needsGatewayRestart
        })
      }

      return {
        ok: true,
        changed: agentsMdChanged || execApprovalsChanged || configChanged,
        configPath: this.configPath,
        needsGatewayRestart
      }
    } catch (err) {
      logger.error('sync.failed', 'Config sync failed', { reason }, err)
      return {
        ok: false,
        changed: false,
        configPath: this.configPath,
        error: err instanceof Error ? err.message : String(err),
        needsGatewayRestart: false
      }
    }
  }

  collectSecretEnvVars(): Record<string, string> {
    // 明文密钥只通过环境变量注入 Openclaw 子进程，配置文件仅保留占位符。
    const vars: Record<string, string> = {
      ...this.modelRegistry.collectSecretEnvVars(),
      ...(this.imGatewayManager?.collectSecretEnvVars() ?? {}),
      ...(this.memorySearchConfigStore?.collectSecretEnvVars() ?? {})
    }

    // MCP Bridge secret 注入子进程环境
    const bridgeConfig = this.getMcpBridgeConfig?.()
    if (bridgeConfig?.secret) {
      vars.PETCLAW_MCP_BRIDGE_SECRET = bridgeConfig.secret
    }

    return vars
  }

  private syncExecApprovalDefaults(): boolean {
    const approvalsPath = path.join(this.stateDir, '..', '.openclaw', 'exec-approvals.json')
    const existing = this.readExecApprovalsFile(approvalsPath)
    if (!existing.agents) existing.agents = {}
    if (!existing.agents.main) existing.agents.main = {}

    const main = existing.agents.main
    if (main.security === 'full' && main.ask === 'off') return false

    main.security = 'full'
    main.ask = 'off'

    return this.atomicWriteIfChanged(approvalsPath, `${JSON.stringify(existing, null, 2)}\n`)
  }

  private syncOpenClawConfig(): boolean {
    const existing = this.readExistingConfig()
    const modelsConfig = this.buildModelsConfig()
    const providers = this.asRecord((modelsConfig as Record<string, unknown>).providers)

    // API 未配置时写最小配置，避免空 providers 导致 gateway 异常。
    // 保留已有 plugins（IM 通道可能仍有效）。
    if (Object.keys(providers).length === 0) {
      const minimalConfig: Record<string, unknown> = {
        gateway: this.buildGatewayConfig(this.asRecord(existing.gateway)),
        ...(existing.plugins ? { plugins: existing.plugins } : {})
      }
      return this.atomicWriteIfChanged(this.configPath, JSON.stringify(minimalConfig, null, 2))
    }

    const nextConfig = this.buildConfig(existing, modelsConfig)
    const nextContent = JSON.stringify(nextConfig, null, 2)

    return this.atomicWriteIfChanged(this.configPath, nextContent)
  }

  private buildConfig(
    existing: Record<string, unknown>,
    modelsConfig: Record<string, unknown>
  ): Record<string, unknown> {
    const channelsConfig = this.buildChannelsConfig()
    const bindingsConfig = this.buildBindingsConfig()

    return {
      gateway: this.buildGatewayConfig(this.asRecord(existing.gateway)),
      models: modelsConfig,
      agents: this.buildAgentsConfig(),
      ...bindingsConfig,
      ...(Object.keys(channelsConfig).length > 0 ? { channels: channelsConfig } : {}),
      session: this.buildSessionConfig(),
      skills: this.buildSkillsConfig(),
      tools: this.buildToolsConfig(),
      browser: this.buildBrowserConfig(),
      cron: this.buildCronConfig(),
      plugins: this.buildPluginsConfig(this.asRecord(existing.plugins)),
      commands: this.buildCommandsConfig()
    }
  }

  private buildGatewayConfig(existingGateway: Record<string, unknown>): GatewayConfig {
    return {
      ...existingGateway,
      mode: 'local',
      auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' },
      tailscale: { mode: 'off' }
    }
  }

  private buildModelsConfig(): Record<string, unknown> {
    return this.modelRegistry.toOpenclawConfig()
  }

  private buildAgentsConfig(): Record<string, unknown> {
    const directoryAgents = this.directoryManager.toOpenclawConfig()
    const memorySearch = this.memorySearchConfigStore?.toOpenclawConfig()
    return {
      defaults: {
        timeoutSeconds: 3600,
        model: { primary: this.modelRegistry.getDefaultOpenClawModelRef() },
        workspace: this.workspacePath,
        sandbox: { mode: 'off' },
        ...(memorySearch ? { memorySearch } : {})
      },
      list: directoryAgents.list
    }
  }

  private buildSkillsConfig(): Record<string, unknown> {
    return this.skillManager.toOpenclawConfig()
  }

  private buildChannelsConfig(): Record<string, unknown> {
    return this.imGatewayManager?.toOpenclawChannelsConfig() ?? {}
  }

  private buildBindingsConfig(): Record<string, unknown> {
    return this.imGatewayManager?.toOpenclawBindingsConfig() ?? {}
  }

  private buildToolsConfig(): Record<string, unknown> {
    return {
      deny: ['web_search'],
      web: { search: { enabled: false } }
    }
  }

  private buildBrowserConfig(): Record<string, unknown> {
    return { enabled: true }
  }

  // 30d keepAlive = 空闲 43200 分钟后自动重置 session
  private buildSessionConfig(): Record<string, unknown> {
    return {
      dmScope: 'per-account-channel-peer',
      reset: { mode: 'idle', idleMinutes: 43200 },
      maintenance: { pruneAfter: '365d', maxEntries: 1000000, rotateBytes: '1gb' }
    }
  }

  private buildCronConfig(): CronConfig {
    const config = this.coworkConfigStore.getConfig()
    return {
      enabled: true,
      skipMissedJobs: config.skipMissedJobs,
      maxConcurrentRuns: 3,
      sessionRetention: '7d'
    }
  }

  private buildPluginsConfig(existingPlugins: Record<string, unknown>): Record<string, unknown> {
    // MCP Bridge 配置：通过 getMcpBridgeConfig 回调获取 callbackUrl/secret/tools
    const mcpBridgeConfig = this.getMcpBridgeConfig?.()
    const mcpBridgePlugins = mcpBridgeConfig
      ? {
          entries: {
            'mcp-bridge': {
              enabled: true,
              config: {
                callbackUrl: mcpBridgeConfig.callbackUrl,
                secret: '${PETCLAW_MCP_BRIDGE_SECRET}',
                tools: mcpBridgeConfig.tools
              }
            },
            'ask-user-question': {
              enabled: true,
              config: {
                callbackUrl: mcpBridgeConfig.askUserCallbackUrl,
                secret: '${PETCLAW_MCP_BRIDGE_SECRET}'
              }
            }
          }
        }
      : {}

    const imPlugins = this.imGatewayManager
      ? { entries: this.imGatewayManager.toOpenclawPluginEntries() }
      : {}

    return {
      ...this.mergePluginConfigs(
        this.mergePluginConfigs(existingPlugins, mcpBridgePlugins),
        imPlugins
      ),
      // 显式清空 deny list：runtime 会校验 deny ID 是否存在，
      // deny 已删除的 plugin 会导致 "plugin not found" 错误
      deny: []
    }
  }

  private buildCommandsConfig(): Record<string, unknown> {
    return { ownerAllowFrom: ['gateway-client', '*'] }
  }

  // 对比当前和上一次的 env var keys，返回变更的 key 列表（不暴露值）
  private diffEnvVarKeys(current: Record<string, string>): string {
    if (!this.previousSecretEnvVarsJson) return Object.keys(current).join(',')
    const previous = JSON.parse(this.previousSecretEnvVarsJson) as Record<string, string>
    const allKeys = new Set([...Object.keys(previous), ...Object.keys(current)])
    const changed: string[] = []
    for (const key of allKeys) {
      if (previous[key] !== current[key]) changed.push(key)
    }
    return changed.join(',')
  }

  private syncAgentsMd(workspacePath: string): boolean {
    fs.mkdirSync(workspacePath, { recursive: true })

    const agentsMdPath = path.join(workspacePath, 'AGENTS.md')
    const marker = '<!-- PetClaw managed: do not edit below this line -->'
    const systemPrompt = this.coworkConfigStore
      .getConfig()
      .systemPrompt.replaceAll(marker, '')
      .trim()
    const managedSections = [
      systemPrompt ? `## System Prompt\n\n${systemPrompt}` : '',
      ...buildManagedSections(this.skillsDir)
    ].filter(Boolean)

    const existingContent = this.readFileOrNull(agentsMdPath)
    const markerIndex = existingContent?.indexOf(marker) ?? -1
    const userContent =
      markerIndex >= 0
        ? existingContent!.slice(0, markerIndex).trimEnd()
        : existingContent?.trimEnd() || readAgentsTemplate(this.getRuntimeRoot())

    const nextContent = `${userContent}\n\n${marker}\n\n${managedSections.join('\n\n')}\n`

    return this.atomicWriteIfChanged(agentsMdPath, nextContent)
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }

  private mergePluginConfigs(
    existingPlugins: Record<string, unknown>,
    managedPlugins: Record<string, unknown>
  ): Record<string, unknown> {
    const existingEntries = this.asRecord(existingPlugins.entries)
    const managedEntries = this.asRecord(managedPlugins.entries)

    return {
      ...existingPlugins,
      ...managedPlugins,
      entries: {
        ...existingEntries,
        ...managedEntries
      }
    }
  }

  private readExistingConfig(): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'))
    } catch {
      return {}
    }
  }

  private readExecApprovalsFile(filePath: string): ExecApprovalsFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const root = parsed as Record<string, unknown>
        if (root.version !== 1) return { version: 1 }

        const agentsRaw = this.asRecord(root.agents)
        const mainRaw = this.asRecord(agentsRaw.main) as ExecApprovalAgentEntry
        return {
          ...root,
          version: 1,
          agents: {
            ...Object.fromEntries(
              Object.entries(agentsRaw).filter(([, value]) => {
                return value && typeof value === 'object' && !Array.isArray(value)
              })
            ),
            main: mainRaw
          } as Record<string, ExecApprovalAgentEntry>
        }
      }
    } catch {
      /* ignore */
    }
    return { version: 1 }
  }

  private readFileOrNull(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, 'utf8')
    } catch {
      return null
    }
  }

  private atomicWriteIfChanged(filePath: string, nextContent: string): boolean {
    const prevContent = this.readFileOrNull(filePath)
    if (nextContent === prevContent) {
      return false
    }

    // 原子写入：先写同目录临时文件再 rename，防止写入中途崩溃导致文件损坏
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tmpPath = `${filePath}.tmp-${Date.now()}`
    fs.writeFileSync(tmpPath, nextContent, 'utf8')
    fs.renameSync(tmpPath, filePath)
    return true
  }
}
