# Model Config Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current KV-based model configuration with a production-ready ProviderRegistry + SQLite store + explicit session model selection flow.

**Architecture:** Built-in providers live in a shared registry with OpenClaw provider ID mappings. Main process persists mutable provider settings and secrets in SQLite, keeps global default model in `app_config`, converts renderer `{ providerId, modelId }` selections to OpenClaw refs, and patches OpenClaw sessions before `chat.send`.

**Tech Stack:** Electron main/preload/renderer, TypeScript, better-sqlite3, React, lucide-react, Tailwind tokens, Vitest.

---

## File Map

- Create: `petclaw-desktop/src/shared/models/provider-registry.ts`  
  Single source of truth for built-in providers, OpenClaw provider IDs, default API protocol, auth mode, and default models.
- Create: `petclaw-desktop/src/main/models/model-config-store.ts`  
  SQLite persistence for `model_providers`, `model_provider_secrets`, and `app_config.model`.
- Modify: `petclaw-desktop/src/main/data/db.ts`  
  Add `model_providers` and `model_provider_secrets` tables.
- Modify: `petclaw-desktop/src/main/ai/types.ts`  
  Replace `modelOverride` session string with `selectedModel` structure and define model config types.
- Modify: `petclaw-desktop/src/main/models/model-registry.ts`  
  Replace KV implementation with registry + store backed service.
- Delete: `petclaw-desktop/src/main/models/preset-providers.ts`  
  Built-in providers move to `ProviderRegistry`.
- Modify: `petclaw-desktop/src/main/ai/config-sync.ts`  
  Consume `ModelRegistry.toOpenclawConfig()` and `getDefaultOpenClawModelRef()`.
- Modify: `petclaw-desktop/src/main/data/cowork-store.ts`  
  Persist selected model JSON in `cowork_sessions`.
- Modify: `petclaw-desktop/src/main/ai/cowork-session-manager.ts`  
  Accept `selectedModel`, store it, and keep directory registration behavior unchanged.
- Modify: `petclaw-desktop/src/main/ai/cowork-controller.ts`  
  Convert selected model to OpenClaw ref and call `sessions.patch` before `chat.send`.
- Modify: `petclaw-desktop/src/main/ipc/models-ipc.ts`  
  Replace active model IPC with default model and API key specific IPC.
- Modify: `petclaw-desktop/src/main/ipc/chat-ipc.ts`  
  Accept `selectedModel` instead of `modelOverride`.
- Modify: `petclaw-desktop/src/preload/index.ts` and `petclaw-desktop/src/preload/index.d.ts`  
  Update renderer API contracts.
- Modify: `petclaw-desktop/src/renderer/src/components/ModelSelector.tsx`  
  UI/UX pass: initialize a concrete selected model, show provider-grouped options, emit `{ providerId, modelId }`.
- Modify: `petclaw-desktop/src/renderer/src/views/chat/ChatInputBox.tsx` and `petclaw-desktop/src/renderer/src/views/chat/ChatView.tsx`  
  Pass selected model through start-session flow.
- Modify tests under `petclaw-desktop/tests/main/**` and add renderer tests if the current test setup supports React component tests.
- Modify docs: `docs/superpowers/specs/2026-04-23-petclaw-phase2-design.md` only if implementation reveals a necessary correction.

UI/UX constraints from `ui-ux-pro-max`:
- Model selector button remains a compact toolbar control with lucide icons, visible label, `aria-label`, keyboard focus, and `active:scale-[0.96]`.
- Dropdown options are grouped by provider, use text labels plus icons, keep 44px target height where possible, and avoid hover-only interactions.
- Loading and empty states must be visible; disabled send state must be obvious and semantic.
- Renderer components must use existing Tailwind tokens, not hard-coded hex.

---

### Task 1: Database Schema And Store Tests

**Files:**
- Modify: `petclaw-desktop/src/main/data/db.ts`
- Create: `petclaw-desktop/src/main/models/model-config-store.ts`
- Test: `petclaw-desktop/tests/main/data/db.test.ts`
- Test: `petclaw-desktop/tests/main/models/model-config-store.test.ts`

