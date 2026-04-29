import type Database from 'better-sqlite3'

import { kvGet, kvSet } from '../data/db'

export type MemorySearchProvider = 'openai' | 'gemini' | 'voyage' | 'mistral' | 'ollama'

export interface MemorySearchConfig {
  enabled: boolean
  provider: MemorySearchProvider
  model: string
  remoteBaseUrl: string
  remoteApiKey: string
  vectorWeight: number
}

const MEMORY_SEARCH_CONFIG_KEY = 'memorySearch.config'
const MEMORY_SEARCH_API_KEY_ENV = 'PETCLAW_MEMORY_SEARCH_API_KEY'

const DEFAULT_MEMORY_SEARCH_CONFIG: MemorySearchConfig = {
  enabled: false,
  provider: 'openai',
  model: '',
  remoteBaseUrl: '',
  remoteApiKey: '',
  vectorWeight: 0.7
}

const VALID_PROVIDERS = new Set<MemorySearchProvider>([
  'openai',
  'gemini',
  'voyage',
  'mistral',
  'ollama'
])

function normalizeProvider(value: unknown): MemorySearchProvider {
  return typeof value === 'string' && VALID_PROVIDERS.has(value as MemorySearchProvider)
    ? (value as MemorySearchProvider)
    : DEFAULT_MEMORY_SEARCH_CONFIG.provider
}

function normalizeVectorWeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MEMORY_SEARCH_CONFIG.vectorWeight
  }
  return Math.min(1, Math.max(0, value))
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export class MemorySearchConfigStore {
  constructor(private db: Database.Database) {}

  getConfig(): MemorySearchConfig {
    const raw = kvGet(this.db, MEMORY_SEARCH_CONFIG_KEY)
    if (!raw) return { ...DEFAULT_MEMORY_SEARCH_CONFIG }

    try {
      const parsed = toRecord(JSON.parse(raw))
      return {
        enabled: parsed.enabled === true,
        provider: normalizeProvider(parsed.provider),
        model: typeof parsed.model === 'string' ? parsed.model.trim() : '',
        remoteBaseUrl: typeof parsed.remoteBaseUrl === 'string' ? parsed.remoteBaseUrl.trim() : '',
        remoteApiKey: typeof parsed.remoteApiKey === 'string' ? parsed.remoteApiKey.trim() : '',
        vectorWeight: normalizeVectorWeight(parsed.vectorWeight)
      }
    } catch {
      return { ...DEFAULT_MEMORY_SEARCH_CONFIG }
    }
  }

  setConfig(patch: Partial<MemorySearchConfig>): MemorySearchConfig {
    const current = this.getConfig()
    const next: MemorySearchConfig = {
      ...current,
      ...patch,
      provider: normalizeProvider(patch.provider ?? current.provider),
      model: (patch.model ?? current.model).trim(),
      remoteBaseUrl: (patch.remoteBaseUrl ?? current.remoteBaseUrl).trim(),
      remoteApiKey: (patch.remoteApiKey ?? current.remoteApiKey).trim(),
      vectorWeight: normalizeVectorWeight(patch.vectorWeight ?? current.vectorWeight)
    }
    kvSet(this.db, MEMORY_SEARCH_CONFIG_KEY, JSON.stringify(next))
    return next
  }

  toOpenclawConfig(): Record<string, unknown> | null {
    const config = this.getConfig()
    if (!config.enabled) return null

    return {
      enabled: true,
      provider: config.provider,
      ...(config.model ? { model: config.model } : {}),
      ...(config.remoteBaseUrl || config.remoteApiKey
        ? {
            remote: {
              ...(config.remoteBaseUrl ? { baseUrl: config.remoteBaseUrl } : {}),
              ...(config.remoteApiKey ? { apiKey: `\${${MEMORY_SEARCH_API_KEY_ENV}}` } : {})
            }
          }
        : {}),
      store: { fts: { tokenizer: 'trigram' } },
      query: { hybrid: { vectorWeight: config.vectorWeight } }
    }
  }

  collectSecretEnvVars(): Record<string, string> {
    const config = this.getConfig()
    if (!config.enabled || !config.remoteApiKey) return {}
    return { [MEMORY_SEARCH_API_KEY_ENV]: config.remoteApiKey }
  }
}
