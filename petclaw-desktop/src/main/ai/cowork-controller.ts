import crypto from 'crypto'
import { EventEmitter } from 'events'

import type { OpenclawGateway } from './gateway'
import type {
  ChatEventPayload,
  AgentEventPayload,
  ApprovalRequestedPayload,
  ApprovalResolvedPayload
} from './gateway'
import type { CoworkStore } from '../data/cowork-store'
import type { ModelRegistry } from '../models/model-registry'
import type {
  ActiveTurn,
  CoworkContinueOptions,
  CoworkStartOptions,
  PermissionRequest,
  PermissionResult,
  CoworkMessage,
  TextStreamMode
} from './types'
import { buildSessionKey } from './types'
import { buildLocalTimeContext } from './managed-prompts'
import { isDeleteCommand, getCommandDangerLevel } from './command-safety'

// ── 常量 ──

const BRIDGE_MAX_MESSAGES = 20
const BRIDGE_MAX_MESSAGE_CHARS = 1200
const TURN_TIMEOUT_MS = 120_000 // 2 分钟客户端超时
const STOP_COOLDOWN_MS = 10_000 // 停止后 10s 冷却，忽略迟到的 gateway 事件
const TICK_TIMEOUT_MS = 90_000 // 3 个 tick 周期（30s）无响应 → 判定假死
const MESSAGE_UPDATE_THROTTLE_MS = 200
const STORE_UPDATE_THROTTLE_MS = 250
const LIFECYCLE_END_FALLBACK_MS = 3000
const LIFECYCLE_ERROR_FALLBACK_MS = 2000

// ── 辅助函数 ──

