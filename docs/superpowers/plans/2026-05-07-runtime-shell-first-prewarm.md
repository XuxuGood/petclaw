# Runtime Shell-first Prewarm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PetClaw show the real app shell immediately while OpenClaw Runtime starts through background prewarm and business-entry `ensureReady`.

**Architecture:** Introduce a Main Process `RuntimeLifecycleService` as the only owner of ConfigSync + Gateway startup orchestration. Main Window, Dock/Application Menu, tray, Phase A IPC, and Pet readiness become App Boot concerns; Chat/Cron/IM/Settings consume Runtime through snapshot + status push + `ensureReady`.

**Tech Stack:** Electron Main/Preload/Renderer, TypeScript, React, Vitest, SQLite stores, OpenClaw EngineManager, ConfigSync, existing `safeHandle`/`safeOn` IPC registry.

---

## File Structure

- Create: `petclaw-desktop/src/main/runtime/runtime-lifecycle.ts`
  - Owns Runtime phase snapshot, startup/prewarm/restart/stop, ConfigSync serialization, EngineManager status forwarding, and concurrent ensure dedupe.
- Create: `petclaw-desktop/src/main/ipc/runtime-ipc.ts`
  - Registers `runtime:*` channels through `safeHandle`.
- Modify: `petclaw-desktop/src/main/ipc/index.ts`
  - Adds runtime IPC deps and registration.
- Modify: `petclaw-desktop/src/main/runtime-services.ts`
  - Injects RuntimeLifecycleService into Gateway/Cron paths so business calls use `ensureReady`.
- Modify: `petclaw-desktop/src/main/ai/gateway.ts`
  - Allows `OpenclawGateway` to delegate Gateway readiness to RuntimeLifecycleService while preserving EngineManager fallback.
- Modify: `petclaw-desktop/src/main/index.ts`
  - Removes blocking `runBootCheck` from startup, initializes runtime services before Gateway is running, registers runtime IPC before shell is shown as main, starts prewarm after Main Window is visible, and removes `restoreMainWindowAfterStartup`.
- Modify: `petclaw-desktop/src/preload/index.ts`
  - Exposes `runtime.getSnapshot/onStatus/ensureReady/prewarm/restart/stop/openDiagnostics`.
- Modify: `petclaw-desktop/src/preload/index.d.ts`
  - Adds Runtime API types.
- Modify: `petclaw-desktop/src/renderer/src/App.tsx`
  - Removes `bootcheck` as app phase; app starts in main shell and still sends `app:pet-ready` after first render.
- Modify: `petclaw-desktop/src/renderer/src/views/settings/EngineSettings.tsx`
  - Uses Runtime snapshot + status subscription and exposes restart/stop/diagnostics controls.
- Modify: `petclaw-desktop/src/renderer/src/views/boot/BootCheckPanel.tsx`
  - Convert visible copy to diagnostics wording and stop rendering it from app boot.
- Modify: `petclaw-shared/src/i18n/locales/zh.ts`
- Modify: `petclaw-shared/src/i18n/locales/en.ts`
  - Add Runtime user-facing copy.
- Test: `petclaw-desktop/tests/main/runtime/runtime-lifecycle.test.ts`
- Test: `petclaw-desktop/tests/main/runtime-services.test.ts`
- Test: `petclaw-desktop/tests/main/system/system-integration-startup.test.ts`
- Test: `petclaw-desktop/tests/main/ai/gateway.test.ts`
- Test: `petclaw-desktop/tests/renderer/App.test.tsx`
- Test: `petclaw-desktop/tests/renderer/settings/EngineSettings.test.tsx`
- Docs after implementation: update architecture docs listed in the spec.

## Task 0: Pre-change Impact and Baseline

**Files:**
- Read: `docs/superpowers/specs/2026-05-07-runtime-shell-first-prewarm-design.md`
- Read: `petclaw-desktop/src/main/index.ts`
- Read: `petclaw-desktop/src/main/bootcheck.ts`
- Read: `petclaw-desktop/src/main/runtime-services.ts`
- Read: `petclaw-desktop/src/main/ai/gateway.ts`
- Read: `petclaw-desktop/src/main/ipc/index.ts`

- [ ] **Step 1: Run AI prepare-change**

```bash
pnpm ai:prepare-change -- --target RuntimeLifecycleService
```

Expected: command completes or reports a toolchain limitation. If it fails with GitNexus lock, registry, EPERM, or EACCES, record the failure in the implementation notes and continue with MCP/local scans.

- [ ] **Step 2: Run GitNexus impact for changed symbols**

Use MCP:

```text
gitnexus_impact({ target: "runBootCheck", direction: "upstream", repo: "petclaw" })
gitnexus_impact({ target: "setupRuntimeServices", direction: "upstream", repo: "petclaw" })
gitnexus_impact({ target: "OpenclawGateway", direction: "upstream", repo: "petclaw" })
gitnexus_impact({ target: "registerAllIpcHandlers", direction: "upstream", repo: "petclaw" })
```

Expected: report direct callers, affected processes, and risk level before edits. If any result is HIGH or CRITICAL, stop and tell the user before implementation.

- [ ] **Step 3: Run baseline targeted tests**

```bash
pnpm --filter petclaw-desktop test -- tests/main/bootcheck.test.ts tests/main/system/system-integration-startup.test.ts tests/main/ai/gateway.test.ts tests/main/scheduler/cron-job-service.test.ts tests/renderer/App.test.tsx
```

Expected: existing tests pass, or failures are recorded as pre-existing with exact failing test names.

- [ ] **Step 4: Commit nothing**

This task is read-only. Do not stage files.

## Task 1: RuntimeLifecycleService

**Files:**
- Create: `petclaw-desktop/src/main/runtime/runtime-lifecycle.ts`
- Test: `petclaw-desktop/tests/main/runtime/runtime-lifecycle.test.ts`

- [ ] **Step 1: Write failing tests**

