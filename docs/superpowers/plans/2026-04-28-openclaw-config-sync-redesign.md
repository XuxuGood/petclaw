# OpenClaw ConfigSync Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor PetClaw `ConfigSync` into a managed OpenClaw runtime configuration layer that covers baseline runtime fields, skills, exec approvals, plugins, IM configuration hooks, and global memorySearch readiness.

**Architecture:** Keep `ConfigSync` as the only external sync entry point, but split config generation into focused private builders. Preserve existing runtime-injected config fields where necessary, and add small typed manager/store interfaces for future IM and memorySearch integration without forcing UI work now.

**Tech Stack:** Electron main process, TypeScript, better-sqlite3, Vitest, OpenClaw gateway config (`openclaw.json`), SQLite `app_config`.

---

## File Map

- Modify: `petclaw-desktop/src/main/ai/config-sync.ts`
  - Split `buildConfig()` into private builders.
  - Add managed runtime baseline fields.
  - Add exec approvals sync.
  - Prepare optional IM and memorySearch dependencies.

- Modify: `petclaw-desktop/src/main/im/im-gateway-manager.ts`
  - Add OpenClaw config adapter methods for channels, bindings, plugin entries, and secret env vars.
  - Keep current CRUD and routing behavior unchanged.

- Create: `petclaw-desktop/src/main/memory/memory-search-config-store.ts`
  - Add typed global memorySearch config store backed by `app_config`.
  - Default disabled.

- Modify: `petclaw-desktop/src/main/index.ts`
  - Instantiate `MemorySearchConfigStore`.
  - Pass optional IM and memorySearch dependencies to `ConfigSync`.
  - Connect IM change events to `ConfigSync.sync()`.

- Modify: `petclaw-desktop/tests/main/ai/config-sync.test.ts`
  - Cover baseline config fields, gateway preservation/override, exec approvals, plugin preservation, IM hooks, memorySearch disabled/enabled.

- Create: `petclaw-desktop/tests/main/im/im-gateway-manager-openclaw.test.ts`
  - Cover IM OpenClaw adapter output and secret redaction behavior.

- Create: `petclaw-desktop/tests/main/memory/memory-search-config-store.test.ts`
  - Cover defaults, persistence, normalization, and secret env output.

- Modify: `docs/架构设计/PetClaw总体架构设计.md`
  - Sync ConfigSync architecture, IM, skills, exec approvals, memorySearch decisions.

- Modify: `AGENTS.md`
  - Update high-frequency ConfigSync responsibilities if wording is stale after implementation.

- Modify: `CLAUDE.md`
  - Mirror the same high-frequency ConfigSync responsibilities for Claude Code.

---

### Task 1: ConfigSync Baseline Tests

**Files:**
- Modify: `petclaw-desktop/tests/main/ai/config-sync.test.ts`

- [ ] **Step 1: Add failing tests for managed baseline fields**

Append these tests inside the existing `describe('ConfigSync', () => { ... })` block:

```ts
  it('should generate managed OpenClaw baseline fields', () => {
    const sync = createSync()
    const result = sync.sync('boot')

    expect(result.ok).toBe(true)
    const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8'))

    expect(config.gateway).toMatchObject({
      mode: 'local',
      auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' },
      tailscale: { mode: 'off' }
    })
    expect(config.agents.defaults.sandbox).toEqual({ mode: 'off' })
    expect(config.tools).toEqual({
      deny: ['web_search'],
      web: { search: { enabled: false } }
    })
    expect(config.browser).toEqual({ enabled: true })
    expect(config.cron).toEqual({
      enabled: true,
      skipMissedJobs: true,
      maxConcurrentRuns: 3,
      sessionRetention: '7d'
    })
    expect(config.commands).toEqual({ ownerAllowFrom: ['gateway-client', '*'] })
  })
```

- [ ] **Step 2: Replace the old gateway preservation expectation**

Find the existing test named `should preserve existing gateway field` and replace its assertion block with:

```ts
    expect(config.gateway).toMatchObject({
      mode: 'local',
      auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' },
      tailscale: { mode: 'off' },
      customField: 'keep-me'
    })
```

