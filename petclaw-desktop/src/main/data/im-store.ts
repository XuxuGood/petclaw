// src/main/data/im-store.ts
// ImStore — im_instances / im_conversation_bindings / im_session_mappings 表 CRUD
import type Database from 'better-sqlite3'

import type { ImConversationBinding, ImInstance, ImInstanceConfig, Platform } from '../im/types'

const DEFAULT_INSTANCE_CONFIG: ImInstanceConfig = {
  dmPolicy: 'open',
  groupPolicy: 'disabled',
  allowFrom: [],
  debug: false
}

export class ImStore {
  constructor(private db: Database.Database) {}

  // ── 实例 CRUD ──

  insertInstance(
    id: string,
    platform: Platform,
    credentials: Record<string, unknown>,
    name: string | null
  ): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO im_instances (id, platform, name, credentials, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        platform,
        name,
        JSON.stringify(credentials),
        JSON.stringify(DEFAULT_INSTANCE_CONFIG),
        now,
        now
      )
  }

  getInstance(id: string): ImInstance | null {
    const row = this.db.prepare('SELECT * FROM im_instances WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? this.rowToInstance(row) : null
  }

  listInstances(): ImInstance[] {
    const rows = this.db
      .prepare('SELECT * FROM im_instances ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>
    return rows.map((r) => this.rowToInstance(r))
  }

  updateInstance(
    id: string,
    patch: Partial<
      Pick<ImInstance, 'name' | 'directoryPath' | 'agentId' | 'credentials' | 'config' | 'enabled'>
    >
  ): void {
    const fields: string[] = []
    const values: unknown[] = []
    if (patch.name !== undefined) {
      fields.push('name = ?')
      values.push(patch.name)
    }
    if (patch.directoryPath !== undefined) {
      fields.push('directory_path = ?')
      values.push(patch.directoryPath)
    }
    if (patch.agentId !== undefined) {
      fields.push('agent_id = ?')
      values.push(patch.agentId)
    }
    if (patch.credentials !== undefined) {
      fields.push('credentials = ?')
      values.push(JSON.stringify(patch.credentials))
    }
    if (patch.config !== undefined) {
      fields.push('config = ?')
      values.push(JSON.stringify(patch.config))
    }
    if (patch.enabled !== undefined) {
      fields.push('enabled = ?')
      values.push(patch.enabled ? 1 : 0)
    }
    if (fields.length === 0) return
    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)
    this.db.prepare(`UPDATE im_instances SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteInstance(id: string): void {
    this.db.prepare('DELETE FROM im_instances WHERE id = ?').run(id)
  }

  // ── 对话绑定 ──

  setConversationBinding(
    conversationId: string,
    instanceId: string,
    peerKind: 'dm' | 'group',
    directoryPath: string,
    agentId: string
  ): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT OR REPLACE INTO im_conversation_bindings
       (conversation_id, instance_id, peer_kind, directory_path, agent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(conversationId, instanceId, peerKind, directoryPath, agentId, now, now)
  }

  getConversationBinding(conversationId: string, instanceId: string): ImConversationBinding | null {
    const row = this.db
      .prepare(
        'SELECT * FROM im_conversation_bindings WHERE conversation_id = ? AND instance_id = ?'
      )
      .get(conversationId, instanceId) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      conversationId: row.conversation_id as string,
      instanceId: row.instance_id as string,
      peerKind: row.peer_kind as 'dm' | 'group',
      directoryPath: row.directory_path as string,
      agentId: row.agent_id as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number
    }
  }

  removeConversationBinding(conversationId: string, instanceId: string): void {
    this.db
      .prepare('DELETE FROM im_conversation_bindings WHERE conversation_id = ? AND instance_id = ?')
      .run(conversationId, instanceId)
  }

  // ── 会话映射 ──

  upsertSessionMapping(
    conversationId: string,
    instanceId: string,
    sessionId: string,
    agentId: string
  ): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT OR REPLACE INTO im_session_mappings
       (conversation_id, instance_id, session_id, agent_id, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(conversationId, instanceId, sessionId, agentId, now, now)
  }

  getSessionMapping(
    conversationId: string,
    instanceId: string
  ): { session_id: string; agent_id: string } | null {
    return (
      (this.db
        .prepare(
          'SELECT session_id, agent_id FROM im_session_mappings WHERE conversation_id = ? AND instance_id = ?'
        )
        .get(conversationId, instanceId) as { session_id: string; agent_id: string } | undefined) ??
      null
    )
  }

  private rowToInstance(row: Record<string, unknown>): ImInstance {
    return {
      id: row.id as string,
      platform: row.platform as Platform,
      name: (row.name as string) ?? null,
      directoryPath: (row.directory_path as string) ?? null,
      agentId: (row.agent_id as string) ?? null,
      credentials: JSON.parse(row.credentials as string) as Record<string, unknown>,
      config: JSON.parse(row.config as string) as ImInstanceConfig,
      enabled: (row.enabled as number) === 1,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number
    }
  }
}
