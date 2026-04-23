import { EventEmitter } from 'events'
import type Database from 'better-sqlite3'

import type { ModelProvider, ModelDefinition } from '../ai/types'
import { kvGet, kvSet } from '../data/db'
import { PRESET_PROVIDERS } from './preset-providers'

export class ModelRegistry extends EventEmitter {
  private providers: ModelProvider[] = []
  private activeModelId: string | null = null

  constructor(private db: Database.Database) {
    super()
  }

  /** 从 KV 表加载持久化状态，合并预设与用户自定义数据 */
  load(): void {
    const saved = kvGet(this.db, 'modelProviders')
    if (saved) {
      const savedProviders = JSON.parse(saved) as ModelProvider[]
      // 以 id 为索引方便查找已保存项
      const savedMap = new Map(savedProviders.map((p) => [p.id, p]))

      // 预设 Provider：保留用户设置的 apiKey / enabled，更新静态预设字段
      this.providers = PRESET_PROVIDERS.map((preset) => {
        const existing = savedMap.get(preset.id)
        if (existing) {
          return {
            ...preset,
            apiKey: existing.apiKey || '',
            enabled: existing.enabled,
            isCustom: false,
            // 用户已有自定义模型列表时保留，否则回退到预设列表
            models: existing.models.length > 0 ? existing.models : preset.models
          }
        }
        return { ...preset, apiKey: '', enabled: false, isCustom: false }
      })

      // 追加用户新增的自定义 Provider（不在预设列表中的）
      for (const p of savedProviders) {
        if (p.isCustom && !this.providers.find((pp) => pp.id === p.id)) {
          this.providers.push(p)
        }
      }
    } else {
      // 首次启动：petclaw 默认启用，其余全部关闭
      this.providers = PRESET_PROVIDERS.map((p) => ({
        ...p,
        apiKey: '',
        enabled: p.id === 'petclaw',
        isCustom: false
      }))
    }

    const activeStr = kvGet(this.db, 'activeModel')
    this.activeModelId = activeStr ? (JSON.parse(activeStr) as string | null) : null
  }

  /** 将当前状态持久化到 KV 表 */
  save(): void {
    kvSet(this.db, 'modelProviders', JSON.stringify(this.providers))
    kvSet(this.db, 'activeModel', JSON.stringify(this.activeModelId))
  }

  listProviders(): ModelProvider[] {
    return this.providers
  }

  getProvider(id: string): ModelProvider | undefined {
    return this.providers.find((p) => p.id === id)
  }

  addProvider(provider: ModelProvider): void {
    if (this.providers.find((p) => p.id === provider.id)) {
      throw new Error(`Provider already exists: ${provider.id}`)
    }
    this.providers.push(provider)
    this.save()
    this.emit('change')
  }

  updateProvider(id: string, patch: Partial<ModelProvider>): void {
    const idx = this.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw new Error(`Provider not found: ${id}`)
    this.providers[idx] = { ...this.providers[idx], ...patch }
    this.save()
    this.emit('change')
  }

  removeProvider(id: string): void {
    const provider = this.getProvider(id)
    if (!provider) return
    // 预设 Provider 不可删除，防止误操作破坏默认配置
    if (provider.isPreset) throw new Error('Cannot delete a preset provider')
    this.providers = this.providers.filter((p) => p.id !== id)
    this.save()
    this.emit('change')
  }

  toggleProvider(id: string, enabled: boolean): void {
    this.updateProvider(id, { enabled })
  }

  addModel(providerId: string, model: ModelDefinition): void {
    const provider = this.getProvider(providerId)
    if (!provider) throw new Error(`Provider not found: ${providerId}`)
    provider.models.push(model)
    this.save()
    this.emit('change')
  }

  removeModel(providerId: string, modelId: string): void {
    const provider = this.getProvider(providerId)
    if (!provider) return
    provider.models = provider.models.filter((m) => m.id !== modelId)
    this.save()
    this.emit('change')
  }

  updateModel(providerId: string, modelId: string, patch: Partial<ModelDefinition>): void {
    const provider = this.getProvider(providerId)
    if (!provider) return
    const model = provider.models.find((m) => m.id === modelId)
    if (!model) return
    Object.assign(model, patch)
    this.save()
    this.emit('change')
  }

  setActiveModel(providerModelId: string): void {
    this.activeModelId = providerModelId
    this.save()
    this.emit('change')
  }

  getActiveModel(): { provider: ModelProvider; model: ModelDefinition } | null {
    if (!this.activeModelId) return null
    // 格式约定：`providerId/modelId`
    const slashIdx = this.activeModelId.indexOf('/')
    if (slashIdx === -1) return null
    const providerId = this.activeModelId.slice(0, slashIdx)
    const modelId = this.activeModelId.slice(slashIdx + 1)
    const provider = this.getProvider(providerId)
    if (!provider) return null
    const model = provider.models.find((m) => m.id === modelId)
    if (!model) return null
    return { provider, model }
  }

  /** 测试 Provider 连通性，10 秒超时 */
  async testConnection(
    providerId: string
  ): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const provider = this.getProvider(providerId)
    if (!provider) return { ok: false, error: 'Provider not found' }
    if (!provider.apiKey) return { ok: false, error: 'API Key not configured' }

    const start = Date.now()
    try {
      const url = provider.baseUrl.replace(/\/$/, '') + '/models'
      const headers: Record<string, string> = {}

      if (provider.apiFormat === 'anthropic') {
        headers['x-api-key'] = provider.apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        headers['Authorization'] = `Bearer ${provider.apiKey}`
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
   * 生成写入 openclaw.json 的配置。
   * API Key 用环境变量占位符替换，不写入明文，确保配置文件可安全提交
   */
  toOpenclawConfig(): { mode: string; providers: Record<string, unknown> } {
    const providers: Record<string, unknown> = {}
    for (const p of this.providers) {
      // 无 key 的 Provider 跳过（petclaw / ollama 不需要 key）
      if (!p.apiKey && p.id !== 'petclaw' && p.id !== 'ollama') continue
      const envVar = `PETCLAW_APIKEY_${p.id.toUpperCase().replace(/-/g, '_')}`
      providers[p.id] = {
        baseUrl: p.baseUrl,
        api: p.apiFormat,
        apiKey: p.apiKey ? `\${${envVar}}` : undefined,
        auth: 'api-key',
        models: p.models.map((m) => ({
          id: m.id,
          name: m.name,
          ...(m.reasoning && { reasoning: true })
        }))
      }
    }
    return { mode: 'replace', providers }
  }

  /** 收集所有需注入进程环境的真实 API Key，用于启动 Openclaw 子进程 */
  collectSecretEnvVars(): Record<string, string> {
    const vars: Record<string, string> = {}
    for (const p of this.providers) {
      if (p.apiKey) {
        const envVar = `PETCLAW_APIKEY_${p.id.toUpperCase().replace(/-/g, '_')}`
        vars[envVar] = p.apiKey
      }
    }
    return vars
  }
}