- [ ] **Step 1: Add failing schema tests**

Add assertions in `petclaw-desktop/tests/main/data/db.test.ts`:

```ts
it('creates model provider tables', () => {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>
  const names = new Set(tables.map((row) => row.name))

  expect(names.has('model_providers')).toBe(true)
  expect(names.has('model_provider_secrets')).toBe(true)
})
```

Create `petclaw-desktop/tests/main/models/model-config-store.test.ts`:

```ts
import Database from 'better-sqlite3'
import { describe, expect, it, beforeEach } from 'vitest'

import { initDatabase } from '../../../src/main/data/db'
import { ModelConfigStore } from '../../../src/main/models/model-config-store'

let db: Database.Database
let store: ModelConfigStore

beforeEach(() => {
  db = new Database(':memory:')
  initDatabase(db)
  store = new ModelConfigStore(db)
})

describe('ModelConfigStore', () => {
  it('stores provider config separately from api key', () => {
    store.upsertProvider({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiFormat: 'openai-completions',
      enabled: true,
      isCustom: false,
      models: [{ id: 'gpt-4o', name: 'GPT-4o', reasoning: false, supportsImage: true, contextWindow: 128000, maxTokens: 16384 }]
    })
    store.setApiKey('openai', 'sk-test')

    expect(store.getProvider('openai')?.models[0]?.id).toBe('gpt-4o')
    expect(store.getApiKey('openai')).toBe('sk-test')
  })

  it('stores default model preference in app_config', () => {
    store.setModelPreference({ defaultProviderId: 'petclaw', defaultModelId: 'petclaw-fast' })
    expect(store.getModelPreference()).toEqual({
      defaultProviderId: 'petclaw',
      defaultModelId: 'petclaw-fast'
    })
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd petclaw-desktop
npm test -- tests/main/data/db.test.ts tests/main/models/model-config-store.test.ts
```

Expected: `model_config_store` import fails and/or model tables are missing.

- [ ] **Step 3: Implement schema**

Add to `initDatabase()` in `petclaw-desktop/src/main/data/db.ts` after `directories`:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_format TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      is_custom INTEGER NOT NULL DEFAULT 0,
      models_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS model_provider_secrets (
      provider_id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    )
  `)
```

- [ ] **Step 4: Implement ModelConfigStore**

Create `petclaw-desktop/src/main/models/model-config-store.ts`:

```ts
import type Database from 'better-sqlite3'

import { kvGet, kvSet } from '../data/db'
import type { ModelDefinition, ModelPreference, ModelProviderConfig } from '../ai/types'

const MODEL_PREFERENCE_KEY = 'model.preference'

interface ProviderRow {
  id: string
  name: string
  base_url: string
  api_format: 'openai-completions' | 'anthropic' | 'google-generative-ai'
  enabled: number
  is_custom: number
  models_json: string
  created_at: number
  updated_at: number
}

export class ModelConfigStore {
  constructor(private db: Database.Database) {}

  listProviders(): ModelProviderConfig[] {
    const rows = this.db.prepare('SELECT * FROM model_providers ORDER BY created_at ASC').all() as ProviderRow[]
    return rows.map((row) => this.rowToProvider(row))
  }

  getProvider(id: string): ModelProviderConfig | null {
    const row = this.db.prepare('SELECT * FROM model_providers WHERE id = ?').get(id) as ProviderRow | undefined
    return row ? this.rowToProvider(row) : null
  }

  upsertProvider(provider: ModelProviderConfig): void {
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

  removeProvider(id: string): void {
    this.db.prepare('DELETE FROM model_providers WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM model_provider_secrets WHERE provider_id = ?').run(id)
  }

  setApiKey(providerId: string, apiKey: string): void {
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
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
cd petclaw-desktop
npm test -- tests/main/data/db.test.ts tests/main/models/model-config-store.test.ts
```

Expected: both files pass.

- [ ] **Step 6: Commit**

```bash
git add petclaw-desktop/src/main/data/db.ts petclaw-desktop/src/main/models/model-config-store.ts petclaw-desktop/tests/main/data/db.test.ts petclaw-desktop/tests/main/models/model-config-store.test.ts
git commit -m "feat: add model config store"
```