Create `petclaw-desktop/tests/main/runtime/runtime-lifecycle.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { RuntimeLifecycleService } from '../../../src/main/runtime/runtime-lifecycle'

function createDeps() {
  const engineManager = {
    getStatus: vi.fn(() => ({ phase: 'ready', version: '2026.2.23', canRetry: false })),
    startGateway: vi.fn(async () => ({
      phase: 'running',
      version: '2026.2.23',
      message: 'running',
      canRetry: false
    })),
    stopGateway: vi.fn(async () => undefined),
    restartGateway: vi.fn(async () => ({
      phase: 'running',
      version: '2026.2.23',
      message: 'running',
      canRetry: false
    })),
    getGatewayConnectionInfo: vi.fn(() => ({ port: 18789, token: 'token' })),
    setSecretEnvVars: vi.fn(),
    on: vi.fn()
  }
  const configSync = {
    sync: vi.fn(() => ({ ok: true, changed: false, configPath: '/state/openclaw.json' })),
    collectSecretEnvVars: vi.fn(() => ({ OPENAI_API_KEY: 'secret' }))
  }
  return { engineManager, configSync }
}

describe('RuntimeLifecycleService', () => {
  it('starts idle and exposes a snapshot', () => {
    const deps = createDeps()
    const service = new RuntimeLifecycleService(deps as never)

    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        phase: 'idle',
        reason: 'initial',
        attempt: 0,
        canRetry: false,
        canOpenDiagnostics: true
      })
    )
  })

  it('serializes config sync and gateway startup for concurrent ensureReady calls', async () => {
    const deps = createDeps()
    const service = new RuntimeLifecycleService(deps as never)

    const [a, b] = await Promise.all([
      service.ensureReady('cowork-send'),
      service.ensureReady('cron-autostart')
    ])

    expect(a.phase).toBe('running')
    expect(b.phase).toBe('running')
    expect(deps.configSync.sync).toHaveBeenCalledTimes(1)
    expect(deps.engineManager.startGateway).toHaveBeenCalledTimes(1)
    expect(deps.engineManager.setSecretEnvVars).toHaveBeenCalledWith({ OPENAI_API_KEY: 'secret' })
    expect(service.getSnapshot().reasons).toEqual(['cowork-send', 'cron-autostart'])
  })

  it('upgrades an in-flight prewarm reason when a user operation arrives', async () => {
    const deps = createDeps()
    let release!: () => void
    deps.engineManager.startGateway.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              phase: 'running',
              version: '2026.2.23',
              message: 'running',
              canRetry: false
            })
        })
    )
    const service = new RuntimeLifecycleService(deps as never)

    const prewarm = service.prewarm('startup-prewarm')
    const ensure = service.ensureReady('cowork-send')
    expect(service.getSnapshot().phase).toBe('starting')
    expect(service.getSnapshot().reason).toBe('cowork-send')
    release()

    await expect(prewarm).resolves.toMatchObject({ phase: 'running' })
    await expect(ensure).resolves.toMatchObject({ phase: 'running' })
  })

  it('clears in-flight startup after failure so retry can start again', async () => {
    const deps = createDeps()
    deps.configSync.sync
      .mockReturnValueOnce({ ok: false, error: 'config failed', changed: false, configPath: '/x' })
      .mockReturnValueOnce({ ok: true, changed: false, configPath: '/x' })
    const service = new RuntimeLifecycleService(deps as never)

    const failed = await service.ensureReady('cowork-send')
    expect(failed.phase).toBe('error')
    expect(failed.errorCode).toBe('config_sync_failed')

    const recovered = await service.ensureReady('cowork-send')
    expect(recovered.phase).toBe('running')
    expect(deps.configSync.sync).toHaveBeenCalledTimes(2)
  })

  it('emits status snapshots when phase changes', async () => {
    const deps = createDeps()
    const service = new RuntimeLifecycleService(deps as never)
    const listener = vi.fn()
    service.on('status', listener)

    await service.ensureReady('cowork-send')

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ phase: 'starting' }))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ phase: 'running' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter petclaw-desktop test -- tests/main/runtime/runtime-lifecycle.test.ts
```

Expected: FAIL because `src/main/runtime/runtime-lifecycle.ts` does not exist.

- [ ] **Step 3: Implement RuntimeLifecycleService**

Create `petclaw-desktop/src/main/runtime/runtime-lifecycle.ts`:

