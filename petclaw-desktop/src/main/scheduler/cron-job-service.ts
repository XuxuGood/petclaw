// src/main/scheduler/cron-job-service.ts
// CronJobService — 所有定时任务 CRUD 委托给 OpenClaw Gateway RPC
// 参考 LobsterAI CronJobService，PetClaw 简化版，不维护本地 DB 表

import { BrowserWindow } from 'electron'

import type {
  Schedule,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskPayload,
  ScheduledTaskDelivery,
  ScheduledTaskRun,
  ScheduledTaskRunWithName,
  TaskState,
  SessionTarget,
  WakeMode
} from './types'
import { SchedulerIpcChannel } from './types'

type GatewayClientLike = {
  request: <T = Record<string, unknown>>(method: string, params?: unknown) => Promise<T>
}

// ── Gateway 响应类型 ──

interface GatewayJobState {
  nextRunAtMs?: number
  runningAtMs?: number
  lastRunAtMs?: number
  lastRunStatus?: string
  lastStatus?: string
  lastError?: string
  lastDurationMs?: number
  consecutiveErrors?: number
}

interface GatewayJob {
  id: string
  name: string
  description?: string
  enabled: boolean
  schedule: Schedule
  sessionTarget: SessionTarget
  wakeMode: WakeMode
  payload: ScheduledTaskPayload
  delivery?: ScheduledTaskDelivery
  agentId?: string | null
  sessionKey?: string | null
  state: GatewayJobState
  createdAtMs: number
  updatedAtMs: number
}

interface GatewayRunLogEntry {
  ts: number
  jobId: string
  action?: string
  status?: string
  error?: string
  sessionId?: string
  sessionKey?: string
  runAtMs?: number
  durationMs?: number
  jobName?: string
  summary?: string
}

interface CronJobServiceDeps {
  getGatewayClient: () => GatewayClientLike | null
  ensureGatewayReady: () => Promise<void>
}

// ── 工具函数 ──

function safeFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return fallback
}

function safeFiniteNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function mapGatewayResultStatus(status?: string): 'success' | 'error' | 'skipped' | null {
  if (status === 'ok') return 'success'
  if (status === 'error') return 'error'
  if (status === 'skipped') return 'skipped'
  return null
}

// ── 导出的映射函数 ──

export function mapGatewaySchedule(schedule: Schedule): Schedule {
  switch (schedule.kind) {
    case 'at':
      return { kind: 'at', at: schedule.at }
    case 'every': {
      // anchorMs 是可选字段，需要单独检测
      const result: Schedule = { kind: 'every', everyMs: safeFiniteNumber(schedule.everyMs, 60000) }
      const anchorMs = safeFiniteNumberOrNull((schedule as { anchorMs?: number }).anchorMs)
      if (anchorMs !== null) (result as { anchorMs?: number }).anchorMs = anchorMs
      return result
    }
    case 'cron': {
      // staggerMs 是可选字段，需要单独检测
      const result: Schedule = { kind: 'cron', expr: schedule.expr }
      if (schedule.tz) (result as { tz?: string }).tz = schedule.tz
      const staggerMs = safeFiniteNumberOrNull((schedule as { staggerMs?: number }).staggerMs)
      if (staggerMs !== null) (result as { staggerMs?: number }).staggerMs = staggerMs
      return result
    }
  }
}

export function mapGatewayTaskState(state: GatewayJobState): TaskState {
  // runningAtMs 存在时优先标记为 running 状态
  const lastStatus = state.runningAtMs
    ? ('running' as const)
    : mapGatewayResultStatus(state.lastRunStatus ?? state.lastStatus)

  return {
    nextRunAtMs: safeFiniteNumberOrNull(state.nextRunAtMs),
    lastRunAtMs: safeFiniteNumberOrNull(state.lastRunAtMs),
    lastStatus,
    lastError: lastStatus === 'success' ? null : (state.lastError ?? null),
    lastDurationMs: safeFiniteNumberOrNull(state.lastDurationMs),
    runningAtMs: safeFiniteNumberOrNull(state.runningAtMs),
    consecutiveErrors: safeFiniteNumber(state.consecutiveErrors ?? 0, 0)
  }
}