Also replace the written fixture in that test with:

```ts
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          gateway: {
            mode: 'remote',
            auth: { mode: 'token', token: 'existing' },
            customField: 'keep-me'
          }
        },
        null,
        2
      )
    )
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter petclaw-desktop test -- tests/main/ai/config-sync.test.ts
```

Expected: FAIL because `tools`, `browser`, `cron`, `sandbox`, and forced gateway auth/tailscale are not implemented.

---

### Task 2: ConfigSync Builder Refactor And Baseline Implementation

**Files:**
- Modify: `petclaw-desktop/src/main/ai/config-sync.ts`

- [ ] **Step 1: Add focused config types near the top of the file**

Add below `ConfigSyncOptions`:

```ts
type JsonObject = Record<string, unknown>

interface GatewayConfig extends JsonObject {
  mode: string
  auth: { mode: string; token: string }
  tailscale: { mode: string }
}

interface CronConfig {
  enabled: boolean
  skipMissedJobs: boolean
  maxConcurrentRuns: number
  sessionRetention: string
}
```

- [ ] **Step 2: Replace `buildConfig()` with builder composition**

Replace the existing `private buildConfig(existing: Record<string, unknown>): Record<string, unknown>` method with:

```ts
  private buildConfig(existing: Record<string, unknown>): Record<string, unknown> {
    return {
      gateway: this.buildGatewayConfig(this.asRecord(existing.gateway)),
      models: this.buildModelsConfig(),
      agents: this.buildAgentsConfig(),
      skills: this.buildSkillsConfig(),
      tools: this.buildToolsConfig(),
      browser: this.buildBrowserConfig(),
      cron: this.buildCronConfig(),
      plugins: this.buildPluginsConfig(this.asRecord(existing.plugins)),
      hooks: this.buildHooksConfig(),
      commands: this.buildCommandsConfig()
    }
  }
```

- [ ] **Step 3: Add builder methods**

Add these private methods before `syncAgentsMd()`:

```ts
  private buildGatewayConfig(existingGateway: Record<string, unknown>): GatewayConfig {
    return {
      ...existingGateway,
      mode: 'local',
      auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' },
      tailscale: { mode: 'off' }
    }
  }

  private buildModelsConfig(): Record<string, unknown> {
    return this.modelRegistry.toOpenclawConfig()
  }

  private buildAgentsConfig(): Record<string, unknown> {
    const directoryAgents = this.directoryManager.toOpenclawConfig()
    return {
      defaults: {
        timeoutSeconds: 3600,
        model: { primary: this.modelRegistry.getDefaultOpenClawModelRef() },
        workspace: this.workspacePath,
        sandbox: { mode: 'off' }
      },
      list: directoryAgents.list
    }
  }

  private buildSkillsConfig(): Record<string, unknown> {
    return this.skillManager.toOpenclawConfig()
  }

  private buildToolsConfig(): Record<string, unknown> {
    return {
      deny: ['web_search'],
      web: { search: { enabled: false } }
    }
  }

  private buildBrowserConfig(): Record<string, unknown> {
    return { enabled: true }
  }

  private buildCronConfig(): CronConfig {
    const config = this.coworkConfigStore.getConfig()
    return {
      enabled: true,
      skipMissedJobs: config.skipMissedJobs,
      maxConcurrentRuns: 3,
      sessionRetention: '7d'
    }
  }

  private buildPluginsConfig(existingPlugins: Record<string, unknown>): Record<string, unknown> {
    const mcpPlugins = this.mcpManager.toOpenclawConfig()
    return this.mergePluginConfigs(existingPlugins, mcpPlugins)
  }

  private buildHooksConfig(): Record<string, unknown> {
    return { internal: { entries: { 'session-memory': { enabled: false } } } }
  }

  private buildCommandsConfig(): Record<string, unknown> {
    return { ownerAllowFrom: ['gateway-client', '*'] }
  }
```

- [ ] **Step 4: Add helper methods**

Add these private methods before `readExistingConfig()`:

