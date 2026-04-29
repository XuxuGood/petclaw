// mcp-ipc.ts: MCP 服务器 CRUD 和启用状态管理的 IPC 处理层
// MCP 服务器配置持久化到 SQLite mcp_servers 表，change 事件触发 openclaw 配置重写
import { safeHandle } from './ipc-registry'
import type { McpManager } from '../mcp/mcp-manager'
import type { McpServer } from '../ai/types'

export interface McpIpcDeps {
  mcpManager: McpManager
  /** 手动触发 MCP Bridge 刷新（重建连接 → 发现 tools → sync 配置）*/
  refreshMcpBridge?: () => Promise<void>
}

export function registerMcpIpcHandlers(deps: McpIpcDeps): void {
  const { mcpManager, refreshMcpBridge } = deps

  // 返回全部 MCP 服务器列表（含启用状态）
  safeHandle('mcp:list', async () => mcpManager.list())

  // 创建新 MCP 服务器，id / createdAt / updatedAt 由 manager 自动生成
  safeHandle(
    'mcp:create',
    async (_event, data: Omit<McpServer, 'id' | 'createdAt' | 'updatedAt'>) =>
      mcpManager.create(data)
  )

  // 局部更新 MCP 服务器配置，返回更新后的完整对象
  safeHandle('mcp:update', async (_event, id: string, patch: Partial<McpServer>) =>
    mcpManager.update(id, patch)
  )

  // 删除 MCP 服务器
  safeHandle('mcp:delete', async (_event, id: string) => mcpManager.delete(id))

  // 快捷切换服务器启用/禁用状态，无需走完整 update 流程
  safeHandle('mcp:set-enabled', async (_event, id: string, enabled: boolean) => {
    mcpManager.setEnabled(id, enabled)
  })

  // 手动触发 MCP Bridge 刷新（Settings UI 中点击刷新按钮）
  safeHandle('mcp:bridge:refresh', async () => {
    if (!refreshMcpBridge) {
      return { success: false, error: 'MCP Bridge not initialized' }
    }
    try {
      await refreshMcpBridge()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
