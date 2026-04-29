import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

import { CoworkController } from '../../../src/main/ai/cowork-controller'
import type { CoworkMessage, CoworkSession } from '../../../src/main/ai/types'
import { buildSessionKey } from '../../../src/main/ai/types'
import type {
  OpenclawGateway,
  ChatEventPayload,
  ApprovalRequestedPayload
} from '../../../src/main/ai/gateway'
import type { CoworkStore } from '../../../src/main/data/cowork-store'
import type { ModelRegistry } from '../../../src/main/models/model-registry'

// Mock managed-prompts：简化 prompt 注入
vi.mock('../../../src/main/ai/managed-prompts', () => ({
  buildLocalTimeContext: () => '[time-context]'
}))

// Mock i18n
vi.mock('../../../src/main/i18n', () => ({
  t: (key: string) => key
}))

// ── Mock 工厂 ──

const TEST_AGENT_ID = 'ws-abc123'
const TEST_SESSION_ID = 'session-1'
const TEST_SESSION_KEY = buildSessionKey(TEST_AGENT_ID, TEST_SESSION_ID)

function createMockSession(overrides?: Partial<CoworkSession>): CoworkSession {
  return {
    id: TEST_SESSION_ID,
    title: 'Test Session',
    directoryPath: '/test/path',
    agentId: TEST_AGENT_ID,
    engineSessionId: null,
    status: 'idle',
    selectedModel: null,
    systemPrompt: '',
    pinned: false,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

function createMockGateway() {
  const gw = new EventEmitter() as EventEmitter & {
    chatSend: ReturnType<typeof vi.fn>
    chatAbort: ReturnType<typeof vi.fn>
    approvalResolve: ReturnType<typeof vi.fn>
    isConnected: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn>
    getClient: ReturnType<typeof vi.fn>
    ensureConnected: ReturnType<typeof vi.fn>
  }
  gw.chatSend = vi.fn().mockResolvedValue({ runId: undefined })
  gw.chatAbort = vi.fn().mockResolvedValue(undefined)
  gw.approvalResolve = vi.fn().mockResolvedValue(undefined)
  gw.isConnected = vi.fn().mockReturnValue(true)
  gw.connect = vi.fn().mockResolvedValue(undefined)
  gw.getClient = vi.fn().mockReturnValue(null)
  gw.ensureConnected = vi.fn().mockResolvedValue(undefined)
  return gw
}

let msgIdCounter = 0

function createMockStore() {
  return {
    getSession: vi.fn().mockReturnValue(createMockSession()),
    updateSession: vi.fn(),
    addMessage: vi
      .fn()
      .mockImplementation(
        (_sessionId: string, type: string, content: string, metadata?: unknown) => {
          msgIdCounter++
          return {
            id: `msg-${msgIdCounter}`,
            type,
            content,
            timestamp: Date.now(),
            metadata
          } satisfies CoworkMessage
        }
      ),
    updateMessageContent: vi.fn(),
    getMessages: vi.fn().mockReturnValue([])
  }
}

describe('CoworkController', () => {
  let gateway: ReturnType<typeof createMockGateway>
  let store: ReturnType<typeof createMockStore>
  let modelRegistry: ModelRegistry
  let controller: CoworkController

  beforeEach(() => {
    msgIdCounter = 0
    vi.useFakeTimers()
    gateway = createMockGateway()
    store = createMockStore()
    modelRegistry = {
      toOpenClawModelRef: vi.fn((selected: { providerId: string; modelId: string }) => {
        if (selected.providerId === 'gemini') return `google/${selected.modelId}`
        return `${selected.providerId}/${selected.modelId}`
      })
    } as unknown as ModelRegistry
    controller = new CoworkController(
      gateway as unknown as OpenclawGateway,
      store as unknown as CoworkStore,
      modelRegistry
    )
  })

  afterEach(() => {
    controller.dispose()
    vi.useRealTimers()
  })

  // 辅助：启动 session 并通过 chatEvent final 完成 turn
  // startSession 内部 await completionPromise，需要并发触发事件来 resolve
  async function startAndComplete(
    sessionId: string,
    prompt: string,
    opts?: { skipFinal?: boolean; systemPrompt?: string; skillIds?: string[]; skillPrompt?: string }
  ): Promise<void> {
    const sessionKey = buildSessionKey(TEST_AGENT_ID, sessionId)

    const startOptions =
      opts?.systemPrompt || opts?.skillIds || opts?.skillPrompt
        ? {
            systemPrompt: opts.systemPrompt,
            skillIds: opts.skillIds,
            skillPrompt: opts.skillPrompt
          }
        : undefined
    const startPromise = controller.startSession(sessionId, prompt, startOptions)

    if (!opts?.skipFinal) {
      // 用 nextTick 确保 startSession 内部已注册事件监听
      await vi.advanceTimersByTimeAsync(0)

      gateway.emit('chatEvent', {
        sessionKey,
        state: 'final',
        stopReason: 'end_turn'
      } satisfies ChatEventPayload)
    }

    await startPromise
  }

  describe('startSession', () => {
    it('设置 status=running，添加 user message，调用 gateway.chatSend', async () => {
      await startAndComplete(TEST_SESSION_ID, 'hello')

      expect(store.updateSession).toHaveBeenCalledWith(TEST_SESSION_ID, { status: 'running' })
      expect(store.addMessage).toHaveBeenCalledWith(
        TEST_SESSION_ID,
        'user',
        'hello',
        undefined // 无 imageAttachments
      )
      expect(gateway.chatSend).toHaveBeenCalledWith(
        TEST_SESSION_KEY,
        expect.stringContaining('hello'),
        expect.objectContaining({
          idempotencyKey: expect.any(String),
          deliver: false
        })
      )
    })

    it('session 运行中再次 start 抛错', async () => {
      // 不发 final，让 turn 保持 running
      const startPromise = controller.startSession(TEST_SESSION_ID, 'hello')
      await vi.advanceTimersByTimeAsync(0)

      await expect(controller.startSession(TEST_SESSION_ID, 'again')).rejects.toThrow(
        /still running/
      )

      // 清理：发 final 完成 turn
      gateway.emit('chatEvent', {
        sessionKey: TEST_SESSION_KEY,
        state: 'final',
        stopReason: 'end_turn'
      } satisfies ChatEventPayload)
      await startPromise
    })

    it('prompt 为空时抛错', async () => {
      await expect(controller.startSession(TEST_SESSION_ID, '  ')).rejects.toThrow(
        /Prompt is required/
      )
    })

    it('session 不存在时抛错', async () => {
      store.getSession.mockReturnValue(null)
      await expect(controller.startSession('no-such', 'hello')).rejects.toThrow(/not found/)
    })

    it('将 selectedModel 转换为 OpenClaw 模型引用后 patch session', async () => {
      const client = { request: vi.fn().mockResolvedValue(undefined) }
      gateway.getClient.mockReturnValue(client)

      const startPromise = controller.startSession(TEST_SESSION_ID, 'hello', {
        selectedModel: { providerId: 'gemini', modelId: 'gemini-2.0-flash' }
      })
      await vi.advanceTimersByTimeAsync(0)
      gateway.emit('chatEvent', {
        sessionKey: TEST_SESSION_KEY,
        state: 'final',
        stopReason: 'end_turn'
      } satisfies ChatEventPayload)
      await startPromise

      expect(modelRegistry.toOpenClawModelRef).toHaveBeenCalledWith({
        providerId: 'gemini',
        modelId: 'gemini-2.0-flash'
      })
      expect(client.request).toHaveBeenCalledWith('sessions.patch', {
        key: TEST_SESSION_KEY,
        model: 'google/gemini-2.0-flash'
      })
    })

    it('转发 message 事件（user 消息）', async () => {
      const msgListener = vi.fn()
      controller.on('message', msgListener)

      await startAndComplete(TEST_SESSION_ID, 'hello')

      expect(msgListener).toHaveBeenCalledWith(
        TEST_SESSION_ID,
        expect.objectContaining({ type: 'user', content: 'hello' })
      )
    })

    it('首轮 prompt 包含上层传入的 system instructions', async () => {
      await startAndComplete(TEST_SESSION_ID, 'hello', {
        systemPrompt: '[section-1]\n\n[section-2]'
      })

      const outboundPrompt = gateway.chatSend.mock.calls[0][1] as string
      expect(outboundPrompt).toContain('[PetClaw system instructions]')
      expect(outboundPrompt).toContain('[section-1]')
      expect(outboundPrompt).toContain('[section-2]')
    })

    it('首轮 prompt 包含本轮选中的 skill prompt', async () => {
      await startAndComplete(TEST_SESSION_ID, 'hello', {
        systemPrompt: '[base-system]',
        skillPrompt: '## Skill: docx\nUse docx.'
      })

      const outboundPrompt = gateway.chatSend.mock.calls[0][1] as string
      expect(outboundPrompt).toContain('[PetClaw system instructions]')
      expect(outboundPrompt).toContain('## Skill: docx')
      expect(outboundPrompt).toContain('Use docx.')
      expect(outboundPrompt.indexOf('## Skill: docx')).toBeLessThan(
        outboundPrompt.indexOf('[base-system]')
      )
    })

    it('第二轮 prompt 不重复注入 system instructions', async () => {
      await startAndComplete(TEST_SESSION_ID, 'hello', {
        systemPrompt: '[section-1]\n\n[section-2]'
      })

      // 第二轮
      gateway.chatSend.mockClear()
      const p2 = controller.startSession(TEST_SESSION_ID, 'follow up', {
        systemPrompt: '[section-1]\n\n[section-2]'
      })
      await vi.advanceTimersByTimeAsync(0)
      gateway.emit('chatEvent', {
        sessionKey: TEST_SESSION_KEY,
        state: 'final',
        stopReason: 'end_turn'
      } satisfies ChatEventPayload)
      await p2

      const secondPrompt = gateway.chatSend.mock.calls[0][1] as string
      expect(secondPrompt).not.toContain('[PetClaw system instructions]')
    })

    it('systemPrompt 变化时下一轮重新注入 system instructions', async () => {
      await startAndComplete(TEST_SESSION_ID, 'hello', {
        systemPrompt: 'old prompt'
      })

      gateway.chatSend.mockClear()
      const p2 = controller.startSession(TEST_SESSION_ID, 'follow up', {
        systemPrompt: 'new prompt'
      })
      await vi.advanceTimersByTimeAsync(0)
      gateway.emit('chatEvent', {
        sessionKey: TEST_SESSION_KEY,
        state: 'final',
        stopReason: 'end_turn'
      } satisfies ChatEventPayload)
      await p2

      const secondPrompt = gateway.chatSend.mock.calls[0][1] as string
      expect(secondPrompt).toContain('[PetClaw system instructions]')
      expect(secondPrompt).toContain('new prompt')
    })

    it('skillIds 写入 user message metadata', async () => {
      await startAndComplete(TEST_SESSION_ID, 'hello', { skillIds: ['docx', 'pdf'] })

      expect(store.addMessage).toHaveBeenCalledWith(TEST_SESSION_ID, 'user', 'hello', {
        skillIds: ['docx', 'pdf']
      })
    })
  })

  describe('chatEvent 路由', () => {
    it('chatEvent delta → 创建 assistant 消息并 emit message', async () => {
      const msgListener = vi.fn()
      controller.on('message', msgListener)

      const startPromise = controller.startSession(TEST_SESSION_ID, 'hello')
      await vi.advanceTimersByTimeAsync(0)

      // 发送 delta
      gateway.emit('chatEvent', {
        sessionKey: TEST_SESSION_KEY,
        state: 'delta',
        message: { role: 'assistant', content: 'hi there' }
      } satisfies ChatEventPayload)

      // 检查 assistant 消息被创建
      expect(store.addMessage).toHaveBeenCalledWith(
        TEST_SESSION_ID,
        'assistant',
        expect.any(String),
        expect.objectContaining({ isStreaming: true })
      )

      // 完成 turn
      gateway.emit('chatEvent', {
        sessionKey: TEST_SESSION_KEY,
        state: 'final',
        stopReason: 'end_turn'
      } satisfies ChatEventPayload)
      await startPromise
    })

    it('chatEvent final → 更新 status=completed，emit complete', async () => {
      const completeListener = vi.fn()
      controller.on('complete', completeListener)

      await startAndComplete(TEST_SESSION_ID, 'hello')

      expect(store.updateSession).toHaveBeenCalledWith(
        TEST_SESSION_ID,
        expect.objectContaining({ status: 'completed' })
      )
      // chatFinal 无 runId 时，complete 事件传 null
      expect(completeListener).toHaveBeenCalledWith(TEST_SESSION_ID, null)
      expect(controller.isSessionActive(TEST_SESSION_ID)).toBe(false)
    })

    it('chatEvent error → 更新 status=error，emit error', async () => {
      const errorListener = vi.fn()
      controller.on('error', errorListener)

      const startPromise = controller.startSession(TEST_SESSION_ID, 'hello')
      await vi.advanceTimersByTimeAsync(0)

      gateway.emit('chatEvent', {
        sessionKey: TEST_SESSION_KEY,
        state: 'error',
        errorMessage: 'rate limit exceeded'
      } satisfies ChatEventPayload)

      await expect(startPromise).rejects.toThrow('rate limit exceeded')
      expect(store.updateSession).toHaveBeenCalledWith(TEST_SESSION_ID, { status: 'error' })
      expect(errorListener).toHaveBeenCalledWith(TEST_SESSION_ID, 'rate limit exceeded')
      expect(controller.isSessionActive(TEST_SESSION_ID)).toBe(false)
    })

    it('chatEvent aborted（非用户主动停止）→ 添加提示消息，status=idle', async () => {
      const msgListener = vi.fn()
      controller.on('message', msgListener)

      const startPromise = controller.startSession(TEST_SESSION_ID, 'hello')
      await vi.advanceTimersByTimeAsync(0)

      gateway.emit('chatEvent', {
        sessionKey: TEST_SESSION_KEY,
        state: 'aborted'
      } satisfies ChatEventPayload)

      await startPromise

      expect(store.updateSession).toHaveBeenCalledWith(TEST_SESSION_ID, { status: 'idle' })
      // 非手动停止 → 应添加超时提示消息
      const assistantMsgs = msgListener.mock.calls.filter(
        ([, msg]: [string, CoworkMessage]) => msg.type === 'assistant' && msg.metadata?.isTimeout
      )
      expect(assistantMsgs.length).toBe(1)
    })

    it('sessionKey 不匹配时忽略事件', async () => {
      const startPromise = controller.startSession(TEST_SESSION_ID, 'hello')
      await vi.advanceTimersByTimeAsync(0)

      // 发送不匹配的 sessionKey
      gateway.emit('chatEvent', {
        sessionKey: 'agent:other:petclaw:other-session',
        state: 'final',
        stopReason: 'end_turn'
      } satisfies ChatEventPayload)

      // turn 仍然活跃
      expect(controller.isSessionActive(TEST_SESSION_ID)).toBe(true)

      // 清理
      gateway.emit('chatEvent', {
        sessionKey: TEST_SESSION_KEY,
        state: 'final',
        stopReason: 'end_turn'
      } satisfies ChatEventPayload)
      await startPromise
    })
  })

  describe('approvalRequested 路由', () => {
    it('删除命令 approvalRequested → emit permissionRequest', async () => {
      const permListener = vi.fn()
      controller.on('permissionRequest', permListener)

      const startPromise = controller.startSession(TEST_SESSION_ID, 'hello')
      await vi.advanceTimersByTimeAsync(0)

      // 使用 rm 命令（删除命令）触发弹窗审批
      gateway.emit('approvalRequested', {
        id: 'req-1',
        request: {
          sessionKey: TEST_SESSION_KEY,
          command: 'rm -rf /tmp/test',
          cwd: '/workspace',
          toolUseId: 'tu-1'
        }
      } satisfies ApprovalRequestedPayload)

      expect(permListener).toHaveBeenCalledWith(
        TEST_SESSION_ID,
        expect.objectContaining({
          requestId: 'req-1',
          toolName: 'Bash',
          toolInput: expect.objectContaining({
            command: 'rm -rf /tmp/test',
            dangerLevel: 'destructive'
          })
        })
      )

      // 清理
      gateway.emit('chatEvent', {
        sessionKey: TEST_SESSION_KEY,
        state: 'final',
        stopReason: 'end_turn'
      } satisfies ChatEventPayload)
      await startPromise
    })

    it('非删除命令 approvalRequested → auto-approve（不 emit permissionRequest）', async () => {
      const permListener = vi.fn()
      controller.on('permissionRequest', permListener)

      const startPromise = controller.startSession(TEST_SESSION_ID, 'hello')
      await vi.advanceTimersByTimeAsync(0)

      // 使用 ls 命令（安全命令）应自动批准
      gateway.emit('approvalRequested', {
        id: 'req-2',
        request: {
          sessionKey: TEST_SESSION_KEY,
          command: 'ls -la',
          cwd: '/workspace'
        }
      } satisfies ApprovalRequestedPayload)

      // 不应弹窗
      expect(permListener).not.toHaveBeenCalled()
      // 应直接调用 approvalResolve，decision 为 allow-always
      expect(gateway.approvalResolve).toHaveBeenCalledWith('req-2', 'allow-always')

      // 清理
      gateway.emit('chatEvent', {
        sessionKey: TEST_SESSION_KEY,
        state: 'final',
        stopReason: 'end_turn'
      } satisfies ChatEventPayload)
      await startPromise
    })

    it('approvalResolved → emit permissionDismiss', () => {
      const dismissListener = vi.fn()
      controller.on('permissionDismiss', dismissListener)

      gateway.emit('approvalResolved', {
        id: 'req-1'
      } satisfies ApprovalResolvedPayload)

      expect(dismissListener).toHaveBeenCalledWith('req-1')
    })
  })

  describe('disconnected 路由', () => {
    it('disconnected → 所有活跃 session 变 error', async () => {
      const errorListener = vi.fn()
      controller.on('error', errorListener)

      // 启动两个 session
      store.getSession.mockImplementation((id: string) =>
        createMockSession({ id, agentId: TEST_AGENT_ID })
      )

      const p1 = controller.startSession('s-1', 'test1')
      await vi.advanceTimersByTimeAsync(0)
      const p2 = controller.startSession('s-2', 'test2')
      await vi.advanceTimersByTimeAsync(0)

      expect(controller.getActiveSessionCount()).toBe(2)

      gateway.emit('disconnected', 'network timeout')

      // 两个 promise 都应该 reject
      await expect(p1).rejects.toThrow(/Gateway disconnected/)
      await expect(p2).rejects.toThrow(/Gateway disconnected/)

      expect(controller.getActiveSessionCount()).toBe(0)
      expect(store.updateSession).toHaveBeenCalledWith('s-1', { status: 'error' })
      expect(store.updateSession).toHaveBeenCalledWith('s-2', { status: 'error' })
      expect(errorListener).toHaveBeenCalledTimes(2)
    })

    it('disconnected → 无活跃 session 时不发出 error 事件', () => {
      const errorListener = vi.fn()
      controller.on('error', errorListener)

      gateway.emit('disconnected', 'server closed')

      expect(errorListener).not.toHaveBeenCalled()
      expect(controller.getActiveSessionCount()).toBe(0)
    })
  })

  describe('respondToPermission', () => {
    it('删除命令审批后调用 gateway.approvalResolve（decision=allow-once）', async () => {
      const startPromise = controller.startSession(TEST_SESSION_ID, 'hello')
      await vi.advanceTimersByTimeAsync(0)

      // 先触发一个删除命令的 approval（会 emit permissionRequest，不会 auto-approve）
      gateway.emit('approvalRequested', {
        id: 'req-1',
        request: {
          sessionKey: TEST_SESSION_KEY,
          command: 'rm -rf /tmp/test',
          cwd: '/workspace'
        }
      } satisfies ApprovalRequestedPayload)

      // 用户手动批准
      const result = { behavior: 'allow' as const }
      controller.respondToPermission('req-1', result)
      expect(gateway.approvalResolve).toHaveBeenCalledWith('req-1', 'allow-once')

      // 清理
      gateway.emit('chatEvent', {
        sessionKey: TEST_SESSION_KEY,
        state: 'final',
        stopReason: 'end_turn'
      } satisfies ChatEventPayload)
      await startPromise
    })

    it('无 pending approval 时 respondToPermission 为 no-op', () => {
      const result = { behavior: 'allow' as const }
      controller.respondToPermission('unknown-req', result)
      expect(gateway.approvalResolve).not.toHaveBeenCalled()
    })
  })

  describe('stopSession', () => {
    it('标记 turn.stopRequested，调用 chatAbort，emit sessionStopped', async () => {
      const stoppedListener = vi.fn()
      controller.on('sessionStopped', stoppedListener)

      const startPromise = controller.startSession(TEST_SESSION_ID, 'test')
      await vi.advanceTimersByTimeAsync(0)

      expect(controller.isSessionActive(TEST_SESSION_ID)).toBe(true)

      controller.stopSession(TEST_SESSION_ID)

      expect(controller.isSessionActive(TEST_SESSION_ID)).toBe(false)
      expect(store.updateSession).toHaveBeenCalledWith(TEST_SESSION_ID, { status: 'idle' })
      expect(gateway.chatAbort).toHaveBeenCalled()
      expect(stoppedListener).toHaveBeenCalledWith(TEST_SESSION_ID)

      await startPromise // stopSession 内部 resolveTurn
    })
  })

  describe('状态查询', () => {
    it('isSessionActive 正确反映活跃状态', async () => {
      expect(controller.isSessionActive(TEST_SESSION_ID)).toBe(false)

      const startPromise = controller.startSession(TEST_SESSION_ID, 'test')
      await vi.advanceTimersByTimeAsync(0)

      expect(controller.isSessionActive(TEST_SESSION_ID)).toBe(true)

      gateway.emit('chatEvent', {
        sessionKey: TEST_SESSION_KEY,
        state: 'final',
        stopReason: 'end_turn'
      } satisfies ChatEventPayload)
      await startPromise

      expect(controller.isSessionActive(TEST_SESSION_ID)).toBe(false)
    })

    it('getActiveSessionCount 返回活跃 session 数量', async () => {
      expect(controller.getActiveSessionCount()).toBe(0)

      store.getSession.mockImplementation((id: string) =>
        createMockSession({ id, agentId: TEST_AGENT_ID })
      )

      const p1 = controller.startSession('s-1', 'test')
      await vi.advanceTimersByTimeAsync(0)
      expect(controller.getActiveSessionCount()).toBe(1)

      const p2 = controller.startSession('s-2', 'test')
      await vi.advanceTimersByTimeAsync(0)
      expect(controller.getActiveSessionCount()).toBe(2)

      // 停止 s-1
      controller.stopSession('s-1')
      await p1
      expect(controller.getActiveSessionCount()).toBe(1)

      // 完成 s-2
      gateway.emit('chatEvent', {
        sessionKey: buildSessionKey(TEST_AGENT_ID, 's-2'),
        state: 'final',
        stopReason: 'end_turn'
      } satisfies ChatEventPayload)
      await p2
      expect(controller.getActiveSessionCount()).toBe(0)
    })
  })

  describe('onSessionDeleted', () => {
    it('清理关联状态', async () => {
      const startPromise = controller.startSession(TEST_SESSION_ID, 'test')
      await vi.advanceTimersByTimeAsync(0)

      // 删除 session → 应清理内部状态
      controller.onSessionDeleted(TEST_SESSION_ID)

      expect(controller.isSessionActive(TEST_SESSION_ID)).toBe(false)
      await startPromise // onSessionDeleted 内部 resolveTurn
    })
  })
})
