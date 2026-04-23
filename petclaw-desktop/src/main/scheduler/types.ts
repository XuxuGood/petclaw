// src/main/scheduler/types.ts
// 定时任务类型定义（参考 LobsterAI scheduledTask/types.ts + constants.ts，PetClaw 简化版）

// ── Schedule 调度方式 ──

export interface ScheduleAt {
  kind: 'at'
  at: string // ISO 8601 时间戳，一次性执行
}

export interface ScheduleEvery {
  kind: 'every'
  everyMs: number
  anchorMs?: number
}

export interface ScheduleCron {
  kind: 'cron'
  expr: string // 标准 5 字段 cron 表达式
  tz?: string
  staggerMs?: number
}

export type Schedule = ScheduleAt | ScheduleEvery | ScheduleCron

// ── Payload 执行内容 ──

export interface PayloadAgentTurn {
  kind: 'agentTurn'
  message: string
  timeoutSeconds?: number
  model?: string
}

export interface PayloadSystemEvent {
  kind: 'systemEvent'
  text: string
}

export type ScheduledTaskPayload = PayloadAgentTurn | PayloadSystemEvent

// ── Delivery 结果推送 ──

export interface ScheduledTaskDelivery {
  mode: 'none' | 'announce' | 'webhook'
  channel?: string
  to?: string
  accountId?: string
  bestEffort?: boolean
}

// ── Task State 运行状态 ──

export interface TaskState {
  nextRunAtMs: number | null
  lastRunAtMs: number | null
  lastStatus: 'success' | 'error' | 'skipped' | 'running' | null
  lastError: string | null
  lastDurationMs: number | null
  runningAtMs: number | null
  consecutiveErrors: number
}

// ── ScheduledTask 完整任务 ──

export type SessionTarget = 'main' | 'isolated'
export type WakeMode = 'always' | 'ifIdle'

export interface ScheduledTask {
  id: string
  name: string
  description: string
  enabled: boolean
  schedule: Schedule
  sessionTarget: SessionTarget
  wakeMode: WakeMode
  payload: ScheduledTaskPayload
  delivery: ScheduledTaskDelivery
  agentId: string | null
  sessionKey: string | null
  state: TaskState
  createdAt: string // ISO
  updatedAt: string // ISO
}

// ── 创建/更新输入 ──

export interface ScheduledTaskInput {
  name: string
  description?: string
  enabled: boolean
  schedule: Schedule
  sessionTarget: SessionTarget
  wakeMode: WakeMode
  payload: ScheduledTaskPayload
  delivery?: ScheduledTaskDelivery
  agentId?: string
  sessionKey?: string
}

// ── Run 执行记录 ──

export interface ScheduledTaskRun {
  id: string
  taskId: string
  sessionId: string | null
  sessionKey: string | null
  status: 'success' | 'error' | 'skipped' | 'running'
  startedAt: string // ISO
  finishedAt: string | null // ISO
  durationMs: number | null
  error: string | null
}

export interface ScheduledTaskRunWithName extends ScheduledTaskRun {
  taskName: string
}

// ── IPC Channel 常量 ──

export const SchedulerIpcChannel = {
  List: 'scheduler:list',
  Get: 'scheduler:get',
  Create: 'scheduler:create',
  Update: 'scheduler:update',
  Delete: 'scheduler:delete',
  Toggle: 'scheduler:toggle',
  RunManually: 'scheduler:run-manually',
  ListRuns: 'scheduler:list-runs',
  ListAllRuns: 'scheduler:list-all-runs',
  // Push events (main → renderer)
  StatusUpdate: 'scheduler:status-update',
  RunUpdate: 'scheduler:run-update',
  Refresh: 'scheduler:refresh'
} as const
