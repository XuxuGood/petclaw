import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

import { initDatabase } from '../../../src/main/data/db'
import {
  MemorySearchConfigStore,
  type MemorySearchConfig
} from '../../../src/main/memory/memory-search-config-store'

describe('MemorySearchConfigStore', () => {
  let db: Database.Database
  let store: MemorySearchConfigStore

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    store = new MemorySearchConfigStore(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should default to disabled', () => {
    expect(store.getConfig()).toEqual({
      enabled: false,
      provider: 'openai',
      model: '',
      remoteBaseUrl: '',
      remoteApiKey: '',
      vectorWeight: 0.7
    })
    expect(store.toOpenclawConfig()).toBeNull()
  })

  it('should persist and output OpenClaw memorySearch config without plaintext api key', () => {
    const patch: Partial<MemorySearchConfig> = {
      enabled: true,
      provider: 'gemini',
      model: 'text-embedding-004',
      remoteBaseUrl: 'https://example.test/v1',
      remoteApiKey: 'secret-key',
      vectorWeight: 0.8
    }

    store.setConfig(patch)

    expect(store.toOpenclawConfig()).toEqual({
      enabled: true,
      provider: 'gemini',
      model: 'text-embedding-004',
      remote: {
        baseUrl: 'https://example.test/v1',
        apiKey: '${PETCLAW_MEMORY_SEARCH_API_KEY}'
      },
      store: { fts: { tokenizer: 'trigram' } },
      query: { hybrid: { vectorWeight: 0.8 } }
    })
    expect(store.collectSecretEnvVars()).toEqual({
      PETCLAW_MEMORY_SEARCH_API_KEY: 'secret-key'
    })
  })
})
