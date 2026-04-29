import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase } from '../../../src/main/data/db'
import { ProviderRegistry } from '../../../src/shared/models/provider-registry'
import { ModelConfigStore } from '../../../src/main/models/model-config-store'
import { ModelRegistry } from '../../../src/main/models/model-registry'

describe('ModelRegistry', () => {
  let db: Database.Database
  let registry: ModelRegistry

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    const store = new ModelConfigStore(db)
    const providerRegistry = new ProviderRegistry()
    registry = new ModelRegistry(store, providerRegistry)
    registry.load()
  })

  afterEach(() => {
    db.close()
  })

  it('should load preset providers', () => {
    const providers = registry.listProviders()
    expect(providers.length).toBeGreaterThanOrEqual(16)
    expect(providers.find((p) => p.id === 'openai')).toBeTruthy()
  })

  it('should toggle provider enabled', () => {
    registry.toggleProvider('openai', false)
    expect(registry.getProvider('openai')?.enabled).toBe(false)
    registry.toggleProvider('openai', true)
    expect(registry.getProvider('openai')?.enabled).toBe(true)
  })

  it('should update provider API key without leaking to openclaw config', () => {
    registry.toggleProvider('openai', true)
    registry.setApiKey('openai', 'sk-test-key')
    const config = registry.toOpenclawConfig()
    // openclaw.json 中不包含明文 key，只有占位符
    const openaiConfig = config.providers['openai'] as Record<string, unknown>
    expect(openaiConfig.apiKey).toBe('${PETCLAW_APIKEY_OPENAI}')
    // collectSecretEnvVars 返回真实 key
    const envVars = registry.collectSecretEnvVars()
    expect(envVars['PETCLAW_APIKEY_OPENAI']).toBe('sk-test-key')
  })

  it('should add a custom provider', () => {
    registry.addProvider({
      id: 'custom-1',
      name: 'My Provider',
      baseUrl: 'https://my-api.com/v1',
      apiFormat: 'openai-completions',
      enabled: true,
      isCustom: true,
      models: []
    })
    registry.setApiKey('custom-1', 'my-key')
    expect(registry.getProvider('custom-1')?.name).toBe('My Provider')
  })

  it('should not delete a preset provider', () => {
    expect(() => registry.removeProvider('openai')).toThrow()
  })

  it('should delete a custom provider', () => {
    registry.addProvider({
      id: 'custom-del',
      name: 'Del',
      baseUrl: '',
      apiFormat: 'openai-completions',
      enabled: true,
      isCustom: true,
      models: []
    })
    registry.removeProvider('custom-del')
    expect(registry.getProvider('custom-del')).toBeUndefined()
  })

  it('should add a model to a provider', () => {
    registry.addModel('openai', {
      id: 'gpt-5',
      name: 'GPT-5',
      reasoning: true,
      supportsImage: true,
      contextWindow: 256000,
      maxTokens: 32768
    })
    const p = registry.getProvider('openai')
    expect(p?.models.find((m) => m.id === 'gpt-5')).toBeTruthy()
  })

  it('should remove a model from a provider', () => {
    registry.removeModel('openai', 'gpt-4o-mini')
    const p = registry.getProvider('openai')
    expect(p?.models.find((m) => m.id === 'gpt-4o-mini')).toBeUndefined()
  })

  it('should emit change on update', () => {
    let fired = false
    registry.on('change', () => {
      fired = true
    })
    registry.toggleProvider('openai', false)
    expect(fired).toBe(true)
  })

  it('should persist and reload', () => {
    registry.toggleProvider('openai', true)
    registry.setApiKey('openai', 'sk-persist')
    registry.setDefaultModel({ providerId: 'openai', modelId: 'gpt-4o' })

    const registry2 = new ModelRegistry(new ModelConfigStore(db), new ProviderRegistry())
    registry2.load()
    expect(registry2.getProvider('openai')?.hasApiKey).toBe(true)
    expect(registry2.getDefaultModel()).toEqual({ providerId: 'openai', modelId: 'gpt-4o' })
  })

  it('maps PetClaw provider ids to OpenClaw provider ids', () => {
    registry.load()
    registry.updateProvider('zhipu', { enabled: true })
    registry.setApiKey('zhipu', 'sk-zhipu')
    registry.updateProvider('youdao', { enabled: true })
    registry.setApiKey('youdao', 'sk-youdao')
    const config = registry.toOpenclawConfig()

    expect(config.providers.zai).toBeDefined()
    expect(config.providers.zhipu).toBeUndefined()
    expect(config.providers.youdaozhiyun).toBeDefined()
    expect(config.providers.youdao).toBeUndefined()
  })

  it('does not sync disabled providers even when an api key exists', () => {
    registry.load()
    registry.updateProvider('openai', { enabled: false })
    registry.setApiKey('openai', 'sk-openai')

    expect(registry.toOpenclawConfig().providers.openai).toBeUndefined()
  })

  it('converts selected model to OpenClaw ref', () => {
    registry.load()
    expect(registry.toOpenClawModelRef({ providerId: 'gemini', modelId: 'gemini-2.0-flash' })).toBe(
      'google/gemini-2.0-flash'
    )
  })
})
