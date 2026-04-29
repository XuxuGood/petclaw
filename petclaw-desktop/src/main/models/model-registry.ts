import { EventEmitter } from 'events'

import type {
  ModelAuthMode,
  ModelDefinition,
  ModelPreference,
  ModelProviderConfig,
  SelectedModel
} from '../ai/types'
import { ProviderRegistry } from '../../shared/models/provider-registry'
import { ModelConfigStore } from './model-config-store'
import { isSystemProxyEnabled } from '../ai/system-proxy'

type ModelProviderInput = Omit<ModelProviderConfig, 'hasApiKey'> & { hasApiKey?: boolean }

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0'
  } catch {
    return false
  }
}

interface OpenClawProviderConfig {
  baseUrl: string
  api: ModelProviderConfig['apiFormat']
  auth: ModelAuthMode
  apiKey?: string
  request?: { proxy: { mode: 'env-proxy' } }
  models: Array<{
    id: string
    name: string
    input: readonly string[]
    reasoning?: true
  }>
}

export class ModelRegistry extends EventEmitter {
  constructor(
    private store: ModelConfigStore,
    private providerRegistry: ProviderRegistry
  ) {
    super()
  }

  /** 确保内置 Provider 已落库，避免每次读取都重新合并静态配置。 */
  load(): void {
    for (const provider of this.providerRegistry.list()) {
      if (this.store.getProvider(provider.id)) continue
      this.store.upsertProvider({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.defaultBaseUrl,
        apiFormat: provider.apiFormat,
        enabled: provider.id === 'petclaw',
        isCustom: false,
        models: provider.defaultModels
      })
    }
  }

  listProviders(): ModelProviderConfig[] {
    return this.store.listProviders()
  }

  getProvider(id: string): ModelProviderConfig | undefined {
    return this.store.getProvider(id) ?? undefined
  }

  addProvider(provider: ModelProviderInput): void {
    if (this.getProvider(provider.id)) {
      throw new Error(`Provider already exists: ${provider.id}`)
    }
    if (this.providerRegistry.isBuiltIn(provider.id)) {
      throw new Error(`Provider already exists: ${provider.id}`)
    }

    this.store.upsertProvider({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat,
      enabled: provider.enabled,
      isCustom: true,
      models: provider.models
    })
    this.emit('change')
  }

  updateProvider(id: string, patch: Partial<ModelProviderInput>): void {
    const provider = this.requireProvider(id)
    const next = {
      id: provider.id,
      name: patch.name ?? provider.name,
      baseUrl: patch.baseUrl ?? provider.baseUrl,
      apiFormat: patch.apiFormat ?? provider.apiFormat,
      enabled: patch.enabled ?? provider.enabled,
      isCustom: this.providerRegistry.isBuiltIn(id) ? false : (patch.isCustom ?? provider.isCustom),
      models: patch.models ?? provider.models
    }

    this.store.upsertProvider(next)
    this.emit('change')
  }

  removeProvider(id: string): void {
    const provider = this.getProvider(id)
    if (!provider) return
    if (this.providerRegistry.isBuiltIn(id)) {
      throw new Error('Cannot delete a preset provider')
    }

    this.store.removeProvider(id)
    this.emit('change')
  }

  toggleProvider(id: string, enabled: boolean): void {
    this.updateProvider(id, { enabled })
  }

  addModel(providerId: string, model: ModelDefinition): void {
    const provider = this.requireProvider(providerId)
    if (provider.models.some((existing) => existing.id === model.id)) {
      throw new Error(`Model already exists: ${model.id}`)
    }

    this.updateProvider(providerId, { models: [...provider.models, model] })
  }

  removeModel(providerId: string, modelId: string): void {
    const provider = this.getProvider(providerId)
    if (!provider) return
    this.updateProvider(providerId, {
      models: provider.models.filter((model) => model.id !== modelId)
    })
  }

  updateModel(providerId: string, modelId: string, patch: Partial<ModelDefinition>): void {
    const provider = this.getProvider(providerId)
    if (!provider) return
    this.updateProvider(providerId, {
      models: provider.models.map((model) =>
        model.id === modelId ? { ...model, ...patch } : model
      )
    })
  }

  setApiKey(providerId: string, apiKey: string): void {
    this.requireProvider(providerId)
    this.store.setApiKey(providerId, apiKey)
    this.emit('change')
  }

  clearApiKey(providerId: string): void {
    this.requireProvider(providerId)
    this.store.clearApiKey(providerId)
    this.emit('change')
  }

