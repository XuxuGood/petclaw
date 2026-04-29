// models-ipc.ts: 模型 Provider 和默认模型管理的 IPC 处理层
// API Key 在返回给渲染进程时自动脱敏，真实 Key 永不传出主进程
import { safeHandle } from './ipc-registry'
import type { ModelRegistry } from '../models/model-registry'
import type { ModelDefinition, ModelProviderConfig, SelectedModel } from '../ai/types'

type ModelProviderPayload = Omit<ModelProviderConfig, 'hasApiKey'> & {
  apiKey?: string
  hasApiKey?: boolean
}

type ModelProviderPatch = Partial<ModelProviderPayload>

export interface ModelsIpcDeps {
  modelRegistry: ModelRegistry
}

export function registerModelsIpcHandlers(deps: ModelsIpcDeps): void {
  const { modelRegistry } = deps

  safeHandle('models:providers', async () => {
    return modelRegistry.listProviders()
  })

  safeHandle('models:provider', async (_event, id: string) => {
    return modelRegistry.getProvider(id) ?? null
  })

  // 添加新 Provider 时单独处理 apiKey，避免明文进入 Provider 配置对象。
  safeHandle('models:add-provider', async (_event, data: ModelProviderPayload) => {
    modelRegistry.addProvider(data)
    if (data.apiKey) {
      modelRegistry.setApiKey(data.id, data.apiKey)
    }
  })

  safeHandle('models:update-provider', async (_event, id: string, patch: ModelProviderPatch) => {
    const { apiKey, ...providerPatch } = patch
    modelRegistry.updateProvider(id, providerPatch)
    if (apiKey !== undefined) {
      if (apiKey) {
        modelRegistry.setApiKey(id, apiKey)
      } else {
        modelRegistry.clearApiKey(id)
      }
    }
  })

  // 删除自定义 Provider；预设 Provider 不可删除，manager 会抛出错误
  safeHandle('models:remove-provider', async (_event, id: string) => {
    modelRegistry.removeProvider(id)
  })

  // 快捷切换 Provider 启用/禁用状态，触发 change 事件以刷新 openclaw 配置
  safeHandle('models:toggle-provider', async (_event, id: string, enabled: boolean) => {
    modelRegistry.toggleProvider(id, enabled)
  })

  safeHandle('models:default', async () => modelRegistry.getDefaultModel())

  safeHandle('models:set-default', async (_event, selected: SelectedModel) => {
    modelRegistry.setDefaultModel(selected)
  })

  safeHandle('models:set-api-key', async (_event, providerId: string, apiKey: string) => {
    modelRegistry.setApiKey(providerId, apiKey)
  })

  safeHandle('models:clear-api-key', async (_event, providerId: string) => {
    modelRegistry.clearApiKey(providerId)
  })

  // 测试 Provider 连通性，返回 { ok, latencyMs?, error? }
  safeHandle('models:test-connection', async (_event, id: string) => {
    return modelRegistry.testConnection(id)
  })

  // 为指定 Provider 添加自定义模型定义
  safeHandle('models:add-model', async (_event, providerId: string, model: ModelDefinition) => {
    modelRegistry.addModel(providerId, model)
  })

  // 从指定 Provider 删除模型
  safeHandle('models:remove-model', async (_event, providerId: string, modelId: string) => {
    modelRegistry.removeModel(providerId, modelId)
  })
}