```ts
  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }

  private mergePluginConfigs(
    existingPlugins: Record<string, unknown>,
    managedPlugins: Record<string, unknown>
  ): Record<string, unknown> {
    const existingEntries = this.asRecord(existingPlugins.entries)
    const managedEntries = this.asRecord(managedPlugins.entries)

    return {
      ...existingPlugins,
      ...managedPlugins,
      entries: {
        ...existingEntries,
        ...managedEntries
      }
    }
  }
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter petclaw-desktop test -- tests/main/ai/config-sync.test.ts
```

Expected: PASS for config-sync tests after updating the gateway preservation fixture.

---

### Task 3: Exec Approval Defaults Tests

**Files:**
- Modify: `petclaw-desktop/tests/main/ai/config-sync.test.ts`

- [ ] **Step 1: Add tests for exec approvals**

Append these tests inside the existing describe block:

```ts
  it('should create exec approval defaults for main agent', () => {
    const sync = createSync()
    const result = sync.sync('boot')

    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)

    const approvalsPath = path.join(tmpDir, '.openclaw', 'exec-approvals.json')
    const approvals = JSON.parse(fs.readFileSync(approvalsPath, 'utf8'))

    expect(approvals).toMatchObject({
      version: 1,
      agents: {
        main: {
          security: 'full',
          ask: 'off'
        }
      }
    })
  })

  it('should preserve unknown exec approval fields', () => {
    const approvalsDir = path.join(tmpDir, '.openclaw')
    fs.mkdirSync(approvalsDir, { recursive: true })
    const approvalsPath = path.join(approvalsDir, 'exec-approvals.json')
    fs.writeFileSync(
      approvalsPath,
      JSON.stringify(
        {
          version: 1,
          customRoot: true,
          agents: {
            main: {
              ask: 'on',
              customAgent: 'keep'
            },
            other: {
              security: 'limited'
            }
          }
        },
        null,
        2
      )
    )

    const sync = createSync()
    const result = sync.sync('boot')

    expect(result.ok).toBe(true)
    const approvals = JSON.parse(fs.readFileSync(approvalsPath, 'utf8'))
    expect(approvals.customRoot).toBe(true)
    expect(approvals.agents.main).toEqual({
      ask: 'off',
      customAgent: 'keep',
      security: 'full'
    })
    expect(approvals.agents.other).toEqual({ security: 'limited' })
  })
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter petclaw-desktop test -- tests/main/ai/config-sync.test.ts
```

Expected: FAIL because `exec-approvals.json` is not written yet.

---

### Task 4: Exec Approval Defaults Implementation

**Files:**
- Modify: `petclaw-desktop/src/main/ai/config-sync.ts`

- [ ] **Step 1: Add approval file types near other local types**

Add:

```ts
interface ExecApprovalAgentEntry {
  security?: string
  ask?: string
  [key: string]: unknown
}

interface ExecApprovalsFile {
  version: number
  agents?: Record<string, ExecApprovalAgentEntry>
  [key: string]: unknown
}
```

- [ ] **Step 2: Update `sync()` to include exec approvals**

Replace:

```ts
      const agentsMdChanged = this.syncAgentsMd(this.workspacePath)
      const configChanged = this.syncOpenClawConfig()

      return { ok: true, changed: agentsMdChanged || configChanged, configPath: this.configPath }
```

with:

```ts
      const agentsMdChanged = this.syncAgentsMd(this.workspacePath)
      const execApprovalsChanged = this.syncExecApprovalDefaults()
      const configChanged = this.syncOpenClawConfig()

      return {
        ok: true,
        changed: agentsMdChanged || execApprovalsChanged || configChanged,
        configPath: this.configPath
      }
```

- [ ] **Step 3: Add `syncExecApprovalDefaults()`**

Add before `syncOpenClawConfig()`:

```ts
  private syncExecApprovalDefaults(): boolean {
    const approvalsPath = path.join(this.stateDir, '..', '.openclaw', 'exec-approvals.json')
    const existing = this.readExecApprovalsFile(approvalsPath)
    if (!existing.agents) existing.agents = {}
    if (!existing.agents.main) existing.agents.main = {}

    const main = existing.agents.main
    if (main.security === 'full' && main.ask === 'off') return false

    main.security = 'full'
    main.ask = 'off'

    return this.atomicWriteIfChanged(
      approvalsPath,
      `${JSON.stringify(existing, null, 2)}\n`
    )
  }

  private readExecApprovalsFile(filePath: string): ExecApprovalsFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const file = parsed as ExecApprovalsFile
        if (file.version === 1) return file
      }
    } catch {
      /* ignore */
    }
    return { version: 1 }
  }
```

- [ ] **Step 4: Ensure atomic write creates parent directories**

In `atomicWriteIfChanged()`, add before `const tmpPath = ...`:

```ts
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter petclaw-desktop test -- tests/main/ai/config-sync.test.ts
```

Expected: PASS.

---

### Task 5: IM OpenClaw Adapter Tests

**Files:**
- Create: `petclaw-desktop/tests/main/im/im-gateway-manager-openclaw.test.ts`

- [ ] **Step 1: Create failing tests**

Create the file with:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

import { initDatabase } from '../../../src/main/data/db'
import { ImStore } from '../../../src/main/data/im-store'
import { ImGatewayManager } from '../../../src/main/im/im-gateway-manager'

describe('ImGatewayManager OpenClaw config', () => {
  let db: Database.Database
  let manager: ImGatewayManager

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    manager = new ImGatewayManager(new ImStore(db))
  })

  afterEach(() => {
    db.close()
  })

  it('should export enabled IM instances as OpenClaw channels without plaintext credentials', () => {
    const instance = manager.createInstance(
      'telegram',
      { botToken: 'secret-token' },
      'Telegram Bot'
    )
    manager.updateInstance(instance.id, {
      config: { webhookPath: '/telegram' },
      enabled: true
    })

    const channels = manager.toOpenclawChannelsConfig()
    const channel = channels[`telegram:${instance.id}`] as Record<string, unknown>

    expect(channel).toEqual({
      enabled: true,
      platform: 'telegram',
      name: 'Telegram Bot',
      webhookPath: '/telegram',
      credentials: {
        botToken: `\${PETCLAW_IM_TELEGRAM_${instance.id.replace(/-/g, '_').toUpperCase()}_BOT_TOKEN}`
      }
    })
    expect(JSON.stringify(channels)).not.toContain('secret-token')
  })

  it('should export instance default bindings', () => {
    const instance = manager.createInstance('telegram', { botToken: 'secret-token' })
    manager.updateInstance(instance.id, {
      enabled: true,
      agentId: 'dir-agent',
      directoryPath: '/repo/a'
    })

    const result = manager.toOpenclawBindingsConfig()

    expect(result.bindings).toEqual([
      {
        agentId: 'dir-agent',
        match: {
          channel: `telegram:${instance.id}`
        }
      }
    ])
  })

  it('should collect IM secret env vars', () => {
    const instance = manager.createInstance('telegram', { botToken: 'secret-token' })
    manager.updateInstance(instance.id, { enabled: true })

    const vars = manager.collectSecretEnvVars()

    expect(vars).toEqual({
      [`PETCLAW_IM_TELEGRAM_${instance.id.replace(/-/g, '_').toUpperCase()}_BOT_TOKEN`]:
        'secret-token'
    })
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter petclaw-desktop test -- tests/main/im/im-gateway-manager-openclaw.test.ts
```

Expected: FAIL because the adapter methods do not exist.

---

### Task 6: IM OpenClaw Adapter Implementation

**Files:**
- Modify: `petclaw-desktop/src/main/im/im-gateway-manager.ts`

- [ ] **Step 1: Add helper functions above the class**

Add:

```ts
function toEnvToken(value: string): string {
  return value.replace(/-/g, '_').toUpperCase()
}

function buildImSecretEnvName(platform: Platform, instanceId: string, key: string): string {
  return `PETCLAW_IM_${platform.toUpperCase()}_${toEnvToken(instanceId)}_${toEnvToken(key)}`
}

function toOpenclawCredentialValue(platform: Platform, instanceId: string, key: string): string {
  return `\${${buildImSecretEnvName(platform, instanceId, key)}}`
}

function isSecretCredentialKey(key: string): boolean {
  return /token|secret|password|apikey|api_key|key/i.test(key)
}
```

- [ ] **Step 2: Add adapter methods before `toOpenclawConfig()`**

Add:

```ts
  toOpenclawChannelsConfig(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const inst of this.store.listInstances()) {
      if (!inst.enabled) continue
      const credentials: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(inst.credentials)) {
        credentials[key] =
          typeof value === 'string' && isSecretCredentialKey(key)
            ? toOpenclawCredentialValue(inst.platform, inst.id, key)
            : value
      }
      result[`${inst.platform}:${inst.id}`] = {
        enabled: true,
        platform: inst.platform,
        ...(inst.name ? { name: inst.name } : {}),
        ...inst.config,
        credentials
      }
    }
    return result
  }

  toOpenclawBindingsConfig(): { bindings?: Array<Record<string, unknown>> } {
    const bindings: Array<Record<string, unknown>> = []
    for (const inst of this.store.listInstances()) {
      if (!inst.enabled || !inst.agentId) continue
      bindings.push({
        agentId: inst.agentId,
        match: { channel: `${inst.platform}:${inst.id}` }
      })
    }
    return bindings.length > 0 ? { bindings } : {}
  }

  toOpenclawPluginEntries(): Record<string, { enabled: boolean }> {
    const entries: Record<string, { enabled: boolean }> = {}
    for (const inst of this.store.listInstances()) {
      entries[inst.platform] = {
        enabled: this.store.listInstances().some((item) => item.enabled && item.platform === inst.platform)
      }
    }
    return entries
  }

  collectSecretEnvVars(): Record<string, string> {
    const vars: Record<string, string> = {}
    for (const inst of this.store.listInstances()) {
      if (!inst.enabled) continue
      for (const [key, value] of Object.entries(inst.credentials)) {
        if (typeof value === 'string' && isSecretCredentialKey(key)) {
          vars[buildImSecretEnvName(inst.platform, inst.id, key)] = value
        }
      }
    }
    return vars
  }
