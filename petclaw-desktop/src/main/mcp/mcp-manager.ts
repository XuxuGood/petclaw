// McpManager: MCP 服务器 CRUD 管理
// SQL 操作委托给 McpStore，Manager 只含业务逻辑和事件通知
import { EventEmitter } from 'events'

import type { McpStore } from '../data/mcp-store'
import type { McpServer, StdioConfig, HttpConfig } from '../ai/types'

export class McpManager extends EventEmitter {
  constructor(private store: McpStore) {
    super()
  }

  create(data: Omit<McpServer, 'id' | 'createdAt' | 'updatedAt'>): McpServer {
    const id = crypto.randomUUID()
    this.store.insert(id, data)
    this.emit('change')
    return this.store.get(id)!
  }

  update(id: string, patch: Partial<McpServer>): McpServer {
    const existing = this.store.get(id)
    if (!existing) throw new Error(`MCP server not found: ${id}`)

    this.store.update(id, patch)
    this.emit('change')
    return this.store.get(id)!
  }

  delete(id: string): void {
    this.store.delete(id)
    this.emit('change')
  }

  list(): McpServer[] {
    return this.store.list()
  }

  get(id: string): McpServer | undefined {
    return this.store.get(id)
  }

  setEnabled(id: string, enabled: boolean): void {
    this.store.setEnabled(id, enabled)
    this.emit('change')
  }

  // 将已启用的 MCP 服务器序列化为 openclaw 配置格式（mcp-bridge 插件 config）
  toOpenclawConfig(): {
    entries: Record<string, { enabled: boolean; config: { servers: Record<string, unknown> } }>
  } {
    const servers: Record<string, unknown> = {}
    for (const s of this.store.list()) {
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
}
