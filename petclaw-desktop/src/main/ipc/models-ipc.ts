// models-ipc.ts: 模型 Provider 和活跃模型管理的 IPC 处理层
// API Key 在返回给渲染进程时自动脱敏，真实 Key 永不传出主进程
import { ipcMain } from 'electron'

import type { ModelRegistry } from '../models/model-registry'
import type { ModelProvider, ModelDefinition } from '../ai/types'

export interface ModelsIpcDeps {
  modelRegistry: ModelRegistry
}

export function registerModelsIpcHandlers(deps: ModelsIpcDeps): void {
  const { modelRegistry } = deps

  // 返回 Provider 列表，API Key 脱敏为前5位 + "****"，防止 Key 泄露到渲染进程
  ipcMain.handle('models:providers', async () => {
    return modelRegistry.listProviders().map((p) => ({
      ...p,
      apiKey: p.apiKey ? `${p.apiKey.slice(0, 5)}****` : ''
    }))
  })

  // 按 id 查询单个 Provider，API Key 同样脱敏
  ipcMain.handle('models:provider', async (_event, id: string) => {
    const p = modelRegistry.getProvider(id)
    if (!p) return null
    return { ...p, apiKey: p.apiKey ? `${p.apiKey.slice(0, 5)}****` : '' }
  })

  // 添加新 Provider（渲染进程传入含明文 apiKey 的完整 ModelProvider）
  ipcMain.handle('models:add-provider', async (_event, data: ModelProvider) => {
    modelRegistry.addProvider(data)
  })

  // 局部更新 Provider 字段（如 apiKey、enabled 等）
  ipcMain.handle(
    'models:update-provider',
    async (_event, id: string, patch: Partial<ModelProvider>) => {
      modelRegistry.updateProvider(id, patch)
    }
  )

  // 删除自定义 Provider；预设 Provider 不可删除，manager 会抛出错误
  ipcMain.handle('models:remove-provider', async (_event, id: string) => {
    modelRegistry.removeProvider(id)
  })

  // 快捷切换 Provider 启用/禁用状态，触发 change 事件以刷新 openclaw 配置
  ipcMain.handle('models:toggle-provider', async (_event, id: string, enabled: boolean) => {
    modelRegistry.toggleProvider(id, enabled)
  })

  // 返回当前活跃模型（含 Provider 信息），未配置时返回 null
  ipcMain.handle('models:active', async () => modelRegistry.getActiveModel())

  // 设置活跃模型，格式为 "providerId/modelId"
  ipcMain.handle('models:set-active', async (_event, id: string) => {
    modelRegistry.setActiveModel(id)
  })

  // 测试 Provider 连通性，返回 { ok, latencyMs?, error? }
  ipcMain.handle('models:test-connection', async (_event, id: string) => {
    return modelRegistry.testConnection(id)
  })

  // 为指定 Provider 添加自定义模型定义
  ipcMain.handle('models:add-model', async (_event, providerId: string, model: ModelDefinition) => {
    modelRegistry.addModel(providerId, model)
  })

  // 从指定 Provider 删除模型
  ipcMain.handle('models:remove-model', async (_event, providerId: string, modelId: string) => {
    modelRegistry.removeModel(providerId, modelId)
  })
}
