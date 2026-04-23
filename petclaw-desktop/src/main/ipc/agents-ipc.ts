// agents-ipc.ts: Agent CRUD 的 IPC 处理层
// channel 命名遵循 `模块:动作` 格式，与 preload/index.d.ts 保持一致
import { ipcMain } from 'electron'

import type { AgentManager } from '../agents/agent-manager'
import type { Agent } from '../ai/types'

export interface AgentsIpcDeps {
  agentManager: AgentManager
}

export function registerAgentsIpcHandlers(deps: AgentsIpcDeps): void {
  const { agentManager } = deps

  // 返回全部 Agent 列表（含预设和自定义）
  ipcMain.handle('agents:list', async () => agentManager.list())

  // 按 id 查询单个 Agent，不存在时返回 undefined
  ipcMain.handle('agents:get', async (_event, id: string) => agentManager.get(id))

  // 创建新 Agent，id / createdAt / updatedAt 由 manager 自动生成
  ipcMain.handle(
    'agents:create',
    async (_event, data: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>) => agentManager.create(data)
  )

  // 局部更新 Agent 字段，返回更新后的完整 Agent
  ipcMain.handle('agents:update', async (_event, id: string, patch: Partial<Agent>) =>
    agentManager.update(id, patch)
  )

  // 删除 Agent；默认 Agent（isDefault=true）禁止删除，manager 会抛出错误
  ipcMain.handle('agents:delete', async (_event, id: string) => agentManager.delete(id))
}
