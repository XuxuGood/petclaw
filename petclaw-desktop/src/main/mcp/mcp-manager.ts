// McpManager: MCP 服务器 CRUD 管理
// SQL 操作委托给 McpStore，Manager 只含业务逻辑和事件通知。
// MCP Bridge 集成后，toOpenclawConfig() 被移除，
// plugin config 由 ConfigSync 通过 getMcpBridgeConfig 回调生成。
import { EventEmitter } from 'events'

import type { McpStore } from '../data/mcp-store'
import type { McpServer } from '../ai/types'

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

  /** 返回所有已启用的 MCP servers，供 McpServerManager 启动连接 */
  listEnabled(): McpServer[] {
    return this.store.list().filter((s) => s.enabled)
  }
}
