import type Database from 'better-sqlite3'

import { kvGet, kvSet } from '../data/db'
import type {
  ModelApiFormat,
  ModelDefinition,
  ModelPreference,
  ModelProviderConfig
} from '../ai/types'

const MODEL_PREFERENCE_KEY = 'model.preference'

interface ProviderRow {
  id: string
  name: string
  base_url: string
  api_format: ModelApiFormat
  enabled: number
  is_custom: number
  models_json: string
  created_at: number
  updated_at: number
}

export class ModelConfigStore {
  constructor(private db: Database.Database) {}

  listProviders(): ModelProviderConfig[] {
    const rows = this.db
      .prepare('SELECT * FROM model_providers ORDER BY created_at ASC')
      .all() as ProviderRow[]
    return rows.map((row) => this.rowToProvider(row))
  }

  getProvider(id: string): ModelProviderConfig | null {
    const row = this.db.prepare('SELECT * FROM model_providers WHERE id = ?').get(id) as
      | ProviderRow
      | undefined
    return row ? this.rowToProvider(row) : null
  }

  upsertProvider(provider: Omit<ModelProviderConfig, 'hasApiKey'>): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO model_providers
          (id, name, base_url, api_format, enabled, is_custom, models_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          base_url = excluded.base_url,
          api_format = excluded.api_format,
          enabled = excluded.enabled,
          is_custom = excluded.is_custom,
          models_json = excluded.models_json,
          updated_at = excluded.updated_at`
      )
      .run(
        provider.id,
        provider.name,
        provider.baseUrl,
        provider.apiFormat,
        provider.enabled ? 1 : 0,
        provider.isCustom ? 1 : 0,
        JSON.stringify(provider.models),
        now,
        now
      )
  }

  clearApiKey(providerId: string): void {
    this.db.prepare('DELETE FROM model_provider_secrets WHERE provider_id = ?').run(providerId)
  }

  removeProvider(id: string): void {
    this.db.prepare('DELETE FROM model_providers WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM model_provider_secrets WHERE provider_id = ?').run(id)
  }

  setApiKey(providerId: string, apiKey: string): void {
    if (!this.getProvider(providerId)) {
      throw new Error(`Provider not found: ${providerId}`)
    }

    this.db
      .prepare(
        'INSERT OR REPLACE INTO model_provider_secrets (provider_id, api_key, updated_at) VALUES (?, ?, ?)'
      )
      .run(providerId, apiKey, Date.now())
  }

  getApiKey(providerId: string): string {
    const row = this.db
      .prepare('SELECT api_key FROM model_provider_secrets WHERE provider_id = ?')
      .get(providerId) as { api_key: string } | undefined
    return row?.api_key ?? ''
  }

  setModelPreference(preference: ModelPreference): void {
    kvSet(this.db, MODEL_PREFERENCE_KEY, JSON.stringify(preference))
  }

  getModelPreference(): ModelPreference | null {
    const raw = kvGet(this.db, MODEL_PREFERENCE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ModelPreference
  }

  private rowToProvider(row: ProviderRow): ModelProviderConfig {
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      apiFormat: row.api_format,
      enabled: row.enabled === 1,
      isCustom: row.is_custom === 1,
      models: JSON.parse(row.models_json) as ModelDefinition[],
      hasApiKey: this.getApiKey(row.id).length > 0
    }
  }
}
