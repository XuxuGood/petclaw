import { createRequire } from 'module'
import { EventEmitter } from 'events'

import { app } from 'electron'

import type { OpenclawEngineManager } from './engine-manager'
import type { GatewayConnectionInfo } from './types'
import { getLogger } from '../logging/facade'

const logger = getLogger('Gateway', 'gateway')

// ── GatewayClient duck-type 接口（从 runtime 动态加载）──

interface GatewayClientLike {
  start: () => void
  stop: () => void
  request: <T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean; timeoutMs?: number | null }
  ) => Promise<T>
}

type GatewayClientCtor = new (options: Record<string, unknown>) => GatewayClientLike

interface GatewayEventFrame {
  event: string
  seq?: number
  payload?: unknown
}

// ── Gateway 发射的事件载荷类型 ──

export interface ChatEventPayload {
  sessionKey: string
  state: string
  message?: unknown
  runId?: string
  stopReason?: string
  errorMessage?: string
}

export interface AgentEventPayload {
  sessionKey: string
  stream: string
  runId?: string
  seq?: number
  data?: Record<string, unknown>
}

export interface ApprovalRequestedPayload {
  id: string
  request: {
    sessionKey: string
    command?: string
    cwd?: string | null
    host?: string | null
    security?: string | null
    ask?: string | null
    resolvedPath?: string | null
    agentId?: string | null
    toolUseId?: string
    [key: string]: unknown
  }
}

export interface ApprovalResolvedPayload {
  id: string
}

// ── Gateway 发射的事件签名 ──

export interface OpenclawGatewayEvents {
  chatEvent: (payload: ChatEventPayload) => void
  agentEvent: (payload: AgentEventPayload) => void
  approvalRequested: (payload: ApprovalRequestedPayload) => void
  approvalResolved: (payload: ApprovalResolvedPayload) => void
  tick: () => void
  connected: () => void
  disconnected: (reason: string) => void
}

export class OpenclawGateway extends EventEmitter {
  private client: GatewayClientLike | null = null
  private pendingGatewayClient: GatewayClientLike | null = null
  private connected = false

  // 版本/路径变更检测
  private gatewayClientVersion: string | null = null
  private gatewayClientEntryPath: string | null = null

  // WS 自动重连
  private gatewayReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private gatewayReconnectAttempt = 0
  private gatewayStoppingIntentionally = false
  private lastConnectionInfo: GatewayConnectionInfo | null = null
  private static readonly GATEWAY_RECONNECT_MAX_ATTEMPTS = 10
  private static readonly GATEWAY_RECONNECT_DELAYS = [2_000, 5_000, 10_000, 15_000, 30_000]

  // Tick 心跳看门狗
  private lastTickTimestamp = 0
  private tickWatchdogTimer: ReturnType<typeof setInterval> | null = null
  private static readonly TICK_WATCHDOG_INTERVAL_MS = 60_000
  private static readonly TICK_TIMEOUT_MS = 90_000

  // 并发锁
  private gatewayClientInitLock: Promise<void> | null = null

  // 引擎管理器引用（按需连接时启动引擎 + 获取连接信息）
  private engineManager: OpenclawEngineManager | null = null

  constructor() {
    super()
  }

  // 注入 EngineManager（启动后调用一次）
  setEngineManager(em: OpenclawEngineManager): void {
    this.engineManager = em
  }

  // ── 按需连接 ──

  // 确保 GatewayClient 已连接：引擎未启动则启动，WS 未连接则连接
  // RPC 方法内部自动调用，调用方无需关心连接状态
  async ensureConnected(): Promise<void> {
    if (this.client && this.connected) return
    if (!this.engineManager) {
      throw new Error('EngineManager not set — call setEngineManager() first')
    }

    const status = await this.engineManager.startGateway()
    if (status.phase !== 'running') {
      throw new Error(status.message || 'OpenClaw engine is not running')
    }

    const connectionInfo = this.engineManager.getGatewayConnectionInfo()
    if (!connectionInfo.clientEntryPath) {
      throw new Error('GatewayClient entry path not found')
    }
    await this.connect(connectionInfo)
  }

  // ── 公开连接接口 ──

