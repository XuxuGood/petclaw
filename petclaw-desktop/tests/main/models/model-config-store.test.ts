import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import { initDatabase } from '../../../src/main/data/db'
import { ModelConfigStore } from '../../../src/main/models/model-config-store'

let db: Database.Database
let store: ModelConfigStore

function upsertOpenAiProvider(): void {
  store.upsertProvider({
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiFormat: 'openai-completions',
    enabled: true,
    isCustom: false,
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        reasoning: false,
        supportsImage: true,
        contextWindow: 128000,
        maxTokens: 16384
      }
    ]
  })
}

beforeEach(() => {
  db = new Database(':memory:')
  initDatabase(db)
  store = new ModelConfigStore(db)
})

describe('ModelConfigStore', () => {
  it('stores provider config separately from api key', () => {
    upsertOpenAiProvider()
    store.setApiKey('openai', 'sk-test')

    expect(store.getProvider('openai')?.models[0]?.id).toBe('gpt-4o')
    expect(store.getApiKey('openai')).toBe('sk-test')
  })

  it('rejects api keys for missing providers', () => {
    expect(() => store.setApiKey('missing', 'sk')).toThrow('Provider not found: missing')
  })

  it('does not expose plaintext api key from provider config', () => {
    upsertOpenAiProvider()
    store.setApiKey('openai', 'sk-test')

    const provider = store.getProvider('openai')

    expect(provider).toMatchObject({ hasApiKey: true })
    expect(provider).not.toHaveProperty('apiKey')
  })

  it('clears secret when provider is removed', () => {
    upsertOpenAiProvider()
    store.setApiKey('openai', 'sk-test')

    store.removeProvider('openai')

    expect(store.getApiKey('openai')).toBe('')
  })

  it('stores default model preference in app_config', () => {
    store.setModelPreference({ defaultProviderId: 'petclaw', defaultModelId: 'petclaw-fast' })
    expect(store.getModelPreference()).toEqual({
      defaultProviderId: 'petclaw',
      defaultModelId: 'petclaw-fast'
    })
  })
})