```

- [ ] **Step 3: Update legacy `toOpenclawConfig()` to delegate**

Replace the method body with:

```ts
    return this.toOpenclawChannelsConfig()
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter petclaw-desktop test -- tests/main/im/im-gateway-manager-openclaw.test.ts
```

Expected: PASS.

---

### Task 7: ConfigSync IM Integration Tests

**Files:**
- Modify: `petclaw-desktop/tests/main/ai/config-sync.test.ts`

- [ ] **Step 1: Add imports**

Add:

```ts
import { ImStore } from '../../../src/main/data/im-store'
import { ImGatewayManager } from '../../../src/main/im/im-gateway-manager'
```

- [ ] **Step 2: Add test-local variable and wire createSync**

Add near other variables:

```ts
  let imGatewayManager: ImGatewayManager
```

In `beforeEach()`, add:

```ts
    imGatewayManager = new ImGatewayManager(new ImStore(db))
```

In `createSync()`, pass:

```ts
      imGatewayManager,
```

- [ ] **Step 3: Add tests**

Append:

```ts
  it('should include IM channels and bindings when configured', () => {
    const instance = imGatewayManager.createInstance(
      'telegram',
      { botToken: 'secret-token' },
      'Telegram Bot'
    )
    imGatewayManager.updateInstance(instance.id, {
      enabled: true,
      agentId: 'main',
      config: { webhookPath: '/telegram' }
    })

    const sync = createSync()
    const result = sync.sync('im-change')
    const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8'))

    expect(config.channels[`telegram:${instance.id}`]).toMatchObject({
      enabled: true,
      platform: 'telegram',
      name: 'Telegram Bot',
      webhookPath: '/telegram'
    })
    expect(config.bindings).toEqual([
      {
        agentId: 'main',
        match: { channel: `telegram:${instance.id}` }
      }
    ])
    expect(JSON.stringify(config)).not.toContain('secret-token')
  })

  it('should collect IM secret env vars', () => {
    const instance = imGatewayManager.createInstance('telegram', { botToken: 'secret-token' })
    imGatewayManager.updateInstance(instance.id, { enabled: true })

    const sync = createSync()
    const vars = sync.collectSecretEnvVars()

    expect(vars).toMatchObject({
      [`PETCLAW_IM_TELEGRAM_${instance.id.replace(/-/g, '_').toUpperCase()}_BOT_TOKEN`]:
        'secret-token'
    })
  })
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
pnpm --filter petclaw-desktop test -- tests/main/ai/config-sync.test.ts
```

Expected: FAIL because `ConfigSyncOptions` does not accept `imGatewayManager` and config does not include channels/bindings.

---

### Task 8: ConfigSync IM Integration Implementation

**Files:**
- Modify: `petclaw-desktop/src/main/ai/config-sync.ts`
- Modify: `petclaw-desktop/src/main/index.ts`

- [ ] **Step 1: Add type import**

In `config-sync.ts`, add:

```ts
import type { ImGatewayManager } from '../im/im-gateway-manager'
```

- [ ] **Step 2: Extend options and class fields**

Add to `ConfigSyncOptions`:

```ts
  imGatewayManager?: ImGatewayManager
