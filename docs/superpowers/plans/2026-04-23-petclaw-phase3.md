# PetClaw v3 Phase 3 — 集成功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 PetClaw 的集成功能层：SchedulerManager（定时任务）、ImGateway（IM 平台桥接）、PetEventBridge 多源扩展、Exec Approval 审批弹窗、Agent 配置对话框、Onboarding 扩展。

**Architecture:** SchedulerManager 通过 Gateway RPC `cron.*` 委托 OpenClaw 运行时管理定时任务（不在 Electron 端维护 cron 循环）。ImGateway 作为 IM 平台配置管理层，所有 IM 平台通过 OpenClaw 插件运行，PetClaw 只管理配置和会话路由。IM 频道作为主视图（非 Settings 子页），配置通过弹窗完成。PetEventBridge 扩展为订阅 ImGateway/SchedulerManager/HookServer 多源事件。Exec Approval 弹窗支持三种模式（标准工具审批、确认模式、多选模式）。Agent 配置对话框三 Tab（基础/技能/IM 渠道），底部 4 按钮（删除/使用此Agent/取消/保存）。CronPage 采用两栏卡片网格布局 + 两个 Tab（我的定时任务/执行记录）。

**Tech Stack:** Electron 33 · better-sqlite3 · Zustand · TypeScript strict · Vitest · lucide-react · Tailwind

**参考实现:** LobsterAI `/Users/xiaoxuxuy/Desktop/工作/AI/开源项目/LobsterAI`（参考但不照抄，保持 PetClaw 特色）

**v3 Spec:** `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md` §9.3, §14, §15, §7.4, §22.4

---

## File Structure

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/main/scheduler/cron-job-service.ts` | Gateway RPC 代理：cron.add/update/remove/list/run |
| `src/main/scheduler/types.ts` | ScheduledTask, Schedule, Payload, Delivery 类型 |
| `src/main/im/im-gateway-manager.ts` | IM 平台配置管理 + OpenClaw 插件代理 |
| `src/main/im/types.ts` | Platform, IMConfig, IMMessage 类型 |
| `src/main/ipc/scheduler-ipc.ts` | 定时任务 IPC handlers |
| `src/main/ipc/im-ipc.ts` | IM 配置 IPC handlers |
| `tests/main/scheduler/cron-job-service.test.ts` | CronJobService 单元测试 |
| `tests/main/im/im-gateway-manager.test.ts` | ImGatewayManager 单元测试 |
| `src/renderer/src/chat/components/CoworkPermissionModal.tsx` | Exec Approval 审批弹窗 |
| `src/renderer/src/chat/components/AgentConfigDialog.tsx` | Agent 三 Tab 配置对话框（icon+名称同行，底部4按钮） |
| `src/renderer/src/chat/components/AgentSkillSelector.tsx` | Agent 技能多选子组件 |
| `src/renderer/src/chat/components/ImChannelsPage.tsx` | IM 频道主视图（平台列表+状态+配置入口） |
| `src/renderer/src/chat/components/ImConfigDialog.tsx` | IM 配置弹窗（左侧平台列表+右侧配置面板） |
| `src/renderer/src/chat/components/CronEditDialog.tsx` | 定时任务创建/编辑弹窗（频率+时间+星期+Prompt） |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/main/data/db.ts` | 新增 `im_config` + `im_session_mappings` 表 |
| `src/main/ai/types.ts` | 新增 IM/Scheduler 相关类型 |
| `src/main/pet/pet-event-bridge.ts` | 扩展：接入 ImGateway + SchedulerManager + HookServer |
| `src/main/ipc/index.ts` | 注册 scheduler-ipc + im-ipc |
| `src/main/index.ts` | 启动流程：初始化 CronJobService + ImGatewayManager + PetEventBridge 扩展 |
| `src/preload/index.ts` | 新增 scheduler/im channels |
| `src/preload/index.d.ts` | 类型同步 |
| `src/renderer/src/chat/ChatApp.tsx` | 新增 ViewType `'im-channels'` + 集成 CoworkPermissionModal + 路由 ImChannelsPage |
| `src/renderer/src/chat/components/ChatView.tsx` | 集成权限审批事件 |
| `src/renderer/src/chat/components/CronPage.tsx` | 替换占位为完整定时任务管理 UI（两栏卡片网格+两 Tab） |
| `src/renderer/src/chat/components/Sidebar.tsx` | 新增 IM 频道导航项 |
| `src/renderer/src/chat/components/settings/SettingsPage.tsx` | 新增 scheduler 菜单项（IM 配置已移至独立主视图） |
| `src/renderer/src/chat/components/settings/AgentSettings.tsx` | 集成 AgentConfigDialog |
| `src/renderer/src/panels/OnboardingPanel.tsx` | 扩展：AI 对话 + 推荐 Skills + StarterCards |

---

## Task 1: DB Schema — im_config + im_session_mappings 表

**Files:**
- Modify: `src/main/data/db.ts`
- Test: `tests/main/data/db.test.ts`

- [ ] **Step 1: 写 im_config 表测试**

在 `tests/main/data/db.test.ts` 追加：

```typescript
describe('im_config table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  afterEach(() => db.close())

  it('should create and query im_config', () => {
    const now = Date.now()
    db.prepare('INSERT INTO im_config (key, value, updated_at) VALUES (?, ?, ?)').run(
      'telegram',
      JSON.stringify({ enabled: true, token: 'xxx' }),
      now
    )
    const row = db.prepare('SELECT value FROM im_config WHERE key = ?').get('telegram') as { value: string }
    expect(JSON.parse(row.value).enabled).toBe(true)
  })

  it('should support multi-instance keys', () => {
    const now = Date.now()
    db.prepare('INSERT INTO im_config (key, value, updated_at) VALUES (?, ?, ?)').run(
      'dingtalk:instance-1',
      JSON.stringify({ enabled: true }),
      now
    )
    db.prepare('INSERT INTO im_config (key, value, updated_at) VALUES (?, ?, ?)').run(
      'dingtalk:instance-2',
      JSON.stringify({ enabled: false }),
      now
    )
    const rows = db.prepare("SELECT key FROM im_config WHERE key LIKE 'dingtalk:%'").all() as Array<{ key: string }>
    expect(rows).toHaveLength(2)
  })
})

describe('im_session_mappings table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  afterEach(() => db.close())

  it('should create mapping with composite primary key', () => {
    const now = Date.now()
    db.prepare(
      'INSERT INTO im_session_mappings (im_conversation_id, platform, cowork_session_id, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('conv-1', 'telegram', 'session-1', 'main', now, now)
    const row = db.prepare(
      'SELECT cowork_session_id FROM im_session_mappings WHERE im_conversation_id = ? AND platform = ?'
    ).get('conv-1', 'telegram') as { cowork_session_id: string }
    expect(row.cowork_session_id).toBe('session-1')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/data/db.test.ts`
Expected: 新测试因表不存在而失败

- [ ] **Step 3: 在 db.ts initDatabase 中追加建表语句**

在 `src/main/data/db.ts` 的 `initDatabase` 函数末尾（`mcp_servers` 表之后）追加：

```typescript
  // IM 平台配置（KV 表，key 为平台名或 平台:实例ID）
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // IM 会话 → Cowork 会话路由映射
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_session_mappings (
      im_conversation_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      cowork_session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT 'main',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (im_conversation_id, platform)
    )
  `)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/data/db.test.ts`

- [ ] **Step 5: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 6: 提交**

```bash
cd petclaw-desktop && git add src/main/data/db.ts tests/main/data/db.test.ts
git commit -m "feat(db): add im_config and im_session_mappings tables for Phase 3"
```

---

## Task 2: Scheduler 类型定义

**Files:**
- Create: `src/main/scheduler/types.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
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
```

- [ ] **Step 2: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
cd petclaw-desktop && git add src/main/scheduler/types.ts
git commit -m "feat(scheduler): add scheduled task type definitions"
```

---

## Task 3: CronJobService — Gateway RPC 代理

**Files:**
- Create: `src/main/scheduler/cron-job-service.ts`
- Test: `tests/main/scheduler/cron-job-service.test.ts`

CronJobService 是 LobsterAI CronJobService 的 PetClaw 简化版。所有定时任务 CRUD 操作委托给 OpenClaw Gateway RPC（`cron.add`/`cron.update`/`cron.remove`/`cron.list`/`cron.run`/`cron.runs`）。PetClaw 端不维护 DB 表，状态完全由 Gateway 管理。

- [ ] **Step 1: 写测试**

```typescript
// tests/main/scheduler/cron-job-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock GatewayClient
function createMockClient() {
  return {
    request: vi.fn()
  }
}

describe('CronJobService', () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  it('should map gateway job to ScheduledTask', async () => {
    // 测试 mapGatewayJob 转换逻辑
    const { mapGatewayJob } = await import('../../../src/main/scheduler/cron-job-service')
    const gatewayJob = {
      id: 'job-1',
      name: '每日新闻',
      description: '收集科技新闻',
      enabled: true,
      schedule: { kind: 'cron' as const, expr: '0 9 * * *' },
      sessionTarget: 'main' as const,
      wakeMode: 'always' as const,
      payload: { kind: 'agentTurn' as const, message: '收集新闻' },
      state: {
        nextRunAtMs: 1714000000000,
        lastRunAtMs: null,
        lastRunStatus: undefined,
        lastError: undefined,
        lastDurationMs: undefined,
        runningAtMs: undefined,
        consecutiveErrors: 0
      },
      createdAtMs: 1713900000000,
      updatedAtMs: 1713900000000
    }
    const task = mapGatewayJob(gatewayJob)
    expect(task.id).toBe('job-1')
    expect(task.name).toBe('每日新闻')
    expect(task.schedule).toEqual({ kind: 'cron', expr: '0 9 * * *' })
    expect(task.payload).toEqual({ kind: 'agentTurn', message: '收集新闻' })
    expect(task.state.nextRunAtMs).toBe(1714000000000)
  })

  it('should map gateway schedule correctly', async () => {
    const { mapGatewaySchedule } = await import('../../../src/main/scheduler/cron-job-service')
    expect(mapGatewaySchedule({ kind: 'at', at: '2026-04-23T10:00:00Z' })).toEqual({
      kind: 'at',
      at: '2026-04-23T10:00:00Z'
    })
    expect(mapGatewaySchedule({ kind: 'every', everyMs: 60000 })).toEqual({
      kind: 'every',
      everyMs: 60000
    })
    expect(mapGatewaySchedule({ kind: 'cron', expr: '0 9 * * 1-5', tz: 'Asia/Shanghai' })).toEqual({
      kind: 'cron',
      expr: '0 9 * * 1-5',
      tz: 'Asia/Shanghai'
    })
  })

  it('should call cron.add via gateway', async () => {
    const { CronJobService } = await import('../../../src/main/scheduler/cron-job-service')
    mockClient.request.mockResolvedValue({
      id: 'new-1',
      name: 'test',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      sessionTarget: 'main',
      wakeMode: 'always',
      payload: { kind: 'agentTurn', message: 'hello' },
      state: {},
      createdAtMs: Date.now(),
      updatedAtMs: Date.now()
    })
    const service = new CronJobService({
      getGatewayClient: () => mockClient,
      ensureGatewayReady: async () => {}
    })
    const task = await service.addJob({
      name: 'test',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      sessionTarget: 'main',
      wakeMode: 'always',
      payload: { kind: 'agentTurn', message: 'hello' }
    })
    expect(mockClient.request).toHaveBeenCalledWith('cron.add', expect.objectContaining({ name: 'test' }))
    expect(task.id).toBe('new-1')
  })

  it('should call cron.remove via gateway', async () => {
    const { CronJobService } = await import('../../../src/main/scheduler/cron-job-service')
    mockClient.request.mockResolvedValue({})
    const service = new CronJobService({
      getGatewayClient: () => mockClient,
      ensureGatewayReady: async () => {}
    })
    await service.removeJob('job-1')
    expect(mockClient.request).toHaveBeenCalledWith('cron.remove', { id: 'job-1' })
  })

  it('should list jobs via gateway', async () => {
    const { CronJobService } = await import('../../../src/main/scheduler/cron-job-service')
    mockClient.request.mockResolvedValue({
      jobs: [
        {
          id: 'j1',
          name: 'Job 1',
          enabled: true,
          schedule: { kind: 'cron', expr: '0 9 * * *' },
          sessionTarget: 'main',
          wakeMode: 'always',
          payload: { kind: 'agentTurn', message: 'hi' },
          state: {},
          createdAtMs: Date.now(),
          updatedAtMs: Date.now()
        }
      ]
    })
    const service = new CronJobService({
      getGatewayClient: () => mockClient,
      ensureGatewayReady: async () => {}
    })
    const tasks = await service.listJobs()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].name).toBe('Job 1')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/scheduler/cron-job-service.test.ts`

