// src/main/im/im-gateway-manager.ts
// ImGatewayManager 管理 IM 平台配置的 CRUD（持久化到 im_config 表）和会话路由映射。
// 大多数 IM 平台通过 OpenClaw 插件运行（不在 PetClaw 主进程中直接管理连接），
// PetClaw 端只管理配置和推送 ConfigSync。
import { EventEmitter } from 'events'

import type Database from 'better-sqlite3'

import type { IMPlatformConfig, IMSettings } from './types'

// IM 全局设置默认值（未保存时返回此默认值）
const DEFAULT_SETTINGS: IMSettings = {
  systemPrompt: '',
  skillsEnabled: true,
  platformAgentBindings: {}
}

export class ImGatewayManager extends EventEmitter {
  constructor(private db: Database.Database) {
    super()
  }

  // ── 平台配置 CRUD ──

  // 保存或更新平台配置，key 格式: 'feishu' 或 'dingtalk:instance-1'（多实例）
  savePlatformConfig(key: string, config: IMPlatformConfig): void {
    const now = Date.now()
    this.db
      .prepare('INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)')
      .run(key, JSON.stringify(config), now)
    // 配置变更时通知订阅方（如 ConfigSync）
    this.emit('change')
  }

  loadPlatformConfig(key: string): IMPlatformConfig | null {
    const row = this.db.prepare('SELECT value FROM im_config WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row ? (JSON.parse(row.value) as IMPlatformConfig) : null
  }

  deletePlatformConfig(key: string): void {
    this.db.prepare('DELETE FROM im_config WHERE key = ?').run(key)
    this.emit('change')
  }

  // 列举所有平台配置（排除 settings 这个特殊 key）
  listPlatformConfigs(): Array<{ key: string; config: IMPlatformConfig }> {
    const rows = this.db
      .prepare("SELECT key, value FROM im_config WHERE key != 'settings'")
      .all() as Array<{ key: string; value: string }>
    return rows.map((row) => ({
      key: row.key,
      config: JSON.parse(row.value) as IMPlatformConfig
    }))
  }

  // ── IM 全局设置 ──

  // 全局设置以 'settings' 作为 key 存入 im_config，与平台配置共表隔离
  saveSettings(settings: IMSettings): void {
    const now = Date.now()
    this.db
      .prepare('INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)')
      .run('settings', JSON.stringify(settings), now)
    this.emit('change')
  }

  loadSettings(): IMSettings {
    const row = this.db.prepare("SELECT value FROM im_config WHERE key = 'settings'").get() as
      | { value: string }
      | undefined
    return row ? (JSON.parse(row.value) as IMSettings) : { ...DEFAULT_SETTINGS }
  }

  // ── Agent 绑定查询 ──

  // 查询平台绑定的 Agent，未绑定时兜底返回 'main'
  getAgentForPlatform(platformKey: string): string {
    const settings = this.loadSettings()
    return settings.platformAgentBindings[platformKey] ?? 'main'
  }

  // ── 会话路由映射 ──

  // 维护 IM 侧会话与内部 cowork 会话的绑定关系（upsert 语义）
  upsertSessionMapping(
    imConversationId: string,
    platform: string,
    coworkSessionId: string,
    agentId: string
  ): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT OR REPLACE INTO im_session_mappings
         (im_conversation_id, platform, cowork_session_id, agent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(imConversationId, platform, coworkSessionId, agentId, now, now)
  }

  getSessionMapping(
    imConversationId: string,
    platform: string
  ): { cowork_session_id: string; agent_id: string } | null {
    return (
      (this.db
        .prepare(
          'SELECT cowork_session_id, agent_id FROM im_session_mappings WHERE im_conversation_id = ? AND platform = ?'
        )
        .get(imConversationId, platform) as
        | { cowork_session_id: string; agent_id: string }
        | undefined) ?? null
    )
  }

  // ── 序列化为 OpenClaw 配置（供 ConfigSync 使用） ──

  // 只导出已启用的平台配置，用于推送给 OpenClaw runtime
  toOpenclawConfig(): Record<string, unknown> {
    const configs = this.listPlatformConfigs()
    const result: Record<string, unknown> = {}
    for (const { key, config } of configs) {
      if (config.enabled) {
        result[key] = config
      }
    }
    return result
  }
}