```

Add class field:

```ts
  private imGatewayManager?: ImGatewayManager
```

In constructor:

```ts
    this.imGatewayManager = opts.imGatewayManager
```

- [ ] **Step 3: Add channels and bindings to `buildConfig()`**

Replace the return expression in `buildConfig()` with:

```ts
    const bindingsConfig = this.buildBindingsConfig()
    return {
      gateway: this.buildGatewayConfig(this.asRecord(existing.gateway)),
      models: this.buildModelsConfig(),
      agents: this.buildAgentsConfig(),
      ...bindingsConfig,
      channels: this.buildChannelsConfig(),
      skills: this.buildSkillsConfig(),
      tools: this.buildToolsConfig(),
      browser: this.buildBrowserConfig(),
      cron: this.buildCronConfig(),
      plugins: this.buildPluginsConfig(this.asRecord(existing.plugins)),
      hooks: this.buildHooksConfig(),
      commands: this.buildCommandsConfig()
    }
```

- [ ] **Step 4: Add IM builder methods**

Add:

```ts
  private buildChannelsConfig(): Record<string, unknown> {
    return this.imGatewayManager?.toOpenclawChannelsConfig() ?? {}
  }

  private buildBindingsConfig(): Record<string, unknown> {
    return this.imGatewayManager?.toOpenclawBindingsConfig() ?? {}
  }
```

- [ ] **Step 5: Merge IM plugin entries**

In `buildPluginsConfig()`, before the return, add:

```ts
    const imPlugins = this.imGatewayManager
      ? { entries: this.imGatewayManager.toOpenclawPluginEntries() }
      : {}
```

Replace the return with:

```ts
    return this.mergePluginConfigs(
      this.mergePluginConfigs(existingPlugins, mcpPlugins),
      imPlugins
    )
```

- [ ] **Step 6: Collect IM secret env vars**

Replace `collectSecretEnvVars()` with:

```ts
  collectSecretEnvVars(): Record<string, string> {
    return {
      ...this.modelRegistry.collectSecretEnvVars(),
      ...(this.imGatewayManager?.collectSecretEnvVars() ?? {})
    }
  }
```

- [ ] **Step 7: Pass IM manager from `index.ts`**

In `index.ts`, add `imGatewayManager` to `new ConfigSync({ ... })`:

```ts
    imGatewayManager,