- [ ] **Step 3: 实现 CronJobService**

```typescript
// src/main/scheduler/cron-job-service.ts
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
  request: <T = Record<string, unknown>>(
    method: string,
    params?: unknown
  ) => Promise<T>
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
      const result: Schedule = { kind: 'every', everyMs: safeFiniteNumber(schedule.everyMs, 60000) }
      const anchorMs = safeFiniteNumberOrNull((schedule as { anchorMs?: number }).anchorMs)
      if (anchorMs !== null) (result as { anchorMs?: number }).anchorMs = anchorMs
      return result
    }
    case 'cron': {
      const result: Schedule = { kind: 'cron', expr: schedule.expr }
      if (schedule.tz) (result as { tz?: string }).tz = schedule.tz
      const staggerMs = safeFiniteNumberOrNull((schedule as { staggerMs?: number }).staggerMs)
      if (staggerMs !== null) (result as { staggerMs?: number }).staggerMs = staggerMs
      return result
    }
  }
}

export function mapGatewayTaskState(state: GatewayJobState): TaskState {
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
      status === 'running'
        ? null
        : new Date(safeFiniteNumber(entry.ts, tsMs)).toISOString(),
    durationMs: safeFiniteNumberOrNull(entry.durationMs),
    error: status === 'success' ? null : (entry.error ?? null)
  }
}

function toGatewaySchedule(schedule: Schedule): Schedule {
  return schedule // 结构一致，直接透传
}

function toGatewayPayload(payload: ScheduledTaskPayload): ScheduledTaskPayload {
  return payload // 结构一致，直接透传
}

function toGatewayDelivery(
  delivery?: ScheduledTaskDelivery
): ScheduledTaskDelivery | undefined {
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

  private static readonly POLL_INTERVAL_MS = 15_000

  constructor(deps: CronJobServiceDeps) {
    this.getGatewayClient = deps.getGatewayClient
    this.ensureGatewayReady = deps.ensureGatewayReady
  }

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

  // ── 轮询（15s 间隔） ──

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

      // 更新缓存
      this.jobNameCache.clear()
      this.runningJobIds.clear()
      for (const job of jobs) {
        this.jobNameCache.set(job.id, job.name)
        if (job.state.runningAtMs) this.runningJobIds.add(job.id)
      }

      // 检测状态变化，推送更新
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

      // 首次轮询完成后通知前端刷新
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/scheduler/cron-job-service.test.ts`

- [ ] **Step 5: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 6: 提交**

```bash
cd petclaw-desktop && git add src/main/scheduler/ tests/main/scheduler/
git commit -m "feat(scheduler): add CronJobService with Gateway RPC proxy"
```

---

## Task 4: IM 类型定义

**Files:**
- Create: `src/main/im/types.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
// src/main/im/types.ts
// IM 平台类型定义（参考 LobsterAI im/types.ts，PetClaw 简化版）

// Phase 3 只实现 4 个平台：飞书、钉钉、企微、微信
export type Platform = 'wechat' | 'wecom' | 'dingtalk' | 'feishu'

// 支持多实例的平台
export type MultiInstancePlatform = 'dingtalk' | 'feishu' | 'wecom'

export const MULTI_INSTANCE_PLATFORMS: MultiInstancePlatform[] = [
  'dingtalk', 'feishu', 'wecom'
]

// 平台显示信息
export const PLATFORM_INFO: Record<Platform, { name: string; icon: string; maxInstances: number }> = {
  feishu: { name: '飞书', icon: '🐦', maxInstances: 3 },
  dingtalk: { name: '钉钉', icon: '📌', maxInstances: 3 },
  wecom: { name: '企业微信', icon: '🏢', maxInstances: 3 },
  wechat: { name: '微信', icon: '💬', maxInstances: 1 }
}

// IM 绑定规则：
// - 一个平台实例同一时间只能被一个 Agent 持有（互斥锁）
// - 已被其他 Agent 绑定的平台在 UI 上显示灰色 + "→ AgentName"，不可点击
// - main Agent 是兜底：未绑定任何 Agent 的平台消息默认交给 main 处理
// - main Agent 不在 Agent 列表中显示，不需要显式绑定 IM

// IM 统一消息类型
export interface IMMessage {
  platform: Platform
  messageId: string
  conversationId: string
  senderId: string
  senderName?: string
  groupName?: string
  content: string
  chatType: 'direct' | 'group'
  timestamp: number
}

// IM 平台连接状态
export interface IMPlatformStatus {
  connected: boolean
  startedAt: number | null
  lastError: string | null
  lastInboundAt: number | null
  lastOutboundAt: number | null
}

// IM 全局设置
export interface IMSettings {
  systemPrompt: string
  skillsEnabled: boolean
  platformAgentBindings: Record<string, string> // key 格式: 'telegram' 或 'dingtalk:instance-id'
}

// IM 平台通用配置
export interface IMPlatformConfig {
  enabled: boolean
  dmPolicy: 'open' | 'pairing' | 'allowlist' | 'disabled'
  groupPolicy: 'open' | 'allowlist' | 'disabled'
  allowFrom: string[]
  debug: boolean
}

// 多实例平台的实例配置
export interface IMInstanceConfig extends IMPlatformConfig {
  instanceId: string
  instanceName: string
}

// IPC Channel 常量
export const ImIpcChannel = {
  LoadConfig: 'im:load-config',
  SaveConfig: 'im:save-config',
  GetStatus: 'im:get-status',
  Connect: 'im:connect',
  Disconnect: 'im:disconnect',
  TestConnection: 'im:test-connection',
  // Push events
  StatusUpdate: 'im:status-update',
  MessageReceived: 'im:message-received'
} as const
```

- [ ] **Step 2: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
cd petclaw-desktop && git add src/main/im/types.ts
git commit -m "feat(im): add IM platform type definitions"
```

---

## Task 5: ImGatewayManager — IM 配置管理

**Files:**
- Create: `src/main/im/im-gateway-manager.ts`
- Test: `tests/main/im/im-gateway-manager.test.ts`

ImGatewayManager 管理 IM 平台配置的 CRUD（持久化到 im_config 表）和会话路由映射。大多数 IM 平台通过 OpenClaw 插件运行（不在 PetClaw 主进程中直接管理连接），PetClaw 端只管理配置和推送 ConfigSync。

- [ ] **Step 1: 写测试**

```typescript
// tests/main/im/im-gateway-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase } from '../../../src/main/data/db'

