import { describe, it, expect, vi, beforeEach } from 'vitest'

import { OpenclawGateway } from '../../../src/main/ai/gateway'
import type {
  ChatEventPayload,
  AgentEventPayload,
  ApprovalRequestedPayload,
  ApprovalResolvedPayload
} from '../../../src/main/ai/gateway'

// 通过 prototype 访问 private handleEvent 测试事件分发
function callHandleEvent(gw: OpenclawGateway, event: string, payload: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(gw as any).handleEvent({ event, payload })
}

describe('OpenclawGateway 事件分发', () => {
  let gw: OpenclawGateway

  beforeEach(() => {
    gw = new OpenclawGateway()
  })

  // ── chatEvent 统一事件 ──

  describe('chatEvent 按 state 构造 ChatEventPayload', () => {
    it('state=delta → 正确构造 ChatEventPayload', () => {
      const listener = vi.fn()
      gw.on('chatEvent', listener)

      callHandleEvent(gw, 'chat', {
        state: 'delta',
        sessionKey: 'agent:ws-123:petclaw:sess-1',
        message: { role: 'assistant', content: 'hello' }
      })

      expect(listener).toHaveBeenCalledTimes(1)
      const payload = listener.mock.calls[0][0] as ChatEventPayload
      expect(payload.sessionKey).toBe('agent:ws-123:petclaw:sess-1')
      expect(payload.state).toBe('delta')
      expect(payload.message).toEqual({ role: 'assistant', content: 'hello' })
      expect(payload.runId).toBeUndefined()
    })

    it('state=final → 正确携带 runId', () => {
      const listener = vi.fn()
      gw.on('chatEvent', listener)

      callHandleEvent(gw, 'chat', {
        state: 'final',
        sessionKey: 'agent:ws-123:petclaw:sess-1',
        runId: 'engine-abc',
        stopReason: 'end_turn'
      })

      const payload = listener.mock.calls[0][0] as ChatEventPayload
      expect(payload.state).toBe('final')
      expect(payload.runId).toBe('engine-abc')
      expect(payload.stopReason).toBe('end_turn')
    })

    it('state=final runId 为空时 runId 为 undefined', () => {
      const listener = vi.fn()
      gw.on('chatEvent', listener)

      callHandleEvent(gw, 'chat', {
        state: 'final',
        sessionKey: 'agent:ws-123:petclaw:sess-1'
      })

      const payload = listener.mock.calls[0][0] as ChatEventPayload
      expect(payload.state).toBe('final')
      expect(payload.runId).toBeUndefined()
    })

    it('state=error → 正确携带 errorMessage', () => {
      const listener = vi.fn()
      gw.on('chatEvent', listener)

      callHandleEvent(gw, 'chat', {
        state: 'error',
        sessionKey: 'agent:ws-123:petclaw:sess-1',
        errorMessage: 'rate limit exceeded'
      })

      const payload = listener.mock.calls[0][0] as ChatEventPayload
      expect(payload.state).toBe('error')
      expect(payload.errorMessage).toBe('rate limit exceeded')
    })

    it('state=aborted → 正确构造', () => {
      const listener = vi.fn()
      gw.on('chatEvent', listener)

      callHandleEvent(gw, 'chat', {
        state: 'aborted',
        sessionKey: 'agent:ws-123:petclaw:sess-1'
      })

      const payload = listener.mock.calls[0][0] as ChatEventPayload
      expect(payload.state).toBe('aborted')
      expect(payload.sessionKey).toBe('agent:ws-123:petclaw:sess-1')
    })

    it('无 sessionKey 时不 emit', () => {
      const listener = vi.fn()
      gw.on('chatEvent', listener)

      callHandleEvent(gw, 'chat', { state: 'delta' })
      callHandleEvent(gw, 'chat', { state: 'final' })

      expect(listener).not.toHaveBeenCalled()
    })

    it('无 state 时不 emit', () => {
      const listener = vi.fn()
      gw.on('chatEvent', listener)

      callHandleEvent(gw, 'chat', { sessionKey: 'agent:ws-123:petclaw:sess-1' })

      expect(listener).not.toHaveBeenCalled()
    })

    it('runId 空白字符串 trim 后为 undefined', () => {
      const listener = vi.fn()
      gw.on('chatEvent', listener)

      callHandleEvent(gw, 'chat', {
        state: 'delta',
        sessionKey: 'agent:ws-123:petclaw:sess-1',
        runId: '  '
      })

      const payload = listener.mock.calls[0][0] as ChatEventPayload
      expect(payload.runId).toBeUndefined()
    })
  })

  // ── agentEvent 统一事件 ──

  describe('agentEvent 按 stream 构造 AgentEventPayload', () => {
    it('stream=assistant → 正确构造', () => {
      const listener = vi.fn()
      gw.on('agentEvent', listener)

      callHandleEvent(gw, 'agent', {
        sessionKey: 'agent:ws-123:petclaw:sess-1',
        stream: 'assistant',
        runId: 'run-1',
        data: { text: 'hello world' }
      })

      expect(listener).toHaveBeenCalledTimes(1)
      const payload = listener.mock.calls[0][0] as AgentEventPayload
      expect(payload.sessionKey).toBe('agent:ws-123:petclaw:sess-1')
      expect(payload.stream).toBe('assistant')
      expect(payload.runId).toBe('run-1')
      expect(payload.data).toEqual({ text: 'hello world' })
    })

    it('stream=text → 正确构造', () => {
      const listener = vi.fn()
      gw.on('agentEvent', listener)

      callHandleEvent(gw, 'agent', {
        sessionKey: 'agent:ws-123:petclaw:sess-1',
        stream: 'text',
        data: { content: 'hello' }
      })

      const payload = listener.mock.calls[0][0] as AgentEventPayload
      expect(payload.stream).toBe('text')
      expect(payload.data).toEqual({ content: 'hello' })
    })

    it('stream=tool → 正确构造', () => {
      const listener = vi.fn()
      gw.on('agentEvent', listener)

      callHandleEvent(gw, 'agent', {
        sessionKey: 'agent:ws-123:petclaw:sess-1',
        stream: 'tool',
        data: {
          toolCallId: 'tc-1',
          phase: 'start',
          name: 'bash',
          args: { command: 'ls' }
        }
      })

      expect(listener).toHaveBeenCalledTimes(1)
      const payload = listener.mock.calls[0][0] as AgentEventPayload
      expect(payload.stream).toBe('tool')
      expect(payload.data?.toolCallId).toBe('tc-1')
    })

    it('stream=lifecycle → 正确构造', () => {
      const listener = vi.fn()
      gw.on('agentEvent', listener)

      callHandleEvent(gw, 'agent', {
        sessionKey: 'agent:ws-123:petclaw:sess-1',
        stream: 'lifecycle',
        runId: 'run-1',
        data: { phase: 'start' }
      })

      const payload = listener.mock.calls[0][0] as AgentEventPayload
      expect(payload.stream).toBe('lifecycle')
      expect(payload.runId).toBe('run-1')
      expect(payload.data).toEqual({ phase: 'start' })
    })

    it('seq 字段正确传递', () => {
      const listener = vi.fn()
      gw.on('agentEvent', listener)

      callHandleEvent(gw, 'agent', {
        sessionKey: 'agent:ws-123:petclaw:sess-1',
        stream: 'tool',
        seq: 42,
        data: { toolCallId: 'tc-1' }
      })

      const payload = listener.mock.calls[0][0] as AgentEventPayload
      expect(payload.seq).toBe(42)
    })

    it('seq 非 number 时为 undefined', () => {
      const listener = vi.fn()
      gw.on('agentEvent', listener)

      callHandleEvent(gw, 'agent', {
        sessionKey: 'agent:ws-123:petclaw:sess-1',
        stream: 'tool',
        seq: 'not-a-number',
        data: { toolCallId: 'tc-1' }
      })

      const payload = listener.mock.calls[0][0] as AgentEventPayload
      expect(payload.seq).toBeUndefined()
    })

    it('无 sessionKey 时不 emit', () => {
      const listener = vi.fn()
      gw.on('agentEvent', listener)

      callHandleEvent(gw, 'agent', {
        stream: 'assistant',
        data: { text: 'hello' }
      })

      expect(listener).not.toHaveBeenCalled()
    })

    it('stream 空白 trim 处理', () => {
      const listener = vi.fn()
      gw.on('agentEvent', listener)

      callHandleEvent(gw, 'agent', {
        sessionKey: 'agent:ws-123:petclaw:sess-1',
        stream: '  assistant  ',
        data: { text: 'hello' }
      })

      const payload = listener.mock.calls[0][0] as AgentEventPayload
      expect(payload.stream).toBe('assistant')
    })
  })

  // ── approvalRequested 事件 ──

  describe('approvalRequested', () => {
    it('正确构造 ApprovalRequestedPayload', () => {
      const listener = vi.fn()
      gw.on('approvalRequested', listener)

      callHandleEvent(gw, 'exec.approval.requested', {
        id: 'req-1',
        request: {
          sessionKey: 'agent:ws-123:petclaw:sess-1',
          command: 'bash',
          cwd: '/workspace',
          toolUseId: 'tu-1'
        }
      })

      expect(listener).toHaveBeenCalledTimes(1)
      const payload = listener.mock.calls[0][0] as ApprovalRequestedPayload
      expect(payload.id).toBe('req-1')
      expect(payload.request.sessionKey).toBe('agent:ws-123:petclaw:sess-1')
      expect(payload.request.command).toBe('bash')
      expect(payload.request.cwd).toBe('/workspace')
      expect(payload.request.toolUseId).toBe('tu-1')
    })

    it('无 id 时不 emit', () => {
      const listener = vi.fn()
      gw.on('approvalRequested', listener)

      callHandleEvent(gw, 'exec.approval.requested', {
        request: { sessionKey: 'agent:ws-123:petclaw:sess-1' }
      })

      expect(listener).not.toHaveBeenCalled()
    })

    it('无 request 时不 emit', () => {
      const listener = vi.fn()
      gw.on('approvalRequested', listener)

      callHandleEvent(gw, 'exec.approval.requested', { id: 'req-1' })

      expect(listener).not.toHaveBeenCalled()
    })
  })

  // ── approvalResolved 事件 ──

  describe('approvalResolved', () => {
    it('正确构造 ApprovalResolvedPayload', () => {
      const listener = vi.fn()
      gw.on('approvalResolved', listener)

      callHandleEvent(gw, 'exec.approval.resolved', { id: 'req-1' })

      expect(listener).toHaveBeenCalledTimes(1)
      const payload = listener.mock.calls[0][0] as ApprovalResolvedPayload
      expect(payload.id).toBe('req-1')
    })

    it('无 id 时不 emit', () => {
      const listener = vi.fn()
      gw.on('approvalResolved', listener)

      callHandleEvent(gw, 'exec.approval.resolved', {})

      expect(listener).not.toHaveBeenCalled()
    })
  })

  // ── tick 事件 ──

  describe('tick 事件', () => {
    it('emit tick', () => {
      const listener = vi.fn()
      gw.on('tick', listener)

      callHandleEvent(gw, 'tick', undefined)

      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  // ── chatAbort / chatSend 未连接 ──

  describe('chatAbort', () => {
    it('未连接时抛错', async () => {
      await expect(gw.chatAbort('key', 'run-1')).rejects.toThrow('Gateway not connected')
    })
  })

  describe('chatSend', () => {
    it('未连接时抛错', async () => {
      await expect(gw.chatSend('key', 'msg')).rejects.toThrow('Gateway not connected')
    })
  })

  // ── payload 为空时不 emit ──

  describe('空 payload 防护', () => {
    it('chat 空 payload 不 emit', () => {
      const listener = vi.fn()
      gw.on('chatEvent', listener)
      callHandleEvent(gw, 'chat', undefined)
      expect(listener).not.toHaveBeenCalled()
    })

    it('agent 空 payload 不 emit', () => {
      const listener = vi.fn()
      gw.on('agentEvent', listener)
      callHandleEvent(gw, 'agent', undefined)
      expect(listener).not.toHaveBeenCalled()
    })

    it('exec.approval.requested 空 payload 不 emit', () => {
      const listener = vi.fn()
      gw.on('approvalRequested', listener)
      callHandleEvent(gw, 'exec.approval.requested', undefined)
      expect(listener).not.toHaveBeenCalled()
    })

    it('exec.approval.resolved 空 payload 不 emit', () => {
      const listener = vi.fn()
      gw.on('approvalResolved', listener)
      callHandleEvent(gw, 'exec.approval.resolved', undefined)
      expect(listener).not.toHaveBeenCalled()
    })
  })
})
