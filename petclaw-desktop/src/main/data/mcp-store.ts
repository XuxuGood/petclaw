// src/main/data/mcp-store.ts
// McpStore — mcp_servers 表 CRUD
import type Database from 'better-sqlite3'

import type { McpServer } from '../ai/types'

export class McpStore {
  constructor(private db: Database.Database) {}

  get(id: string): McpServer | undefined {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? this.rowToServer(row) : undefined
  }

  list(): McpServer[] {
    const rows = this.db
      .prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>
    return rows.map((r) => this.rowToServer(r))
  }

  insert(id: string, data: Omit<McpServer, 'id' | 'createdAt' | 'updatedAt'>): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO mcp_servers (id, name, description, enabled, transport_type, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.name,
        data.description,
        data.enabled ? 1 : 0,
        data.transportType,
        JSON.stringify(data.config),
        now,
        now
      )
  }

  update(id: string, patch: Partial<McpServer>): void {
    const fields: string[] = []
    const values: unknown[] = []

    if (patch.name !== undefined) {
      fields.push('name = ?')
      values.push(patch.name)
    }
    if (patch.description !== undefined) {
      fields.push('description = ?')
      values.push(patch.description)
    }
    if (patch.enabled !== undefined) {
      fields.push('enabled = ?')
      values.push(patch.enabled ? 1 : 0)
    }
    if (patch.transportType !== undefined) {
      fields.push('transport_type = ?')
      values.push(patch.transportType)
    }
    if (patch.config !== undefined) {
      fields.push('config_json = ?')
      values.push(JSON.stringify(patch.config))
    }

    if (fields.length === 0) return
    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    this.db.prepare(`UPDATE mcp_servers SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare('UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, Date.now(), id)
  }

  private rowToServer(row: Record<string, unknown>): McpServer {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      enabled: row.enabled === 1,
      transportType: row.transport_type as McpServer['transportType'],
      config: JSON.parse(row.config_json as string),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number
    }
  }
}