function truncateStr(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}...`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 后缀-前缀重叠计算：检测流式文本中的部分重叠（delta 拼接时去重）
export function computeSuffixPrefixOverlap(left: string, right: string): number {
  const leftProbe = left.slice(-256)
  const rightProbe = right.slice(0, 256)
  const maxOverlap = Math.min(leftProbe.length, rightProbe.length)
  for (let size = maxOverlap; size > 0; size--) {
    if (leftProbe.slice(-size) === rightProbe.slice(0, size)) return size
  }
  return 0
}

// 流式文本合并：snapshot（全量替换）vs delta（增量拼接）
// 支持 mode 感知的回退保护和重叠去重
export function mergeStreamingText(
  previous: string,
  incoming: string,
  mode: TextStreamMode
): { mergedText: string; mode: TextStreamMode } {
  if (!incoming) return { mergedText: previous, mode }
  if (!previous) return { mergedText: incoming, mode }
  if (incoming === previous) return { mergedText: previous, mode }

  // snapshot 模式：incoming 更短则保留 previous（回退保护）
  if (mode === 'snapshot') {
    if (previous.startsWith(incoming) && incoming.length < previous.length) {
      return { mergedText: previous, mode }
    }
    return { mergedText: incoming, mode }
  }

  // delta 模式：incoming 可能是全量快照（包含 previous）
  if (mode === 'delta') {
    if (incoming.startsWith(previous)) {
      return { mergedText: incoming, mode: 'snapshot' }
    }
    const overlap = computeSuffixPrefixOverlap(previous, incoming)
    return { mergedText: previous + incoming.slice(overlap), mode }
  }

  // unknown 模式：自动检测
  if (incoming.startsWith(previous)) return { mergedText: incoming, mode: 'snapshot' }
  if (previous.startsWith(incoming)) return { mergedText: previous, mode: 'snapshot' }
  if (incoming.includes(previous) && incoming.length > previous.length) {
    return { mergedText: incoming, mode: 'snapshot' }
  }
  const overlap = computeSuffixPrefixOverlap(previous, incoming)
  if (overlap > 0) {
    return { mergedText: previous + incoming.slice(overlap), mode: 'delta' }
  }
  return { mergedText: previous + incoming, mode: 'delta' }
}

// 递归提取 tool result 文本，支持 string/array/object 多种格式
export function extractToolText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    return payload
      .map((item) => extractToolText(item).trim())
      .filter(Boolean)
      .join('\n')
  }
  if (!isRecord(payload)) {
    if (payload === undefined || payload === null) return ''
    try {
      return JSON.stringify(payload, null, 2)
    } catch {
      return String(payload)
    }
  }
  // 优先级：text > output > stdout/stderr > content
  if (typeof payload.text === 'string' && payload.text.trim()) return payload.text
  if (typeof payload.output === 'string' && payload.output.trim()) return payload.output
  if (typeof payload.stdout === 'string' || typeof payload.stderr === 'string') {
    const chunks = [payload.stdout, payload.stderr]
      .filter((s) => typeof s === 'string' && s)
      .join('\n')
    if (chunks) return chunks
  }
  const content = payload.content
  if (typeof content === 'string' && content.trim()) return content
  if (Array.isArray(content)) {
    const chunks: string[] = []
    for (const item of content) {
      if (typeof item === 'string' && item.trim()) {
        chunks.push(item)
        continue
      }
      if (!isRecord(item)) continue
      if (typeof item.text === 'string' && item.text.trim()) {
        chunks.push(item.text)
        continue
      }
      if (typeof item.content === 'string' && item.content.trim()) {
        chunks.push(item.content)
      }
    }
    if (chunks.length > 0) return chunks.join('\n')
  }
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

// 递归提取 agent assistant stream 文本
// 支持 text/output_text/content/parts/candidates/response 嵌套结构
export function extractAssistantStreamText(payload: unknown): string {
  const collectTextChunks = (value: unknown): string[] => {
    if (typeof value === 'string') {
      return value.trim() ? [value.trim()] : []
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => collectTextChunks(item))
    }
    if (!isRecord(value)) return []
    const chunks: string[] = []
    if (typeof value.text === 'string' && value.text.trim()) chunks.push(value.text.trim())
    if (typeof value.output_text === 'string' && value.output_text.trim())
      chunks.push(value.output_text.trim())
    if (value.content !== undefined) chunks.push(...collectTextChunks(value.content))
    if (value.parts !== undefined) chunks.push(...collectTextChunks(value.parts))
    if (value.candidates !== undefined) chunks.push(...collectTextChunks(value.candidates))
    if (value.response !== undefined) chunks.push(...collectTextChunks(value.response))
    return chunks
  }
  return collectTextChunks(payload).join('\n').trim()
}

// 安全转换 tool args 为 Record
function toToolInputRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  if (value === undefined || value === null) return {}
  return { value }
}

// Controller 内部业务类型：tool 事件归一化后的结构（从 gateway 移入）
interface AgentToolData {
  toolCallId: string
  phase: 'start' | 'update' | 'result'
  name?: string
  args?: unknown
  result?: string
  isError?: boolean
  runId?: string
}

// runTurn 内部选项
interface RunTurnOptions {
  autoApprove?: boolean
  confirmationMode?: 'modal' | 'text'
  imageAttachments?: Array<{ name: string; mimeType: string; base64Data: string }>
  skillIds?: string[]
  skillPrompt?: string
  systemPrompt?: string
  selectedModel?: CoworkStartOptions['selectedModel']
}

export class CoworkController extends EventEmitter {
  // ── 核心状态 ──
  private activeTurns = new Map<string, ActiveTurn>()
  private pendingTurns = new Map<string, { resolve: () => void; reject: (err: Error) => void }>()

  // ── 映射表 ──
  private sessionIdBySessionKey = new Map<string, string>()
  private sessionIdByRunId = new Map<string, string>()

  // ── 幂等缓存 ──
  private lastPatchedModelBySession = new Map<string, string>()
  private lastSystemPromptBySession = new Map<string, string>()

  // ── 防护状态 ──
  private stoppedSessions = new Map<string, number>()
  private manuallyStoppedSessions = new Set<string>()
  private latestTurnTokenBySession = new Map<string, number>()
  private terminatedRunIds = new Set<string>()

  // ── 序列号去重 ──
  private lastChatSeqByRunId = new Map<string, number>()
  private lastAgentSeqByRunId = new Map<string, number>()

  // ── confirmationMode 记忆 ──
  private confirmationModeBySession = new Map<string, 'modal' | 'text'>()

  // ── Prompt 注入 ──
  private bridgedSessions = new Set<string>()

  // ── pending agent event queue（race condition 防护）──
  private pendingAgentEventsByRunId = new Map<string, AgentEventPayload[]>()

  // ── pending approvals 追踪 ──
  // Map: requestId → {sessionId, allowAlways?}，用于 respondToPermission 时查找 decision 策略
  private pendingApprovals = new Map<
    string,
    { requestId: string; sessionId: string; allowAlways?: boolean }
  >()

  // ── tick 心跳监控 ──
  private lastTickTimestamp = 0
  private tickWatchdogTimer: ReturnType<typeof setInterval> | null = null

  // ── store write + emit 节流 ──
  private lastEmitTime = new Map<string, number>()
  private pendingEmitTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private lastStoreWriteTime = new Map<string, number>()
  private pendingStoreTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private gateway: OpenclawGateway,
    private store: CoworkStore,
    private modelRegistry: ModelRegistry
  ) {
    super()
    this.bindGatewayEvents()
    // 每 30s 检查 tick 健康
    this.tickWatchdogTimer = setInterval(() => this.checkTickHealth(), 30_000)
  }

  // ── 公共 API ──

  async startSession(
    sessionId: string,
    prompt: string,
    options?: CoworkStartOptions
  ): Promise<void> {
    await this.runTurn(sessionId, prompt, options)
  }

  async continueSession(
    sessionId: string,
    prompt: string,
    options?: CoworkContinueOptions
  ): Promise<void> {
    await this.runTurn(sessionId, prompt, options)
  }

  stopSession(sessionId: string): void {
    const turn = this.activeTurns.get(sessionId)
    if (turn) {
      turn.stopRequested = true
      // 精确中断：传 sessionKey + runId
      this.gateway.chatAbort(turn.sessionKey, turn.runId).catch((err) => {
        console.warn('[CoworkController] chatAbort failed:', err)
      })
    }

    this.manuallyStoppedSessions.add(sessionId)
    this.stoppedSessions.set(sessionId, Date.now())
    this.cleanupSessionTurn(sessionId)
    // 停止会话时清理相关 pendingApprovals，避免已取消会话的弹窗残留
    for (const [requestId, pending] of this.pendingApprovals) {
      if (pending.sessionId === sessionId) {
        this.pendingApprovals.delete(requestId)
      }
    }
    this.store.updateSession(sessionId, { status: 'idle' })
    this.emit('sessionStopped', sessionId)
    this.resolveTurn(sessionId)
  }

  // 将用户的审批结果转换为 gateway 协议的 decision 字符串并发送
  respondToPermission(requestId: string, result: PermissionResult): void {
    const pending = this.pendingApprovals.get(requestId)
    if (!pending) return

    // 转换为 gateway exec.approval.resolve 协议：
    // - deny: 用户拒绝
    // - allow-always: 自动批准的命令（加入 gateway allowlist，后续不再询问）
    // - allow-once: 用户手动批准一次
    const decision =
      result.behavior !== 'allow' ? 'deny' : pending.allowAlways ? 'allow-always' : 'allow-once'

    this.pendingApprovals.delete(requestId)
    this.gateway.approvalResolve(requestId, decision).catch((err) => {
      console.error(`[CoworkController] approvalResolve failed for ${requestId}:`, err)
    })
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeTurns.has(sessionId)
  }

  getActiveSessionCount(): number {
    return this.activeTurns.size
  }

  hasActiveSessions(): boolean {
    return this.activeTurns.size > 0
  }

  // 会话删除时清理所有关联状态，防止内存泄漏
  onSessionDeleted(sessionId: string): void {
    this.cleanupSessionTurn(sessionId)
    this.resolveTurn(sessionId)
    this.lastPatchedModelBySession.delete(sessionId)
    this.lastSystemPromptBySession.delete(sessionId)
    this.bridgedSessions.delete(sessionId)
    this.stoppedSessions.delete(sessionId)
    this.manuallyStoppedSessions.delete(sessionId)
    this.latestTurnTokenBySession.delete(sessionId)
    this.confirmationModeBySession.delete(sessionId)
    for (const [key, sid] of this.sessionIdBySessionKey) {
      if (sid === sessionId) this.sessionIdBySessionKey.delete(key)
    }
    // 清理该会话相关的 pendingApprovals
    for (const [requestId, pending] of this.pendingApprovals) {
      if (pending.sessionId === sessionId) {
        this.pendingApprovals.delete(requestId)
      }
    }
  }

  // 销毁 controller，清理 tick watchdog
  dispose(): void {
    if (this.tickWatchdogTimer) {
      clearInterval(this.tickWatchdogTimer)
      this.tickWatchdogTimer = null
    }
  }

  // ── runTurn 核心 ──
  //
  // runTurn 是一次 Cowork 对话 turn 的启动编排层，不直接消费模型输出。
  // 它负责把“本地会话状态”和“OpenClaw runtime 异步事件流”绑定起来：
  //
  // 1. 先做本地一致性校验：prompt 不能为空，同一 session 同时只能运行一个 turn，
  //    且 session 必须存在。activeTurns 是并发闸门，避免多个 gateway run 同时写入
  //    同一条 PetClaw 会话。
  // 2. 用户主动发起新 turn 时，清理 stop/cooldown 防护状态，并记住 confirmationMode。
  //    stopSession 会在短时间内忽略迟到事件；新 turn 要显式解除这层保护，否则新的
  //    runtime 事件可能被误判为旧 run 的残留。
  // 3. 先写入 user message 并更新 session=running，再发送给 gateway。这样 renderer
  //    和 PetEventBridge 能立即获得用户消息，即使后续 chatSend 失败，也有完整的
  //    本地审计轨迹。
  // 4. 用 agentId + sessionId 派生 sessionKey。sessionKey 是 OpenClaw runtime 侧的
  //    会话/workspace 路由键；controller 维护 sessionKey -> sessionId 映射，用来把
  //    后续 SSE/RPC 事件还原到 PetClaw 本地会话。
  // 5. 如果当前会话指定了 selectedModel，只在模型变化时 patch gateway session。
  //    这样既能支持每个 Cowork session 使用独立模型，又避免每轮重复 RPC。
  // 6. buildOutboundPrompt 只做运行时包装：按“首次或变化”注入 systemPrompt，每轮补充
  //    本地时间上下文，并在 runtime 侧没有历史时桥接 PetClaw 最近消息。真正的配置
  //    聚合发生在上层 ConfigSync / CoworkConfigStore，controller 不读取配置源。
  // 7. 创建 completionPromise 后立即登记到 pendingTurns。runTurn 的 Promise 不以
  //    chatSend 返回为完成标准，而是等 chatFinal/chatError/chatAborted、lifecycle 兜底、
  //    stopSession 或断连处理调用 resolveTurn/rejectTurn，保证调用方看到的是完整 turn
  //    生命周期结果。
  // 8. 本地先生成 runId 作为 idempotencyKey，并递增 turnToken。runId 用于绑定 gateway
  //    事件和去重；turnToken 用于超时 timer 与迟到异步回调的代际校验，避免旧 turn 清理
  //    新 turn。
  // 9. ActiveTurn 保存流式文本、assistant/tool 消息映射、已知 runId 集合和节流状态。
  //    后续 handleChatEvent / handleAgentEvent 只根据 ActiveTurn 增量落库、发射 UI 事件，
  //    因此 runTurn 必须在 chatSend 前完成 ActiveTurn 注册。
  // 10. chatSend 只负责把本轮请求交给 gateway；assistant 文本、tool use/result、审批、
  //     complete/error 都从 gateway 事件管线异步回流。若 gateway 返回了不同 runId，
  //     controller 会把它并入 knownRunIds，并立即 flush 早到但此前无法路由的 agent 事件。

  private async runTurn(
    sessionId: string,
    prompt: string,
    options: RunTurnOptions = {}
  ): Promise<void> {
    if (!prompt.trim()) {
      throw new Error('Prompt is required.')
    }
    if (this.activeTurns.has(sessionId)) {
      throw new Error(`Session ${sessionId} is still running.`)
    }
    const session = this.store.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // 清除防护状态（用户主动发新消息 = 重新激活）
    this.stoppedSessions.delete(sessionId)
    this.manuallyStoppedSessions.delete(sessionId)

    // confirmationMode 记忆
    const confirmationMode =
      options.confirmationMode ?? this.confirmationModeBySession.get(sessionId) ?? 'modal'
    this.confirmationModeBySession.set(sessionId, confirmationMode)

    // 写入 user message + 状态更新
    this.store.updateSession(sessionId, { status: 'running' })
    const metadata =
      options.skillIds?.length || options.imageAttachments?.length
        ? {
            ...(options.skillIds?.length ? { skillIds: options.skillIds } : {}),
            ...(options.imageAttachments?.length
              ? { imageAttachments: options.imageAttachments }
              : {})
          }
        : undefined
    const msg = this.store.addMessage(sessionId, 'user', prompt, metadata)
    this.emit('message', sessionId, msg)

    // sessionKey 路由
    const agentId = session.agentId
    const sessionKey = buildSessionKey(agentId, sessionId)
    this.sessionIdBySessionKey.set(sessionKey, sessionId)

    // model patch
    const selectedModel = options.selectedModel ?? session.selectedModel
    const currentModel = selectedModel ? this.modelRegistry.toOpenClawModelRef(selectedModel) : ''
    if (currentModel && currentModel !== this.lastPatchedModelBySession.get(sessionId)) {
      try {
        const client = this.gateway.getClient()
        if (client) {
          await client.request('sessions.patch', { key: sessionKey, model: currentModel })
          this.lastPatchedModelBySession.set(sessionId, currentModel)
        }
      } catch (err) {
        console.warn('[CoworkController] Failed to patch session model:', err)
      }
    }

    // prompt 包装。skillPrompt 是本轮动态上下文，不写回 session.systemPrompt。
    const turnSystemPrompt = [options.skillPrompt, options.systemPrompt]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join('\n\n')
    const outboundMessage = await this.buildOutboundPrompt(
      sessionId,
      sessionKey,
      prompt,
      turnSystemPrompt
    )

    // completionPromise
    const completionPromise = new Promise<void>((resolve, reject) => {
      this.pendingTurns.set(sessionId, { resolve, reject })
    })

    // 生成 runId + turnToken
    const runId = crypto.randomUUID()
    const turnToken = this.nextTurnToken(sessionId)
    this.sessionIdByRunId.set(runId, sessionId)

    // 创建 ActiveTurn
    this.activeTurns.set(sessionId, {
      sessionId,
      sessionKey,
      runId,
      turnToken,
      startedAtMs: Date.now(),
      assistantMessageId: null,
      stopRequested: false,
      knownRunIds: new Set([runId]),
      currentText: '',
      textStreamMode: 'unknown',
      committedAssistantText: '',
      agentAssistantTextLength: 0,
      toolUseMessageIdByToolCallId: new Map(),
      toolResultMessageIdByToolCallId: new Map(),
      toolResultTextByToolCallId: new Map()
    })

    // timeout watchdog
    this.startTurnTimeoutWatchdog(sessionId, turnToken)

    // chatSend
    try {
      const attachments = options.imageAttachments?.length
        ? options.imageAttachments.map((img) => ({
            type: 'image',
            mimeType: img.mimeType,
            content: img.base64Data
          }))
        : undefined
      const sendResult = await this.gateway.chatSend(sessionKey, outboundMessage, {
        idempotencyKey: runId,
        deliver: false, // 桌面端不自动推送到 IM 通道
        ...(options.autoApprove !== undefined ? { autoApprove: options.autoApprove } : {}),
        ...(attachments ? { attachments } : {})
      })
      // gateway 返回的 runId 可能与本地不同
      if (sendResult.runId && sendResult.runId !== runId) {
        const turn = this.activeTurns.get(sessionId)
        if (turn) {
          turn.knownRunIds.add(sendResult.runId)
          this.sessionIdByRunId.set(sendResult.runId, sessionId)
          // flush 该 runId 的缓存事件
          this.flushPendingAgentEvents(sessionId, sendResult.runId)
        }
      }
    } catch (err) {
      this.cleanupSessionTurn(sessionId)
      this.store.updateSession(sessionId, { status: 'error' })
      const message = err instanceof Error ? err.message : String(err)
      this.emit('error', sessionId, message)
      this.rejectTurn(sessionId, new Error(message))
    }

    await completionPromise
  }

  // ── Turn 生命周期辅助 ──

  private nextTurnToken(sessionId: string): number {
    const current = this.latestTurnTokenBySession.get(sessionId) ?? 0
    const next = current + 1
    this.latestTurnTokenBySession.set(sessionId, next)
    return next
  }

  private isCurrentTurnToken(sessionId: string, token: number): boolean {
    return this.latestTurnTokenBySession.get(sessionId) === token
  }

  private resolveTurn(sessionId: string): void {
    const pending = this.pendingTurns.get(sessionId)
    if (pending) {
      this.pendingTurns.delete(sessionId)
      pending.resolve()
    }
  }

  private rejectTurn(sessionId: string, error: Error): void {
    const pending = this.pendingTurns.get(sessionId)
    if (pending) {
      this.pendingTurns.delete(sessionId)
      pending.reject(error)
    }
  }

  private cleanupSessionTurn(sessionId: string): void {
    const turn = this.activeTurns.get(sessionId)
    if (!turn) return

    if (turn.timeoutTimer) {
      clearTimeout(turn.timeoutTimer)
    }

    // flush + 清理节流 timer
    if (turn.assistantMessageId) {
      this.flushAndClearThrottled(sessionId, turn.assistantMessageId)
    }

    // 清 runId 映射 + seq 去重缓存 + terminatedRunIds
    for (const rid of turn.knownRunIds) {
      this.sessionIdByRunId.delete(rid)
      this.lastChatSeqByRunId.delete(rid)
      this.lastAgentSeqByRunId.delete(rid)
      this.terminatedRunIds.delete(rid)
    }

    this.activeTurns.delete(sessionId)
  }

  private startTurnTimeoutWatchdog(sessionId: string, turnToken: number): void {
    const timer = setTimeout(() => {
      if (!this.isCurrentTurnToken(sessionId, turnToken)) return

      const turn = this.activeTurns.get(sessionId)
      if (!turn) return

      console.warn(
        `[CoworkController] Turn timeout for session ${sessionId} after ${TURN_TIMEOUT_MS}ms`
      )
      this.cleanupSessionTurn(sessionId)
      this.store.updateSession(sessionId, { status: 'error' })
      this.emit('error', sessionId, 'Turn timed out')
      this.resolveTurn(sessionId)
    }, TURN_TIMEOUT_MS)

    const turn = this.activeTurns.get(sessionId)
    if (turn) {
      turn.timeoutTimer = timer
    }
  }

  // ── sessionKey/runId → sessionId 解析 ──

  private resolveSessionId(sessionKey: string): string | null {
    return this.sessionIdBySessionKey.get(sessionKey) ?? null
  }

  // 增强版：优先按 runId 查找，fallback 到 sessionKey
  private resolveSessionIdFromEvent(sessionKey: string, runId?: string): string | null {
    if (runId) {
      const byRunId = this.sessionIdByRunId.get(runId)
      if (byRunId) return byRunId
    }
    return this.sessionIdBySessionKey.get(sessionKey) ?? null
  }

  private isSessionInStopCooldown(sessionId: string): boolean {
    const stopTime = this.stoppedSessions.get(sessionId)
    if (!stopTime) return false
    if (Date.now() - stopTime < STOP_COOLDOWN_MS) return true
    this.stoppedSessions.delete(sessionId)
    return false
  }

  // 绑定 runId 到当前 turn + flush pending queue
  private bindRunIdToTurn(sessionId: string, turn: ActiveTurn, runId: string): void {
    if (!runId || turn.knownRunIds.has(runId)) return
    turn.knownRunIds.add(runId)
    this.sessionIdByRunId.set(runId, sessionId)
    this.flushPendingAgentEvents(sessionId, runId)
  }

  // ── 序列号去重 ──

  private checkSeqDedup(seqMap: Map<string, number>, runId: string, seq?: number): boolean {
    if (typeof seq !== 'number' || !Number.isFinite(seq) || !runId) return false
    const lastSeq = seqMap.get(runId)
    if (lastSeq !== undefined && seq <= lastSeq) return true
    seqMap.set(runId, seq)
    return false
  }

  // ── tick 心跳监控 ──

  private checkTickHealth(): void {
    if (this.lastTickTimestamp <= 0) return
    const elapsed = Date.now() - this.lastTickTimestamp
    if (elapsed <= TICK_TIMEOUT_MS) return
    // 连接假死，emit 事件供上层处理
    this.emit('tickTimeout', elapsed)
  }

  // ── 文本分段 split ──

  // 从 fullText 中去掉已 committed 的前缀，得到当前 segment 文本
  private resolveAssistantSegmentText(turn: ActiveTurn, fullText: string): string {
    const normalized = fullText.trim()
    if (!normalized) return ''
    const committed = turn.committedAssistantText
    if (!committed) return normalized
    if (normalized.startsWith(committed)) return normalized.slice(committed.length).trimStart()
    return normalized
  }

  // tool 边界处切分：将当前 assistant 消息标记为 final，准备创建新 segment
  private splitAssistantSegmentBeforeTool(sessionId: string, turn: ActiveTurn): void {
    if (!turn.assistantMessageId || !turn.currentText.trim()) return
    this.flushAndClearThrottled(sessionId, turn.assistantMessageId)
    turn.committedAssistantText += turn.currentText.trim()
    turn.assistantMessageId = null
  }

  // ── store write + emit 节流 ──

  // Leading + trailing 模式：首次立即发射，窗口内节流，窗口结束时 trailing 执行
  private throttledEmitMessageUpdate(sessionId: string, messageId: string, content: string): void {
    const now = Date.now()
    const lastEmit = this.lastEmitTime.get(messageId) ?? 0
    const elapsed = now - lastEmit

    if (elapsed >= MESSAGE_UPDATE_THROTTLE_MS) {
      this.clearPendingEmit(messageId)
      this.lastEmitTime.set(messageId, now)
      this.emit('messageUpdate', sessionId, messageId, content)
      return
    }

    this.clearPendingEmit(messageId)
    this.pendingEmitTimers.set(
      messageId,
      setTimeout(() => {
        this.pendingEmitTimers.delete(messageId)
        this.lastEmitTime.set(messageId, Date.now())
        this.emit('messageUpdate', sessionId, messageId, content)
      }, MESSAGE_UPDATE_THROTTLE_MS - elapsed)
    )
  }

  private throttledStoreUpdate(sessionId: string, messageId: string, content: string): void {
    const now = Date.now()
    const lastWrite = this.lastStoreWriteTime.get(messageId) ?? 0
    const elapsed = now - lastWrite

    if (elapsed >= STORE_UPDATE_THROTTLE_MS) {
      this.clearPendingStore(messageId)
      this.lastStoreWriteTime.set(messageId, now)
      this.store.updateMessageContent(messageId, content)
      return
    }

    this.clearPendingStore(messageId)
    this.pendingStoreTimers.set(
      messageId,
      setTimeout(() => {
        this.pendingStoreTimers.delete(messageId)
        this.lastStoreWriteTime.set(messageId, Date.now())
        // 写入前检查 turn 是否仍然活跃
        const turn = this.activeTurns.get(sessionId)
        if (turn?.assistantMessageId === messageId) {
          this.store.updateMessageContent(messageId, content)
        }
      }, STORE_UPDATE_THROTTLE_MS - elapsed)
    )
  }

  private clearPendingEmit(messageId: string): void {
    const timer = this.pendingEmitTimers.get(messageId)
    if (timer) {
      clearTimeout(timer)
      this.pendingEmitTimers.delete(messageId)
    }
  }

  private clearPendingStore(messageId: string): void {
    const timer = this.pendingStoreTimers.get(messageId)
    if (timer) {
      clearTimeout(timer)
      this.pendingStoreTimers.delete(messageId)
    }
  }

  // 立即 flush pending 并清理（用于 chatFinal、cleanupSessionTurn、split）
  private flushAndClearThrottled(sessionId: string, messageId: string): void {
    // flush pending store write
    const storeTimer = this.pendingStoreTimers.get(messageId)
    if (storeTimer) {
      clearTimeout(storeTimer)
      this.pendingStoreTimers.delete(messageId)
      const turn = this.activeTurns.get(sessionId)
      if (turn?.assistantMessageId === messageId && turn.currentText) {
        const segmentText = this.resolveAssistantSegmentText(turn, turn.currentText)
        if (segmentText) {
          this.store.updateMessageContent(messageId, segmentText)
        }
      }
    }
    // flush pending emit
    const emitTimer = this.pendingEmitTimers.get(messageId)
    if (emitTimer) {
      clearTimeout(emitTimer)
      this.pendingEmitTimers.delete(messageId)
      const turn = this.activeTurns.get(sessionId)
      if (turn?.assistantMessageId === messageId && turn.currentText) {
        const segmentText = this.resolveAssistantSegmentText(turn, turn.currentText)
        if (segmentText) {
          this.emit('messageUpdate', sessionId, messageId, segmentText)
        }
      }
    }
    // 清理时间戳
    this.lastEmitTime.delete(messageId)
    this.lastStoreWriteTime.delete(messageId)
  }

  // ── pending agent event queue ──

  private enqueuePendingAgentEvent(runId: string, payload: AgentEventPayload): void {
    const normalized = runId.trim()
    if (!normalized) return

    const queued = this.pendingAgentEventsByRunId.get(normalized) ?? []
    queued.push(payload)
    if (queued.length > 240) queued.shift()
    this.pendingAgentEventsByRunId.set(normalized, queued)

    // 总 runId 上限 400
    if (this.pendingAgentEventsByRunId.size > 400) {
      const oldestRunId = this.pendingAgentEventsByRunId.keys().next().value as string | undefined
      if (oldestRunId) this.pendingAgentEventsByRunId.delete(oldestRunId)
    }
  }

  private flushPendingAgentEvents(sessionId: string, runId: string): void {
    const normalized = runId.trim()
    if (!normalized) return

    const queued = this.pendingAgentEventsByRunId.get(normalized)
    if (!queued || queued.length === 0) return
    this.pendingAgentEventsByRunId.delete(normalized)

    const turn = this.activeTurns.get(sessionId)
    if (!turn) return

    for (const payload of queued) {
      this.dispatchAgentEvent(sessionId, turn, payload)
    }
  }

  // ── finalizeTurnText ──

  private finalizeTurnText(sessionId: string, turn: ActiveTurn): void {
    if (turn.assistantMessageId && turn.currentText) {
      this.flushAndClearThrottled(sessionId, turn.assistantMessageId)
      const segmentText = this.resolveAssistantSegmentText(turn, turn.currentText)
      if (segmentText) {
        this.store.updateMessageContent(turn.assistantMessageId, segmentText)
        this.emit('messageUpdate', sessionId, turn.assistantMessageId, segmentText)
      }
    }
  }

  // ── reuseFinalAssistantMessage ──

  // 避免 chatFinal 重复创建与流式过程中相同内容的 assistant 消息
  private reuseFinalAssistantMessage(sessionId: string, content: string): string | null {
    const normalized = content.trim()
    if (!normalized) return null
    const session = this.store.getSession(sessionId)
    const messages = session?.messages ?? []
    let nonAssistantCount = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.type === 'assistant') {
        if (msg.content.trim() !== normalized) return null
        this.store.updateMessageContent(msg.id, content)
        return msg.id
      }
      nonAssistantCount++
      if (nonAssistantCount > 1) return null
    }
    return null
  }

  // ── syncFinalAssistantWithHistory ──

  // chatFinal 文本为空时，通过 chat.history 拉取最终 assistant 文本
  private async syncFinalAssistantWithHistory(sessionId: string, turn: ActiveTurn): Promise<void> {
    const client = this.gateway.getClient()
    if (!client) return

    try {
      const history = (await client.request('chat.history', {
        sessionKey: turn.sessionKey,
        limit: 50
      })) as { messages?: unknown[] } | null
      if (!Array.isArray(history?.messages) || history.messages.length === 0) return

      const canonicalText = this.extractCurrentTurnAssistantText(history.messages)
      if (!canonicalText) return
      if (!this.isCurrentTurnToken(sessionId, turn.turnToken)) return

      const segmentText = this.resolveAssistantSegmentText(turn, canonicalText)
      if (!segmentText) return

      if (turn.assistantMessageId) {
        this.store.updateMessageContent(turn.assistantMessageId, segmentText)
        this.emit('messageUpdate', sessionId, turn.assistantMessageId, segmentText)
      } else {
        const reusedId = this.reuseFinalAssistantMessage(sessionId, segmentText)
        if (reusedId) {
          turn.assistantMessageId = reusedId
        } else {
          const assistantMsg = this.store.addMessage(sessionId, 'assistant', segmentText, {
            isFinal: true
          })
          turn.assistantMessageId = assistantMsg.id
          this.emit('message', sessionId, assistantMsg)
        }
      }
      turn.currentText = canonicalText
    } catch {
      // chat.history 不可用时静默降级
    }
  }

  // 从 gateway history 提取当前 turn 的 assistant 文本
  private extractCurrentTurnAssistantText(messages: unknown[]): string {
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (isRecord(msg) && (msg as Record<string, unknown>).role === 'user') {
        lastUserIdx = i
        break
      }
    }
    const startIdx = lastUserIdx >= 0 ? lastUserIdx + 1 : 0
    const parts: string[] = []
    for (let i = startIdx; i < messages.length; i++) {
      const msg = messages[i]
      if (!isRecord(msg)) continue
      if ((msg as Record<string, unknown>).role !== 'assistant') continue
      const text = this.extractMessageContent(msg as Record<string, unknown>).trim()
      if (text) parts.push(text)
    }
    return parts.join('\n\n')
  }

  // ── 运行时 Prompt 注入 ──

  private async buildOutboundPrompt(
    sessionId: string,
    sessionKey: string,
    prompt: string,
    systemPrompt?: string
  ): Promise<string> {
    const sections: string[] = []

    const normalizedSystemPrompt = (systemPrompt ?? '').trim()
    const previousSystemPrompt = this.lastSystemPromptBySession.get(sessionId) ?? ''
    const shouldInjectSystemPrompt = Boolean(
      normalizedSystemPrompt && normalizedSystemPrompt !== previousSystemPrompt
    )

    if (normalizedSystemPrompt) {
      this.lastSystemPromptBySession.set(sessionId, normalizedSystemPrompt)
    } else {
      this.lastSystemPromptBySession.delete(sessionId)
    }

    if (shouldInjectSystemPrompt) {
      sections.push(this.buildSystemPromptPrefix(normalizedSystemPrompt))
    }

    sections.push(buildLocalTimeContext())

    if (!this.bridgedSessions.has(sessionId)) {
      this.bridgedSessions.add(sessionId)

      let hasHistory = false
      try {
        const client = this.gateway.getClient()
        if (client) {
          const history = (await client.request('chat.history', {
            sessionKey,
            limit: 1
          })) as { messages?: unknown[] } | null
          hasHistory = Array.isArray(history?.messages) && history.messages.length > 0
        }
      } catch {
        // 安全降级
      }

      if (!hasHistory) {
        const session = this.store.getSession(sessionId)
        if (session) {
          const bridgePrefix = this.buildBridgePrefix(session.messages, prompt)
          if (bridgePrefix) {
            sections.push(bridgePrefix)
          }
        }
      }
    }

    if (prompt.trim()) {
      sections.push(`[Current user request]\n${prompt}`)
    }

    return sections.join('\n\n')
  }

  private buildSystemPromptPrefix(systemPrompt: string): string {
    return [
      '[PetClaw system instructions]',
      'Apply the instructions below as the highest-priority guidance for this session.',
      'If earlier PetClaw system instructions exist, replace them with this version.',
      systemPrompt
    ].join('\n')
  }

  private buildBridgePrefix(messages: CoworkMessage[], currentPrompt: string): string {
    const normalizedPrompt = currentPrompt.trim()
    if (!normalizedPrompt) return ''

    const source = messages
      .filter((msg) => {
        if (msg.type !== 'user' && msg.type !== 'assistant') return false
        if (!msg.content.trim()) return false
        if (msg.metadata?.isThinking) return false
        return true
      })
      .map((msg) => ({ type: msg.type, content: msg.content.trim() }))

    if (source.length === 0) return ''

    const last = source[source.length - 1]
    if (last?.type === 'user' && last.content === normalizedPrompt) {
      source.pop()
    }

    const recent = source.slice(-BRIDGE_MAX_MESSAGES)
    if (recent.length === 0) return ''

    const lines = recent.map((entry) => {
      const role = entry.type === 'user' ? 'User' : 'Assistant'
      return `${role}: ${truncateStr(entry.content, BRIDGE_MAX_MESSAGE_CHARS)}`
    })

    return [
      '[Context bridge from previous PetClaw conversation]',
      'Use this prior context for continuity. Focus your final answer on the current request.',
      ...lines
    ].join('\n')
  }

  // ── Gateway 事件路由（6 个绑定）──

  private bindGatewayEvents(): void {
    this.gateway.on('tick', () => {
      this.lastTickTimestamp = Date.now()
    })
    this.gateway.on('chatEvent', (payload: ChatEventPayload) => {
      this.handleChatEvent(payload)
    })
    this.gateway.on('agentEvent', (payload: AgentEventPayload) => {
      this.handleAgentEvent(payload)
    })
    this.gateway.on('approvalRequested', (payload: ApprovalRequestedPayload) => {
      this.handleApprovalRequested(payload)
    })
    this.gateway.on('approvalResolved', (payload: ApprovalResolvedPayload) => {
      this.handleApprovalResolved(payload)
    })
    this.gateway.on('disconnected', (reason: string) => {
      this.handleDisconnected(reason)
    })
  }

  // ── 统一 chat 管线 ──

  private handleChatEvent(payload: ChatEventPayload): void {
    const { sessionKey, state } = payload

    // 统一 sessionId 解析
    const sessionId = this.resolveSessionIdFromEvent(sessionKey, payload.runId)
    if (!sessionId) return
    if (this.isSessionInStopCooldown(sessionId)) return

    const turn = this.activeTurns.get(sessionId)

    // seq 去重
    const runId = payload.runId ?? turn?.runId ?? ''
    if (this.checkSeqDedup(this.lastChatSeqByRunId, runId, undefined)) return

    // 按 state 分发
    switch (state) {
      case 'delta':
        this.handleChatDelta(sessionId, turn, payload)
        break
      case 'final':
        this.handleChatFinal(sessionId, turn, payload)
        break
      case 'error':
        this.handleChatError(sessionId, payload)
        break
      case 'aborted':
        this.handleChatAborted(sessionId, turn)
        break
    }
  }

  private handleChatDelta(
    sessionId: string,
    turn: ActiveTurn | undefined,
    payload: ChatEventPayload
  ): void {
    if (!turn) return

    const message = payload.message as Record<string, unknown> | undefined
    if (!message) return
    const content = this.extractMessageContent(message)
    if (!content) return

    // 流式累积
    const { mergedText, mode } = mergeStreamingText(turn.currentText, content, turn.textStreamMode)
    turn.currentText = mergedText
    turn.textStreamMode = mode

    const segmentText = this.resolveAssistantSegmentText(turn, mergedText)
    if (!segmentText) return

    if (!turn.assistantMessageId) {
      const msg = this.store.addMessage(sessionId, 'assistant', segmentText, {
        isStreaming: true
      })
      turn.assistantMessageId = msg.id
      this.emit('message', sessionId, msg)
    } else {
      this.throttledStoreUpdate(sessionId, turn.assistantMessageId, segmentText)
      this.throttledEmitMessageUpdate(sessionId, turn.assistantMessageId, segmentText)
    }
  }

  private async handleChatFinal(
    sessionId: string,
    turn: ActiveTurn | undefined,
    payload: ChatEventPayload
  ): Promise<void> {
    const engineSessionId = payload.runId ?? null

    // stopReason=error → 走 error 路径
    if (payload.stopReason === 'error') {
      const errorMessage = payload.errorMessage?.trim() || 'OpenClaw run failed'
      this.store.addMessage(sessionId, 'system', errorMessage, { error: errorMessage })
      this.cleanupSessionTurn(sessionId)
      this.store.updateSession(sessionId, { status: 'error' })
      this.emit('error', sessionId, errorMessage)
      this.rejectTurn(sessionId, new Error(errorMessage))
      return
    }

    // 最终文本更新
    if (turn) {
      this.finalizeTurnText(sessionId, turn)

      // final text 为空时从 history 补全
      if (!turn.currentText.trim()) {
        await this.syncFinalAssistantWithHistory(sessionId, turn)
      } else if (!turn.assistantMessageId) {
        // 有文本但无 assistantMessageId（不应发生，兜底处理）
        const segmentText = this.resolveAssistantSegmentText(turn, turn.currentText)
        if (segmentText) {
          const reusedId = this.reuseFinalAssistantMessage(sessionId, segmentText)
          if (reusedId) {
            turn.assistantMessageId = reusedId
          } else {
            const assistantMsg = this.store.addMessage(sessionId, 'assistant', segmentText, {
              isFinal: true
            })
            turn.assistantMessageId = assistantMsg.id
            this.emit('message', sessionId, assistantMsg)
          }
        }
      }
    }

    this.cleanupSessionTurn(sessionId)
    this.store.updateSession(sessionId, { status: 'completed', engineSessionId })
    this.emit('complete', sessionId, engineSessionId)
    this.resolveTurn(sessionId)
  }

  private handleChatError(sessionId: string, payload: ChatEventPayload): void {
    const error = payload.errorMessage?.trim() || 'Unknown error'
    this.store.addMessage(sessionId, 'system', error, { error })
    this.cleanupSessionTurn(sessionId)
    this.store.updateSession(sessionId, { status: 'error' })
    this.emit('error', sessionId, error)
    this.rejectTurn(sessionId, new Error(error))
  }

  private handleChatAborted(sessionId: string, turn: ActiveTurn | undefined): void {
    if (turn && !turn.stopRequested && !this.manuallyStoppedSessions.has(sessionId)) {
      const msg = this.store.addMessage(sessionId, 'assistant', '任务执行超时，请重试或简化请求', {
        isTimeout: true
      })
      this.emit('message', sessionId, msg)
    }

    this.cleanupSessionTurn(sessionId)
    this.store.updateSession(sessionId, { status: 'idle' })
    this.emit('complete', sessionId, null)
    this.resolveTurn(sessionId)
  }

  // ── 统一 agent 管线 ──

  private handleAgentEvent(payload: AgentEventPayload): void {
    const { sessionKey, stream, data, runId } = payload

    // ① assistant fast-path：在管线之前执行，不被 pending queue 延迟
    if (stream === 'text' || stream === 'assistant') {
      this.processAgentAssistantText(sessionKey, payload)
      return
    }

    // ② 统一前置管线
    const sessionId = this.resolveSessionIdFromEvent(sessionKey, runId)
    if (!sessionId) {
      // 仅 tool/lifecycle stream 入队
      if (
        runId &&
        (stream === 'tool' ||
          stream === 'tools' ||
          stream === 'lifecycle' ||
          this.hasToolShape(data))
      ) {
        this.enqueuePendingAgentEvent(runId, payload)
      }
      return
    }

    const turn = this.activeTurns.get(sessionId)

    // sessionKey mismatch
    if (turn && turn.sessionKey !== sessionKey) return

    // sessionId 交叉验证
    if (runId) {
      const bySessionKey = this.sessionIdBySessionKey.get(sessionKey)
      if (bySessionKey && bySessionKey !== sessionId) return
      if (turn) this.bindRunIdToTurn(sessionId, turn, runId)
    }

    // seq 去重
    if (runId && this.checkSeqDedup(this.lastAgentSeqByRunId, runId, payload.seq)) return

    // ③ 按 stream 分发
    this.dispatchAgentEvent(sessionId, turn, payload)
  }

  // assistant 快路径：独立做 sessionId 解析（不走 pending queue）
  private processAgentAssistantText(sessionKey: string, payload: AgentEventPayload): void {
    const { data, runId } = payload
    const sessionId = this.resolveSessionIdFromEvent(sessionKey, runId)
    if (!sessionId) return
    if (this.isSessionInStopCooldown(sessionId)) return

    const turn = this.activeTurns.get(sessionId)
    if (!turn) return

    // sessionKey mismatch 检查
    if (turn.sessionKey !== sessionKey) return

    // sessionId 交叉验证
    if (runId) {
      const bySessionKey = this.sessionIdBySessionKey.get(sessionKey)
      if (bySessionKey && bySessionKey !== sessionId) return
    }

    const effectiveRunId = runId ?? turn.runId
    if (this.checkSeqDedup(this.lastAgentSeqByRunId, effectiveRunId, undefined)) return

    // runId 绑定
    if (runId) {
      this.bindRunIdToTurn(sessionId, turn, runId)
    }

    // 递归提取 assistant stream 文本
    const extractedText = extractAssistantStreamText(data)
    if (!extractedText) return

    // hwm text reset 检测：文本长度显著回退 → 新 model call 边界，自动 split
    const incomingLength = extractedText.length
    if (
      turn.agentAssistantTextLength > 0 &&
      incomingLength < turn.agentAssistantTextLength * 0.5 &&
      turn.assistantMessageId &&
      turn.currentText.trim()
    ) {
      this.splitAssistantSegmentBeforeTool(sessionId, turn)
      turn.agentAssistantTextLength = 0
    }
    turn.agentAssistantTextLength = Math.max(turn.agentAssistantTextLength, incomingLength)

    // 流式累积
    const { mergedText, mode } = mergeStreamingText(
      turn.currentText,
      extractedText,
      turn.textStreamMode
    )
    turn.currentText = mergedText
    turn.textStreamMode = mode

    const segmentText = this.resolveAssistantSegmentText(turn, mergedText)
    if (!segmentText) return

    if (!turn.assistantMessageId) {
      const msg = this.store.addMessage(sessionId, 'assistant', segmentText, {
        isStreaming: true
      })
      turn.assistantMessageId = msg.id
      this.emit('message', sessionId, msg)
    } else {
      this.throttledStoreUpdate(sessionId, turn.assistantMessageId, segmentText)
      this.throttledEmitMessageUpdate(sessionId, turn.assistantMessageId, segmentText)
    }
  }

  // 按 stream 分发 agent 事件（已通过管线检查）
  private dispatchAgentEvent(
    sessionId: string,
    turn: ActiveTurn | undefined,
    payload: AgentEventPayload
  ): void {
    const { stream, data, runId } = payload

    if (stream === 'tool' || stream === 'tools' || this.hasToolShape(data)) {
      if (this.isSessionInStopCooldown(sessionId)) return
      if (!turn) return
      const toolData = this.parseToolData(data, runId)
      if (!toolData) return
      this.handleAgentToolEvent(sessionId, turn, toolData)
      return
    }

    if (stream === 'lifecycle') {
      this.handleAgentLifecycleEvent(sessionId, turn, data, runId)
      return
    }
  }

  // duck-type 检测 tool 事件
  private hasToolShape(data: Record<string, unknown> | undefined): boolean {
    return isRecord(data) && typeof data.toolCallId === 'string'
  }

  // tool 字段归一化：从 gateway AgentEventPayload.data 提取 AgentToolData
  // phase end→result, name/toolName 别名, args/toolInput 别名, partialResult/result 优先级
  private parseToolData(
    data: Record<string, unknown> | undefined,
    runId?: string
  ): AgentToolData | null {
    if (!data) return null
    const toolCallId = ((data.toolCallId ?? '') as string).trim()
    if (!toolCallId) return null
    const rawPhase = ((data.phase ?? 'start') as string).trim()
    const phase = rawPhase === 'end' ? 'result' : rawPhase
    return {
      toolCallId,
      phase: phase as AgentToolData['phase'],
      name: (data.name ?? data.toolName) as string | undefined,
      args: data.args ?? data.toolInput,
      result: (data.partialResult ?? data.result) as string | undefined,
      isError: data.isError as boolean | undefined,
      runId
    }
  }

  // lifecycle 事件处理（chatFinal/chatError 兜底）
  private handleAgentLifecycleEvent(
    sessionId: string,
    turn: ActiveTurn | undefined,
    data: Record<string, unknown> | undefined,
    runId?: string
  ): void {
    if (!data) return
    const phase = (data.phase ?? '') as string
    if (!phase) return

    // phase=error → 标记 runId 已终止
    if (phase === 'error' && runId) {
      this.terminatedRunIds.add(runId)
    }

    // phase=start → 更新 session 状态
    if (phase === 'start') {
      this.store.updateSession(sessionId, { status: 'running' })
    }

    // phase=end → 延迟兜底 complete（给 chatFinal 留时间）
    if (phase === 'end') {
      if (!turn) return
      const endingRunId = runId ?? turn.runId
      setTimeout(() => {
        const currentTurn = this.activeTurns.get(sessionId)
        if (!currentTurn) return
        if (endingRunId && !currentTurn.knownRunIds.has(endingRunId)) return
        this.finalizeTurnText(sessionId, currentTurn)
        this.cleanupSessionTurn(sessionId)
        this.store.updateSession(sessionId, { status: 'completed' })
        this.emit('complete', sessionId, currentTurn.runId)
        this.resolveTurn(sessionId)
      }, LIFECYCLE_END_FALLBACK_MS)
    }

    // phase=error → 延迟兜底 error（给 chatError 留时间）
    if (phase === 'error') {
      const errorMessage = (data.error as string) || 'OpenClaw run failed'
      setTimeout(() => {
        const currentTurn = this.activeTurns.get(sessionId)
        if (!currentTurn) return
        this.store.updateSession(sessionId, { status: 'error' })
        this.store.addMessage(sessionId, 'system', errorMessage, { error: errorMessage })
        this.emit('error', sessionId, errorMessage)
        this.cleanupSessionTurn(sessionId)
        this.rejectTurn(sessionId, new Error(errorMessage))
      }, LIFECYCLE_ERROR_FALLBACK_MS)
    }
  }

  // ── approval 事件处理 ──

  private handleApprovalRequested(payload: ApprovalRequestedPayload): void {
    const sessionKey = payload.request.sessionKey
    if (!sessionKey) return
    const sessionId = this.resolveSessionId(sessionKey)
    if (!sessionId) return
    if (this.isSessionInStopCooldown(sessionId)) return

    const command = typeof payload.request.command === 'string' ? payload.request.command : ''

    // Auto-approve 非删除命令：避免频繁弹窗打断用户。
    // 只有删除命令（rm、rmdir、find -delete、git clean 等）才需要用户手动确认。
    // allow-always 会让 gateway 将该命令加入 allowlist，后续不再询问。
    if (!isDeleteCommand(command)) {
      this.pendingApprovals.set(payload.id, { requestId: payload.id, sessionId, allowAlways: true })
      this.respondToPermission(payload.id, { behavior: 'allow', updatedInput: {} })
      return
    }

    this.pendingApprovals.set(payload.id, { requestId: payload.id, sessionId })

    const { level: dangerLevel, reason: dangerReason } = getCommandDangerLevel(command)

    const permReq: PermissionRequest = {
      requestId: payload.id,
      toolName: 'Bash',
      toolInput: {
        command,
        dangerLevel,
        dangerReason,
        cwd: payload.request.cwd ?? null,
        host: payload.request.host ?? null,
        security: payload.request.security ?? null,
        ask: payload.request.ask ?? null,
        resolvedPath: payload.request.resolvedPath ?? null,
        agentId: payload.request.agentId ?? null
      },
      toolUseId: payload.id
    }
    this.emit('permissionRequest', sessionId, permReq)
  }

  private handleApprovalResolved(payload: ApprovalResolvedPayload): void {
    this.pendingApprovals.delete(payload.id)
    // 通知 renderer 关闭审批弹窗（gateway 侧超时 auto-deny 时也会触发）
    this.emit('permissionDismiss', payload.id)
  }

  // ── disconnected 处理 ──

  private handleDisconnected(reason: string): void {
    const errorMessage = `Gateway disconnected: ${reason}`
    const sessionIds = [...this.activeTurns.keys()]
    for (const sessionId of sessionIds) {
      this.cleanupSessionTurn(sessionId)
      this.store.updateSession(sessionId, { status: 'error' })
      this.emit('error', sessionId, errorMessage)
      this.rejectTurn(sessionId, new Error(errorMessage))
    }
  }

  // ── agentTool 事件处理（抽出为独立方法，供 pending queue flush 复用）──

  private handleAgentToolEvent(sessionId: string, turn: ActiveTurn, data: AgentToolData): void {
    // ① tool 边界切分 assistant 消息
    this.splitAssistantSegmentBeforeTool(sessionId, turn)

    // ② 幂等创建 tool_use（任何 phase 到来时）
    if (!turn.toolUseMessageIdByToolCallId.has(data.toolCallId)) {
      const toolName = data.name || 'Tool'
      const msg = this.store.addMessage(sessionId, 'tool_use', `Using tool: ${toolName}`, {
        toolName,
        toolInput: toToolInputRecord(data.args),
        toolUseId: data.toolCallId,
        isStreaming: true
      })
      turn.toolUseMessageIdByToolCallId.set(data.toolCallId, msg.id)
      this.emit('message', sessionId, msg)
    }

    // ③ phase=update → 流式 tool result
    if (data.phase === 'update') {
      const incoming = extractToolText(data.result)
      if (!incoming.trim()) return

      const prevText = turn.toolResultTextByToolCallId.get(data.toolCallId) ?? ''
      const merged = mergeStreamingText(prevText, incoming, 'unknown').mergedText

      const existingId = turn.toolResultMessageIdByToolCallId.get(data.toolCallId)
      if (!existingId) {
        const msg = this.store.addMessage(sessionId, 'tool_result', merged, {
          toolUseId: data.toolCallId,
          isStreaming: true,
          isFinal: false
        })
        turn.toolResultMessageIdByToolCallId.set(data.toolCallId, msg.id)
        turn.toolResultTextByToolCallId.set(data.toolCallId, merged)
        this.emit('message', sessionId, msg)
      } else if (merged !== prevText) {
        this.store.updateMessageContent(existingId, merged)
        turn.toolResultTextByToolCallId.set(data.toolCallId, merged)
        this.emit('messageUpdate', sessionId, existingId, merged)
      }
      return
    }

    // ④ phase=result → 最终 tool result（带 fallback）
    if (data.phase === 'result') {
      const incoming = extractToolText(data.result)
      const previous = turn.toolResultTextByToolCallId.get(data.toolCallId) ?? ''
      const finalContent = incoming.trim() ? incoming : previous
      const isError = Boolean(data.isError)
      const finalError = isError ? finalContent || 'Tool execution failed' : undefined

      const existingId = turn.toolResultMessageIdByToolCallId.get(data.toolCallId)
      if (existingId) {
        this.store.updateMessageContent(existingId, finalContent)
        this.emit('messageUpdate', sessionId, existingId, finalContent)
      } else {
        const msg = this.store.addMessage(sessionId, 'tool_result', finalContent, {
          toolUseId: data.toolCallId,
          error: finalError,
          isError,
          isStreaming: false,
          isFinal: true
        })
        turn.toolResultMessageIdByToolCallId.set(data.toolCallId, msg.id)
        this.emit('message', sessionId, msg)
      }
      turn.toolResultTextByToolCallId.set(data.toolCallId, finalContent)
    }
  }

  // ── 消息内容提取（从 chat message 中提取文本）──

  private extractMessageContent(message: Record<string, unknown>): string {
    if (typeof message.content === 'string') return message.content
    if (Array.isArray(message.content)) {
      return (message.content as Array<Record<string, unknown>>)
        .filter((block) => block.type === 'text')
        .map((block) => (block.text ?? '') as string)
        .join('')
    }
    return ''
  }
}