```ts
import { EventEmitter } from 'events'

import type { ConfigSync, ConfigSyncResult } from '../ai/config-sync'
import type { OpenclawEngineManager } from '../ai/engine-manager'
import type { EngineStatus } from '../ai/types'
import { getLogger } from '../logging/facade'

const logger = getLogger('RuntimeLifecycle', 'runtime')

export type RuntimePhase =
  | 'idle'
  | 'prewarming'
  | 'starting'
  | 'connecting'
  | 'running'
  | 'degraded'
  | 'error'
  | 'stopping'

export interface RuntimeSnapshot {
  phase: RuntimePhase
  reason: string
  reasons: string[]
  updatedAt: number
  attempt: number
  message: string | null
  errorCode: string | null
  gatewayPort: number | null
  enginePhase: string | null
  canRetry: boolean
  canOpenDiagnostics: boolean
}

interface RuntimeLifecycleEvents {
  status: (snapshot: RuntimeSnapshot) => void
}

export interface RuntimeLifecycleDeps {
  engineManager: Pick<
    OpenclawEngineManager,
    | 'getStatus'
    | 'startGateway'
    | 'restartGateway'
    | 'stopGateway'
    | 'getGatewayConnectionInfo'
    | 'setSecretEnvVars'
    | 'on'
  >
  configSync: Pick<ConfigSync, 'sync' | 'collectSecretEnvVars'>
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRunning(status: EngineStatus): boolean {
  return status.phase === 'running'
}

export class RuntimeLifecycleService extends EventEmitter {
  private snapshot: RuntimeSnapshot = {
    phase: 'idle',
    reason: 'initial',
    reasons: [],
    updatedAt: Date.now(),
    attempt: 0,
    message: null,
    errorCode: null,
    gatewayPort: null,
    enginePhase: null,
    canRetry: false,
    canOpenDiagnostics: true
  }
  private inFlight: Promise<RuntimeSnapshot> | null = null
  private inFlightReasons = new Set<string>()

  constructor(private readonly deps: RuntimeLifecycleDeps) {
    super()
    this.deps.engineManager.on('status', (status) => {
      this.publishFromEngineStatus(status)
    })
  }

  override on<U extends keyof RuntimeLifecycleEvents>(
    event: U,
    listener: RuntimeLifecycleEvents[U]
  ): this {
    return super.on(event, listener)
  }

  override emit<U extends keyof RuntimeLifecycleEvents>(
    event: U,
    ...args: Parameters<RuntimeLifecycleEvents[U]>
  ): boolean {
    return super.emit(event, ...args)
  }

  getSnapshot(): RuntimeSnapshot {
    return { ...this.snapshot, reasons: [...this.snapshot.reasons] }
  }

  prewarm(reason: string): Promise<RuntimeSnapshot> {
    return this.ensureReady(reason, { prewarm: true })
  }

  ensureReady(reason: string, options: { prewarm?: boolean } = {}): Promise<RuntimeSnapshot> {
    const current = this.deps.engineManager.getStatus()
    if (isRunning(current)) {
      this.setSnapshotFromEngine('running', reason, current, null, false)
      return Promise.resolve(this.getSnapshot())
    }

    this.inFlightReasons.add(reason)
    if (this.inFlight) {
      if (!options.prewarm && this.snapshot.phase === 'prewarming') {
        this.setSnapshot({
          phase: 'starting',
          reason,
          reasons: [...this.inFlightReasons],
          message: 'Runtime startup is required by a user operation.'
        })
      } else {
        this.setSnapshot({ reasons: [...this.inFlightReasons] })
      }
      return this.inFlight
    }

    const phase: RuntimePhase = options.prewarm ? 'prewarming' : 'starting'
    this.setSnapshot({
      phase,
      reason,
      reasons: [...this.inFlightReasons],
      attempt: this.snapshot.attempt + 1,
      errorCode: null,
      canRetry: false,
      message: options.prewarm ? 'Runtime prewarm started.' : 'Runtime startup started.'
    })

    const task = this.startRuntime(reason).finally(() => {
      if (this.inFlight === task) {
        this.inFlight = null
        this.inFlightReasons.clear()
      }
    })
    this.inFlight = task
    return task
  }

  async restart(reason: string): Promise<RuntimeSnapshot> {
    this.setSnapshot({
      phase: 'stopping',
      reason,
      reasons: [reason],
      message: 'Runtime restart requested.',
      canRetry: false
    })
    try {
      const status = await this.deps.engineManager.restartGateway()
      if (isRunning(status)) {
        this.setSnapshotFromEngine('running', reason, status, null, false)
      } else {
        this.setSnapshotFromEngine('error', reason, status, 'gateway_restart_failed', true)
      }
    } catch (error) {
      logger.error('restart.failed', 'Runtime restart failed', { reason }, error)
      this.setSnapshot({
        phase: 'error',
        reason,
        errorCode: 'gateway_restart_failed',
        message: toErrorMessage(error),
        canRetry: true
      })
    }
    return this.getSnapshot()
  }

  async stop(reason: string): Promise<RuntimeSnapshot> {
    this.setSnapshot({
      phase: 'stopping',
      reason,
      reasons: [reason],
      message: 'Runtime stop requested.',
      canRetry: false
    })
    await this.deps.engineManager.stopGateway()
    this.setSnapshot({
      phase: 'idle',
      reason,
      reasons: [reason],
      message: 'Runtime stopped.',
      errorCode: null,
      gatewayPort: null,
      canRetry: false
    })
    return this.getSnapshot()
  }

  private async startRuntime(reason: string): Promise<RuntimeSnapshot> {
    try {
      const syncResult: ConfigSyncResult = this.deps.configSync.sync(reason)
      if (!syncResult.ok) {
        this.setSnapshot({
          phase: 'error',
          reason,
          errorCode: 'config_sync_failed',
          message: syncResult.error ?? 'Config sync failed.',
          canRetry: true
        })
        return this.getSnapshot()
      }

      this.deps.engineManager.setSecretEnvVars(this.deps.configSync.collectSecretEnvVars())
      this.setSnapshot({
        phase: 'connecting',
        reason,
        reasons: [...this.inFlightReasons],
        message: 'Gateway process is starting.'
      })

      const status = await this.deps.engineManager.startGateway()
      if (isRunning(status)) {
        this.setSnapshotFromEngine('running', reason, status, null, false)
      } else {
        this.setSnapshotFromEngine('error', reason, status, 'gateway_start_failed', true)
      }
    } catch (error) {
      logger.error('ensureReady.failed', 'Runtime ensureReady failed', { reason }, error)
      this.setSnapshot({
        phase: 'error',
        reason,
        errorCode: 'runtime_start_failed',
        message: toErrorMessage(error),
        canRetry: true
      })
    }
    return this.getSnapshot()
  }

  private publishFromEngineStatus(status: EngineStatus): void {
    if (status.phase === 'running') {
      this.setSnapshotFromEngine('running', this.snapshot.reason, status, null, false)
      return
    }
    if (this.snapshot.phase === 'running') {
      this.setSnapshotFromEngine('degraded', this.snapshot.reason, status, null, true)
    }
  }

  private setSnapshotFromEngine(
    phase: RuntimePhase,
    reason: string,
    status: EngineStatus,
    errorCode: string | null,
    canRetry: boolean
  ): void {
    const info = this.deps.engineManager.getGatewayConnectionInfo()
    this.setSnapshot({
      phase,
      reason,
      reasons: [...this.inFlightReasons],
      message: status.message ?? null,
      errorCode,
      gatewayPort: info.port ?? null,
      enginePhase: status.phase,
      canRetry
    })
  }

  private setSnapshot(patch: Partial<RuntimeSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      updatedAt: Date.now()
    }
    this.emit('status', this.getSnapshot())
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter petclaw-desktop test -- tests/main/runtime/runtime-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/main/runtime/runtime-lifecycle.ts petclaw-desktop/tests/main/runtime/runtime-lifecycle.test.ts
git commit -m "feat: add runtime lifecycle service"
```

