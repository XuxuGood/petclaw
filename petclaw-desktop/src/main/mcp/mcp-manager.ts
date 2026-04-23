// McpManager: MCP 服务器 CRUD 管理，持久化到 SQLite mcp_servers 表
// 继承 EventEmitter，在数据变更时 emit 'change' 事件，供上层（如 openclaw 配置生成）订阅刷新
import { EventEmitter } from 'events'
import type Database from 'better-sqlite3'

import type { McpServer, StdioConfig, HttpConfig } from '../ai/types'

export class McpManager extends EventEmitter {
  constructor(private db: Database.Database) {
    super()
  }

  create(data: Omit<McpServer, 'id' | 'createdAt' | 'updatedAt'>): McpServer {
    const id = crypto.randomUUID()
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
    this.emit('change')
    return this.get(id)!
  }

  update(id: string, patch: Partial<McpServer>): McpServer {
    const existing = this.get(id)
    if (!existing) throw new Error(`MCP server not found: ${id}`)

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

    fields.push('updated_at = ?')
    values.push(Date.now())
    // WHERE id = ? 的参数放最后
    values.push(id)

    this.db.prepare(`UPDATE mcp_servers SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    this.emit('change')
    return this.get(id)!
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
    this.emit('change')
  }

  list(): McpServer[] {
    const rows = this.db
      .prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>
    return rows.map((r) => this.rowToServer(r))
  }

  get(id: string): McpServer | undefined {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? this.rowToServer(row) : undefined
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare('UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, Date.now(), id)
    this.emit('change')
  }

  // 将已启用的 MCP 服务器序列化为 openclaw 配置格式（mcp-bridge 插件 config）
  toOpenclawConfig(): {
    entries: Record<string, { enabled: boolean; config: { servers: Record<string, unknown> } }>
  } {
    const servers: Record<string, unknown> = {}
    for (const s of this.list()) {
      // 仅导出已启用的服务器
      if (!s.enabled) continue
      if (s.transportType === 'stdio') {
        const cfg = s.config as StdioConfig
        servers[s.name] = {
          transport: 'stdio',
          command: cfg.command,
          args: cfg.args,
          ...(cfg.env && { env: cfg.env })
        }
      } else {
        // sse / streamable-http 均通过 url 方式连接
        const cfg = s.config as HttpConfig
        servers[s.name] = {
          transport: s.transportType,
          url: cfg.url,
          ...(cfg.headers && { headers: cfg.headers })
        }
      }
    }
    return {
      entries: {
        'mcp-bridge': {
          enabled: Object.keys(servers).length > 0,
          config: { servers }
        }
      }
    }
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