  getDefaultModel(): SelectedModel {
    const preference = this.store.getModelPreference()
    if (preference && this.hasModel(preference.defaultProviderId, preference.defaultModelId)) {
      return {
        providerId: preference.defaultProviderId,
        modelId: preference.defaultModelId
      }
    }

    const petclaw = this.getProvider('petclaw')
    const petclawModel = petclaw?.models.find((model) => model.id === 'petclaw-fast')
    if (petclawModel) {
      return { providerId: 'petclaw', modelId: petclawModel.id }
    }

    const provider = this.listProviders().find((item) => item.models.length > 0)
    if (provider) {
      return { providerId: provider.id, modelId: provider.models[0].id }
    }

    return { providerId: 'petclaw', modelId: 'petclaw-fast' }
  }

  setDefaultModel(selected: SelectedModel): void {
    if (!this.hasModel(selected.providerId, selected.modelId)) {
      throw new Error(`Model not found: ${selected.providerId}/${selected.modelId}`)
    }

    const preference: ModelPreference = {
      defaultProviderId: selected.providerId,
      defaultModelId: selected.modelId
    }
    this.store.setModelPreference(preference)
    this.emit('change')
  }

  getDefaultOpenClawModelRef(): string {
    return this.toOpenClawModelRef(this.getDefaultModel())
  }

  toOpenClawModelRef(selected: SelectedModel): string {
    return `${this.providerRegistry.toOpenClawProviderId(selected.providerId)}/${selected.modelId}`
  }

  /** 测试 Provider 连通性，10 秒超时。 */
  async testConnection(
    providerId: string
  ): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const provider = this.getProvider(providerId)
    if (!provider) return { ok: false, error: 'Provider not found' }
    const definition = this.providerRegistry.get(providerId)
    const apiKey = this.store.getApiKey(providerId)
    if ((definition?.auth ?? 'api-key') === 'api-key' && !apiKey) {
      return { ok: false, error: 'API Key not configured' }
    }

    const start = Date.now()
    try {
      const url = provider.baseUrl.replace(/\/$/, '') + '/models'
      const headers: Record<string, string> = {}

      if (provider.apiFormat === 'anthropic') {
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(url, { headers, signal: controller.signal })
      clearTimeout(timeout)

      return { ok: res.status < 400, latencyMs: Date.now() - start }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start
      }
    }
  }

  /**
   * 生成写入 openclaw.json 的模型配置。
   * API Key 只写环境变量占位符，明文通过 collectSecretEnvVars 注入子进程环境。
   */
  toOpenclawConfig(): { mode: string; providers: Record<string, OpenClawProviderConfig> } {
    const providers: Record<string, OpenClawProviderConfig> = {}

    for (const provider of this.listProviders()) {
      if (!provider.enabled) continue

      const definition = this.providerRegistry.get(provider.id)
      const auth = definition?.auth ?? 'api-key'
      const apiKey = this.store.getApiKey(provider.id)
      if (auth === 'api-key' && !apiKey) continue

      const openClawProviderId = definition?.openClawProviderId ?? provider.id
      const config: OpenClawProviderConfig = {
        baseUrl: provider.baseUrl,
        api: provider.apiFormat,
        auth,
        models: provider.models.map((model) => ({
          id: model.id,
          name: model.name,
          input: model.supportsImage ? (['text', 'image'] as const) : (['text'] as const),
          ...(model.reasoning ? { reasoning: true as const } : {})
        }))
      }

      if (auth === 'api-key') {
        config.apiKey = `\${${this.buildEnvVarName(provider.id)}}`
      }

      // 非本地 provider 且系统代理已启用时，告知 runtime 走环境变量代理
      if (isSystemProxyEnabled() && !isLoopbackUrl(provider.baseUrl)) {
        config.request = { proxy: { mode: 'env-proxy' } }
      }

      providers[openClawProviderId] = config
    }

    return { mode: 'replace', providers }
  }

  /** 收集需要注入 OpenClaw 子进程环境的真实 API Key。 */
  collectSecretEnvVars(): Record<string, string> {
    const vars: Record<string, string> = {}

    for (const provider of this.listProviders()) {
      if (!provider.enabled) continue
      const definition = this.providerRegistry.get(provider.id)
      if ((definition?.auth ?? 'api-key') !== 'api-key') continue

      const apiKey = this.store.getApiKey(provider.id)
      if (apiKey) {
        vars[this.buildEnvVarName(provider.id)] = apiKey
      }
    }

    return vars
  }

  private requireProvider(id: string): ModelProviderConfig {
    const provider = this.getProvider(id)
    if (!provider) throw new Error(`Provider not found: ${id}`)
    return provider
  }

  private hasModel(providerId: string, modelId: string): boolean {
    return this.getProvider(providerId)?.models.some((model) => model.id === modelId) ?? false
  }

  private buildEnvVarName(providerId: string): string {
    return `PETCLAW_APIKEY_${providerId.toUpperCase().replace(/-/g, '_')}`
  }
}