## Task 2: Runtime IPC and Preload API

**Files:**
- Create: `petclaw-desktop/src/main/ipc/runtime-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/index.ts`
- Modify: `petclaw-desktop/src/preload/index.ts`
- Modify: `petclaw-desktop/src/preload/index.d.ts`
- Test: add IPC/preload assertions in `petclaw-desktop/tests/main/system/system-integration-startup.test.ts`

- [ ] **Step 1: Write failing source-order test**

Add this test to `system-integration-startup.test.ts`:

```ts
it('registers runtime lifecycle IPC before the renderer enters the main shell', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/main/index.ts'), 'utf-8')

  const registerRuntimeLifecycleIndex = source.indexOf('registerRuntimeLifecycleIpcHandlers(')
  const bootCompleteIndex = source.indexOf("chatWindow.webContents.send('boot:complete'")
  const petReadyIndex = source.indexOf("safeOn('app:pet-ready'")

  expect(registerRuntimeLifecycleIndex).toBeGreaterThan(-1)
  expect(petReadyIndex).toBeGreaterThan(-1)
  if (bootCompleteIndex > -1) {
    expect(registerRuntimeLifecycleIndex).toBeLessThan(bootCompleteIndex)
  }
  expect(registerRuntimeLifecycleIndex).toBeLessThan(petReadyIndex)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter petclaw-desktop test -- tests/main/system/system-integration-startup.test.ts
```

Expected: FAIL because `registerRuntimeLifecycleIpcHandlers(` is absent.

- [ ] **Step 3: Implement runtime IPC**

Create `petclaw-desktop/src/main/ipc/runtime-ipc.ts`:

```ts
import { safeHandle } from './ipc-registry'
import type { RuntimeLifecycleService } from '../runtime/runtime-lifecycle'

export interface RuntimeIpcDeps {
  runtimeLifecycle: RuntimeLifecycleService
  openRuntimeDiagnostics: () => void
}

export function registerRuntimeLifecycleIpcHandlers(deps: RuntimeIpcDeps): void {
  safeHandle('runtime:get-snapshot', () => deps.runtimeLifecycle.getSnapshot())
  safeHandle('runtime:ensure-ready', (_event, reason: string) =>
    deps.runtimeLifecycle.ensureReady(reason || 'renderer')
  )
  safeHandle('runtime:prewarm', (_event, reason: string) =>
    deps.runtimeLifecycle.prewarm(reason || 'renderer-prewarm')
  )
  safeHandle('runtime:restart', (_event, reason: string) =>
    deps.runtimeLifecycle.restart(reason || 'renderer-restart')
  )
  safeHandle('runtime:stop', (_event, reason: string) =>
    deps.runtimeLifecycle.stop(reason || 'renderer-stop')
  )
  safeHandle('runtime:open-diagnostics', () => {
    deps.openRuntimeDiagnostics()
  })
}
```

Modify `petclaw-desktop/src/main/ipc/index.ts`:

```ts
import {
  registerRuntimeLifecycleIpcHandlers,
  type RuntimeIpcDeps
} from './runtime-ipc'

export type AllIpcDeps = ChatIpcDeps &
  CoworkDraftIpcDeps &
  SettingsIpcDeps &
  WindowIpcDeps &
  BootIpcDeps &
  DirectoryIpcDeps &
  ModelsIpcDeps &
  SkillsIpcDeps &
  McpIpcDeps &
  MemoryIpcDeps &
  SchedulerIpcDeps &
  ImIpcDeps &
  RuntimeIpcDeps

export function registerAllIpcHandlers(deps: AllIpcDeps): void {
  registerRuntimeLifecycleIpcHandlers(deps)
  registerChatIpcHandlers(deps)
  registerCoworkDraftIpcHandlers(deps)
  registerWindowIpcHandlers(deps)
  registerDirectoryIpcHandlers(deps)
  registerModelsIpcHandlers(deps)
  registerSkillsIpcHandlers(deps)
  registerMcpIpcHandlers(deps)
  registerMemoryIpcHandlers(deps)
  registerSchedulerIpcHandlers(deps)
  registerImIpcHandlers(deps)
}

export {
  registerBootIpcHandlers,
  registerSettingsIpcHandlers,
  registerLoggingIpcHandlers,
  registerRuntimeLifecycleIpcHandlers
}
export type { BootIpcDeps, SettingsIpcDeps, RuntimeIpcDeps }
```

- [ ] **Step 4: Expose preload runtime API**

Add to `api` in `petclaw-desktop/src/preload/index.ts`:

```ts
  runtime: {
    getSnapshot: () => ipcRenderer.invoke('runtime:get-snapshot'),
    ensureReady: (reason: string) => ipcRenderer.invoke('runtime:ensure-ready', reason),
    prewarm: (reason: string) => ipcRenderer.invoke('runtime:prewarm', reason),
    restart: (reason: string) => ipcRenderer.invoke('runtime:restart', reason),
    stop: (reason: string) => ipcRenderer.invoke('runtime:stop', reason),
    openDiagnostics: () => ipcRenderer.invoke('runtime:open-diagnostics'),
    onStatus: (cb: (snapshot: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, snapshot: unknown) => cb(snapshot)
      ipcRenderer.on('runtime:status', handler)
      return () => ipcRenderer.removeListener('runtime:status', handler)
    }
  },
  onSettingsOpenTab: (callback: (tab: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, tab: string) => callback(tab)
    ipcRenderer.on('settings:open-tab', handler)
    return () => ipcRenderer.removeListener('settings:open-tab', handler)
  },
```

