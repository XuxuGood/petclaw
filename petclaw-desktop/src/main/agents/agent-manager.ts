// AgentManager：Agent CRUD 操作 + 预设 Agent 安装
// 继承 EventEmitter，写操作（create/update/delete）后触发 'change' 事件，
// 供上层（IPC handler、config-sync）监听并刷新 Openclaw 配置
import { EventEmitter } from 'events'
import type Database from 'better-sqlite3'

import type { Agent } from '../ai/types'
import { PRESET_AGENTS } from './preset-agents'

export class AgentManager extends EventEmitter {
  constructor(
    private db: Database.Database,
    // workspace 路径用于生成 Openclaw 配置
    private workspacePath: string
  ) {
    super()
  }

  // 幂等安装预设 Agent：已存在的 id 跳过，避免重复写入
  ensurePresetAgents(): void {
    const existing = this.list()
    const existingIds = new Set(existing.map((a) => a.id))
    const now = Date.now()

    for (const preset of PRESET_AGENTS) {
      if (!existingIds.has(preset.id)) {
        this.db
          .prepare(
            `INSERT INTO agents
              (id, name, description, system_prompt, identity, model, icon, skill_ids,
               enabled, is_default, source, preset_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            preset.id,
            preset.name,
            preset.description,
            preset.systemPrompt,
            preset.identity,
            preset.model,
            preset.icon,
            JSON.stringify(preset.skillIds),
            preset.enabled ? 1 : 0,
            preset.isDefault ? 1 : 0,
            preset.source,
            preset.presetId,
            now,
            now
          )
      }
    }
  }

  create(data: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Agent {
    const id = crypto.randomUUID()
    const now = Date.now()

    this.db
      .prepare(
        `INSERT INTO agents
          (id, name, description, system_prompt, identity, model, icon, skill_ids,
           enabled, is_default, source, preset_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.name,
        data.description,
        data.systemPrompt,
        data.identity,
        data.model,
        data.icon,
        JSON.stringify(data.skillIds),
        data.enabled ? 1 : 0,
        data.isDefault ? 1 : 0,
        data.source,
        data.presetId,
        now,
        now
      )

    this.emit('change')
    return this.get(id)!
  }

  update(id: string, patch: Partial<Agent>): Agent {
    const existing = this.get(id)
    if (!existing) throw new Error(`Agent not found: ${id}`)

    const fields: string[] = []
    const values: unknown[] = []

    for (const [key, value] of Object.entries(patch)) {
      // camelCase → snake_case 字段映射
      const col = key.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
      // 跳过不可变字段
      if (col === 'id' || col === 'created_at') continue

      if (key === 'skillIds') {
        // 数组序列化为 JSON 字符串
        fields.push('skill_ids = ?')
        values.push(JSON.stringify(value))
      } else if (typeof value === 'boolean') {
        // SQLite 无 boolean 类型，用 0/1 存储
        fields.push(`${col} = ?`)
        values.push(value ? 1 : 0)
      } else {
        fields.push(`${col} = ?`)
        values.push(value)
      }
    }

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    this.db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    this.emit('change')
    return this.get(id)!
  }

  delete(id: string): void {
    const agent = this.get(id)
    if (!agent) return
    // isDefault 的 main agent 是系统保留 agent，禁止删除
    if (agent.isDefault) throw new Error('Cannot delete the default agent')

    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id)
    this.emit('change')
  }

  list(): Agent[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY created_at ASC').all() as Array<
      Record<string, unknown>
    >
    return rows.map((r) => this.rowToAgent(r))
  }

  get(id: string): Agent | undefined {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? this.rowToAgent(row) : undefined
  }

  // 生成 Openclaw 运行时配置片段，由 config-sync 合并到完整配置文件
  toOpenclawConfig(): {
    defaults: { timeoutSeconds: number; model: { primary: string }; workspace: string }
  } {
    const mainAgent = this.list().find((a) => a.isDefault)
    return {
      defaults: {
        timeoutSeconds: 3600,
        model: { primary: mainAgent?.model || 'llm/petclaw-fast' },
        workspace: this.workspacePath
      }
    }
  }

  // 将数据库行（snake_case）映射为 Agent 类型（camelCase）
  private rowToAgent(row: Record<string, unknown>): Agent {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      systemPrompt: row.system_prompt as string,
      identity: row.identity as string,
      model: row.model as string,
      icon: row.icon as string,
      skillIds: JSON.parse(row.skill_ids as string) as string[],
      enabled: row.enabled === 1,
      isDefault: row.is_default === 1,
      source: row.source as 'preset' | 'custom',
      presetId: row.preset_id as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number
    }
  }
}