### Task 2: Provider Registry And ModelRegistry Rewrite

**Files:**
- Create: `petclaw-desktop/src/shared/models/provider-registry.ts`
- Modify: `petclaw-desktop/src/main/ai/types.ts`
- Modify: `petclaw-desktop/src/main/models/model-registry.ts`
- Delete: `petclaw-desktop/src/main/models/preset-providers.ts`
- Test: `petclaw-desktop/tests/main/models/model-registry.test.ts`

- [ ] **Step 1: Add failing tests for provider mapping and enabled filtering**

Update `model-registry.test.ts` with cases:

```ts
it('maps PetClaw provider ids to OpenClaw provider ids', () => {
  registry.load()
  registry.updateProvider('zhipu', { enabled: true })
  registry.setApiKey('zhipu', 'sk-zhipu')
  const config = registry.toOpenclawConfig()

  expect(config.providers.zai).toBeDefined()
  expect(config.providers.zhipu).toBeUndefined()
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
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd petclaw-desktop
npm test -- tests/main/models/model-registry.test.ts
```

Expected: missing `setApiKey`, `toOpenClawModelRef`, and provider mapping.

- [ ] **Step 3: Define shared provider registry**

Create `petclaw-desktop/src/shared/models/provider-registry.ts` with:

```ts
import type { ModelDefinition, ProviderDefinition } from '../../main/ai/types'

const petclawModels: ModelDefinition[] = [
  { id: 'petclaw-fast', name: 'PetClaw Fast', reasoning: false, supportsImage: true, contextWindow: 128000, maxTokens: 4096 },
  { id: 'petclaw-pro', name: 'PetClaw Pro', reasoning: true, supportsImage: true, contextWindow: 200000, maxTokens: 8192 }
]

const definitions: ProviderDefinition[] = [
  { id: 'petclaw', openClawProviderId: 'petclaw', name: 'PetClaw', logo: 'petclaw', defaultBaseUrl: 'https://petclaw.ai/api/v1', apiFormat: 'openai-completions', auth: 'none', isPreset: true, defaultModels: petclawModels },
  { id: 'openai', openClawProviderId: 'openai', name: 'OpenAI', logo: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', apiFormat: 'openai-completions', auth: 'api-key', isPreset: true, defaultModels: [{ id: 'gpt-4o', name: 'GPT-4o', reasoning: false, supportsImage: true, contextWindow: 128000, maxTokens: 16384 }] },
  { id: 'anthropic', openClawProviderId: 'anthropic', name: 'Anthropic', logo: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com', apiFormat: 'anthropic', auth: 'api-key', isPreset: true, defaultModels: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', reasoning: false, supportsImage: true, contextWindow: 200000, maxTokens: 8192 }] },
  { id: 'zhipu', openClawProviderId: 'zai', name: '智谱 Zhipu', logo: 'zhipu', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiFormat: 'openai-completions', auth: 'api-key', isPreset: true, defaultModels: [{ id: 'glm-4-plus', name: 'GLM-4 Plus', reasoning: false, supportsImage: true, contextWindow: 128000, maxTokens: 4096 }] },
  { id: 'gemini', openClawProviderId: 'google', name: 'Google Gemini', logo: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiFormat: 'google-generative-ai', auth: 'api-key', isPreset: true, defaultModels: [{ id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', reasoning: false, supportsImage: true, contextWindow: 1048576, maxTokens: 8192 }] },
  { id: 'alibaba', openClawProviderId: 'qwen-portal', name: '阿里百炼', logo: 'alibaba', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiFormat: 'openai-completions', auth: 'api-key', isPreset: true, defaultModels: [{ id: 'qwen-max', name: 'Qwen Max', reasoning: false, supportsImage: true, contextWindow: 32768, maxTokens: 8192 }] },
  { id: 'ollama', openClawProviderId: 'ollama', name: 'Ollama', logo: 'ollama', defaultBaseUrl: 'http://localhost:11434/v1', apiFormat: 'openai-completions', auth: 'none', isPreset: true, defaultModels: [] }
]

export class ProviderRegistry {
  private readonly byId = new Map(definitions.map((definition) => [definition.id, definition]))

  list(): ProviderDefinition[] {
    return definitions
  }

  get(id: string): ProviderDefinition | undefined {
    return this.byId.get(id)
  }
}
```