Add to `ElectronAPI` in `petclaw-desktop/src/preload/index.d.ts`:

```ts
  runtime: {
    getSnapshot: () => Promise<unknown>
    ensureReady: (reason: string) => Promise<unknown>
    prewarm: (reason: string) => Promise<unknown>
    restart: (reason: string) => Promise<unknown>
    stop: (reason: string) => Promise<unknown>
    openDiagnostics: () => Promise<void>
    onStatus: (cb: (snapshot: unknown) => void) => () => void
  }
  onSettingsOpenTab: (callback: (tab: string) => void) => () => void
```

- [ ] **Step 5: Run tests and typecheck node**

```bash
pnpm --filter petclaw-desktop test -- tests/main/system/system-integration-startup.test.ts
pnpm --filter petclaw-desktop typecheck:node
```

Expected: source-order test still fails until Task 4 wires `index.ts`; typecheck passes after exported types compile.

- [ ] **Step 6: Commit after Task 4 wires index**

Do not commit this task alone if the source-order test is still failing. Commit together with Task 4.

## Task 3: Runtime Services Use Lifecycle Ensure

**Files:**
- Modify: `petclaw-desktop/src/main/runtime-services.ts`
- Modify: `petclaw-desktop/src/main/ai/gateway.ts`
- Test: `petclaw-desktop/tests/main/runtime-services.test.ts`
- Test: `petclaw-desktop/tests/main/ai/gateway.test.ts`

- [ ] **Step 1: Write failing runtime-services test**

Create `petclaw-desktop/tests/main/runtime-services.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

describe('setupRuntimeServices runtime lifecycle integration', () => {
  it('passes runtime lifecycle ensureReady to cron gateway readiness', async () => {
    vi.doMock('../../src/main/scheduler/cron-job-service', () => {
      class CronJobService {
        static lastDeps: unknown
        constructor(deps: unknown) {
          CronJobService.lastDeps = deps
        }
        startPolling = vi.fn()
        stopPolling = vi.fn()
        hasRunningJobs = vi.fn(() => false)
      }
      return { CronJobService }
    })

    const { setupRuntimeServices } = await import('../../src/main/runtime-services')
    const { CronJobService } = await import('../../src/main/scheduler/cron-job-service')
    const runtimeLifecycle = {
      ensureReady: vi.fn(async () => ({ phase: 'running' })),
      getSnapshot: vi.fn(() => ({ phase: 'idle' }))
    }

    await setupRuntimeServices({
      db: {} as never,
      engineManager: { getStatus: vi.fn(), startGateway: vi.fn() } as never,
      coworkStore: {} as never,
      directoryManager: {} as never,
      modelRegistry: {} as never,
      draftAttachmentRoot: '/tmp/drafts',
      runtimeLifecycle: runtimeLifecycle as never,
      startCronPolling: false
    })

    const deps = (CronJobService as never as { lastDeps: { ensureGatewayReady: () => Promise<void> } })
      .lastDeps
    await deps.ensureGatewayReady()
    expect(runtimeLifecycle.ensureReady).toHaveBeenCalledWith('cron')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter petclaw-desktop test -- tests/main/runtime-services.test.ts
```

Expected: FAIL because `setupRuntimeServices` has no `runtimeLifecycle` dependency.

- [ ] **Step 3: Modify runtime-services deps**

In `petclaw-desktop/src/main/runtime-services.ts`, extend deps:

```ts
import type { RuntimeLifecycleService } from './runtime/runtime-lifecycle'

export interface RuntimeServiceDeps {
  db: Database.Database
  engineManager: OpenclawEngineManager
  coworkStore: CoworkStore
  directoryManager: DirectoryManager
  modelRegistry: ModelRegistry
  draftAttachmentRoot: string
  runtimeLifecycle: RuntimeLifecycleService
  startCronPolling?: boolean
}
```

Set gateway lifecycle and cron ensure:

```ts
  const gateway = new OpenclawGateway()
  gateway.setEngineManager(deps.engineManager)
  gateway.setRuntimeLifecycle(deps.runtimeLifecycle)
```

Replace cron deps:

```ts
  const cronJobService = new CronJobServiceClass({
    getGatewayClient: () => gateway.getClient(),
    ensureGatewayReady: async () => {
      await deps.runtimeLifecycle.ensureReady('cron')
      await gateway.ensureConnected()
    },
    metaStore: scheduledTaskMetaStore
  })
  if (deps.startCronPolling ?? true) {
    cronJobService.startPolling()
  }
```

- [ ] **Step 4: Modify gateway to delegate ensure**

In `petclaw-desktop/src/main/ai/gateway.ts`, add type import and field:

```ts
import type { RuntimeLifecycleService } from '../runtime/runtime-lifecycle'

  private runtimeLifecycle: RuntimeLifecycleService | null = null

  setRuntimeLifecycle(runtimeLifecycle: RuntimeLifecycleService): void {
    this.runtimeLifecycle = runtimeLifecycle
  }
```

In `ensureConnected`, replace direct startup with:

```ts
    const status = this.runtimeLifecycle
      ? await this.runtimeLifecycle.ensureReady('gateway-connect')
      : await this.engineManager.startGateway()
    if (status.phase !== 'running') {
      throw new Error(status.message || 'OpenClaw engine is not running')
    }
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter petclaw-desktop test -- tests/main/runtime-services.test.ts tests/main/ai/gateway.test.ts tests/main/scheduler/cron-job-service.test.ts
pnpm --filter petclaw-desktop typecheck:node
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add petclaw-desktop/src/main/runtime-services.ts petclaw-desktop/src/main/ai/gateway.ts petclaw-desktop/tests/main/runtime-services.test.ts petclaw-desktop/tests/main/ai/gateway.test.ts
git commit -m "refactor: route gateway readiness through runtime lifecycle"
```