  async connect(connectionInfo: GatewayConnectionInfo): Promise<void> {
    // 并发锁：同一时刻只有一个连接流程
    if (this.gatewayClientInitLock) {
      await this.gatewayClientInitLock
      return
    }
    this.gatewayClientInitLock = this._connectImpl(connectionInfo)
    try {
      await this.gatewayClientInitLock
    } finally {
      this.gatewayClientInitLock = null
    }
  }

  /** 仅在未连接时才执行 connect，已连接则跳过 */
  async connectIfNeeded(connectionInfo: GatewayConnectionInfo): Promise<void> {
    if (this.client && this.connected) return
    await this.connect(connectionInfo)
  }

  /** 强制断开后重连 */
  async reconnect(connectionInfo: GatewayConnectionInfo): Promise<void> {
    this.disconnect()
    await this.connect(connectionInfo)
  }

  disconnect(): void {
    this.gatewayStoppingIntentionally = true
    this.cancelGatewayReconnect()
    this.stopTickWatchdog()
    // 同时清理已晋升的 client 和等待中的 pendingClient
    const clientToStop = this.client ?? this.pendingGatewayClient
    try {
      clientToStop?.stop()
    } catch {
      /* ignore */
    }
    this.client = null
    this.pendingGatewayClient = null
    this.connected = false
    this.gatewayClientVersion = null
    this.gatewayClientEntryPath = null
    this.lastTickTimestamp = 0
    this.gatewayStoppingIntentionally = false
  }

  isConnected(): boolean {
    return this.connected
  }

  // 暴露底层 client 供 CronJobService 等模块代理 Gateway RPC
  getClient(): GatewayClientLike | null {
    return this.client
  }

  // ── RPC 方法 ──

  async chatSend(
    sessionKey: string,
    message: string,
    options?: Record<string, unknown>
  ): Promise<{ runId?: string }> {
    await this.ensureConnected()
    const result = await this.client!.request<{ runId?: string }>('chat.send', {
      sessionKey,
      message,
      ...options
    })
    return result ?? {}
  }

  async chatAbort(sessionKey: string, runId: string): Promise<void> {
    await this.ensureConnected()
    await this.client!.request('chat.abort', { sessionKey, runId })
  }

  // decision: 'allow-always' | 'allow-once' | 'deny'，对齐 gateway exec.approval.resolve 协议
  async approvalResolve(requestId: string, decision: string): Promise<void> {
    await this.ensureConnected()
    await this.client!.request('exec.approval.resolve', {
      id: requestId,
      decision
    })
  }

  // ── 内部连接实现 ──