- [ ] **Step 4: Update model types**

In `petclaw-desktop/src/main/ai/types.ts`, replace model provider interfaces with:

```ts
export type ModelApiFormat = 'openai-completions' | 'anthropic' | 'google-generative-ai'
export type ModelAuthMode = 'api-key' | 'none'

export interface SelectedModel {
  providerId: string
  modelId: string
}

export interface ModelPreference {
  defaultProviderId: string
  defaultModelId: string
}

export interface ProviderDefinition {
  id: string
  openClawProviderId: string
  name: string
  logo: string
  defaultBaseUrl: string
  apiFormat: ModelApiFormat
  auth: ModelAuthMode
  isPreset: boolean
  defaultModels: ModelDefinition[]
}

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
```

- [ ] **Step 5: Rewrite ModelRegistry**

Change `ModelRegistry` constructor to accept `ModelConfigStore` and `ProviderRegistry`, merge built-ins on `load()`, and implement:

```ts
toOpenClawModelRef(selected: SelectedModel): string {
  const definition = this.providerRegistry.get(selected.providerId)
  const providerId = definition?.openClawProviderId ?? selected.providerId
  return `${providerId}/${selected.modelId}`
}
```

`toOpenclawConfig()` must:

```ts
for (const provider of this.listProviders()) {
  if (!provider.enabled) continue
  const definition = this.providerRegistry.get(provider.id)
  const auth = definition?.auth ?? 'api-key'
  const apiKey = this.store.getApiKey(provider.id)
  if (auth === 'api-key' && !apiKey) continue
  const openClawProviderId = definition?.openClawProviderId ?? provider.id
  const envVar = `PETCLAW_APIKEY_${provider.id.toUpperCase().replace(/-/g, '_')}`
  providers[openClawProviderId] = {
    baseUrl: provider.baseUrl,
    api: provider.apiFormat,
    ...(auth === 'api-key' ? { apiKey: `\${${envVar}}`, auth: 'api-key' } : {}),
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.name,
      ...(model.reasoning ? { reasoning: true } : {})
    }))
  }
}
```

- [ ] **Step 6: Run targeted tests**

```bash
cd petclaw-desktop
npm test -- tests/main/models/model-registry.test.ts tests/main/ai/config-sync.test.ts
```

Expected: model registry tests pass; config sync failures identify call sites to update in Task 3.

- [ ] **Step 7: Commit**

```bash
git add petclaw-desktop/src/shared/models/provider-registry.ts petclaw-desktop/src/main/ai/types.ts petclaw-desktop/src/main/models/model-registry.ts petclaw-desktop/src/main/models/preset-providers.ts petclaw-desktop/tests/main/models/model-registry.test.ts
git commit -m "refactor: move model providers to registry"
```

### Task 3: ConfigSync And Runtime Initialization

**Files:**
- Modify: `petclaw-desktop/src/main/runtime-services.ts`
- Modify: `petclaw-desktop/src/main/index.ts`
- Modify: `petclaw-desktop/src/main/ai/config-sync.ts`
- Test: `petclaw-desktop/tests/main/ai/config-sync.test.ts`

- [ ] **Step 1: Add failing ConfigSync assertion**

In `config-sync.test.ts`, assert:

```ts
expect(parsed.agents.defaults.model.primary).toBe('petclaw/petclaw-fast')
expect(parsed.models.providers.petclaw).toBeDefined()
expect(parsed.models.providers.zhipu).toBeUndefined()
```

- [ ] **Step 2: Wire store and registry construction**

Where `ModelRegistry` is constructed, replace `new ModelRegistry(db)` with:

```ts
const modelConfigStore = new ModelConfigStore(db)
const providerRegistry = new ProviderRegistry()
modelRegistry = new ModelRegistry(modelConfigStore, providerRegistry)
modelRegistry.load()
```

- [ ] **Step 3: Update ConfigSync default model call**

Use:

