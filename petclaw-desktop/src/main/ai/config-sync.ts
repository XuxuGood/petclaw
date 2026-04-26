// config-sync.ts：将 Openclaw 运行时配置（openclaw.json）与当前 Manager 状态同步
// 重构为直接依赖 Manager 对象（ConfigSyncOptions），移除 ConfigSyncDeps 函数注入接口
import fs from 'fs'

import type { DirectoryManager } from './directory-manager'
import type { ModelRegistry } from '../models/model-registry'
import type { SkillManager } from '../skills/skill-manager'
import type { McpManager } from '../mcp/mcp-manager'

export interface ConfigSyncResult {
  ok: boolean
  changed: boolean
  configPath: string
  error?: string
}

export interface ConfigSyncOptions {
  configPath: string
  stateDir: string
  directoryManager: DirectoryManager
  modelRegistry: ModelRegistry
  skillManager: SkillManager
  mcpManager: McpManager
}

export class ConfigSync {
  private configPath: string
  private directoryManager: DirectoryManager
  private modelRegistry: ModelRegistry
  private skillManager: SkillManager
  private mcpManager: McpManager

  constructor(private opts: ConfigSyncOptions) {
    this.configPath = opts.configPath
    this.directoryManager = opts.directoryManager
    this.modelRegistry = opts.modelRegistry
    this.skillManager = opts.skillManager
    this.mcpManager = opts.mcpManager
  }

  sync(_reason: string): ConfigSyncResult {
    try {
      const existing = this.readExistingConfig()
      const nextConfig = this.buildConfig(existing)
      const nextContent = JSON.stringify(nextConfig, null, 2)
      const prevContent = this.readFileOrNull(this.configPath)

      if (nextContent === prevContent) {
        return { ok: true, changed: false, configPath: this.configPath }
      }

      // 原子写入：先写临时文件再 rename，防止写入中途崩溃导致配置文件损坏
      const tmpPath = `${this.configPath}.tmp-${Date.now()}`
      fs.writeFileSync(tmpPath, nextContent, 'utf8')
      fs.renameSync(tmpPath, this.configPath)

      return { ok: true, changed: true, configPath: this.configPath }
    } catch (err) {
      return {
        ok: false,
        changed: false,
        configPath: this.configPath,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  collectSecretEnvVars(): Record<string, string> {
    // 委托 ModelRegistry 收集需注入子进程环境的 API Key
    return this.modelRegistry.collectSecretEnvVars()
  }

  private buildConfig(existing: Record<string, unknown>): Record<string, unknown> {
    return {
      // gateway 字段保留已有配置，首次生成时使用默认本地模式
      gateway: existing.gateway ?? {
        mode: 'local',
        auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' }
      },
      models: this.modelRegistry.toOpenclawConfig(),
      agents: this.directoryManager.toOpenclawConfig(),
      skills: this.skillManager.toOpenclawConfig(),
      // MCP 服务器映射为 plugins 配置块
      plugins: this.mcpManager.toOpenclawConfig(),
      hooks: { internal: { entries: { 'session-memory': { enabled: false } } } },
      commands: { ownerAllowFrom: ['gateway-client', '*'] }
    }
  }

  private readExistingConfig(): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'))
    } catch {
      return {}
    }
  }

  private readFileOrNull(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, 'utf8')
    } catch {
      return null
    }
  }
}