## Task 4: Shell-first Main Startup

**Files:**
- Modify: `petclaw-desktop/src/main/index.ts`
- Modify: `petclaw-desktop/tests/main/system/system-integration-startup.test.ts`
- Uses already-created: `petclaw-desktop/src/main/ipc/runtime-ipc.ts`

- [ ] **Step 1: Replace source-order tests for shell-first behavior**

In `system-integration-startup.test.ts`, replace tests that require BootCheck blocking or restore tail-fix with:

```ts
it('does not run BootCheck as a blocking startup gate', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/main/index.ts'), 'utf-8')

  expect(source).not.toContain('const bootResult = await runBootCheck')
  expect(source).not.toContain('restoreMainWindowAfterStartup(chatWindow)')
})

it('creates runtime services and registers IPC before pet readiness without waiting for gateway', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/main/index.ts'), 'utf-8')

  const createMainWindowIndex = source.indexOf('const chatWindow = createMainWindow(db)')
  const initializeRuntimeIndex = source.indexOf('await initializeRuntimeServices()')
  const registerRuntimeIndex = source.indexOf('registerRuntimeIpcHandlers()')
  const petReadyIndex = source.indexOf("safeOn('app:pet-ready'")

  expect(createMainWindowIndex).toBeGreaterThan(-1)
  expect(initializeRuntimeIndex).toBeGreaterThan(createMainWindowIndex)
  expect(registerRuntimeIndex).toBeGreaterThan(initializeRuntimeIndex)
  expect(registerRuntimeIndex).toBeLessThan(petReadyIndex)
})

it('starts runtime prewarm after the main window has been activated', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/main/index.ts'), 'utf-8')

  const activateIndex = source.indexOf('activateMainWindow({ app, window: chatWindow })')
  const prewarmIndex = source.indexOf("runtimeLifecycle.prewarm('startup-prewarm')")

  expect(activateIndex).toBeGreaterThan(-1)
  expect(prewarmIndex).toBeGreaterThan(activateIndex)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter petclaw-desktop test -- tests/main/system/system-integration-startup.test.ts
```

Expected: FAIL because `index.ts` still awaits `runBootCheck` and calls `restoreMainWindowAfterStartup`.

- [ ] **Step 3: Wire RuntimeLifecycleService in index.ts**

Add import:

```ts
import { RuntimeLifecycleService } from './runtime/runtime-lifecycle'
```

Add module variable:

```ts
let runtimeLifecycle: RuntimeLifecycleService
```

After `configSync.bindChangeListeners(...)`, create the service:

```ts
  runtimeLifecycle = new RuntimeLifecycleService({
    engineManager,
    configSync
  })
  runtimeLifecycle.on('status', (snapshot) => {
    getMainWindow()?.webContents.send('runtime:status', snapshot)
  })
```

Change `initializeRuntimeServices` call body:

```ts
async function initializeRuntimeServices(): Promise<RuntimeServices> {
  if (!runtimeLifecycle) {
    throw new Error('[Runtime] lifecycle service is not initialized')
  }
  runtimeServices = await setupRuntimeServices({
    db,
    engineManager,
    coworkStore,
    directoryManager,
    modelRegistry,
    draftAttachmentRoot: path.join(app.getPath('userData'), 'cowork-draft-attachments'),
    runtimeLifecycle
  })

  return runtimeServices
}
```

- [ ] **Step 4: Remove blocking BootCheck from startup**

In `index.ts`:

- Remove `STARTUP_MAIN_WINDOW_RESTORE_DELAY_MS`.
- Remove `restoreMainWindowAfterStartup`.
- Remove the startup `const bootResult = await runBootCheck(...)` block.
- Remove startup `bootSuccess` gate.
- Keep `safeOn('boot:retry', ...)` only as diagnostics compatibility if `BootCheckPanel` still uses it from Settings; otherwise remove it with Task 6.
- After `ready-to-show`, activate the window, initialize runtime services, register IPC, and send shell completion:

```ts
  await new Promise<void>((resolve) => {
    chatWindow.once('ready-to-show', () => resolve())
  })
  activateMainWindow({ app, window: chatWindow })

  await initializeRuntimeServices()
  registerRuntimeIpcHandlers()

  bootSuccess = true
  chatWindow.webContents.send('boot:complete', true)
  void runtimeLifecycle.prewarm('startup-prewarm')
```

- [ ] **Step 5: Pass runtime deps into registerAllIpcHandlers**

Inside `registerRuntimeIpcHandlers()` deps object, add:

```ts
      runtimeLifecycle,
      openRuntimeDiagnostics: () => {
        const mainWindow = getMainWindow()
        if (!mainWindow || mainWindow.isDestroyed()) return
        mainWindow.webContents.send('panel:open', 'settings')
        mainWindow.webContents.send('settings:open-tab', 'engine')
        activateMainWindow({ app, window: mainWindow })
      },
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter petclaw-desktop test -- tests/main/system/system-integration-startup.test.ts
pnpm --filter petclaw-desktop typecheck:node
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2 + Task 4 together**

```bash
git add petclaw-desktop/src/main/index.ts petclaw-desktop/src/main/ipc/index.ts petclaw-desktop/src/main/ipc/runtime-ipc.ts petclaw-desktop/src/preload/index.ts petclaw-desktop/src/preload/index.d.ts petclaw-desktop/tests/main/system/system-integration-startup.test.ts
git commit -m "refactor: start desktop shell before runtime gateway"
```

## Task 5: Renderer Shell and Runtime Status

**Files:**
- Modify: `petclaw-desktop/src/renderer/src/App.tsx`
- Modify: `petclaw-desktop/src/renderer/src/views/settings/EngineSettings.tsx`
- Modify: `petclaw-shared/src/i18n/locales/zh.ts`
- Modify: `petclaw-shared/src/i18n/locales/en.ts`
- Test: `petclaw-desktop/tests/renderer/App.test.tsx`
- Test: `petclaw-desktop/tests/renderer/settings/EngineSettings.test.tsx`

- [ ] **Step 1: Write failing App test**

Add or update an App test:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/src/App'

it('renders the main shell without waiting for boot complete', async () => {
  window.api.getBootStatus = vi.fn(async () => null)
  window.api.onBootComplete = vi.fn(() => () => undefined)
  window.api.petReady = vi.fn()

  render(<App />)

  await waitFor(() => {
    expect(window.api.petReady).toHaveBeenCalled()
  })
  expect(screen.queryByText(/正在启动 PetClaw|Starting PetClaw/)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter petclaw-desktop test -- tests/renderer/App.test.tsx
```

