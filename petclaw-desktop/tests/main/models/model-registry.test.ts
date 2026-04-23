import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase } from '../../../src/main/data/db'
import { ModelRegistry } from '../../../src/main/models/model-registry'

describe('ModelRegistry', () => {
  let db: Database.Database
  let registry: ModelRegistry

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    registry = new ModelRegistry(db)
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
    registry.updateProvider('openai', { apiKey: 'sk-test-key' })
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
      logo: '',
      baseUrl: 'https://my-api.com/v1',
      apiKey: 'my-key',
      apiFormat: 'openai-completions',
      enabled: true,
      isPreset: false,
      isCustom: true,
      models: []
    })
    expect(registry.getProvider('custom-1')?.name).toBe('My Provider')
  })

  it('should not delete a preset provider', () => {
    expect(() => registry.removeProvider('openai')).toThrow()
  })

  it('should delete a custom provider', () => {
    registry.addProvider({
      id: 'custom-del',
      name: 'Del',
      logo: '',
      baseUrl: '',
      apiKey: '',
      apiFormat: 'openai-completions',
      enabled: true,
      isPreset: false,
      isCustom: true,
      models: []
    })
    registry.removeProvider('custom-del')
    expect(registry.getProvider('custom-del')).toBeUndefined()
  })

  it('should set and get active model', () => {
    registry.setActiveModel('openai/gpt-4o')
    const active = registry.getActiveModel()
    expect(active?.provider.id).toBe('openai')
    expect(active?.model.id).toBe('gpt-4o')
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
    registry.updateProvider('openai', { apiKey: 'sk-persist' })
    registry.setActiveModel('openai/gpt-4o')
    registry.save()

    const registry2 = new ModelRegistry(db)
    registry2.load()
    expect(registry2.getProvider('openai')?.apiKey).toBe('sk-persist')
    expect(registry2.getActiveModel()?.model.id).toBe('gpt-4o')
  })
})