export function mapGatewayJob(job: GatewayJob): ScheduledTask {
  const delivery = job.delivery ?? { mode: 'none' as const }

  return {
    id: job.id,
    name: job.name,
    description: job.description ?? '',
    enabled: job.enabled,
    schedule: mapGatewaySchedule(job.schedule),
    sessionTarget: job.sessionTarget,
    wakeMode: job.wakeMode,
    payload: job.payload,
    delivery: {
      mode: delivery.mode,
      ...(delivery.channel ? { channel: delivery.channel } : {}),
      ...(delivery.to ? { to: delivery.to } : {}),
      ...(delivery.accountId ? { accountId: delivery.accountId } : {}),
      ...(typeof delivery.bestEffort === 'boolean' ? { bestEffort: delivery.bestEffort } : {})
    },
    agentId: job.agentId ?? null,
    sessionKey: job.sessionKey ?? null,
    state: mapGatewayTaskState(job.state),
    createdAt: new Date(safeFiniteNumber(job.createdAtMs, Date.now())).toISOString(),
    updatedAt: new Date(safeFiniteNumber(job.updatedAtMs, Date.now())).toISOString()
  }
}

function mapGatewayRun(entry: GatewayRunLogEntry): ScheduledTaskRun {
  // action !== 'finished' 说明仍在运行
  const status =
    entry.action && entry.action !== 'finished'
      ? ('running' as const)
      : (mapGatewayResultStatus(entry.status) ?? ('error' as const))

  const tsMs = safeFiniteNumber(entry.runAtMs ?? entry.ts, Date.now())

  return {
    id: `${entry.jobId}-${entry.ts}`,
    taskId: entry.jobId,
    sessionId: entry.sessionId ?? null,
    sessionKey: entry.sessionKey ?? null,
    status,
    startedAt: new Date(tsMs).toISOString(),
    finishedAt:
      status === 'running' ? null : new Date(safeFiniteNumber(entry.ts, tsMs)).toISOString(),
    durationMs: safeFiniteNumberOrNull(entry.durationMs),
    error: status === 'success' ? null : (entry.error ?? null)
  }
}

// Gateway 与 PetClaw 数据结构一致，直接透传
function toGatewaySchedule(schedule: Schedule): Schedule {
  return schedule
}

function toGatewayPayload(payload: ScheduledTaskPayload): ScheduledTaskPayload {
  return payload
}

function toGatewayDelivery(delivery?: ScheduledTaskDelivery): ScheduledTaskDelivery | undefined {
  if (!delivery) return undefined
  return delivery
}

// ── Service ──

export class CronJobService {
  private readonly getGatewayClient: () => GatewayClientLike | null
  private readonly ensureGatewayReady: () => Promise<void>
  private pollingTimer: ReturnType<typeof setInterval> | null = null
  private lastKnownStates = new Map<string, string>()
  private polling = false
  private firstPollDone = false
  private jobNameCache = new Map<string, string>()
  private runningJobIds = new Set<string>()

  // 15 秒轮询间隔，与 Gateway 保持状态同步
  private static readonly POLL_INTERVAL_MS = 15_000

  constructor(deps: CronJobServiceDeps) {
    this.getGatewayClient = deps.getGatewayClient
    this.ensureGatewayReady = deps.ensureGatewayReady
  }

  // 获取 Gateway 客户端，未就绪时先等待
  private async client(): Promise<GatewayClientLike> {
    let client = this.getGatewayClient()
    if (!client) {
      await this.ensureGatewayReady()
      client = this.getGatewayClient()
    }
    if (!client) {
      throw new Error('Gateway client unavailable for cron operations')
    }
    return client
  }

  getJobNameSync(jobId: string): string | null {
    return this.jobNameCache.get(jobId) ?? null
  }

  hasRunningJobs(): boolean {
    return this.runningJobIds.size > 0
  }

  async addJob(input: ScheduledTaskInput): Promise<ScheduledTask> {
    const client = await this.client()
    const job = await client.request<GatewayJob>('cron.add', {
      name: input.name,
      description: input.description || undefined,
      enabled: input.enabled,
      schedule: toGatewaySchedule(input.schedule),
      sessionTarget: input.sessionTarget,
      wakeMode: input.wakeMode,
      payload: toGatewayPayload(input.payload),
      ...(input.delivery ? { delivery: toGatewayDelivery(input.delivery) } : {}),
      ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
      ...(input.sessionKey?.trim() ? { sessionKey: input.sessionKey.trim() } : {})
    })
    const mapped = mapGatewayJob(job)
    this.jobNameCache.set(mapped.id, mapped.name)
    return mapped
  }