  private async _connectImpl(connectionInfo: GatewayConnectionInfo): Promise<void> {
    this.lastConnectionInfo = connectionInfo

    // 版本或路径变更 → 先断开旧连接
    const versionChanged =
      this.gatewayClientVersion !== null && this.gatewayClientVersion !== connectionInfo.version
    const pathChanged =
      this.gatewayClientEntryPath !== null &&
      this.gatewayClientEntryPath !== connectionInfo.clientEntryPath
    if (versionChanged || pathChanged) {
      logger.warn('client.versionOrPath.changed', {
        previousVersion: this.gatewayClientVersion,
        nextVersion: connectionInfo.version ?? null,
        previousEntryPath: this.gatewayClientEntryPath,
        nextEntryPath: connectionInfo.clientEntryPath
      })
      this.disconnect()
    }

    // 已连接且无变更 → 跳过
    if (this.client && this.connected) return

    if (!connectionInfo.clientEntryPath) {
      throw new Error('GatewayConnectionInfo.clientEntryPath is required')
    }
    if (!connectionInfo.url && (!connectionInfo.port || !connectionInfo.token)) {
      throw new Error('GatewayConnectionInfo requires url or port+token')
    }

    const Ctor = await this.loadGatewayClientCtor(connectionInfo.clientEntryPath)
    const url = connectionInfo.url ?? `ws://127.0.0.1:${connectionInfo.port}`

    return new Promise<void>((resolve, reject) => {
      let settled = false

      const settleResolve = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      const settleReject = (error: Error): void => {
        if (settled) return
        settled = true
        reject(error)
      }

      const client = new Ctor({
        url,
        token: connectionInfo.token,
        clientDisplayName: 'PetClaw',
        clientVersion: app.getVersion(),
        mode: 'backend',
        caps: ['tool-events'],
        role: 'operator',
        scopes: ['operator.admin'],
        onHelloOk: () => {
          // 握手成功后才暴露 client，避免并发代码在 connect 帧前发送 request
          this.client = client
          this.pendingGatewayClient = null
          this.connected = true
          this.gatewayClientVersion = connectionInfo.version ?? null
          this.gatewayClientEntryPath = connectionInfo.clientEntryPath
          this.lastTickTimestamp = Date.now()
          this.startTickWatchdog()
          this.gatewayReconnectAttempt = 0
          settleResolve()
          this.emit('connected')
        },
        onConnectError: (error: Error) => {
          // 只有认证失败才立即拒绝，其他等自动重连
          const msg = error.message.toLowerCase()
          const isAuthFailure =
            msg.includes('auth') || msg.includes('denied') || msg.includes('forbidden')
          if (isAuthFailure) {
            settleReject(error)
          }
        },
        onClose: (_code: number, reason: string) => {
          if (!settled) {
            // 握手前断开，等 GatewayClient 内部重连
            return
          }
          // 如果是主动断开（stopGatewayClient），不做任何处理
          if (this.gatewayStoppingIntentionally) return

          this.connected = false
          this.emit('disconnected', reason || 'Connection closed')
          // 意外断开 → 调度自动重连
          this.scheduleGatewayReconnect()
        },
        onEvent: (event: GatewayEventFrame) => {
          this.handleEvent(event)
        }
      })

      // 先存为 pending，握手成功后在 onHelloOk 中晋升为 this.client
      this.pendingGatewayClient = client
      client.start()

      // 60s 超时
      setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error('Gateway connection timeout (60s)'))
        }
      }, 60_000)
    })
  }

  // ── WS 自动重连 ──

  private scheduleGatewayReconnect(): void {
    if (this.gatewayReconnectAttempt >= OpenclawGateway.GATEWAY_RECONNECT_MAX_ATTEMPTS) {
      logger.error('reconnect.maxAttempts.reached', {
        maxAttempts: OpenclawGateway.GATEWAY_RECONNECT_MAX_ATTEMPTS
      })
      return
    }

    const delays = OpenclawGateway.GATEWAY_RECONNECT_DELAYS
    const delay = delays[Math.min(this.gatewayReconnectAttempt, delays.length - 1)]
    this.gatewayReconnectAttempt++

    logger.warn('reconnect.scheduled', {
      attempt: this.gatewayReconnectAttempt,
      maxAttempts: OpenclawGateway.GATEWAY_RECONNECT_MAX_ATTEMPTS,
      delayMs: delay
    })

    this.gatewayReconnectTimer = setTimeout(() => {
      this.gatewayReconnectTimer = null
      void this.attemptGatewayReconnect()
    }, delay)
  }

  private async attemptGatewayReconnect(): Promise<void> {
    if (!this.lastConnectionInfo) return
    try {
      await this.connectIfNeeded(this.lastConnectionInfo)
      this.gatewayReconnectAttempt = 0
    } catch (error) {
      logger.warn('reconnect.failed', undefined, error)
      this.scheduleGatewayReconnect()
    }
  }

  private cancelGatewayReconnect(): void {
    if (this.gatewayReconnectTimer) {
      clearTimeout(this.gatewayReconnectTimer)
      this.gatewayReconnectTimer = null
    }
  }

  // ── Tick 心跳看门狗 ──

  private startTickWatchdog(): void {
    this.stopTickWatchdog()
    this.tickWatchdogTimer = setInterval(() => {
      this.checkTickHealth()
    }, OpenclawGateway.TICK_WATCHDOG_INTERVAL_MS)
  }

  private stopTickWatchdog(): void {
    if (this.tickWatchdogTimer) {
      clearInterval(this.tickWatchdogTimer)
      this.tickWatchdogTimer = null
    }
  }

  private checkTickHealth(): void {
    if (this.lastTickTimestamp <= 0) return
    const elapsed = Date.now() - this.lastTickTimestamp
    if (elapsed <= OpenclawGateway.TICK_TIMEOUT_MS) return

    logger.warn('tickWatchdog.timeout', {
      elapsedMs: elapsed,
      thresholdMs: OpenclawGateway.TICK_TIMEOUT_MS
    })
    this.cancelGatewayReconnect()
    this.disconnect()
    this.gatewayReconnectAttempt = 0
    this.scheduleGatewayReconnect()
  }

  // ── 事件分发 ──

  private handleEvent(frame: GatewayEventFrame): void {
    const { event, payload } = frame

    if (event === 'tick') {
      this.lastTickTimestamp = Date.now()
      this.emit('tick')
      return
    }

    const p = payload as Record<string, unknown> | undefined
    if (!p) return

    switch (event) {
      case 'chat':
        this.handleChatEvent(p)
        break
      case 'agent':
        this.handleAgentEvent(p, frame.seq as number | undefined)
        break
      case 'exec.approval.requested':
        this.handleApprovalRequested(p)
        break
      case 'exec.approval.resolved':
        this.handleApprovalResolved(p)
        break
      // 其他事件静默忽略
    }
  }

  private handleChatEvent(p: Record<string, unknown>): void {
    const sessionKey = ((p.sessionKey ?? '') as string).trim()
    const state = ((p.state ?? '') as string).trim()
    if (!sessionKey || !state) return

    const rawRunId = ((p.runId ?? '') as string).trim()
    const payload: ChatEventPayload = {
      sessionKey,
      state,
      message: p.message,
      runId: rawRunId || undefined,
      stopReason: p.stopReason ? String(p.stopReason) : undefined,
      errorMessage: p.errorMessage ? String(p.errorMessage) : undefined
    }
    this.emit('chatEvent', payload)
  }

  private handleAgentEvent(p: Record<string, unknown>, framSeq?: number): void {
    const sessionKey = ((p.sessionKey ?? '') as string).trim()
    const stream = ((p.stream ?? '') as string).trim()
    if (!sessionKey || !stream) return

    const rawRunId = ((p.runId ?? '') as string).trim()
    // seq 可能来自 frame 级别或 payload 级别，优先取 frame
    const rawSeq = framSeq ?? p.seq
    const payload: AgentEventPayload = {
      sessionKey,
      stream,
      runId: rawRunId || undefined,
      seq: typeof rawSeq === 'number' ? rawSeq : undefined,
      data: p.data as Record<string, unknown> | undefined
    }
    this.emit('agentEvent', payload)
  }

  private handleApprovalRequested(p: Record<string, unknown>): void {
    const id = ((p.id ?? '') as string).trim()
    const request = p.request as Record<string, unknown> | undefined
    if (!id || !request) return

    const payload: ApprovalRequestedPayload = {
      id,
      request: {
        sessionKey: (request.sessionKey ?? '') as string,
        command: request.command as string | undefined,
        cwd: (request.cwd as string | null) ?? null,
        host: (request.host as string | null) ?? null,
        security: (request.security as string | null) ?? null,
        ask: (request.ask as string | null) ?? null,
        resolvedPath: (request.resolvedPath as string | null) ?? null,
        agentId: (request.agentId as string | null) ?? null,
        toolUseId: request.toolUseId as string | undefined
      }
    }
    this.emit('approvalRequested', payload)
  }

  private handleApprovalResolved(p: Record<string, unknown>): void {
    const id = ((p.id ?? '') as string).trim()
    if (!id) return
    this.emit('approvalResolved', { id } satisfies ApprovalResolvedPayload)
  }

  // ── 动态加载 GatewayClient 构造函数 ──

  private async loadGatewayClientCtor(clientEntryPath: string): Promise<GatewayClientCtor> {
    const req = createRequire(import.meta.url)
    const loaded = req(clientEntryPath) as Record<string, unknown>

    // 优先查找命名导出 GatewayClient
    if (typeof loaded.GatewayClient === 'function') {
      return loaded.GatewayClient as GatewayClientCtor
    }

    // Duck-type 检测
    for (const value of Object.values(loaded)) {
      if (typeof value !== 'function') continue
      const ctor = value as { name?: string; prototype?: Record<string, unknown> }
      if (ctor.name === 'GatewayClient') return value as GatewayClientCtor
      if (
        ctor.prototype &&
        typeof ctor.prototype.start === 'function' &&
        typeof ctor.prototype.stop === 'function' &&
        typeof ctor.prototype.request === 'function'
      ) {
        return value as GatewayClientCtor
      }
    }

    const exportKeysPreview = Object.keys(loaded).slice(0, 20).join(', ')
    throw new Error(
      `GatewayClient class not found in ${clientEntryPath} (exports: ${exportKeysPreview || 'none'})`
    )
  }
}