```

After existing change listeners, add:

```ts
  imGatewayManager.on('change', () => configSync.sync('im-change'))
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm --filter petclaw-desktop test -- tests/main/ai/config-sync.test.ts tests/main/im/im-gateway-manager-openclaw.test.ts
```

Expected: PASS.

---

### Task 9: MemorySearch Store Tests

**Files:**
- Create: `petclaw-desktop/tests/main/memory/memory-search-config-store.test.ts`

- [ ] **Step 1: Create failing tests**

Create:

```ts
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter petclaw-desktop test -- tests/main/memory/memory-search-config-store.test.ts
```

Expected: FAIL because the store file does not exist.

---

### Task 10: MemorySearch Store Implementation

**Files:**
- Create: `petclaw-desktop/src/main/memory/memory-search-config-store.ts`

- [ ] **Step 1: Create the store**

Create:

```ts
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
        remoteBaseUrl:
          typeof parsed.remoteBaseUrl === 'string' ? parsed.remoteBaseUrl.trim() : '',
        remoteApiKey:
          typeof parsed.remoteApiKey === 'string' ? parsed.remoteApiKey.trim() : '',
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
```

- [ ] **Step 2: Run tests**

Run:

```bash
pnpm --filter petclaw-desktop test -- tests/main/memory/memory-search-config-store.test.ts
```

Expected: PASS.

---

### Task 11: ConfigSync MemorySearch Integration

**Files:**
- Modify: `petclaw-desktop/src/main/ai/config-sync.ts`
- Modify: `petclaw-desktop/src/main/index.ts`
- Modify: `petclaw-desktop/tests/main/ai/config-sync.test.ts`

- [ ] **Step 1: Add config-sync tests**

In `config-sync.test.ts`, import:

```ts
import { MemorySearchConfigStore } from '../../../src/main/memory/memory-search-config-store'
```

Add variable:

```ts
  let memorySearchConfigStore: MemorySearchConfigStore
```

In `beforeEach()`:

```ts
    memorySearchConfigStore = new MemorySearchConfigStore(db)
```

In `createSync()`:

```ts
      memorySearchConfigStore,
```

Append:

```ts
  it('should omit memorySearch when disabled', () => {
    const sync = createSync()
    const result = sync.sync('boot')
    const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8'))

    expect(config.agents.defaults.memorySearch).toBeUndefined()
  })

  it('should write global memorySearch to agents defaults when enabled', () => {
    memorySearchConfigStore.setConfig({
      enabled: true,
      provider: 'gemini',
      model: 'text-embedding-004',
      remoteApiKey: 'secret-key'
    })

    const sync = createSync()
    const result = sync.sync('memory-search-change')
    const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8'))

    expect(config.agents.defaults.memorySearch).toMatchObject({
      enabled: true,
      provider: 'gemini',
      model: 'text-embedding-004',
      remote: { apiKey: '${PETCLAW_MEMORY_SEARCH_API_KEY}' }
    })
    expect(JSON.stringify(config)).not.toContain('secret-key')
    expect(sync.collectSecretEnvVars()).toMatchObject({
      PETCLAW_MEMORY_SEARCH_API_KEY: 'secret-key'
    })
  })
```

- [ ] **Step 2: Update `config-sync.ts` options**

Import:

```ts
import type { MemorySearchConfigStore } from '../memory/memory-search-config-store'
```

Add option and field:

```ts
  memorySearchConfigStore?: MemorySearchConfigStore
```

```ts
  private memorySearchConfigStore?: MemorySearchConfigStore
```

Constructor:

```ts
    this.memorySearchConfigStore = opts.memorySearchConfigStore
```

- [ ] **Step 3: Add memorySearch to agents defaults**

In `buildAgentsConfig()`, add:

```ts
    const memorySearch = this.memorySearchConfigStore?.toOpenclawConfig()
```

Then add inside defaults:

```ts
        ...(memorySearch ? { memorySearch } : {})
```

- [ ] **Step 4: Add memorySearch secrets**

In `collectSecretEnvVars()`, add:

```ts
      ...(this.memorySearchConfigStore?.collectSecretEnvVars() ?? {})
```

- [ ] **Step 5: Instantiate in `index.ts`**

Import:

```ts
import { MemorySearchConfigStore } from './memory/memory-search-config-store'
```

Create near other stores:

```ts
  const memorySearchConfigStore = new MemorySearchConfigStore(db)
```

Pass to `new ConfigSync({ ... })`:

```ts
    memorySearchConfigStore,
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter petclaw-desktop test -- tests/main/ai/config-sync.test.ts tests/main/memory/memory-search-config-store.test.ts
```

Expected: PASS.

---

### Task 12: Clear Selected Skills After Send

**Files:**
- Modify: `petclaw-desktop/src/renderer/src/views/chat/ChatInputBox.tsx`

- [ ] **Step 1: Apply the turn-scoped selected skill behavior**

In `handleSend()`, after `setInput('')`, add:

```ts
    setSelectedSkills([])
