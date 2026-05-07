import { describe, expect, it, vi } from 'vitest'

import {
  RuntimeLifecycleService,
  type RuntimeLifecycleDeps
} from '../../../src/main/runtime/runtime-lifecycle'
import type { EngineStatus, GatewayConnectionInfo } from '../../../src/main/ai/types'

function createRunningStatus(message = 'running'): EngineStatus {
  return {
    phase: 'running',
    version: '2026.2.23',
    message,
    canRetry: false
  }
}

function createConnectionInfo(): GatewayConnectionInfo {
  return {
    version: '2026.2.23',
    port: 18789,
    token: 'token',
    url: 'ws://127.0.0.1:18789',
    clientEntryPath: '/runtime/client.js'
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function createDeps() {
  const statusListeners: Array<(status: EngineStatus) => void> = []
  const engineManager = {
    getStatus: vi.fn(() => ({
      phase: 'ready',
      version: '2026.2.23',
      message: 'ready',
      canRetry: false
    })),
    startGateway: vi.fn(async () => createRunningStatus()),
    stopGateway: vi.fn(async () => undefined),
    restartGateway: vi.fn(async () => createRunningStatus()),
    getGatewayConnectionInfo: vi.fn(() => createConnectionInfo()),
    setSecretEnvVars: vi.fn(),
    on: vi.fn((event: 'status', listener: (status: EngineStatus) => void) => {
      if (event === 'status') {
        statusListeners.push(listener)
      }
    })
  } satisfies RuntimeLifecycleDeps['engineManager']
  const configSync = {
    sync: vi.fn(() => ({
      ok: true,
      changed: false,
      configPath: '/state/openclaw.json',
      needsGatewayRestart: false
    })),
    collectSecretEnvVars: vi.fn(() => ({ OPENAI_API_KEY: 'secret' }))
  } satisfies RuntimeLifecycleDeps['configSync']
  const emitStatus = (status: EngineStatus) => {
    for (const listener of statusListeners) {
      listener(status)
    }
  }
  return { engineManager, configSync, emitStatus }
}

describe('RuntimeLifecycleService', () => {
  it('starts idle and exposes a snapshot', () => {
    const deps = createDeps()
    const service = new RuntimeLifecycleService(deps)

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
    const service = new RuntimeLifecycleService(deps)

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
          release = () => resolve(createRunningStatus())
        })
    )
    const service = new RuntimeLifecycleService(deps)

    const prewarm = service.prewarm('startup-prewarm')
    const ensure = service.ensureReady('cowork-send')
    expect(service.getSnapshot().phase).toBe('starting')
    expect(service.getSnapshot().reason).toBe('cowork-send')
    await Promise.resolve()
    release()

    await expect(prewarm).resolves.toMatchObject({ phase: 'running' })
    await expect(ensure).resolves.toMatchObject({ phase: 'running' })
  })

  it('clears in-flight startup after failure so retry can start again', async () => {
    const deps = createDeps()
    deps.configSync.sync
      .mockReturnValueOnce({
        ok: false,
        error: 'config failed',
        changed: false,
        configPath: '/x',
        needsGatewayRestart: false
      })
      .mockReturnValueOnce({
        ok: true,
        changed: false,
        configPath: '/x',
        needsGatewayRestart: false
      })
    const service = new RuntimeLifecycleService(deps)

    const failed = await service.ensureReady('cowork-send')
    expect(failed.phase).toBe('error')
    expect(failed.errorCode).toBe('config_sync_failed')

    const recovered = await service.ensureReady('cowork-send')
    expect(recovered.phase).toBe('running')
    expect(deps.configSync.sync).toHaveBeenCalledTimes(2)
  })

  it('emits status snapshots when phase changes', async () => {
    const deps = createDeps()
    const service = new RuntimeLifecycleService(deps)
    const listener = vi.fn()
    service.on('status', listener)

    await service.ensureReady('cowork-send')

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ phase: 'starting' }))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ phase: 'running' }))
  })

  it('updates runtime snapshot from engine status events', async () => {
    const deps = createDeps()
    const service = new RuntimeLifecycleService(deps)

    await service.ensureReady('cowork-send')
    deps.emitStatus({
      phase: 'running',
      version: '2026.2.23',
      message: 'engine running',
      canRetry: false
    })

    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        phase: 'running',
        message: 'engine running',
        gatewayPort: 18789,
        enginePhase: 'running',
        errorCode: null,
        canRetry: false
      })
    )

    deps.emitStatus({
      phase: 'error',
      version: '2026.2.23',
      message: 'engine failed',
      canRetry: true
    })

    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        phase: 'degraded',
        message: 'engine failed',
        enginePhase: 'error',
        errorCode: 'engine_not_running',
        canRetry: true
      })
    )
  })

  it('passes through stop and updates snapshot', async () => {
    const deps = createDeps()
    const service = new RuntimeLifecycleService(deps)

    await service.ensureReady('cowork-send')
    const stopped = await service.stop('user-stop')

    expect(deps.engineManager.stopGateway).toHaveBeenCalledTimes(1)
    expect(stopped).toEqual(
      expect.objectContaining({
        phase: 'idle',
        reason: 'user-stop',
        gatewayPort: null,
        enginePhase: 'ready',
        errorCode: null,
        canRetry: false
      })
    )
  })

  it('waits for in-flight startup before restart passthrough', async () => {
    const deps = createDeps()
    let release!: () => void
    deps.engineManager.startGateway.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(createRunningStatus())
        })
    )
    const service = new RuntimeLifecycleService(deps)

    const prewarm = service.prewarm('startup-prewarm')
    const restart = service.restart('user-restart')

    expect(deps.engineManager.restartGateway).not.toHaveBeenCalled()
    await Promise.resolve()
    release()

    await expect(prewarm).resolves.toMatchObject({ phase: 'running' })
    await expect(restart).resolves.toMatchObject({
      phase: 'running',
      reason: 'user-restart',
      gatewayPort: 18789,
      enginePhase: 'running',
      errorCode: null,
      canRetry: false
    })
    expect(deps.engineManager.restartGateway).toHaveBeenCalledTimes(1)
  })

  it('keeps upgraded user reason when prewarm startup throws', async () => {
    const deps = createDeps()
    let rejectStart!: (error: Error) => void
    deps.engineManager.startGateway.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectStart = reject
        })
    )
    const service = new RuntimeLifecycleService(deps)

    const prewarm = service.prewarm('startup-prewarm')
    const ensure = service.ensureReady('cowork-send')
    await Promise.resolve()
    rejectStart(new Error('gateway failed'))

    await expect(prewarm).resolves.toMatchObject({
      phase: 'error',
      reason: 'cowork-send',
      errorCode: 'gateway_start_failed',
      enginePhase: 'ready',
      canRetry: true
    })
    await expect(ensure).resolves.toMatchObject({
      phase: 'error',
      reason: 'cowork-send',
      errorCode: 'gateway_start_failed'
    })
  })

  it('returns error snapshot when startGateway resolves non-running', async () => {
    const deps = createDeps()
    deps.engineManager.startGateway.mockResolvedValueOnce({
      phase: 'error',
      version: '2026.2.23',
      message: 'gateway unavailable',
      canRetry: true
    })
    const service = new RuntimeLifecycleService(deps)

    const failed = await service.ensureReady('cowork-send')

    expect(failed).toEqual(
      expect.objectContaining({
        phase: 'error',
        reason: 'cowork-send',
        message: 'gateway unavailable',
        errorCode: 'gateway_not_running',
        gatewayPort: null,
        enginePhase: 'error',
        canRetry: true
      })
    )
  })

  it('returns error snapshot when startGateway throws', async () => {
    const deps = createDeps()
    deps.engineManager.startGateway.mockRejectedValueOnce(new Error('spawn failed'))
    const service = new RuntimeLifecycleService(deps)

    const failed = await service.ensureReady('cowork-send')

    expect(failed).toEqual(
      expect.objectContaining({
        phase: 'error',
        reason: 'cowork-send',
        message: 'spawn failed',
        errorCode: 'gateway_start_failed',
        gatewayPort: null,
        enginePhase: 'ready',
        canRetry: true
      })
    )
  })

  it('does not let an older in-flight startup overwrite stop', async () => {
    const deps = createDeps()
    const start = createDeferred<EngineStatus>()
    deps.engineManager.startGateway.mockReturnValueOnce(start.promise)
    const service = new RuntimeLifecycleService(deps)

    const prewarm = service.prewarm('startup-prewarm')
    const stop = service.stop('user-stop')

    start.resolve(createRunningStatus())

    await expect(prewarm).resolves.toMatchObject({ phase: 'running' })
    await expect(stop).resolves.toMatchObject({
      phase: 'idle',
      reason: 'user-stop',
      gatewayPort: null,
      errorCode: null
    })
    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        phase: 'idle',
        reason: 'user-stop',
        gatewayPort: null,
        errorCode: null
      })
    )
  })

  it('serializes restart before a following stop', async () => {
    const deps = createDeps()
    const restart = createDeferred<EngineStatus>()
    deps.engineManager.restartGateway.mockReturnValueOnce(restart.promise)
    const service = new RuntimeLifecycleService(deps)

    const restartPromise = service.restart('user-restart')
    const stopPromise = service.stop('user-stop')

    await Promise.resolve()
    expect(deps.engineManager.restartGateway).toHaveBeenCalledTimes(1)
    expect(deps.engineManager.stopGateway).not.toHaveBeenCalled()

    restart.resolve(createRunningStatus())

    await expect(restartPromise).resolves.toMatchObject({ phase: 'running' })
    await expect(stopPromise).resolves.toMatchObject({
      phase: 'idle',
      reason: 'user-stop'
    })
    expect(deps.engineManager.stopGateway).toHaveBeenCalledTimes(1)
    expect(deps.engineManager.restartGateway.mock.invocationCallOrder[0]).toBeLessThan(
      deps.engineManager.stopGateway.mock.invocationCallOrder[0]
    )
    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        phase: 'idle',
        reason: 'user-stop'
      })
    )
  })

  it('runs ensure after a queued stop barrier instead of resolving stale prewarm startup', async () => {
    const deps = createDeps()
    const firstStart = createDeferred<EngineStatus>()
    const secondStart = createDeferred<EngineStatus>()
    const stop = createDeferred<void>()
    deps.engineManager.startGateway
      .mockReturnValueOnce(firstStart.promise)
      .mockReturnValueOnce(secondStart.promise)
    deps.engineManager.stopGateway.mockReturnValueOnce(stop.promise)
    const service = new RuntimeLifecycleService(deps)

    const prewarm = service.prewarm('startup-prewarm')
    await Promise.resolve()
    const stopPromise = service.stop('settings-stop')
    const ensure = service.ensureReady('cowork-send')
    let ensureSettled = false
    ensure.then(() => {
      ensureSettled = true
    })

    firstStart.resolve(createRunningStatus('prewarm running'))
    await expect(prewarm).resolves.toMatchObject({ phase: 'running' })
    await Promise.resolve()

    expect(deps.engineManager.stopGateway).toHaveBeenCalledTimes(1)
    expect(ensureSettled).toBe(false)

    stop.resolve()
    await expect(stopPromise).resolves.toMatchObject({
      phase: 'idle',
      reason: 'settings-stop'
    })
    await Promise.resolve()

    expect(deps.engineManager.startGateway).toHaveBeenCalledTimes(2)
    expect(ensureSettled).toBe(false)
    secondStart.resolve(createRunningStatus('post-stop running'))

    await expect(ensure).resolves.toMatchObject({
      phase: 'running',
      reason: 'cowork-send',
      message: 'post-stop running'
    })
    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        phase: 'running',
        reason: 'cowork-send'
      })
    )
  })

  it('dedupes concurrent ensures while post-stop barrier startup is pending', async () => {
    const deps = createDeps()
    const firstStart = createDeferred<EngineStatus>()
    const secondStart = createDeferred<EngineStatus>()
    const stop = createDeferred<void>()
    deps.engineManager.startGateway
      .mockReturnValueOnce(firstStart.promise)
      .mockReturnValueOnce(secondStart.promise)
    deps.engineManager.stopGateway.mockReturnValueOnce(stop.promise)
    const service = new RuntimeLifecycleService(deps)

    const prewarm = service.prewarm('startup-prewarm')
    await Promise.resolve()
    const stopPromise = service.stop('settings-stop')
    const ensure1 = service.ensureReady('cowork-send')

    firstStart.resolve(createRunningStatus('prewarm running'))
    await expect(prewarm).resolves.toMatchObject({ phase: 'running' })
    await Promise.resolve()
    stop.resolve()
    await expect(stopPromise).resolves.toMatchObject({ phase: 'idle' })
    await Promise.resolve()

    expect(deps.engineManager.startGateway).toHaveBeenCalledTimes(2)
    const ensure2 = service.ensureReady('cron-autostart')
    await Promise.resolve()
    secondStart.resolve(createRunningStatus('post-stop running'))

    await expect(ensure1).resolves.toMatchObject({
      phase: 'running',
      reason: 'cowork-send',
      message: 'post-stop running'
    })
    await expect(ensure2).resolves.toMatchObject({
      phase: 'running',
      reason: 'cowork-send',
      message: 'post-stop running'
    })
    expect(deps.engineManager.startGateway).toHaveBeenCalledTimes(2)
  })

  it('runs ensure after a queued restart barrier instead of resolving stale prewarm startup', async () => {
    const deps = createDeps()
    const firstStart = createDeferred<EngineStatus>()
    const restart = createDeferred<EngineStatus>()
    deps.engineManager.startGateway.mockReturnValueOnce(firstStart.promise)
    deps.engineManager.restartGateway.mockReturnValueOnce(restart.promise)
    const service = new RuntimeLifecycleService(deps)

    const prewarm = service.prewarm('startup-prewarm')
    await Promise.resolve()
    const restartPromise = service.restart('settings-restart')
    const ensure = service.ensureReady('cowork-send')
    let ensureSettled = false
    ensure.then(() => {
      ensureSettled = true
    })

    firstStart.resolve(createRunningStatus('prewarm running'))
    await expect(prewarm).resolves.toMatchObject({ phase: 'running' })
    await Promise.resolve()

    expect(deps.engineManager.restartGateway).toHaveBeenCalledTimes(1)
    expect(ensureSettled).toBe(false)

    restart.resolve(createRunningStatus('post-restart running'))

    await expect(restartPromise).resolves.toMatchObject({
      phase: 'running',
      reason: 'settings-restart',
      message: 'post-restart running'
    })
    await expect(ensure).resolves.toMatchObject({
      phase: 'running',
      reason: 'settings-restart',
      message: 'post-restart running'
    })
  })
})