Expected: FAIL because App starts with `phase: 'bootcheck'`.

- [ ] **Step 3: Remove bootcheck phase from App**

In `App.tsx`:

```ts
type AppPhase = 'main'
```

Initialize:

```ts
  const [phase] = useState<AppPhase>('main')
```

Remove the `onBootComplete/getBootStatus` effect. Keep `petReady` effect:

```ts
  useEffect(() => {
    window.api.petReady()
  }, [])
```

Remove the render branch:

```tsx
  if (phase === 'bootcheck') {
    return (
      <>
        {renderPermissionModal()}
        <BootCheckPanel onRetry={() => window.api.retryBoot()} />
      </>
    )
  }
```

Remove the `BootCheckPanel` import if no longer used.

Subscribe to Settings tab open events:

```ts
  useEffect(() => {
    const unsub = window.api.onSettingsOpenTab((tab) => {
      setSettingsTab(tab)
      handleViewChange('settings')
    })
    return unsub
  }, [handleViewChange])
```

- [ ] **Step 4: Update EngineSettings to use runtime snapshot**

Use this state shape inside `EngineSettings.tsx`:

```ts
interface RuntimeSnapshot {
  phase: string
  reason: string
  updatedAt: number
  attempt: number
  message: string | null
  errorCode: string | null
  gatewayPort: number | null
  enginePhase: string | null
  canRetry: boolean
  canOpenDiagnostics: boolean
}

const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null)
const [actionError, setActionError] = useState<string | null>(null)
```

Load snapshot and subscribe:

```ts
  useEffect(() => {
    let cancelled = false
    window.api.runtime
      .getSnapshot()
      .then((snapshot) => {
        if (!cancelled) setRuntime(snapshot as RuntimeSnapshot)
      })
      .catch(() => {
        if (!cancelled) setActionError(t('runtime.statusLoadFailed'))
      })
    const unsub = window.api.runtime.onStatus((snapshot) => {
      setRuntime(snapshot as RuntimeSnapshot)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [t])
```

Add actions:

```ts
  const handleRestart = async () => {
    setActionError(null)
    try {
      setRuntime((current) =>
        current ? { ...current, phase: 'starting', reason: 'settings-restart' } : current
      )
      const snapshot = await window.api.runtime.restart('settings-restart')
      setRuntime(snapshot as RuntimeSnapshot)
    } catch {
      setActionError(t('runtime.restartFailed'))
    }
  }

  const handleStop = async () => {
    setActionError(null)
    try {
      const snapshot = await window.api.runtime.stop('settings-stop')
      setRuntime(snapshot as RuntimeSnapshot)
    } catch {
      setActionError(t('runtime.stopFailed'))
    }
  }
```

- [ ] **Step 5: Add i18n keys**

Add to `zh.ts`:

```ts
  'runtime.phase.idle': '未启动',
  'runtime.phase.prewarming': '后台预热中',
  'runtime.phase.starting': '启动中',
  'runtime.phase.connecting': '连接中',
  'runtime.phase.running': '运行中',
  'runtime.phase.degraded': '部分可用',
  'runtime.phase.error': '启动失败',
  'runtime.phase.stopping': '停止中',
  'runtime.statusLoadFailed': '无法读取 Runtime 状态',
  'runtime.restart': '重启 Runtime',
  'runtime.stop': '停止 Runtime',
  'runtime.openDiagnostics': '打开诊断',
  'runtime.restartFailed': 'Runtime 重启失败',
  'runtime.stopFailed': 'Runtime 停止失败',
  'runtime.gatewayPort': 'Gateway 端口',
```

Add to `en.ts`:

```ts
  'runtime.phase.idle': 'Idle',
  'runtime.phase.prewarming': 'Prewarming',
  'runtime.phase.starting': 'Starting',
  'runtime.phase.connecting': 'Connecting',
  'runtime.phase.running': 'Running',
  'runtime.phase.degraded': 'Degraded',
  'runtime.phase.error': 'Failed',
  'runtime.phase.stopping': 'Stopping',
  'runtime.statusLoadFailed': 'Unable to load Runtime status',
  'runtime.restart': 'Restart Runtime',
  'runtime.stop': 'Stop Runtime',
  'runtime.openDiagnostics': 'Open diagnostics',
  'runtime.restartFailed': 'Runtime restart failed',
  'runtime.stopFailed': 'Runtime stop failed',
  'runtime.gatewayPort': 'Gateway port',
```

- [ ] **Step 6: Run renderer tests**

```bash
pnpm --filter petclaw-desktop test -- tests/renderer/App.test.tsx tests/renderer/settings/EngineSettings.test.tsx
pnpm --filter petclaw-desktop typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add petclaw-desktop/src/renderer/src/App.tsx petclaw-desktop/src/renderer/src/views/settings/EngineSettings.tsx petclaw-shared/src/i18n/locales/zh.ts petclaw-shared/src/i18n/locales/en.ts petclaw-desktop/tests/renderer/App.test.tsx petclaw-desktop/tests/renderer/settings/EngineSettings.test.tsx
git commit -m "feat: show main shell before runtime readiness"
```

