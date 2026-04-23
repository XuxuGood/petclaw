// mcp-ipc.ts: MCP 服务器 CRUD 和启用状态管理的 IPC 处理层
// MCP 服务器配置持久化到 SQLite mcp_servers 表，change 事件触发 openclaw 配置重写
import { ipcMain } from 'electron'

import type { McpManager } from '../mcp/mcp-manager'
import type { McpServer } from '../ai/types'

export interface McpIpcDeps {
  mcpManager: McpManager
}

export function registerMcpIpcHandlers(deps: McpIpcDeps): void {
  const { mcpManager } = deps

  // 返回全部 MCP 服务器列表（含启用状态）
  ipcMain.handle('mcp:list', async () => mcpManager.list())

  // 创建新 MCP 服务器，id / createdAt / updatedAt 由 manager 自动生成
  ipcMain.handle(
    'mcp:create',
    async (_event, data: Omit<McpServer, 'id' | 'createdAt' | 'updatedAt'>) =>
      mcpManager.create(data)
  )

  // 局部更新 MCP 服务器配置，返回更新后的完整对象
  ipcMain.handle('mcp:update', async (_event, id: string, patch: Partial<McpServer>) =>
    mcpManager.update(id, patch)
  )

  // 删除 MCP 服务器
  ipcMain.handle('mcp:delete', async (_event, id: string) => mcpManager.delete(id))

  // 快捷切换服务器启用/禁用状态，无需走完整 update 流程
  ipcMain.handle('mcp:set-enabled', async (_event, id: string, enabled: boolean) => {
    mcpManager.setEnabled(id, enabled)
  })
}