describe('ImGatewayManager', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  afterEach(() => db.close())

  it('should save and load platform config', async () => {
    const { ImGatewayManager } = await import('../../../src/main/im/im-gateway-manager')
    const manager = new ImGatewayManager(db)
    manager.savePlatformConfig('telegram', { enabled: true, dmPolicy: 'open', groupPolicy: 'disabled', allowFrom: [], debug: false })
    const config = manager.loadPlatformConfig('telegram')
    expect(config).toBeTruthy()
    expect(config!.enabled).toBe(true)
  })

  it('should save and load IM settings', async () => {
    const { ImGatewayManager } = await import('../../../src/main/im/im-gateway-manager')
    const manager = new ImGatewayManager(db)
    manager.saveSettings({
      systemPrompt: 'You are helpful',
      skillsEnabled: true,
      platformAgentBindings: { telegram: 'main', 'dingtalk:inst-1': 'work-agent' }
    })
    const settings = manager.loadSettings()
    expect(settings.platformAgentBindings['telegram']).toBe('main')
    expect(settings.platformAgentBindings['dingtalk:inst-1']).toBe('work-agent')
  })

  it('should manage session mappings', async () => {
    const { ImGatewayManager } = await import('../../../src/main/im/im-gateway-manager')
    const manager = new ImGatewayManager(db)
    manager.upsertSessionMapping('conv-1', 'telegram', 'session-abc', 'main')
    const mapping = manager.getSessionMapping('conv-1', 'telegram')
    expect(mapping).toBeTruthy()
    expect(mapping!.cowork_session_id).toBe('session-abc')
  })

  it('should emit change event on config save', async () => {
    const { ImGatewayManager } = await import('../../../src/main/im/im-gateway-manager')
    const manager = new ImGatewayManager(db)
    let changed = false
    manager.on('change', () => { changed = true })
    manager.savePlatformConfig('telegram', { enabled: true, dmPolicy: 'open', groupPolicy: 'disabled', allowFrom: [], debug: false })
    expect(changed).toBe(true)
  })

  it('should return agent for platform binding', async () => {
    const { ImGatewayManager } = await import('../../../src/main/im/im-gateway-manager')
    const manager = new ImGatewayManager(db)
    manager.saveSettings({
      systemPrompt: '',
      skillsEnabled: true,
      platformAgentBindings: { telegram: 'news-agent' }
    })
    expect(manager.getAgentForPlatform('telegram')).toBe('news-agent')
    expect(manager.getAgentForPlatform('dingtalk')).toBe('main') // 默认 main
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/im/im-gateway-manager.test.ts`

- [ ] **Step 3: 实现 ImGatewayManager**

```typescript
// src/main/im/im-gateway-manager.ts
import { EventEmitter } from 'events'

import type Database from 'better-sqlite3'

import type { Platform, IMPlatformConfig, IMSettings } from './types'

const DEFAULT_SETTINGS: IMSettings = {
  systemPrompt: '',
  skillsEnabled: true,
  platformAgentBindings: {}
}

export class ImGatewayManager extends EventEmitter {
  constructor(private db: Database.Database) {
    super()
  }

  // ── 平台配置 CRUD ──

  savePlatformConfig(key: string, config: IMPlatformConfig): void {
    const now = Date.now()
    this.db
      .prepare(
        'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)'
      )
      .run(key, JSON.stringify(config), now)
    this.emit('change')
  }

  loadPlatformConfig(key: string): IMPlatformConfig | null {
    const row = this.db
      .prepare('SELECT value FROM im_config WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row ? (JSON.parse(row.value) as IMPlatformConfig) : null
  }

  deletePlatformConfig(key: string): void {
    this.db.prepare('DELETE FROM im_config WHERE key = ?').run(key)
    this.emit('change')
  }

  listPlatformConfigs(): Array<{ key: string; config: IMPlatformConfig }> {
    const rows = this.db
      .prepare("SELECT key, value FROM im_config WHERE key != 'settings'")
      .all() as Array<{ key: string; value: string }>
    return rows.map((row) => ({
      key: row.key,
      config: JSON.parse(row.value) as IMPlatformConfig
    }))
  }

  // ── IM 全局设置 ──

  saveSettings(settings: IMSettings): void {
    const now = Date.now()
    this.db
      .prepare(
        'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)'
      )
      .run('settings', JSON.stringify(settings), now)
    this.emit('change')
  }

  loadSettings(): IMSettings {
    const row = this.db
      .prepare("SELECT value FROM im_config WHERE key = 'settings'")
      .get() as { value: string } | undefined
    return row ? (JSON.parse(row.value) as IMSettings) : { ...DEFAULT_SETTINGS }
  }

  // ── Agent 绑定查询 ──

  getAgentForPlatform(platformKey: string): string {
    const settings = this.loadSettings()
    return settings.platformAgentBindings[platformKey] ?? 'main'
  }

  // ── 会话路由映射 ──

  upsertSessionMapping(
    imConversationId: string,
    platform: string,
    coworkSessionId: string,
    agentId: string
  ): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT OR REPLACE INTO im_session_mappings
         (im_conversation_id, platform, cowork_session_id, agent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(imConversationId, platform, coworkSessionId, agentId, now, now)
  }

  getSessionMapping(
    imConversationId: string,
    platform: string
  ): { cowork_session_id: string; agent_id: string } | null {
    return (
      this.db
        .prepare(
          'SELECT cowork_session_id, agent_id FROM im_session_mappings WHERE im_conversation_id = ? AND platform = ?'
        )
        .get(imConversationId, platform) as
        | { cowork_session_id: string; agent_id: string }
        | undefined
    ) ?? null
  }

  // ── 序列化为 OpenClaw 配置（供 ConfigSync 使用） ──

  toOpenclawConfig(): Record<string, unknown> {
    const configs = this.listPlatformConfigs()
    const result: Record<string, unknown> = {}
    for (const { key, config } of configs) {
      if (config.enabled) {
        result[key] = config
      }
    }
    return result
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/im/im-gateway-manager.test.ts`

- [ ] **Step 5: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 6: 提交**

```bash
cd petclaw-desktop && git add src/main/im/ tests/main/im/
git commit -m "feat(im): add ImGatewayManager with config CRUD and session mapping"
```

---

## Task 6: PetEventBridge 多源扩展

**Files:**
- Modify: `src/main/pet/pet-event-bridge.ts`

当前 PetEventBridge 只订阅 CoworkController 事件。Phase 3 需要扩展为同时订阅 ImGatewayManager、CronJobService、HookServer。

- [ ] **Step 1: 重写 PetEventBridge 构造函数和事件绑定**

```typescript
// src/main/pet/pet-event-bridge.ts
import { BrowserWindow } from 'electron'

import type { CoworkController } from '../ai/cowork-controller'
import type { CoworkMessage } from '../ai/types'
import type { ImGatewayManager } from '../im/im-gateway-manager'
import type { CronJobService } from '../scheduler/cron-job-service'
import type { HookServer } from '../hooks/server'

/**
 * PetEventBridge: 聚合多源事件，向宠物窗口发送统一的状态事件和气泡消息。
 *
 * 事件源：
 * - CoworkController: 聊天消息/流式更新/完成/错误/权限审批
 * - ImGatewayManager: IM 消息到达创建会话
 * - CronJobService: 定时任务触发
 * - HookServer: Claude Code hook 活跃/空闲
 *
 * 维护 activeSessionCount 计数器，确保多会话并行时正确触发动画：
 * - 任何会话开始 → ChatSent（仅首个）
 * - 所有会话结束 → AIDone
 */
export class PetEventBridge {
  private activeSessionCount = 0
  private firstResponseSent = new Set<string>()

  constructor(
    private petWindow: BrowserWindow,
    private coworkController: CoworkController,
    private imGateway?: ImGatewayManager,
    private cronService?: CronJobService,
    private hookServer?: HookServer
  ) {
    this.bindCoworkEvents()
    if (this.hookServer) this.bindHookEvents()
    // IM 和 Scheduler 事件通过主动调用触发（不是 EventEmitter），
    // 需要在 index.ts 中将回调注入。这里提供 public 方法供外部调用。
  }

  // ── CoworkController 事件（v1 已有，保持不变） ──

  private bindCoworkEvents(): void {
    this.coworkController.on('message', (_sessionId: string, msg: CoworkMessage) => {
      if (msg.type === 'user') {
        this.sessionStarted()
      }
    })

    this.coworkController.on(
      'messageUpdate',
      (sessionId: string, _msgId: string, content: string) => {
        if (!this.firstResponseSent.has(sessionId)) {
          this.firstResponseSent.add(sessionId)
          this.sendPetEvent('AI_RESPONDING')
        }
        this.sendBubble(content.slice(-50), 'chat')
      }
    )

    this.coworkController.on('complete', (sessionId: string) => {
      this.cleanupSession(sessionId)
      this.sendBubble('任务完成', 'system')
    })

    this.coworkController.on('error', (sessionId: string) => {
      this.cleanupSession(sessionId)
    })

    this.coworkController.on('sessionStopped', (sessionId: string) => {
      this.cleanupSession(sessionId)
    })

    this.coworkController.on('permissionRequest', (_sessionId: string, req: unknown) => {
      const toolName = (req as { toolName?: string })?.toolName ?? 'unknown'
      this.sendBubble(`等待审批：${toolName}`, 'approval')
    })
  }

  // ── HookServer 事件 ──

  private bindHookEvents(): void {
    this.hookServer!.onEvent((event) => {
      if (event.type === 'session_end') {
        this.sendPetEvent('HOOK_IDLE')
      } else {
        this.sendPetEvent('HOOK_ACTIVE')
      }
      // 透传 hook:event 到 Pet 窗口
      this.petWindow.webContents.send('hook:event', event)
    })
  }

  // ── IM 消息触发（由 index.ts 在收到 IM 消息时调用） ──

  notifyImSessionCreated(sessionId: string, platform: string): void {
    this.sessionStarted()
    this.sendBubble(`[${platform}] 收到新任务`, 'im')
  }

  // ── 定时任务触发（由 index.ts 在 cron 任务执行时调用） ──

  notifySchedulerTaskFired(sessionId: string, taskName: string): void {
    this.sessionStarted()
    this.sendBubble(`[定时] ${taskName}`, 'scheduler')
  }

  // ── 会话计数 ──

  private sessionStarted(): void {
    this.activeSessionCount++
    if (this.activeSessionCount === 1) {
      this.sendPetEvent('CHAT_SENT')
    }
  }

  private cleanupSession(sessionId: string): void {
    this.firstResponseSent.delete(sessionId)
    this.activeSessionCount = Math.max(0, this.activeSessionCount - 1)
    if (this.activeSessionCount === 0) {
      this.sendPetEvent('AI_DONE')
    }
  }

  private sendPetEvent(event: string): void {
    this.petWindow.webContents.send('pet:state-event', { event })
  }

  private sendBubble(text: string, source: string): void {
    this.petWindow.webContents.send('pet:bubble', { text, source })
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
cd petclaw-desktop && git add src/main/pet/pet-event-bridge.ts
git commit -m "feat(pet): extend PetEventBridge with IM, scheduler, and hook event sources"
```

---

## Task 7: Scheduler IPC + IM IPC handlers

**Files:**
- Create: `src/main/ipc/scheduler-ipc.ts`
- Create: `src/main/ipc/im-ipc.ts`
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 1: 创建 scheduler-ipc.ts**

```typescript
// src/main/ipc/scheduler-ipc.ts
import { ipcMain } from 'electron'

import type { CronJobService } from '../scheduler/cron-job-service'
import type { ScheduledTaskInput } from '../scheduler/types'
import { SchedulerIpcChannel } from '../scheduler/types'

export interface SchedulerIpcDeps {
  cronJobService: CronJobService
}

export function registerSchedulerIpcHandlers(deps: SchedulerIpcDeps): void {
  const { cronJobService } = deps

  ipcMain.handle(SchedulerIpcChannel.List, async () => {
    return cronJobService.listJobs()
  })

  ipcMain.handle(SchedulerIpcChannel.Create, async (_event, input: ScheduledTaskInput) => {
    return cronJobService.addJob(input)
  })

  ipcMain.handle(
    SchedulerIpcChannel.Update,
    async (_event, id: string, input: Partial<ScheduledTaskInput>) => {
      return cronJobService.updateJob(id, input)
    }
  )

  ipcMain.handle(SchedulerIpcChannel.Delete, async (_event, id: string) => {
    return cronJobService.removeJob(id)
  })

  ipcMain.handle(SchedulerIpcChannel.Toggle, async (_event, id: string, enabled: boolean) => {
    return cronJobService.toggleJob(id, enabled)
  })

  ipcMain.handle(SchedulerIpcChannel.RunManually, async (_event, id: string) => {
    return cronJobService.runJob(id)
  })

  ipcMain.handle(
    SchedulerIpcChannel.ListRuns,
    async (_event, jobId: string, limit?: number, offset?: number) => {
      return cronJobService.listRuns(jobId, limit, offset)
    }
  )

  ipcMain.handle(
    SchedulerIpcChannel.ListAllRuns,
    async (_event, limit?: number, offset?: number) => {
      return cronJobService.listAllRuns(limit, offset)
    }
  )
}
```

- [ ] **Step 2: 创建 im-ipc.ts**

```typescript
// src/main/ipc/im-ipc.ts
import { ipcMain } from 'electron'

import type { ImGatewayManager } from '../im/im-gateway-manager'
import type { IMPlatformConfig, IMSettings } from '../im/types'
import { ImIpcChannel } from '../im/types'

export interface ImIpcDeps {
  imGatewayManager: ImGatewayManager
}

export function registerImIpcHandlers(deps: ImIpcDeps): void {
  const { imGatewayManager } = deps

  ipcMain.handle(ImIpcChannel.LoadConfig, async () => {
    return {
      platforms: imGatewayManager.listPlatformConfigs(),
      settings: imGatewayManager.loadSettings()
    }
  })

  ipcMain.handle(
    ImIpcChannel.SaveConfig,
    async (_event, key: string, config: IMPlatformConfig) => {
      imGatewayManager.savePlatformConfig(key, config)
    }
  )

  ipcMain.handle(ImIpcChannel.GetStatus, async () => {
    // 状态由 OpenClaw 插件管理，PetClaw 端返回配置中的 enabled 状态
    const platforms = imGatewayManager.listPlatformConfigs()
    const result: Record<string, { enabled: boolean }> = {}
    for (const { key, config } of platforms) {
      result[key] = { enabled: config.enabled }
    }
    return result
  })

  // IM 全局设置
  ipcMain.handle('im:load-settings', async () => {
    return imGatewayManager.loadSettings()
  })

  ipcMain.handle('im:save-settings', async (_event, settings: IMSettings) => {
    imGatewayManager.saveSettings(settings)
  })
}
```

- [ ] **Step 3: 更新 ipc/index.ts 注册新模块**

在 `src/main/ipc/index.ts` 中添加导入和注册：

读取现有 `src/main/ipc/index.ts`，在已有的 import 和 register 调用后追加：

```typescript
import { registerSchedulerIpcHandlers, type SchedulerIpcDeps } from './scheduler-ipc'
import { registerImIpcHandlers, type ImIpcDeps } from './im-ipc'

// 在 AllIpcDeps 接口中追加：
// extends ... SchedulerIpcDeps, ImIpcDeps

// 在 registerAllIpcHandlers 函数中追加：
// registerSchedulerIpcHandlers(deps)
// registerImIpcHandlers(deps)
```

注意：需要先读取 `src/main/ipc/index.ts` 的具体内容来确定精确的编辑位置。

- [ ] **Step 4: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 5: 提交**

```bash
cd petclaw-desktop && git add src/main/ipc/scheduler-ipc.ts src/main/ipc/im-ipc.ts src/main/ipc/index.ts
git commit -m "feat(ipc): add scheduler and IM IPC handler modules"
```

---

## Task 8: Preload + 类型定义更新

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: 在 preload/index.ts 中新增 scheduler 和 im channels**

在已有的 `memory` 对象之后追加：

```typescript
  // ── v3 Phase 3: Scheduler ──
  scheduler: {
    list: () => ipcRenderer.invoke('scheduler:list'),
    create: (input: unknown) => ipcRenderer.invoke('scheduler:create', input),
    update: (id: string, input: unknown) => ipcRenderer.invoke('scheduler:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('scheduler:delete', id),
    toggle: (id: string, enabled: boolean) => ipcRenderer.invoke('scheduler:toggle', id, enabled),
    runManually: (id: string) => ipcRenderer.invoke('scheduler:run-manually', id),
    listRuns: (jobId: string, limit?: number, offset?: number) =>
      ipcRenderer.invoke('scheduler:list-runs', jobId, limit, offset),
    listAllRuns: (limit?: number, offset?: number) =>
      ipcRenderer.invoke('scheduler:list-all-runs', limit, offset),
    onStatusUpdate: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('scheduler:status-update', handler)
      return () => ipcRenderer.removeListener('scheduler:status-update', handler)
    },
    onRefresh: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('scheduler:refresh', handler)
      return () => ipcRenderer.removeListener('scheduler:refresh', handler)
    }
  },

  // ── v3 Phase 3: IM ──
  im: {
    loadConfig: () => ipcRenderer.invoke('im:load-config'),
    saveConfig: (key: string, config: unknown) =>
      ipcRenderer.invoke('im:save-config', key, config),
    getStatus: () => ipcRenderer.invoke('im:get-status'),
    loadSettings: () => ipcRenderer.invoke('im:load-settings'),
    saveSettings: (settings: unknown) => ipcRenderer.invoke('im:save-settings', settings),
    onStatusUpdate: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('im:status-update', handler)
      return () => ipcRenderer.removeListener('im:status-update', handler)
    }
  }
```

- [ ] **Step 2: 同步更新 preload/index.d.ts**

在 `ElectronAPI` 接口中追加对应的 `scheduler` 和 `im` 类型声明。

- [ ] **Step 3: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 4: 提交**

```bash
cd petclaw-desktop && git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(preload): add scheduler and IM IPC channels for Phase 3"
```

---

## Task 9: 主进程启动流程集成

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 在 index.ts 中初始化 CronJobService 和 ImGatewayManager**

在现有 Manager 初始化块（`// 4. Phase 2: Manager 初始化`）之后，`// 5. ConfigSync 初始化` 之前，添加：

```typescript
  // Phase 3: 集成功能初始化
  const { ImGatewayManager } = await import('./im/im-gateway-manager')
  const imGatewayManager = new ImGatewayManager(db)
```

在 `initializeRuntimeServices` 函数中（Gateway 连接成功后），创建 CronJobService：

```typescript
  // Phase 3: CronJobService — 定时任务 Gateway RPC 代理
  const { CronJobService } = await import('./scheduler/cron-job-service')
  cronJobService = new CronJobService({
    getGatewayClient: () => gateway?.getClient() ?? null,
    ensureGatewayReady: async () => { /* gateway should already be ready */ }
  })
  cronJobService.startPolling()
```

在 `registerAllIpcHandlers` 调用中追加新的依赖：

```typescript
  registerAllIpcHandlers({
    // ...existing deps...
    cronJobService: cronJobService!,
    imGatewayManager
  })
```

在 PetEventBridge 创建中传入新参数：

```typescript
  petEventBridge = new PetEventBridge(
    petWindow,
    coworkController,
    imGatewayManager,
    cronJobService ?? undefined,
    hookServer
  )
```

在 `app.on('before-quit')` 中停止 CronJobService：

```typescript
  cronJobService?.stopPolling()
```

- [ ] **Step 2: 添加模块级变量声明**

在文件顶部（现有变量声明区域）添加：

```typescript
import type { CronJobService } from './scheduler/cron-job-service'
import type { ImGatewayManager } from './im/im-gateway-manager'

let cronJobService: CronJobService | null = null
let imGatewayManager: ImGatewayManager
```

- [ ] **Step 3: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 4: 提交**

```bash
cd petclaw-desktop && git add src/main/index.ts
git commit -m "feat(startup): integrate CronJobService and ImGatewayManager into boot sequence"
```

---

## Task 10: CoworkPermissionModal — Exec Approval 审批弹窗

**Files:**
- Create: `src/renderer/src/chat/components/CoworkPermissionModal.tsx`
- Modify: `src/renderer/src/chat/components/ChatView.tsx`

参考 LobsterAI `CoworkPermissionModal.tsx`，实现三种模式：标准工具审批、确认模式、多选模式。

- [ ] **Step 1: 创建 CoworkPermissionModal.tsx**

```tsx
// src/renderer/src/chat/components/CoworkPermissionModal.tsx
import { useState } from 'react'
import { ShieldAlert, ShieldCheck, ShieldX, X } from 'lucide-react'

type DangerLevel = 'safe' | 'caution' | 'destructive'

interface PermissionRequest {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId?: string | null
}

interface PermissionResult {
  behavior: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  message?: string
}

interface CoworkPermissionModalProps {
  permission: PermissionRequest
  onRespond: (result: PermissionResult) => void
}

// 危险命令检测
function detectDangerLevel(toolName: string, toolInput: Record<string, unknown>): DangerLevel {
  // 优先读取 toolInput 中的 dangerLevel
  if (toolInput.dangerLevel === 'destructive') return 'destructive'
  if (toolInput.dangerLevel === 'caution') return 'caution'

  const command = String(toolInput.command ?? toolInput.input ?? '')

  const destructivePatterns = [
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|--recursive)\b/i,
    /\bgit\s+push\s+.*--force\b/i,
    /\bgit\s+reset\s+--hard\b/i
  ]
  if (destructivePatterns.some((p) => p.test(command))) return 'destructive'

  const cautionPatterns = [
    /\b(rm|rmdir|del|trash)\b/i,
    /\bgit\s+push\b/i,
    /\b(kill|killall|pkill)\b/i,
    /\b(chmod|chown)\b/i,
    /\bsudo\b/i
  ]
  if (cautionPatterns.some((p) => p.test(command))) return 'caution'

  return 'safe'
}

// 判断是否为 AskUserQuestion 确认模式（单问题 + 2选项 + 非多选）
function isConfirmMode(toolInput: Record<string, unknown>): boolean {
  const questions = toolInput.questions as Array<Record<string, unknown>> | undefined
  if (!questions || questions.length !== 1) return false
  const q = questions[0]
  const options = q.options as unknown[] | undefined
  return options?.length === 2 && q.multiSelect !== true
}

// 判断是否为 AskUserQuestion 多选模式
function isMultiQuestionMode(toolInput: Record<string, unknown>): boolean {
  if (toolInput.questions && !isConfirmMode(toolInput)) return true
  return false
}

const DANGER_STYLES: Record<DangerLevel, { bg: string; border: string; icon: typeof ShieldAlert }> = {
  safe: { bg: 'bg-green-50', border: 'border-green-200', icon: ShieldCheck },
  caution: { bg: 'bg-yellow-50', border: 'border-yellow-200', icon: ShieldAlert },
  destructive: { bg: 'bg-red-50', border: 'border-red-200', icon: ShieldX }
}

export function CoworkPermissionModal({ permission, onRespond }: CoworkPermissionModalProps) {
  const { toolName, toolInput } = permission

  // AskUserQuestion 确认模式
  if (toolName === 'AskUserQuestion' && isConfirmMode(toolInput)) {
    return (
      <ConfirmModeModal
        toolInput={toolInput}
        onRespond={onRespond}
      />
    )
  }

  // AskUserQuestion 多选模式
  if (toolName === 'AskUserQuestion' && isMultiQuestionMode(toolInput)) {
    return (
      <MultiQuestionModal
        toolInput={toolInput}
        onRespond={onRespond}
      />
    )
  }

  // 标准工具审批模式
  const dangerLevel = detectDangerLevel(toolName, toolInput)
  const style = DANGER_STYLES[dangerLevel]
  const DangerIcon = style.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-root rounded-[14px] shadow-lg w-[480px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* 标题栏 */}
        <div className={`flex items-center gap-3 px-5 py-4 ${style.bg} border-b ${style.border}`}>
          <DangerIcon size={20} className={dangerLevel === 'safe' ? 'text-green-600' : dangerLevel === 'caution' ? 'text-yellow-600' : 'text-red-600'} />
          <span className="text-[14px] font-semibold text-text-primary">
            {dangerLevel === 'destructive' ? '危险操作' : dangerLevel === 'caution' ? '需要确认' : '工具调用'}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => onRespond({ behavior: 'deny', message: '用户取消' })}
            className="p-1 rounded-[8px] hover:bg-black/5 transition-colors"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-5 py-4 overflow-y-auto">
          <div className="mb-3">
            <span className="text-[12px] text-text-tertiary">工具名称</span>
            <div className="text-[14px] font-mono text-text-primary mt-1">{toolName}</div>
          </div>
          <div>
            <span className="text-[12px] text-text-tertiary">参数</span>
            <pre className="text-[12px] font-mono text-text-secondary mt-1 p-3 bg-bg-hover rounded-[10px] overflow-x-auto max-h-[200px]">
              {JSON.stringify(toolInput, null, 2)}
            </pre>
          </div>
        </div>

        {/* 按钮 */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={() => onRespond({ behavior: 'deny', message: '用户拒绝' })}
            className="px-4 py-2 text-[13px] rounded-[10px] bg-bg-hover text-text-secondary hover:bg-bg-active transition-colors active:scale-[0.96] duration-[120ms]"
          >
            拒绝
          </button>
          <button
            onClick={() => onRespond({ behavior: 'allow' })}
            className={`px-4 py-2 text-[13px] rounded-[10px] text-white transition-colors active:scale-[0.96] duration-[120ms] ${
              dangerLevel === 'destructive'
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-accent hover:bg-accent-hover'
            }`}
          >
            允许
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 确认模式子组件 ──

function ConfirmModeModal({
  toolInput,
  onRespond
}: {
  toolInput: Record<string, unknown>
  onRespond: (result: PermissionResult) => void
}) {
  const questions = toolInput.questions as Array<Record<string, unknown>>
  const q = questions[0]
  const options = q.options as Array<{ label: string; description?: string }>
  const questionText = String(q.question ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-root rounded-[14px] shadow-lg w-[420px] flex flex-col overflow-hidden">
        <div className="px-5 py-4">
          <p className="text-[14px] text-text-primary leading-[1.6]">{questionText}</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={() =>
              onRespond({
                behavior: 'allow',
                updatedInput: { ...toolInput, answers: { [questionText]: options[1].label } }
              })
            }
            className="px-4 py-2 text-[13px] rounded-[10px] bg-bg-hover text-text-secondary hover:bg-bg-active transition-colors active:scale-[0.96] duration-[120ms]"
          >
            {options[1].label}
          </button>
          <button
            onClick={() =>
              onRespond({
                behavior: 'allow',
                updatedInput: { ...toolInput, answers: { [questionText]: options[0].label } }
              })
            }
            className="px-4 py-2 text-[13px] rounded-[10px] bg-accent text-white hover:bg-accent-hover transition-colors active:scale-[0.96] duration-[120ms]"
          >
            {options[0].label}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 多选模式子组件 ──

function MultiQuestionModal({
  toolInput,
  onRespond
}: {
  toolInput: Record<string, unknown>
  onRespond: (result: PermissionResult) => void
}) {
  const questions = toolInput.questions as Array<Record<string, unknown>>
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const handleSubmit = () => {
    onRespond({
      behavior: 'allow',
      updatedInput: { ...toolInput, answers }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-root rounded-[14px] shadow-lg w-[500px] max-h-[80vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 overflow-y-auto flex-1">
          {questions.map((q, qi) => {
            const questionText = String(q.question ?? '')
            const options = q.options as Array<{ label: string; description?: string }>
            const isMulti = q.multiSelect === true
            const currentAnswer = answers[questionText] ?? ''
            const selectedSet = new Set(currentAnswer.split('|||').filter(Boolean))

            return (
              <div key={qi} className="mb-5">
                <p className="text-[14px] font-medium text-text-primary mb-2">{questionText}</p>
                <div className="space-y-1.5">
                  {options.map((opt) => {
                    const isSelected = isMulti
                      ? selectedSet.has(opt.label)
                      : currentAnswer === opt.label

                    return (
                      <button
                        key={opt.label}
                        onClick={() => {
                          if (isMulti) {
                            const next = new Set(selectedSet)
                            if (next.has(opt.label)) next.delete(opt.label)
                            else next.add(opt.label)
                            setAnswers((prev) => ({
                              ...prev,
                              [questionText]: Array.from(next).join('|||')
                            }))
                          } else {
                            setAnswers((prev) => ({
                              ...prev,
                              [questionText]: opt.label
                            }))
                          }
                        }}
                        className={`w-full text-left px-3 py-2 rounded-[10px] text-[13px] transition-colors duration-[120ms] ${
                          isSelected
                            ? 'bg-accent/10 text-accent border border-accent/30'
                            : 'bg-bg-hover text-text-secondary hover:bg-bg-active border border-transparent'
                        }`}
                      >
                        <span className="font-medium">{opt.label}</span>
                        {opt.description && (
                          <span className="text-text-tertiary ml-2">{opt.description}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={() => onRespond({ behavior: 'deny', message: '用户取消' })}
            className="px-4 py-2 text-[13px] rounded-[10px] bg-bg-hover text-text-secondary hover:bg-bg-active transition-colors active:scale-[0.96] duration-[120ms]"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-[13px] rounded-[10px] bg-accent text-white hover:bg-accent-hover transition-colors active:scale-[0.96] duration-[120ms]"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 在 ChatView.tsx 中集成权限审批事件**

在 `ChatView.tsx` 中新增 `permissionRequest` 事件监听和 `CoworkPermissionModal` 渲染：

```typescript
// 在 ChatView 组件中添加状态
const [pendingPermission, setPendingPermission] = useState<{
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId?: string | null
} | null>(null)

// 在 useEffect 中添加权限事件监听
const unsubPermission = window.api.cowork.onPermission((data) => {
  const d = data as { sessionId: string; request: typeof pendingPermission }
  if (d.request) {
    setPendingPermission(d.request)
  }
})

// 在 return 中渲染 CoworkPermissionModal
{pendingPermission && (
  <CoworkPermissionModal
    permission={pendingPermission}
    onRespond={(result) => {
      window.api.cowork.respondPermission(pendingPermission.requestId, result)
      setPendingPermission(null)
    }}
  />
)}
```

- [ ] **Step 3: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 4: 提交**

```bash
cd petclaw-desktop && git add src/renderer/src/chat/components/CoworkPermissionModal.tsx src/renderer/src/chat/components/ChatView.tsx
git commit -m "feat(ui): add CoworkPermissionModal with standard, confirm, and multi-question modes"
```

---

## Task 11: AgentConfigDialog — Agent 三 Tab 配置对话框

**Files:**
- Create: `src/renderer/src/chat/components/AgentConfigDialog.tsx`
- Create: `src/renderer/src/chat/components/AgentSkillSelector.tsx`
- Modify: `src/renderer/src/chat/components/settings/AgentSettings.tsx`

参考设计稿 `docs/设计/设置/agent配置.png`，实现三 Tab（基础信息/技能/IM 渠道）的 Agent 配置对话框。

**设计稿关键布局要求：**
- 标题栏：icon emoji + Agent 名称同行（如 `📈 股票助手`），右侧关闭按钮
- Tab 栏：`基础信息` | `技能` | `IM 渠道`，无图标纯文字
- 基础信息 Tab：名称字段 = icon 输入框(小) + 名称输入框(大) 同行；描述、系统提示词(textarea)、身份(IDENTITY.md textarea)、Agent 默认模型(下拉选择)
- 底部按钮：4 个 — 左侧「删除」(红色，仅编辑模式)，右侧「使用此 Agent」(边框按钮) + 「取消」+ 「保存」(实心按钮)
- IM 渠道 Tab：只显示 4 个平台（飞书/钉钉/微信/企微），已被其他 Agent 绑定的平台灰色不可选 + 显示 "→ AgentName"

- [ ] **Step 1: 创建 AgentSkillSelector.tsx**

```tsx
// src/renderer/src/chat/components/AgentSkillSelector.tsx
import { useState, useEffect } from 'react'
import { Check } from 'lucide-react'

interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
}

interface AgentSkillSelectorProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function AgentSkillSelector({ selectedIds, onChange }: AgentSkillSelectorProps) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    window.api.skills.list().then((list: unknown) => {
      setSkills(list as Skill[])
    })
  }, [])

  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
  )

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((sid) => sid !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索技能..."
        className="w-full px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
      <div className="max-h-[300px] overflow-y-auto space-y-1">
        {filtered.map((skill) => {
          const isSelected = selectedIds.includes(skill.id)
          return (
            <button
              key={skill.id}
              onClick={() => toggle(skill.id)}
              className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-[13px] transition-colors duration-[120ms] ${
                isSelected
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-[4px] border flex items-center justify-center shrink-0 ${
                  isSelected ? 'bg-accent border-accent' : 'border-border'
                }`}
              >
                {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-text-primary">{skill.name}</div>
                {skill.description && (
                  <div className="text-[12px] text-text-tertiary truncate">{skill.description}</div>
                )}
              </div>
            </button>
          )
        })}
      </div>
      <div className="text-[12px] text-text-tertiary">
        已选 {selectedIds.length} 个技能
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建 AgentConfigDialog.tsx**

按设计稿实现，核心布局差异（vs 旧方案）：
1. **标题栏**：`{icon} {name}` 同行显示，不用分两行
2. **名称字段**：icon 输入(60px) + name 输入(flex-1) 同行
3. **身份字段**：label 为 "身份"，placeholder 为 "身份描述（IDENTITY.md）..."，用 textarea
4. **模型字段**：label 为 "Agent 默认模型"，用 `<select>` 下拉选择（从 `window.api.models.list()` 加载可用模型）
5. **底部按钮**：左对齐「删除」(红色，带 Trash2 图标，仅 agentId 存在时显示)，右对齐「使用此 Agent」(边框按钮) + 「取消」+ 「保存」(实心按钮)
6. **IM 渠道 Tab**：只列出 4 个平台（飞书/钉钉/微信/企微），每个平台行显示 icon + 名称 + checkbox；已被其他 Agent 绑定的平台 disabled + 灰色 + 右侧显示 "→ {boundAgentName}"

```tsx
// src/renderer/src/chat/components/AgentConfigDialog.tsx
import { useState, useEffect, useCallback } from 'react'
import { X, Trash2 } from 'lucide-react'

import { AgentSkillSelector } from './AgentSkillSelector'

type ConfigTab = 'basic' | 'skills' | 'im'

interface Agent {
  id: string
  name: string
  description: string
  systemPrompt: string
  identity: string
  model: string
  icon: string
  skillIds: string[]
  isDefault: boolean
  source: 'preset' | 'custom'
}

// 4 个 IM 平台（Phase 3 范围）
const IM_PLATFORMS = [
  { key: 'feishu', name: '飞书', icon: '🐦' },
  { key: 'dingtalk', name: '钉钉', icon: '📌' },
  { key: 'wechat', name: '微信', icon: '💬' },
  { key: 'wecom', name: '企业微信', icon: '🏢' }
] as const

interface AgentConfigDialogProps {
  isOpen: boolean
  agentId: string | null // null = 创建新 Agent
  onClose: () => void
  onSaved: () => void
  onUseAgent?: (agentId: string) => void // "使用此 Agent" 回调
}

export function AgentConfigDialog({ isOpen, agentId, onClose, onSaved, onUseAgent }: AgentConfigDialogProps) {
  const [activeTab, setActiveTab] = useState<ConfigTab>('basic')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // 表单状态
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [identity, setIdentity] = useState('')
  const [model, setModel] = useState('')
  const [icon, setIcon] = useState('')
  const [skillIds, setSkillIds] = useState<string[]>([])

  // IM 绑定状态
  const [platformBindings, setPlatformBindings] = useState<Record<string, boolean>>({})
  // 所有平台的当前绑定情况（用于显示已被占用的平台）
  const [allBindings, setAllBindings] = useState<Record<string, string>>({})
  // Agent 列表（用于显示绑定的 Agent 名称）
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([])
  // 可用模型列表
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([])

  // 加载已有 Agent 数据
  useEffect(() => {
    if (!isOpen) return
    setActiveTab('basic')

    // 加载 Agent 列表和模型列表
    window.api.agents.list().then((list: unknown) => {
      setAgents(list as Array<{ id: string; name: string }>)
    })
    window.api.models?.list?.().then?.((list: unknown) => {
      if (Array.isArray(list)) setAvailableModels(list as Array<{ id: string; name: string }>)
    })

    // 加载全局 IM 绑定状态
    window.api.im.loadSettings().then((settings: unknown) => {
      const s = settings as { platformAgentBindings?: Record<string, string> }
      const bindings = s.platformAgentBindings ?? {}
      setAllBindings(bindings)
      // 提取当前 Agent 的绑定
      const myBindings: Record<string, boolean> = {}
      for (const [key, boundAgent] of Object.entries(bindings)) {
        myBindings[key] = boundAgent === agentId
      }
      setPlatformBindings(myBindings)
    })

    if (agentId) {
      window.api.agents.get(agentId).then((agent: unknown) => {
        const a = agent as Agent
        if (a) {
          setName(a.name)
          setDescription(a.description)
          setSystemPrompt(a.systemPrompt)
          setIdentity(a.identity)
          setModel(a.model)
          setIcon(a.icon)
          setSkillIds(a.skillIds)
        }
      })
    } else {
      setName('')
      setDescription('')
      setSystemPrompt('')
      setIdentity('')
      setModel('')
      setIcon('')
      setSkillIds([])
      setPlatformBindings({})
    }
  }, [isOpen, agentId])

  const handleSave = useCallback(async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      let savedId = agentId
      if (agentId) {
        await window.api.agents.update(agentId, {
          name, description, systemPrompt, identity, model, icon, skillIds
        })
      } else {
        const result = await window.api.agents.create({
          name, description, systemPrompt, identity, model, icon, skillIds
        })
        savedId = (result as { id: string }).id
      }

      // 保存 IM 绑定（互斥规则：同一平台只能绑一个 Agent）
      const currentSettings = (await window.api.im.loadSettings()) as {
        systemPrompt?: string
        skillsEnabled?: boolean
        platformAgentBindings?: Record<string, string>
      }
      const bindings = { ...currentSettings.platformAgentBindings }
      for (const [key, isBound] of Object.entries(platformBindings)) {
        if (isBound && savedId) {
          bindings[key] = savedId
        } else if (!isBound && bindings[key] === savedId) {
          delete bindings[key]
        }
      }
      await window.api.im.saveSettings({
        ...currentSettings,
        platformAgentBindings: bindings
      })

      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }, [name, description, systemPrompt, identity, model, icon, skillIds, platformBindings, agentId, onSaved, onClose])

  const handleDelete = useCallback(async () => {
    if (!agentId) return
    setDeleting(true)
    try {
      await window.api.agents.delete(agentId)
      onSaved()
      onClose()
    } finally {
      setDeleting(false)
    }
  }, [agentId, onSaved, onClose])

  if (!isOpen) return null

  const TABS: Array<{ id: ConfigTab; label: string }> = [
    { id: 'basic', label: '基础信息' },
    { id: 'skills', label: '技能' },
    { id: 'im', label: 'IM 渠道' }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-root rounded-[14px] shadow-lg w-[560px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* 标题栏：icon + name 同行 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            {icon && <span className="text-[20px]">{icon}</span>}
            <h2 className="text-[15px] font-semibold text-text-primary">
              {agentId ? (name || '编辑 Agent') : '创建 Agent'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-[8px] hover:bg-bg-hover transition-colors"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        {/* Tab 栏：纯文字，无图标 */}
        <div className="flex gap-4 px-5 pt-3 border-b border-border">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`pb-2.5 text-[13px] transition-colors duration-[120ms] border-b-2 ${
                activeTab === id
                  ? 'text-text-primary font-medium border-accent'
                  : 'text-text-tertiary hover:text-text-secondary border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'basic' && (
            <div className="space-y-4">
              {/* 名称：icon + name 同行 */}
              <Field label="名称" required>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    placeholder="🤖"
                    className="w-[52px] px-2 py-2 text-[16px] text-center rounded-[10px] bg-bg-hover border border-border focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="给 Agent 起个名字"
                    className="flex-1 px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                </div>
              </Field>
              <Field label="描述">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="简要描述这个 Agent 的用途"
                  className="w-full px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary resize-none focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              </Field>
              <Field label="系统提示词">
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={5}
                  placeholder="定义 Agent 的行为和个性..."
                  className="w-full px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary resize-none focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              </Field>
              <Field label="身份">
                <textarea
                  value={identity}
                  onChange={(e) => setIdentity(e.target.value)}
                  rows={3}
                  placeholder="身份描述（IDENTITY.md）..."
                  className="w-full px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary resize-none focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              </Field>
              <Field label="Agent 默认模型">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40"
                >
                  <option value="">使用全局默认模型</option>
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-text-tertiary mt-1">仅 OpenClaw 引擎使用此设置</p>
              </Field>
            </div>
          )}

          {activeTab === 'skills' && (
            <AgentSkillSelector selectedIds={skillIds} onChange={setSkillIds} />
          )}

          {activeTab === 'im' && (
            <div className="space-y-3">
              <p className="text-[13px] text-text-tertiary mb-4">
                选择此 Agent 接管哪些 IM 平台的消息。每个平台同一时间只能被一个 Agent 持有。
              </p>
              {IM_PLATFORMS.map(({ key, name: platformName, icon: platformIcon }) => {
                const isBoundToMe = platformBindings[key] ?? false
                const boundToOther = allBindings[key] && allBindings[key] !== agentId
                const boundAgentName = boundToOther
                  ? agents.find((a) => a.id === allBindings[key])?.name ?? allBindings[key]
                  : null

                return (
                  <label
                    key={key}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] transition-colors ${
                      boundToOther
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-bg-hover cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isBoundToMe}
                      disabled={!!boundToOther}
                      onChange={(e) =>
                        setPlatformBindings((prev) => ({
                          ...prev,
                          [key]: e.target.checked
                        }))
                      }
                      className="rounded"
                    />
                    <span className="text-[15px]">{platformIcon}</span>
                    <span className="text-[13px] text-text-primary flex-1">{platformName}</span>
                    {boundToOther && (
                      <span className="text-[12px] text-text-tertiary">→ {boundAgentName}</span>
                    )}
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {/* 底部按钮：左侧删除 + 右侧 使用此Agent/取消/保存 */}
        <div className="flex items-center px-5 py-4 border-t border-border">
          {/* 左侧：删除按钮（仅编辑模式） */}
          {agentId && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-red-500 hover:text-red-600 hover:bg-red-50 rounded-[10px] transition-colors active:scale-[0.96] duration-[120ms]"
            >
              <Trash2 size={14} />
              删除
            </button>
          )}
          <div className="flex-1" />
          {/* 右侧按钮组 */}
          {agentId && onUseAgent && (
            <button
              onClick={() => onUseAgent(agentId)}
              className="px-4 py-2 text-[13px] rounded-[10px] border border-accent text-accent hover:bg-accent/5 transition-colors active:scale-[0.96] duration-[120ms] mr-2"
            >
              使用此 Agent
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] rounded-[10px] text-text-secondary hover:bg-bg-hover transition-colors active:scale-[0.96] duration-[120ms] mr-2"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-4 py-2 text-[13px] rounded-[10px] bg-accent text-white hover:bg-accent-hover transition-colors active:scale-[0.96] duration-[120ms] disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Field 子组件 ──

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] text-text-tertiary mb-1.5">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}
```

- [ ] **Step 3: 在 AgentSettings.tsx 中集成 AgentConfigDialog**

在现有的 `AgentSettings.tsx` 中导入并使用 `AgentConfigDialog`，添加「创建新 Agent」和「编辑 Agent」按钮触发对话框。

- [ ] **Step 4: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 5: 提交**

```bash
cd petclaw-desktop && git add src/renderer/src/chat/components/AgentConfigDialog.tsx src/renderer/src/chat/components/AgentSkillSelector.tsx src/renderer/src/chat/components/settings/AgentSettings.tsx
git commit -m "feat(ui): add AgentConfigDialog with basic/skills/IM tabs and 4-button layout"
```

---

## Task 12: CronPage — 定时任务管理 UI

**Files:**
- Modify: `src/renderer/src/chat/components/CronPage.tsx`
- Create: `src/renderer/src/chat/components/CronEditDialog.tsx`

替换占位页面为完整的定时任务管理 UI。参考设计稿 `docs/设计/定时任务/` 目录下的 4 张截图。

**设计稿关键布局要求：**

### CronPage 主视图（参考 xw_20260423210354.png）
- 顶部：拖拽区 + 右侧「通过 QoderWork 创建」按钮（ghost） + 「新建定时任务」按钮（实心黑）
- 标题区：「定时任务」标题 + 副标题描述
- 信息条：蓝色 info banner「定时任务仅在电脑保持唤醒时运行」+ 右侧「保持系统唤醒」开关
- 两个 Tab：「我的定时任务」|「执行记录」
- **我的定时任务 Tab**：两栏卡片网格（`grid grid-cols-2 gap-4`），每个卡片包含：
  - 左侧圆形 checkbox（切换启用/禁用）
  - 标题（加粗）
  - 描述（灰色小字，2-3 行）
  - 底部：时间描述（如 `每周一 18:00`、`每天 09:30`、`工作日 12:30`），带时钟图标
  - 右上角更多菜单（⋯）：编辑 / 手动执行 / 删除
- **执行记录 Tab**（参考 xw_20260423210454.png）：
  - 时间范围筛选：「按天」|「按周」|「按月」pill 切换
  - 任务筛选下拉：「全部任务」
  - 状态筛选下拉：「全部状态」
  - 空状态：Clock 图标 + "暂无执行记录" + "当定时任务开始执行后，记录将显示在这里"
  - 有记录时：列表每行显示 任务名 | 执行时间 | 状态标签 | 耗时

### CronEditDialog 创建/编辑弹窗（参考 xw_20260423210414.png + xw_20260423210510.png）
- 标题：「新建定时任务」或「编辑任务」+ 副标题描述
- 字段布局：
  1. **任务名称**：单行 input
  2. **计划时间**：频率下拉（每天/每周/每月/自定义 Cron）+ 时间 input（09:00 格式）+ 时钟图标
  3. **星期选择器**（仅「每周」模式显示）：7 个圆形 pill 按钮（一 二 三 四 五 六 日），可多选，选中为实心黑
  4. **Prompt textarea**：标题 "让 QoderWork 帮你做什么..."，大文本框(6+ 行)
  5. **Prompt 工具栏**：底部一行 — 「选择工作目录」按钮 + 日历图标 + 附件图标 + 右侧「标准 ↓」模式选择器
- 底部按钮：「取消」+「保存」（实心黑/accent）

- [ ] **Step 1: 创建 CronEditDialog.tsx**

```tsx
// src/renderer/src/chat/components/CronEditDialog.tsx
import { useState, useEffect } from 'react'
import { X, Clock, FolderOpen, Calendar, Paperclip, ChevronDown } from 'lucide-react'

type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'custom'

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
// cron 星期值：1=Mon ... 7=Sun
const WEEKDAY_CRON_VALUES = [1, 2, 3, 4, 5, 6, 0]

interface CronEditDialogProps {
  isOpen: boolean
  taskId: string | null // null = 创建新任务
  initialData?: {
    name: string
    schedule: { kind: string; expr?: string }
    payload: { message: string }
  }
  onClose: () => void
  onSaved: () => void
}

export function CronEditDialog({ isOpen, taskId, initialData, onClose, onSaved }: CronEditDialogProps) {
  const [name, setName] = useState('')
  const [frequency, setFrequency] = useState<ScheduleFrequency>('daily')
  const [time, setTime] = useState('09:00')
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([1]) // 默认周一
  const [prompt, setPrompt] = useState('')
  const [cwd, setCwd] = useState('')
  const [customCron, setCustomCron] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    if (initialData) {
      setName(initialData.name)
      setPrompt(initialData.payload.message)
      // 解析 schedule → frequency/time/weekdays
      if (initialData.schedule.kind === 'cron' && initialData.schedule.expr) {
        parseCronExpr(initialData.schedule.expr)
      }
    } else {
      setName('')
      setFrequency('daily')
      setTime('09:00')
      setSelectedWeekdays([1])
      setPrompt('')
      setCwd('')
      setCustomCron('')
    }
  }, [isOpen, initialData])

  const parseCronExpr = (expr: string) => {
    const parts = expr.split(/\s+/)
    if (parts.length < 5) return
    const [minute, hour, _dom, _month, dow] = parts
    setTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`)
    if (dow === '*') {
      setFrequency('daily')
    } else if (dow === '1-5') {
      setFrequency('weekly')
      setSelectedWeekdays([1, 2, 3, 4, 5])
    } else {
      setFrequency('weekly')
      setSelectedWeekdays(dow.split(',').map(Number))
    }
  }

  const buildCronExpr = (): string => {
    if (frequency === 'custom') return customCron
    const [h, m] = time.split(':')
    if (frequency === 'daily') return `${parseInt(m)} ${parseInt(h)} * * *`
    if (frequency === 'weekly') {
      const days = selectedWeekdays.sort().join(',')
      return `${parseInt(m)} ${parseInt(h)} * * ${days}`
    }
    if (frequency === 'monthly') return `${parseInt(m)} ${parseInt(h)} 1 * *`
    return `${parseInt(m)} ${parseInt(h)} * * *`
  }

  const toggleWeekday = (dayValue: number) => {
    setSelectedWeekdays((prev) =>
      prev.includes(dayValue) ? prev.filter((d) => d !== dayValue) : [...prev, dayValue]
    )
  }

  const handleSave = async () => {
    if (!name.trim() || !prompt.trim()) return
    setSaving(true)
    try {
      const input = {
        name: name.trim(),
        enabled: true,
        schedule: { kind: 'cron' as const, expr: buildCronExpr() },
        sessionTarget: 'main' as const,
        wakeMode: 'always' as const,
        payload: { kind: 'agentTurn' as const, message: prompt.trim() }
      }
      if (taskId) {
        await window.api.scheduler.update(taskId, input)
      } else {
        await window.api.scheduler.create(input)
      }
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleSelectCwd = async () => {
    // 触发文件夹选择（需要 IPC 支持）
    // 暂用简单 prompt
    const dir = window.prompt('输入工作目录路径')
    if (dir) setCwd(dir)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-root rounded-[14px] shadow-lg w-[540px] max-h-[85vh] flex flex-col overflow-hidden">
        {/* 标题 */}
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <h2 className="text-[17px] font-semibold text-text-primary">
              {taskId ? '编辑任务' : '新建定时任务'}
            </h2>
            <p className="text-[13px] text-text-tertiary mt-1">
              按计划自动执行任务，也可随时手动触发。在任意对话中描述你想定期做的事，即可快速创建
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-[8px] hover:bg-bg-hover transition-colors shrink-0"
          >
            <X size={18} className="text-text-tertiary" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {/* 任务名称 */}
          <div className="mb-5">
            <label className="block text-[14px] font-medium text-text-primary mb-2">任务名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="描述你的任务"
              className="w-full px-4 py-3 text-[14px] rounded-[10px] bg-bg-root border border-border text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
          </div>

          {/* 计划时间 */}
          <div className="mb-5">
            <label className="block text-[14px] font-medium text-text-primary mb-2">计划时间</label>
            <div className="flex items-center gap-3">
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)}
                className="px-4 py-3 text-[14px] rounded-[10px] bg-bg-root border border-border text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40 min-w-[120px]"
              >
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
                <option value="custom">自定义 Cron</option>
              </select>

              {frequency !== 'custom' ? (
                <div className="relative">
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="px-4 py-3 pr-10 text-[14px] rounded-[10px] bg-bg-root border border-border text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                  <Clock
                    size={16}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
                  />
                </div>
              ) : (
                <input
                  type="text"
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  placeholder="0 9 * * 1-5"
                  className="flex-1 px-4 py-3 text-[14px] font-mono rounded-[10px] bg-bg-root border border-border text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              )}
            </div>

            {/* 星期选择器（仅每周模式） */}
            {frequency === 'weekly' && (
              <div className="flex items-center gap-2 mt-3">
                {WEEKDAY_LABELS.map((label, idx) => {
                  const cronValue = WEEKDAY_CRON_VALUES[idx]
                  const isActive = selectedWeekdays.includes(cronValue)
                  return (
                    <button
                      key={cronValue}
                      onClick={() => toggleWeekday(cronValue)}
                      className={`w-9 h-9 rounded-full text-[13px] font-medium transition-all duration-[120ms] active:scale-[0.96] ${
                        isActive
                          ? 'bg-text-primary text-white'
                          : 'bg-bg-hover text-text-secondary hover:bg-bg-active'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Prompt */}
          <div className="mb-4">
            <label className="block text-[14px] font-medium text-text-primary mb-2">
              让 QoderWork 帮你做什么...
            </label>
            <div className="border border-border rounded-[10px] overflow-hidden">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                placeholder="让 QoderWork 帮你做什么..."
                className="w-full px-4 py-3 text-[14px] text-text-primary bg-bg-root resize-none focus:outline-none placeholder:text-text-tertiary"
              />
              {/* 工具栏 */}
              <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-bg-root">
                <button
                  onClick={handleSelectCwd}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-[8px] transition-colors"
                >
                  <FolderOpen size={14} />
                  {cwd ? cwd.split('/').pop() : '选择工作目录'}
                </button>
                <button className="p-1.5 text-text-tertiary hover:text-text-secondary rounded-[6px] hover:bg-bg-hover transition-colors">
                  <Calendar size={16} />
                </button>
                <button className="p-1.5 text-text-tertiary hover:text-text-secondary rounded-[6px] hover:bg-bg-hover transition-colors">
                  <Paperclip size={16} />
                </button>
                <div className="flex-1" />
                <button className="flex items-center gap-1 px-2 py-1 text-[12px] text-text-tertiary hover:text-text-secondary rounded-[6px] hover:bg-bg-hover transition-colors">
                  <span>标准</span>
                  <ChevronDown size={12} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-[14px] text-text-secondary hover:text-text-primary transition-colors active:scale-[0.96] duration-[120ms]"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !prompt.trim() || saving}
            className="px-5 py-2.5 text-[14px] rounded-[10px] bg-text-primary text-white hover:opacity-90 transition-all active:scale-[0.96] duration-[120ms] disabled:opacity-40"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 重写 CronPage.tsx**

完整替换文件内容。按设计稿实现两栏卡片网格 + 两 Tab + 信息条。

关键实现要点：
1. **顶部按钮区**：拖拽区右侧两个按钮（通过 QoderWork 创建 ghost + 新建定时任务 实心）
2. **信息条**：蓝色 ℹ️ 背景 + "保持系统唤醒" 开关
3. **Tab 切换**：「我的定时任务」和「执行记录」，纯文字 tab，选中加粗+下划线
4. **任务卡片网格**：`grid grid-cols-2 gap-4`，每张卡片 `rounded-[14px] border border-border p-4`
5. **卡片内容**：圆形 checkbox(启用/禁用) + 标题 + 描述(最多3行 truncate) + 底部时间标签(Clock图标 + 时间描述)
6. **执行记录 Tab**：时间范围 pill 按钮（按天/按周/按月）+ 两个筛选下拉 + 表格列表或空状态
7. **空状态**：任务列表无数据时显示 Clock 图标 + "还没有定时任务" + 创建按钮
8. **实时更新**：订阅 `scheduler:status-update` 和 `scheduler:refresh` 事件

由于此文件代码量较大（约 500 行），subagent 实现时应参考设计稿截图和上述结构说明。使用 PetClaw 设计规范（圆角 `rounded-[10px]`/`rounded-[14px]`、`active:scale-[0.96]`、`duration-[120ms]`、lucide-react 图标、`text-text-primary/secondary/tertiary` token）。

- [ ] **Step 3: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 4: 提交**

```bash
cd petclaw-desktop && git add src/renderer/src/chat/components/CronPage.tsx src/renderer/src/chat/components/CronEditDialog.tsx
git commit -m "feat(ui): replace CronPage placeholder with full scheduler management UI"
```

---

## Task 13: ImChannelsPage + ImConfigDialog — IM 频道主视图 + 配置弹窗

**Files:**
- Create: `src/renderer/src/chat/components/ImChannelsPage.tsx`
- Create: `src/renderer/src/chat/components/ImConfigDialog.tsx`
- Modify: `src/renderer/src/chat/ChatApp.tsx` — 新增 ViewType `'im-channels'` + 路由
- Modify: `src/renderer/src/chat/components/Sidebar.tsx` — 新增 IM 频道导航项

参考设计稿 `docs/设计/IM/` 目录下的截图。IM 频道是**主内容区视图**（与 chat/skills/cron 同级），不在 Settings 页中。

**设计稿关键布局要求：**

### ImChannelsPage 主视图（参考 xw_20260423205953.png）
- 顶部拖拽区
- 标题：「IM 频道」+ 副标题 "配置 IM 频道，让 QoderWork 接收来自钉钉、飞书等平台的消息。频道配置信息仅存储在本地，不会上传到云端。"
- 信息条：绿色 ℹ️ 建议横幅 "建议授予'完全磁盘访问权限'..." + 右侧「前往设置」链接
- 平台列表：每行一个平台卡片
  - 左侧：平台 icon（彩色圆形）+ 平台名称 + 描述（灰色小字）
  - 右侧：状态标签（「已连接」绿色 badge）+ 「配置/管理」按钮 + toggle 开关 + 更多菜单（⋯）
  - 4 个平台：钉钉、飞书、微信、企业微信
- 点击「配置」按钮 → 打开 ImConfigDialog 弹窗

### ImConfigDialog 配置弹窗（参考 xw_20260423210030.png + xw_20260423210045.png）
- 标题：「IM 机器人」
- 两栏布局：
  - **左侧平台列表**（240px 宽）：平台 icon + 名称，可折叠展开多实例（如飞书下有 Feishu Bot 1-5）
    - 底部「+ 扫码创建机器人」按钮
    - 支持多实例的平台（飞书/钉钉/企微）可展开子列表
    - 选中项高亮
  - **右侧配置面板**（flex-1）：
    - 顶部：机器人名称 + 状态标签（未连接/已连接）
    - 「扫码创建机器人」大按钮（仅新建时显示）
    - "或 手动填写，粘贴已有机器人信息" 分割线
    - 配置字段（按平台不同）：
      - 飞书：App ID、App Secret、Domain（默认 feishu.cn）
      - 钉钉：App Key、App Secret
      - 微信：Account ID + 二维码扫描区
      - 企微：Corp ID、Agent ID、Secret
    - 「高级设置」折叠区
  - 底部：「取消」+「保存」按钮

- [ ] **Step 1: 创建 ImChannelsPage.tsx**

```tsx
// src/renderer/src/chat/components/ImChannelsPage.tsx
import { useState, useEffect } from 'react'
import { Settings2, ExternalLink, MoreHorizontal, Info } from 'lucide-react'

import { ImConfigDialog } from './ImConfigDialog'

// Phase 3 只支持 4 个平台
const PLATFORMS = [
  {
    key: 'dingtalk',
    name: '钉钉',
    icon: '📌',
    description: '通过钉钉机器人接收用户消息'
  },
  {
    key: 'feishu',
    name: '飞书',
    icon: '🐦',
    description: '通过飞书机器人接收用户消息'
  },
  {
    key: 'wechat',
    name: '微信',
    icon: '💬',
    description: '通过微信接收用户消息'
  },
  {
    key: 'wecom',
    name: '企业微信',
    icon: '🏢',
    description: '通过企业微信机器人接收用户消息'
  }
] as const

interface PlatformStatus {
  enabled: boolean
  connected?: boolean
}

export function ImChannelsPage() {
  const [statuses, setStatuses] = useState<Record<string, PlatformStatus>>({})
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)

  useEffect(() => {
    loadStatuses()
    const unsub = window.api.im.onStatusUpdate(() => loadStatuses())
    return unsub
  }, [])

  const loadStatuses = () => {
    window.api.im.getStatus().then((data: unknown) => {
      setStatuses(data as Record<string, PlatformStatus>)
    })
  }

  const handleToggle = async (key: string, enabled: boolean) => {
    const existing = await window.api.im.loadConfig()
    const platforms = (existing as { platforms: Array<{ key: string; config: Record<string, unknown> }> }).platforms
    const platform = platforms.find((p) => p.key === key)
    const config = platform?.config ?? {
      enabled: false,
      dmPolicy: 'open',
      groupPolicy: 'disabled',
      allowFrom: [],
      debug: false
    }
    await window.api.im.saveConfig(key, { ...config, enabled })
    loadStatuses()
  }

  const openConfig = (platformKey: string) => {
    setSelectedPlatform(platformKey)
    setConfigDialogOpen(true)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 拖拽区 */}
      <div className="drag-region h-[52px] shrink-0" />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[720px] mx-auto px-6 py-4">
          {/* 标题 */}
          <h1 className="text-[24px] font-bold text-text-primary mb-2">IM 频道</h1>
          <p className="text-[14px] text-text-tertiary mb-6 leading-[1.6]">
            配置 IM 频道，让 QoderWork 接收来自钉钉、飞书等平台的消息。
            频道配置信息仅存储在本地，不会上传到云端。
          </p>

          {/* 信息条 */}
          <div className="flex items-start gap-3 px-4 py-3 mb-6 bg-accent/5 border border-accent/15 rounded-[10px]">
            <Info size={16} className="text-accent shrink-0 mt-0.5" />
            <p className="text-[13px] text-text-secondary leading-[1.6] flex-1">
              建议授予「完全磁盘访问权限」，可避免系统使用过程中反复弹出文件访问确认，体验更流畅。
            </p>
            <button className="text-[13px] text-accent hover:underline shrink-0">
              前往设置
            </button>
          </div>

          {/* 平台列表 */}
          <div className="space-y-2">
            {PLATFORMS.map(({ key, name, icon, description }) => {
              const status = statuses[key]
              const enabled = status?.enabled ?? false
              const connected = status?.connected ?? false

              return (
                <div
                  key={key}
                  className="flex items-center gap-4 px-4 py-3.5 rounded-[14px] border border-border hover:border-text-tertiary/30 transition-colors"
                >
                  {/* 平台 icon */}
                  <div className="w-10 h-10 rounded-full bg-bg-hover flex items-center justify-center text-[20px] shrink-0">
                    {icon}
                  </div>

                  {/* 名称 + 描述 */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium text-text-primary">{name}</div>
                    <div className="text-[12px] text-text-tertiary mt-0.5">{description}</div>
                  </div>

                  {/* 状态 badge */}
                  {connected && (
                    <span className="px-2 py-0.5 text-[11px] font-medium text-green-600 bg-green-50 rounded-full">
                      已连接
                    </span>
                  )}

                  {/* 配置/管理按钮 */}
                  <button
                    onClick={() => openConfig(key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-text-secondary hover:text-text-primary bg-bg-hover hover:bg-bg-active rounded-[10px] transition-colors active:scale-[0.96] duration-[120ms]"
                  >
                    <Settings2 size={14} />
                    {connected ? '配置/管理' : '配置'}
                  </button>

                  {/* 开关 */}
                  <button
                    onClick={() => handleToggle(key, !enabled)}
                    className={`relative w-[36px] h-[20px] rounded-full transition-colors duration-200 ${
                      enabled ? 'bg-accent' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`absolute top-[2px] w-[16px] h-[16px] rounded-full bg-white shadow transition-transform duration-200 ${
                        enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
                      }`}
                    />
                  </button>

                  {/* 更多菜单 */}
                  <button className="p-1.5 text-text-tertiary hover:text-text-secondary rounded-[8px] hover:bg-bg-hover transition-colors">
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* IM 配置弹窗 */}
      <ImConfigDialog
        isOpen={configDialogOpen}
        initialPlatform={selectedPlatform}
        onClose={() => setConfigDialogOpen(false)}
        onSaved={loadStatuses}
      />
    </div>
  )
}
```

- [ ] **Step 2: 创建 ImConfigDialog.tsx**

按设计稿实现两栏布局弹窗。左侧平台列表（可展开多实例）+ 右侧配置面板。

由于此文件代码量较大（约 350 行），subagent 实现时应参考：
- 设计稿 `docs/设计/IM/xw_20260423210030.png`（飞书配置面板）
- 设计稿 `docs/设计/IM/xw_20260423210045.png`（微信配置面板）
- LobsterAI 的 IM 配置对话框交互模式

核心结构：
1. **左侧平台列表**：4 个平台（飞书/钉钉/微信/企微），多实例平台点击展开子列表显示 "Bot 1/Bot 2..."，底部「+ 扫码创建机器人」
2. **右侧配置面板**：根据选中的平台显示不同字段：
   - 飞书：App ID + App Secret + Domain（默认 feishu.cn）
   - 钉钉：App Key + App Secret
   - 微信：Account ID + QR 扫码区
   - 企微：Corp ID + Agent ID + Secret
3. **保存时**：调用 `window.api.im.saveConfig(key, config)`，key 格式为 `'feishu'` 或 `'feishu:instance-uuid'`
4. **Secret 字段**：显示为 password type，有显示/隐藏切换

- [ ] **Step 3: 更新 ChatApp.tsx — 新增 ViewType + 路由**

在 `ChatApp.tsx` 中：
1. 扩展 `ViewType` 类型：`'chat' | 'skills' | 'cron' | 'im-channels' | 'settings'`
2. 在三栏布局的 main 区域追加路由：`{activeView === 'im-channels' && <ImChannelsPage />}`
3. 导入 `ImChannelsPage`

```typescript
// ChatApp.tsx 变更
export type ViewType = 'chat' | 'skills' | 'cron' | 'im-channels' | 'settings'

// 在 main 路由区域追加：
{activeView === 'im-channels' && <ImChannelsPage />}
```

- [ ] **Step 4: 更新 Sidebar.tsx — 新增 IM 频道导航项**

在 Sidebar 的功能导航区（技能/定时 按钮之后），新增 IM 频道按钮。参考设计稿中侧边栏的 "IM 频道" 项（在定时任务下方）。

```tsx
// 在 Sidebar.tsx 的功能导航区追加 IM 频道按钮
// 位置：在「定时」按钮之后，分隔线之前
<button
  onClick={() => onViewChange('im-channels')}
  title="IM 频道"
  className={`no-drag w-full flex items-center gap-2.5 px-3 py-[7px] rounded-[10px] text-[13px] transition-all duration-[120ms] ease active:scale-[0.96] ${
    activeView === 'im-channels'
      ? 'bg-bg-active text-text-primary font-medium'
      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
  }`}
>
  <MessageSquare size={14} strokeWidth={activeView === 'im-channels' ? 2 : 1.75} />
  <span>IM 频道</span>
</button>
```

注意：Sidebar 的 `onViewChange` 已支持 ViewType，只需扩展 ViewType 类型即可。导航布局参考设计稿——IM 频道独占一行（不和技能/定时并排），放在定时任务下方。

- [ ] **Step 5: 更新 preload 恢复 lastActiveTab 逻辑**

在 `ChatApp.tsx` 的 `useEffect` 中恢复 tab 时需要兼容新的 `'im-channels'` 值：

```typescript
// ChatApp.tsx 恢复 tab 逻辑更新
if (val === 'chat' || val === 'skills' || val === 'cron' || val === 'im-channels' || val === 'settings') {
  setActiveView(val as ViewType)
}
```

同理更新 `onPanelOpen` 的判断逻辑。

- [ ] **Step 6: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 7: 提交**

```bash
cd petclaw-desktop && git add src/renderer/src/chat/components/ImChannelsPage.tsx src/renderer/src/chat/components/ImConfigDialog.tsx src/renderer/src/chat/ChatApp.tsx src/renderer/src/chat/components/Sidebar.tsx
git commit -m "feat(ui): add ImChannelsPage main view and ImConfigDialog modal"
```

---

## Task 14: Onboarding 扩展 — AI 对话 + 推荐 Skills + StarterCards

**Files:**
- Modify: `src/renderer/src/panels/OnboardingPanel.tsx`

当前 OnboardingPanel 是 5 步向导。Phase 3 扩展：在最后一步之前插入「AI 推荐技能」步骤，完成后展示 StarterCards。

- [ ] **Step 1: 扩展 OnboardingPanel**

在现有的 OnboardingPanel 中添加：

1. **Step 5（新增）: 推荐技能**
   - 调用 `window.api.skills.list()` 获取技能列表
   - 展示推荐技能网格（前 6 个），每个显示名称+描述+启用开关
   - 「全部启用」和「跳过」按钮

2. **Step 6（新增）: StarterCards**
   - 3-4 个快捷任务卡片（如「帮我写一封邮件」「生成今日新闻」「整理代码仓库」）
   - 点击卡片直接完成 onboarding 并发送首条消息
   - 「跳过，直接开始」按钮完成 onboarding

具体实现由 subagent 参考现有 OnboardingPanel 代码结构和 PetClaw 设计规范完成。

- [ ] **Step 2: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
cd petclaw-desktop && git add src/renderer/src/panels/OnboardingPanel.tsx
git commit -m "feat(onboarding): add skill recommendations and starter cards steps"
```

---

## Task 15: 全量测试 + 类型检查 + 文档同步

**Files:**
- Modify: `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md`
- Modify: `.ai/README.md`

- [ ] **Step 1: 运行全量类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`
Expected: 零错误

- [ ] **Step 2: 运行全量测试**

Run: `cd petclaw-desktop && npx vitest run`
Expected: 所有新测试通过，已有测试不回归

- [ ] **Step 3: 同步 v3 架构文档**

在 `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md` 的 §25 Phase 3 部分标记为「已实现」，更新实际文件路径和实现细节。

- [ ] **Step 4: 同步 .ai/README.md**

在 `.ai/README.md` 中追加 Phase 3 新增模块的说明（CronJobService、ImGatewayManager、PetEventBridge 多源扩展、CoworkPermissionModal、AgentConfigDialog）。

- [ ] **Step 5: 提交**

```bash
cd petclaw-desktop && git add docs/ .ai/
git commit -m "docs: update v3 spec and README for Phase 3 completion"
```

---

## Verification

### 手动验证
1. `cd petclaw-desktop && npx tsc --noEmit` — 类型检查通过
2. `npx vitest run` — 全量测试通过
3. 开发模式启动 `npm run dev`：
   - **CronPage**：两栏卡片网格展示定时任务列表，两个 Tab 切换正常
   - 创建定时任务弹窗：频率下拉 + 时间 + 星期选择器 + Prompt 工具栏
   - 手动执行 → 宠物 Thinking → Working → Happy → Idle
   - **IM 频道主视图**：4 个平台行（钉钉/飞书/微信/企微），状态/开关/配置按钮
   - IM 配置弹窗：左侧平台列表 + 右侧配置面板，保存后 ConfigSync 触发
   - **Exec Approval 弹窗**：标准工具审批 / 确认模式 / 多选模式 三种渲染
   - **Agent 配置对话框**：icon+名称同行，三 Tab 切换正常，底部 4 按钮（删除/使用此Agent/取消/保存）
   - Agent IM 绑定互斥：已被其他 Agent 绑定的平台灰色不可选 + 显示 "→ AgentName"
   - Settings → 定时任务：默认 Agent + 超时配置
   - **PetEventBridge**：多源事件正确驱动宠物动画
   - Onboarding：推荐技能步骤 + StarterCards 展示
   - **Sidebar**：IM 频道导航项正常工作，ViewType 路由正确

### 回归验证
- 宠物状态机 6 状态转换不变
- Phase 2 所有功能（Agent/Model/Skill/MCP/Memory）正常
- IPC channel 三处同步（ipc/*.ts + preload/index.ts + preload/index.d.ts）

### 关键检查点
- CronJobService 不维护本地 DB，完全委托 Gateway RPC
- IM 配置持久化到 `im_config` 表，非 `kv` 表
- IM 频道是主视图（ViewType `'im-channels'`），不在 Settings 页中
- IM 配置通过 ImConfigDialog 弹窗完成（从 ImChannelsPage 触发）
- IM 绑定互斥：一个平台实例同一时间只能被一个 Agent 持有
- main Agent 是 IM 消息的默认兜底，不需要显式绑定
- PetEventBridge 正确维护 `activeSessionCount`，多会话并行时不误触 AIDone
- CoworkPermissionModal 正确检测 AskUserQuestion 模式（确认 vs 多选）
- AgentConfigDialog 底部 4 按钮：删除(红色左对齐) + 使用此Agent(边框) + 取消 + 保存(实心)
- CronPage 两栏卡片网格 + 两 Tab（任务/执行记录）
- CronEditDialog 星期选择器仅在「每周」模式显示