## Task 6: BootCheck Becomes Diagnostics-only

**Files:**
- Modify: `petclaw-desktop/src/main/bootcheck.ts`
- Modify: `petclaw-desktop/src/renderer/src/views/boot/BootCheckPanel.tsx`
- Modify: `petclaw-desktop/tests/main/bootcheck.test.ts`

- [ ] **Step 1: Decide retained API shape**

Keep `runBootCheck` as diagnostics-only so existing tests and Settings diagnostics can reuse its env/config/gateway checks. Do not call it from app startup.

- [ ] **Step 2: Update bootcheck tests to assert diagnostics semantics**

Add:

```ts
it('remains diagnostics-only and does not define startup ownership', async () => {
  const result = await runBootCheck(
    new FakeWindow() as never,
    createEngineManager(baseDir) as never,
    createConfigSync() as never
  )

  expect(result.success).toBe(true)
  expect(result.port).toBe(18789)
  expect(result.token).toBe('token')
})
```

- [ ] **Step 3: Update comments and names without changing channel contracts**

In `bootcheck.ts`, change the leading comment:

```ts
/**
 * Runtime 诊断检查：环境 → 引擎 → 连接。
 * 该流程只用于 Settings/Diagnostics，不再作为应用启动门禁。
 */
```

In `BootCheckPanel.tsx`, update visible headings through i18n keys to Runtime diagnostics wording. Keep retry and diagnostics export buttons functional.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter petclaw-desktop test -- tests/main/bootcheck.test.ts
pnpm --filter petclaw-desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/main/bootcheck.ts petclaw-desktop/src/renderer/src/views/boot/BootCheckPanel.tsx petclaw-desktop/tests/main/bootcheck.test.ts
git commit -m "refactor: make bootcheck diagnostics-only"
```

## Task 7: Docs and Full Verification

**Files:**
- Modify: `docs/架构设计/desktop/overview/Desktop架构设计.md`
- Modify: `docs/架构设计/desktop/runtime/RuntimeGateway架构设计.md`
- Modify: `docs/架构设计/desktop/runtime/SystemIntegration架构设计.md`
- Modify if IPC/preload changed facts: `docs/架构设计/desktop/foundation/IPCPreload架构设计.md`
- Modify if Renderer startup facts changed: `docs/架构设计/desktop/foundation/Renderer架构设计.md`

- [ ] **Step 1: Run broad verification**

```bash
pnpm --filter petclaw-desktop typecheck
pnpm --filter petclaw-desktop test
```

Expected: PASS.

- [ ] **Step 2: Run package verification**

```bash
pnpm --filter petclaw-desktop package:dir
```

Expected: PASS.

- [ ] **Step 3: Run macOS arm64 dist verification**

```bash
pnpm --filter petclaw-desktop dist:mac:arm64
```

Expected: PASS. If packaging takes too long in CI-like shell, record the last successful package command and continue to manual app-open verification only if the app bundle exists.

- [ ] **Step 4: Manual packaged app verification**

```bash
open -n petclaw-desktop/release/mac-arm64/PetClaw.app
```

Expected after 20 seconds:

- One PetClaw main process.
- Main Window visible without clicking Pet.
- Dock icon visible.
- Application Menu visible.
- Pet Window does not steal focus.
- Runtime status may be `prewarming`, `running`, or `error`; Shell remains usable in all three cases.

- [ ] **Step 5: Check duplicate launch**

```bash
open -n petclaw-desktop/release/mac-arm64/PetClaw.app
```

Expected: second launch focuses existing Main Window and does not start a second app instance.

- [ ] **Step 6: Update docs**

Update docs to say:

- App Boot no longer waits for Gateway health.
- Runtime readiness is owned by `RuntimeLifecycleService`.
- BootCheck is diagnostics-only.
- Dock/Application Menu/Tray are installed before Runtime prewarm.
- Renderer uses runtime snapshot + status push.

- [ ] **Step 7: Run change detection**

Use MCP before final commit:

```text
gitnexus_detect_changes({ scope: "all", repo: "petclaw" })
```

Expected: affected scope includes startup/runtime/renderer docs and tests; no unrelated flows are reported.

- [ ] **Step 8: Commit docs and verification updates**

```bash
git add docs/架构设计/desktop/overview/Desktop架构设计.md docs/架构设计/desktop/runtime/RuntimeGateway架构设计.md docs/架构设计/desktop/runtime/SystemIntegration架构设计.md docs/架构设计/desktop/foundation/IPCPreload架构设计.md docs/架构设计/desktop/foundation/Renderer架构设计.md
git commit -m "docs: document shell-first runtime startup"
```

## Self-review

- Spec coverage:
  - Shell-first startup: Task 4 and Task 5.
  - Runtime lifecycle service: Task 1.
  - Gateway prewarm after Main Window visible: Task 4.
  - Business-entry ensure for Chat/Cron/IM: Task 3 covers Gateway/Cron; Chat is covered through `OpenclawGateway.ensureConnected` in Task 3 because CoworkController uses Gateway RPC.
  - BootCheck diagnostics-only: Task 6.
  - IPC/preload snapshot + push: Task 2.
  - Platform/system entry boundaries: Task 4 tests and Task 7 packaged verification.
  - Documentation sync: Task 7.
- Placeholder scan:
  - Passed: the plan contains concrete files, commands, expected results, and code blocks for implementation steps.
- Type consistency:
  - `RuntimeLifecycleService`, `RuntimeSnapshot`, and `RuntimePhase` names are consistent across Main, IPC, Preload, Renderer, and tests.
  - IPC names match spec: `runtime:get-snapshot`, `runtime:ensure-ready`, `runtime:prewarm`, `runtime:restart`, `runtime:stop`, `runtime:open-diagnostics`.
