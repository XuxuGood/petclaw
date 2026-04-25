// src/main/ai/directory-manager.ts
// DirectoryManager：目录注册 + deriveAgentId + openclaw.json 配置生成
// 替代旧 AgentManager，用户只选择目录，Agent ID 自动派生
import { EventEmitter } from 'events'
import type Database from 'better-sqlite3'

import { deriveAgentId, type Directory } from './types'

interface OpenclawAgentEntry {
  id: string
  default?: boolean
  workspace?: string
  model?: { primary: string }
  skills?: string[]
}

interface OpenclawAgentsConfig {
  defaults: { timeoutSeconds: number; model: { primary: string }; workspace: string }
  list: OpenclawAgentEntry[]
}

export class DirectoryManager extends EventEmitter {
  constructor(
    private db: Database.Database,
    // main agent 的默认 workspace 路径
    private defaultWorkspace: string
  ) {
    super()
  }

  // 注册目录（首次使用时自动调用，幂等）
  ensureRegistered(directoryPath: string): Directory {
    const agentId = deriveAgentId(directoryPath)
    const existing = this.get(agentId)
    if (existing) return existing

    const now = Date.now()
    this.db
      .prepare(
        'INSERT INTO directories (agent_id, path, created_at, updated_at) VALUES (?, ?, ?, ?)'
      )
      .run(agentId, directoryPath, now, now)

    this.emit('change')
    return this.get(agentId)!
  }

  get(agentId: string): Directory | null {
    const row = this.db.prepare('SELECT * FROM directories WHERE agent_id = ?').get(agentId) as
      | Record<string, unknown>
      | undefined
    return row ? this.rowToDirectory(row) : null
  }

  getByPath(directoryPath: string): Directory | null {
    const row = this.db.prepare('SELECT * FROM directories WHERE path = ?').get(directoryPath) as
      | Record<string, unknown>
      | undefined
    return row ? this.rowToDirectory(row) : null
  }

  list(): Directory[] {
    const rows = this.db
      .prepare('SELECT * FROM directories ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>
    return rows.map((r) => this.rowToDirectory(r))
  }

  updateName(agentId: string, name: string): void {
    this.db
      .prepare('UPDATE directories SET name = ?, updated_at = ? WHERE agent_id = ?')
      .run(name, Date.now(), agentId)
    this.emit('change')
  }

  updateModelOverride(agentId: string, model: string): void {
    this.db
      .prepare('UPDATE directories SET model_override = ?, updated_at = ? WHERE agent_id = ?')
      .run(model, Date.now(), agentId)
    this.emit('change')
  }

  updateSkillIds(agentId: string, skillIds: string[]): void {
    this.db
      .prepare('UPDATE directories SET skill_ids = ?, updated_at = ? WHERE agent_id = ?')
      .run(JSON.stringify(skillIds), Date.now(), agentId)
    this.emit('change')
  }

  // 序列化为 openclaw.json agents 配置段
  toOpenclawConfig(): OpenclawAgentsConfig {
    const directories = this.list()
    const list: OpenclawAgentEntry[] = [{ id: 'main', default: true }]

    for (const dir of directories) {
      const entry: OpenclawAgentEntry = {
        id: dir.agentId,
        workspace: dir.path
      }
      if (dir.modelOverride) {
        entry.model = { primary: dir.modelOverride }
      }
      if (dir.skillIds.length > 0) {
        entry.skills = dir.skillIds
      }
      list.push(entry)
    }

    return {
      defaults: {
        timeoutSeconds: 3600,
        model: { primary: 'llm/petclaw-fast' },
        workspace: this.defaultWorkspace
      },
      list
    }
  }

  private rowToDirectory(row: Record<string, unknown>): Directory {
    return {
      agentId: row.agent_id as string,
      path: row.path as string,
      name: (row.name as string) ?? null,
      modelOverride: (row.model_override as string) ?? '',
      skillIds: JSON.parse((row.skill_ids as string) ?? '[]') as string[],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number
    }
  }
}