```ts
model: { primary: this.modelRegistry.getDefaultOpenClawModelRef() }
```

- [ ] **Step 4: Run targeted tests**

```bash
cd petclaw-desktop
npm test -- tests/main/ai/config-sync.test.ts tests/main/ai/engine-manager.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/main/runtime-services.ts petclaw-desktop/src/main/index.ts petclaw-desktop/src/main/ai/config-sync.ts petclaw-desktop/tests/main/ai/config-sync.test.ts
git commit -m "feat: sync model registry config"
```

### Task 4: Session Selected Model Flow

**Files:**
- Modify: `petclaw-desktop/src/main/data/db.ts`
- Modify: `petclaw-desktop/src/main/data/cowork-store.ts`
- Modify: `petclaw-desktop/src/main/ai/types.ts`
- Modify: `petclaw-desktop/src/main/ai/cowork-session-manager.ts`
- Modify: `petclaw-desktop/src/main/ai/cowork-controller.ts`
- Test: `petclaw-desktop/tests/main/data/cowork-store.test.ts`
- Test: `petclaw-desktop/tests/main/ai/cowork-controller.test.ts`
- Test: `petclaw-desktop/tests/main/ai/cowork-session-manager.test.ts`

- [ ] **Step 1: Add selected model persistence tests**

Add to `cowork-store.test.ts`:

```ts
it('persists selected model as structured JSON', () => {
  const session = store.createSession('title', '/tmp/project', 'main', '')
  store.updateSession(session.id, {
    selectedModel: { providerId: 'openai', modelId: 'gpt-4o' }
  })

  expect(store.getSession(session.id)?.selectedModel).toEqual({
    providerId: 'openai',
    modelId: 'gpt-4o'
  })
})
```

- [ ] **Step 2: Rename session column before launch**

Because the project is not launched, replace `model_override` with `selected_model_json` in `cowork_sessions`:

```sql
selected_model_json TEXT NOT NULL DEFAULT ''
```

No compatibility migration is needed.

- [ ] **Step 3: Update session types**

Replace:

```ts
modelOverride: string
```

with:

```ts
selectedModel: SelectedModel | null
```

Replace `CoworkStartOptions.modelOverride?: string` with:

```ts
selectedModel?: SelectedModel
```

- [ ] **Step 4: Update CoworkStore mapping**

Persist `selectedModel` with:

```ts
if (updates.selectedModel !== undefined) {
  fields.push('selected_model_json = ?')
  values.push(updates.selectedModel ? JSON.stringify(updates.selectedModel) : '')
}
```

Read it with:

```ts
const selectedModelJson = (row.selected_model_json as string) || ''
selectedModel: selectedModelJson ? (JSON.parse(selectedModelJson) as SelectedModel) : null
```

- [ ] **Step 5: Patch session model through ModelRegistry**

Inject `ModelRegistry` into `CoworkController`, then replace current model patch logic with:

```ts
const selectedModel = session.selectedModel
if (selectedModel) {
  const currentModel = this.modelRegistry.toOpenClawModelRef(selectedModel)
  if (currentModel !== this.lastPatchedModelBySession.get(sessionId)) {
    const client = this.gateway.getClient()
    if (client) {
      await client.request('sessions.patch', { key: sessionKey, model: currentModel })
      this.lastPatchedModelBySession.set(sessionId, currentModel)
    }
  }
}
```

- [ ] **Step 6: Run targeted tests**

```bash
cd petclaw-desktop
npm test -- tests/main/data/cowork-store.test.ts tests/main/ai/cowork-session-manager.test.ts tests/main/ai/cowork-controller.test.ts
```

Expected: pass with `sessions.patch` receiving OpenClaw refs.

- [ ] **Step 7: Commit**

```bash
git add petclaw-desktop/src/main/data/db.ts petclaw-desktop/src/main/data/cowork-store.ts petclaw-desktop/src/main/ai/types.ts petclaw-desktop/src/main/ai/cowork-session-manager.ts petclaw-desktop/src/main/ai/cowork-controller.ts petclaw-desktop/tests/main/data/cowork-store.test.ts petclaw-desktop/tests/main/ai/cowork-session-manager.test.ts petclaw-desktop/tests/main/ai/cowork-controller.test.ts
git commit -m "feat: patch selected session model"
```