  async updateJob(id: string, input: Partial<ScheduledTaskInput>): Promise<ScheduledTask> {
    const client = await this.client()
    const patch: Record<string, unknown> = {}

    if (input.name !== undefined) patch.name = input.name
    if (input.description !== undefined) patch.description = input.description || undefined
    if (input.enabled !== undefined) patch.enabled = input.enabled
    if (input.schedule !== undefined) patch.schedule = toGatewaySchedule(input.schedule)
    if (input.sessionTarget !== undefined) patch.sessionTarget = input.sessionTarget
    if (input.wakeMode !== undefined) patch.wakeMode = input.wakeMode
    if (input.payload !== undefined) patch.payload = toGatewayPayload(input.payload)
    if (input.delivery !== undefined)
      patch.delivery = toGatewayDelivery(input.delivery) ?? { mode: 'none' }
    if (input.agentId !== undefined) patch.agentId = input.agentId?.trim() || null
    if (input.sessionKey !== undefined) patch.sessionKey = input.sessionKey?.trim() || null

    const job = await client.request<GatewayJob>('cron.update', { id, patch })
    return mapGatewayJob(job)
  }

  async removeJob(id: string): Promise<void> {
    const client = await this.client()
    await client.request('cron.remove', { id })
    this.lastKnownStates.delete(id)
  }

  async listJobs(): Promise<ScheduledTask[]> {
    const client = await this.client()
    const result = await client.request<{ jobs?: GatewayJob[] }>('cron.list', {
      includeDisabled: true,
      limit: 200
    })
    return Array.isArray(result.jobs) ? result.jobs.map(mapGatewayJob) : []
  }

  async toggleJob(id: string, enabled: boolean): Promise<ScheduledTask> {
    const client = await this.client()
    const job = await client.request<GatewayJob>('cron.update', {
      id,
      patch: { enabled }
    })
    return mapGatewayJob(job)
  }

  async runJob(id: string): Promise<void> {
    const client = await this.client()
    await client.request('cron.run', { id })
  }

  async listRuns(jobId: string, limit = 20, offset = 0): Promise<ScheduledTaskRun[]> {
    const client = await this.client()
    const result = await client.request<{ entries?: GatewayRunLogEntry[] }>('cron.runs', {
      scope: 'job',
      id: jobId,
      limit,
      offset,
      sortDir: 'desc'
    })
    return Array.isArray(result.entries) ? result.entries.map(mapGatewayRun) : []
  }

  async listAllRuns(limit = 20, offset = 0): Promise<ScheduledTaskRunWithName[]> {
    const client = await this.client()
    const result = await client.request<{ entries?: GatewayRunLogEntry[] }>('cron.runs', {
      scope: 'all',
      limit,
      offset,
      sortDir: 'desc'
    })
    if (!Array.isArray(result.entries) || result.entries.length === 0) return []

    return result.entries.map((entry) => ({
      ...mapGatewayRun(entry),
      taskName: entry.jobName ?? this.jobNameCache.get(entry.jobId) ?? entry.jobId
    }))
  }

  // ── 轮询（15s 间隔）—— 检测状态变化后推送 StatusUpdate 事件到渲染进程 ──

  startPolling(): void {
    if (this.polling) return
    this.polling = true
    this.pollOnce()
    this.pollingTimer = setInterval(() => {
      void this.pollOnce()
    }, CronJobService.POLL_INTERVAL_MS)
  }

  stopPolling(): void {
    this.polling = false
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
    }
    this.lastKnownStates.clear()
    this.jobNameCache.clear()
    this.runningJobIds.clear()
    this.firstPollDone = false
  }

  private async pollOnce(): Promise<void> {
    if (!this.polling) return

    try {
      const client = this.getGatewayClient()
      if (!client) return

      const result = await client.request<{ jobs?: GatewayJob[] }>('cron.list', {
        includeDisabled: true,
        limit: 200
      })
      const jobs = Array.isArray(result.jobs) ? result.jobs : []

      // 更新 name 缓存和 running 状态
      this.jobNameCache.clear()
      this.runningJobIds.clear()
      for (const job of jobs) {
        this.jobNameCache.set(job.id, job.name)
        if (job.state.runningAtMs) this.runningJobIds.add(job.id)
      }

      // 比对状态哈希，仅状态变化时才推送更新，避免无效渲染
      for (const job of jobs) {
        const stateHash = JSON.stringify(job.state)
        const previousHash = this.lastKnownStates.get(job.id)
        if (previousHash !== stateHash) {
          this.lastKnownStates.set(job.id, stateHash)
          if (previousHash !== undefined) {
            const task = mapGatewayJob(job)
            this.emitStatusUpdate(task.id, task.state)
          }
        }
      }

      // 首次轮询完成后通知前端整体刷新任务列表
      if (!this.firstPollDone) {
        this.firstPollDone = true
        this.emitFullRefresh()
      }
    } catch (error) {
      console.warn('[CronJobService] Polling error:', error)
    }
  }

  private emitStatusUpdate(taskId: string, state: TaskState): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(SchedulerIpcChannel.StatusUpdate, { taskId, state })
      }
    })
  }

  private emitFullRefresh(): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(SchedulerIpcChannel.Refresh)
      }
    })
  }
}