```

The function should become:

```ts
  const handleSend = () => {
    if (!canSend) return
    onSend(input.trim(), cwd, selectedSkills, selectedModel)
    setInput('')
    setSelectedSkills([])
    // 重置 textarea 高度
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter petclaw-desktop typecheck
```

Expected: PASS.

---

### Task 13: Documentation Sync

**Files:**
- Modify: `docs/架构设计/PetClaw总体架构设计.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update architecture ConfigSync section**

In `docs/架构设计/PetClaw总体架构设计.md`, update section `6. 基础层 — ConfigSync` to state:

```md
ConfigSync 是 OpenClaw runtime 配置唯一写入入口，负责同步：

- `{userData}/openclaw/state/openclaw.json`
- `{userData}/openclaw/workspace/AGENTS.md`
- `{userData}/openclaw/.openclaw/exec-approvals.json`

`openclaw.json` 由分域 builder 生成：gateway、models、agents、tools、browser、skills、cron、plugins、channels、bindings、hooks、commands。
```

- [ ] **Step 2: Update skill semantics**

Replace stale `activeSkillIds` wording with:

```md
本轮 skill 选择由 ChatInputBox 维护，发送消息时通过 `skillIds` 写入 user message metadata，并由主进程生成本轮 `skillPrompt`。发送后清空选择。`cowork_sessions.system_prompt` 不保存 skill prompt。
```

- [ ] **Step 3: Add memorySearch decision**

Add near agent defaults:

```md
`agents.defaults.memorySearch` 是全局记忆检索配置。main agent 和目录 agent 默认继承。当前阶段不做目录级 memorySearch override；如未来需要，再由 `directories` 增加 override 字段并输出到对应 `agents.list[i].memorySearch`。
```

- [ ] **Step 4: Update AGENTS.md and CLAUDE.md summaries**

Ensure both files say:

```md
ConfigSync 是 OpenClaw runtime 配置同步入口，负责 `openclaw.json`、main workspace `AGENTS.md`、exec approvals。它聚合 Directory、Model、Skill、MCP、IM、Cron、memorySearch 等配置；敏感信息只能通过 env placeholder 写入 runtime 配置。
```

- [ ] **Step 5: Run docs grep**

Run:

```bash
rg -n "activeSkillIds|exec-approvals|memorySearch|buildManagedSections" AGENTS.md CLAUDE.md docs/架构设计/PetClaw总体架构设计.md docs/superpowers/specs/2026-04-28-openclaw-config-sync-redesign.md
```

Expected:

- No stale “会话激活 activeSkillIds” semantics in architecture doc.
- `exec-approvals` and `memorySearch` are documented.
- `buildManagedSections` is described as managed AGENTS sections, not skill routing.

---

### Task 14: Final Verification

**Files:**
- No direct edits.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter petclaw-desktop test -- tests/main/ai/config-sync.test.ts tests/main/im/im-gateway-manager-openclaw.test.ts tests/main/memory/memory-search-config-store.test.ts tests/main/skills/skill-manager.test.ts tests/main/ipc/chat-ipc.test.ts tests/main/ai/cowork-controller.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run desktop typecheck**

Run:

```bash
pnpm --filter petclaw-desktop typecheck
```

Expected: PASS.

- [ ] **Step 3: Run workspace typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run workspace tests**

Run:

```bash
npm test
```

Expected: PASS in a full local environment. If this fails with `listen EPERM` or local port/socket errors in sandbox, record it as an environment limitation and rely on targeted tests plus typecheck.

---

## Self-Review Notes

- Spec coverage: baseline config, IM, memorySearch, skills, exec approvals, plugins, docs, and selected skill turn scope are covered by tasks.
- Scope control: embedding UI, directory-level memorySearch override, and LobsterAI channel history reconciliation are intentionally excluded.
- Type consistency: optional `imGatewayManager` and `memorySearchConfigStore` are introduced before use in ConfigSync integration tasks.