### Task 5: IPC And Preload Contracts

**Files:**
- Modify: `petclaw-desktop/src/main/ipc/models-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/chat-ipc.ts`
- Modify: `petclaw-desktop/src/preload/index.ts`
- Modify: `petclaw-desktop/src/preload/index.d.ts`
- Test: `petclaw-desktop/tests/main/ipc/chat-ipc.test.ts`

- [ ] **Step 1: Add IPC contract tests**

In `chat-ipc.test.ts`, assert start-session passes structured model:

```ts
expect(coworkSessionManager.createAndStart).toHaveBeenCalledWith(
  expect.any(String),
  expect.any(String),
  'hello',
  expect.objectContaining({
    selectedModel: { providerId: 'openai', modelId: 'gpt-4o' }
  })
)
```

- [ ] **Step 2: Update chat IPC request type**

Replace `modelOverride?: string` with:

```ts
selectedModel?: { providerId: string; modelId: string }
```

Pass:

```ts
selectedModel: options.selectedModel
```

- [ ] **Step 3: Update model IPC**

Expose:

```ts
models: {
  providers: () => ipcRenderer.invoke('models:providers'),
  defaultModel: () => ipcRenderer.invoke('models:default'),
  setDefaultModel: (model: unknown) => ipcRenderer.invoke('models:set-default', model),
  setApiKey: (providerId: string, apiKey: string) => ipcRenderer.invoke('models:set-api-key', providerId, apiKey),
  clearApiKey: (providerId: string) => ipcRenderer.invoke('models:clear-api-key', providerId)
}
```

Remove `models:active` and `models:set-active` because the product is not launched.

- [ ] **Step 4: Run IPC tests**

```bash
cd petclaw-desktop
npm test -- tests/main/ipc/chat-ipc.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/main/ipc/models-ipc.ts petclaw-desktop/src/main/ipc/chat-ipc.ts petclaw-desktop/src/preload/index.ts petclaw-desktop/src/preload/index.d.ts petclaw-desktop/tests/main/ipc/chat-ipc.test.ts
git commit -m "refactor: update model ipc contracts"
```

### Task 6: Renderer ModelSelector And ChatInputBox

**Files:**
- Modify: `petclaw-desktop/src/renderer/src/components/ModelSelector.tsx`
- Modify: `petclaw-desktop/src/renderer/src/views/chat/ChatInputBox.tsx`
- Modify: `petclaw-desktop/src/renderer/src/views/chat/ChatView.tsx`
- Modify i18n locale files under `petclaw-shared/src/i18n/locales/zh.ts` and `petclaw-shared/src/i18n/locales/en.ts` if new labels are needed.

- [ ] **Step 1: Define renderer selected model type**

Use local type until a shared renderer type exists:

```ts
interface SelectedModel {
  providerId: string
  modelId: string
}
```

- [ ] **Step 2: Update ModelSelector extraction**

Extract provider-grouped options:

```ts
interface ModelOption {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  reasoning: boolean
}
```

When providers load, only include `enabled` providers and models with non-empty ids.

- [ ] **Step 3: Initialize selected model**

In `ModelSelector`, after providers load:

```ts
if (!value && options[0]) {
  onChange({ providerId: options[0].providerId, modelId: options[0].modelId })
}
```

Directory model initialization is handled by the parent when directory config is available; otherwise fallback to the first enabled/default model returned by the main process.

- [ ] **Step 4: Apply UI/UX details**

Keep the trigger compact:

```tsx
<button
  type="button"
  aria-label={t('modelSelector.chooseModel')}
  className="flex min-h-8 max-w-[160px] items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-[12px] text-text-secondary transition-all duration-[120ms] hover:bg-bg-card hover:text-text-primary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
>
```

Option rows must be buttons with provider label, model name, selected check icon, and no emoji icons.

- [ ] **Step 5: Update ChatInputBox contract**

Replace:

```ts
onSend: (message: string, cwd: string, skillIds: string[], modelOverride: string) => void
```

with:

```ts
onSend: (message: string, cwd: string, skillIds: string[], selectedModel: SelectedModel | null) => void
```

Disable send until `selectedModel` exists:

```ts
const canSend = !disabled && input.trim().length > 0 && selectedModel !== null
```

- [ ] **Step 6: Update ChatView request**

Send:

```ts
selectedModel
```

instead of `modelOverride`.

- [ ] **Step 7: Run renderer typecheck**

```bash
cd petclaw-desktop
npm run typecheck:web
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add petclaw-desktop/src/renderer/src/components/ModelSelector.tsx petclaw-desktop/src/renderer/src/views/chat/ChatInputBox.tsx petclaw-desktop/src/renderer/src/views/chat/ChatView.tsx petclaw-shared/src/i18n/locales/zh.ts petclaw-shared/src/i18n/locales/en.ts
git commit -m "feat: select model in chat input"
```

### Task 7: Settings Model UI Compatibility With New Backend

**Files:**
- Modify: `petclaw-desktop/src/renderer/src/views/settings/ModelSettings.tsx`
- Modify: `petclaw-desktop/src/main/ipc/models-ipc.ts`
- Test manually via dev app.

- [ ] **Step 1: Replace API key display semantics**

Settings must rely on `hasApiKey`, not masked `apiKey`.

Use:

```ts
if (provider.hasApiKey) {
  // show configured state
}
```

- [ ] **Step 2: Route key edits through secret IPC**

When user saves key:

```ts
await window.api.models.setApiKey(provider.id, apiKey.trim())
```

When user clears key:

```ts
await window.api.models.clearApiKey(provider.id)
```

- [ ] **Step 3: Route default model save through app_config preference**

When selecting global default:

```ts
await window.api.models.setDefaultModel({ providerId, modelId })
```

- [ ] **Step 4: UI/UX check**

Provider form must have visible labels, inline error text, disabled save state during async save, and keyboard accessible buttons.

- [ ] **Step 5: Run typecheck**

```bash
cd petclaw-desktop
npm run typecheck:web
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add petclaw-desktop/src/renderer/src/views/settings/ModelSettings.tsx petclaw-desktop/src/main/ipc/models-ipc.ts
git commit -m "feat: update model settings for secret store"
```

### Task 8: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run node and web typecheck**

```bash
cd petclaw-desktop
npm run typecheck
```

Expected: both `typecheck:node` and `typecheck:web` pass.

- [ ] **Step 2: Run full tests**

```bash
cd petclaw-desktop
npm test
```

Expected: all tests pass. If sandbox blocks localhost/socket tests, rerun with escalated permissions and record the reason.

- [ ] **Step 3: Run grep checks**

```bash
rg -n "modelOverride|activeModel|modelProviders|preset-providers" petclaw-desktop/src petclaw-desktop/tests
```

Expected: no production references to removed model config concepts except `directory.modelOverride`, which remains valid.

- [ ] **Step 4: Manual UI smoke check**

```bash
cd petclaw-desktop
npm run dev
```

Expected:
- ModelSelector starts with a concrete model selected.
- Dropdown opens upward from toolbar and remains keyboard focusable.
- Sending a new chat triggers `sessions.patch` before `chat.send`.
- Disabled provider models do not appear in selector.
- API key never appears in renderer responses.

- [ ] **Step 5: Commit verification fixes**

```bash
git add petclaw-desktop docs/superpowers/specs/2026-04-23-petclaw-phase2-design.md
git commit -m "test: verify model config refactor"
```

---

## Self-Review

- Spec coverage: The plan covers model persistence, API key separation, ProviderRegistry/OpenClaw mapping, ConfigSync default model, session `sessions.patch`, ChatInputBox selected model, and settings UI.
- UI/UX coverage: The plan applies `ui-ux-pro-max` requirements to ModelSelector touch targets, labels, keyboard focus, loading/empty states, and token-based styling.
- Scope control: The plan keeps `models_json` in `model_providers` and does not introduce a separate model table until model-level querying becomes necessary.
- No compatibility work: Because PetClaw is not launched, old `modelProviders`, `activeModel`, and session `modelOverride` storage are replaced directly.
