// shared/models/types.ts
// 模型和供应商的基础类型定义，供 main / renderer / shared 共用。
// main/ai/types.ts 通过 re-export 继续对外暴露，避免改动已有 import 路径。

export type ModelApiFormat = 'openai-completions' | 'anthropic' | 'google-generative-ai'
export type ModelAuthMode = 'api-key' | 'oauth'

export interface ModelDefinition {
  id: string
  name: string
  reasoning: boolean
  supportsImage: boolean
  contextWindow: number
  maxTokens: number
}

export interface ProviderDefinition {
  id: string
  openClawProviderId: string
  name: string
  logo: string
  defaultBaseUrl: string
  apiFormat: ModelApiFormat
  auth: ModelAuthMode
  /** 是否需要用户提供 API Key。false 表示该 provider 无需密钥即可使用（如 petclaw、ollama）。 */
  requiresApiKey: boolean
  isPreset: boolean
  defaultModels: ModelDefinition[]
}

// 用户持久化的 Provider 配置（合并内置默认值和用户覆盖后的运行时状态）
export interface ModelProviderConfig {
  id: string
  name: string
  baseUrl: string
  apiFormat: ModelApiFormat
  enabled: boolean
  isCustom: boolean
  models: ModelDefinition[]
  hasApiKey: boolean
}

// 会话级或全局模型选择
export interface SelectedModel {
  providerId: string
  modelId: string
}

// 用户模型偏好（持久化到 app_config）
export interface ModelPreference {
  defaultProviderId: string
  defaultModelId: string
}
