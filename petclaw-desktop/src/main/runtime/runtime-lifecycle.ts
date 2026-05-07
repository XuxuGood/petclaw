import { EventEmitter } from 'events'

import type { ConfigSync, ConfigSyncResult } from '../ai/config-sync'
import type { EngineStatus, GatewayConnectionInfo } from '../ai/types'
import { getLogger } from '../logging'

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
  enginePhase: EngineStatus['phase'] | null
  canRetry: boolean
  canOpenDiagnostics: boolean
}

interface RuntimeLifecycleEvents {
  status: (snapshot: RuntimeSnapshot) => void
}

interface RuntimeLifecycleEngineManager {
  getStatus(): EngineStatus
  startGateway(): Promise<EngineStatus>
  stopGateway(): Promise<void>
  restartGateway(): Promise<EngineStatus>
  getGatewayConnectionInfo(): GatewayConnectionInfo
  setSecretEnvVars(vars: Record<string, string>): void
  on(event: 'status', listener: (status: EngineStatus) => void): unknown
}

export interface RuntimeLifecycleDeps {
  engineManager: RuntimeLifecycleEngineManager
  configSync: Pick<ConfigSync, 'sync' | 'collectSecretEnvVars'>
}

const logger = getLogger('RuntimeLifecycle')

function cloneSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
  return { ...snapshot, reasons: [...snapshot.reasons] }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hasGatewayPort(info: GatewayConnectionInfo): number | null {
  return typeof info.port === 'number' ? info.port : null
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
  private inFlightPrewarm = false
  private operationQueue: Promise<void> = Promise.resolve()
  private pendingBarrierCount = 0

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
    return cloneSnapshot(this.snapshot)
  }

  prewarm(reason: string): Promise<RuntimeSnapshot> {
    return this.beginEnsureReady(reason, true)
  }

  ensureReady(reason: string): Promise<RuntimeSnapshot> {
    return this.beginEnsureReady(reason, false)
  }

  private beginEnsureReady(reason: string, prewarm: boolean): Promise<RuntimeSnapshot> {
    this.recordReason(reason)

    if (this.pendingBarrierCount > 0) {
      return this.enqueueOperation(() => this.ensureAfterBarrier(reason, prewarm))
    }

    if (this.inFlight) {
      if (!prewarm && this.inFlightPrewarm) {
        this.inFlightPrewarm = false
        this.publish({
          phase: 'starting',
          reason,
          message: null,
          errorCode: null,
          canRetry: false
        })
      }
      return this.inFlight
    }

    const phase: RuntimePhase = prewarm ? 'prewarming' : 'starting'
    this.publish({
      phase,
      reason,
      attempt: this.snapshot.attempt + 1,
      message: null,
      errorCode: null,
      canRetry: false
    })

    this.inFlightPrewarm = prewarm
    this.inFlight = this.enqueueOperation(() => this.startRuntime(reason)).finally(() => {
      this.inFlight = null
      this.inFlightPrewarm = false
    })
    return this.inFlight
  }

  async restart(reason: string): Promise<RuntimeSnapshot> {
    this.recordReason(reason)
    this.pendingBarrierCount += 1
    return this.enqueueOperation(async () => {
      try {
        return await this.restartRuntime(reason)
      } finally {
        this.pendingBarrierCount -= 1
      }
    })
  }

  async stop(reason: string): Promise<RuntimeSnapshot> {
    this.recordReason(reason)
    this.pendingBarrierCount += 1
    return this.enqueueOperation(async () => {
      try {
        return await this.stopRuntime(reason)
      } finally {
        this.pendingBarrierCount -= 1
      }
    })
  }

  private async restartRuntime(reason: string): Promise<RuntimeSnapshot> {
    this.publish({
      phase: 'starting',
      reason,
      attempt: this.snapshot.attempt + 1,
      message: null,
      errorCode: null,
      canRetry: false
    })

    try {
      const status = await this.deps.engineManager.restartGateway()
      return this.publishEngineResult(status, reason)
    } catch (error) {
      logger.error('runtime.restart.failed', 'Runtime restart failed', { reason }, error)
      return this.publishError(reason, 'gateway_restart_failed', toErrorMessage(error))
    }
  }

  private async stopRuntime(reason: string): Promise<RuntimeSnapshot> {
    this.publish({
      phase: 'stopping',
      reason,
      message: null,
      errorCode: null,
      canRetry: false
    })

    try {
      await this.deps.engineManager.stopGateway()
      const status = this.deps.engineManager.getStatus()
      return this.publish({
        phase: 'idle',
        reason,
        message: status.message,
        errorCode: null,
        gatewayPort: null,
        enginePhase: status.phase,
        canRetry: status.canRetry
      })
    } catch (error) {
      logger.error('runtime.stop.failed', 'Runtime stop failed', { reason }, error)
      return this.publishError(reason, 'gateway_stop_failed', toErrorMessage(error))
    }
  }

  private async startRuntime(reason: string): Promise<RuntimeSnapshot> {
    const syncResult = this.syncConfig(reason)
    if (!syncResult.ok) {
      return this.publishError(
        reason,
        'config_sync_failed',
        syncResult.error ?? 'Config sync failed'
      )
    }

    const secretEnvVars = this.deps.configSync.collectSecretEnvVars()
    this.deps.engineManager.setSecretEnvVars(secretEnvVars)

    this.publish({
      phase: 'connecting',
      reason: this.snapshot.reason,
      message: null,
      errorCode: null,
      canRetry: false
    })

    try {
      const status = await this.deps.engineManager.startGateway()
      return this.publishEngineResult(status, this.snapshot.reason)
    } catch (error) {
      logger.error('runtime.start.failed', 'Runtime start failed', { reason }, error)
      return this.publishError(this.snapshot.reason, 'gateway_start_failed', toErrorMessage(error))
    }
  }

  private async ensureAfterBarrier(reason: string, prewarm: boolean): Promise<RuntimeSnapshot> {
    if (this.snapshot.phase === 'running') {
      return this.getSnapshot()
    }

    const phase: RuntimePhase = prewarm ? 'prewarming' : 'starting'
    this.publish({
      phase,
      reason,
      attempt: this.snapshot.attempt + 1,
      message: null,
      errorCode: null,
      canRetry: false
    })

    const start = this.startRuntime(reason)
    this.inFlightPrewarm = prewarm
    const tracked = start.finally(() => {
      if (this.inFlight === tracked) {
        this.inFlight = null
        this.inFlightPrewarm = false
      }
    })
    this.inFlight = tracked
    return tracked
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(operation, operation)
    this.operationQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private syncConfig(reason: string): ConfigSyncResult {
    try {
      return this.deps.configSync.sync(reason)
    } catch (error) {
      logger.error(
        'runtime.configSync.failed',
        'Runtime config sync threw an error',
        { reason },
        error
      )
      return {
        ok: false,
        changed: false,
        configPath: '',
        error: toErrorMessage(error),
        needsGatewayRestart: false
      }
    }
  }

  private publishEngineResult(status: EngineStatus, reason: string): RuntimeSnapshot {
    if (status.phase !== 'running') {
      return this.publishError(reason, 'gateway_not_running', status.message, status)
    }

    const connectionInfo = this.deps.engineManager.getGatewayConnectionInfo()
    return this.publish({
      phase: 'running',
      reason,
      message: status.message,
      errorCode: null,
      gatewayPort: hasGatewayPort(connectionInfo),
      enginePhase: status.phase,
      canRetry: status.canRetry
    })
  }

  private publishFromEngineStatus(status: EngineStatus): void {
    if (status.phase === 'running') {
      const connectionInfo = this.deps.engineManager.getGatewayConnectionInfo()
      this.publish({
        phase: 'running',
        message: status.message,
        errorCode: null,
        gatewayPort: hasGatewayPort(connectionInfo),
        enginePhase: status.phase,
        canRetry: status.canRetry
      })
      return
    }

    if (this.snapshot.phase === 'running') {
      this.publish({
        phase: 'degraded',
        message: status.message,
        errorCode: 'engine_not_running',
        enginePhase: status.phase,
        canRetry: status.canRetry
      })
    }
  }

  private publishError(
    reason: string,
    errorCode: string,
    message: string,
    status?: EngineStatus
  ): RuntimeSnapshot {
    return this.publish({
      phase: 'error',
      reason,
      message,
      errorCode,
      gatewayPort: null,
      enginePhase: status?.phase ?? this.deps.engineManager.getStatus().phase,
      canRetry: status?.canRetry ?? true
    })
  }

  private recordReason(reason: string): void {
    if (this.snapshot.reasons.includes(reason)) return
    this.snapshot = {
      ...this.snapshot,
      reasons: [...this.snapshot.reasons, reason],
      updatedAt: Date.now()
    }
  }

  private publish(update: Partial<RuntimeSnapshot>): RuntimeSnapshot {
    this.snapshot = {
      ...this.snapshot,
      ...update,
      reason: update.reason ?? this.snapshot.reason,
      reasons: [...this.snapshot.reasons],
      updatedAt: Date.now(),
      canOpenDiagnostics: true
    }

    const snapshot = cloneSnapshot(this.snapshot)
    this.emit('status', snapshot)
    return snapshot
  }
}
