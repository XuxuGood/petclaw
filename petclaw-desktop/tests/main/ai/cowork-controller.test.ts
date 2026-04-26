import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

import { CoworkController } from '../../../src/main/ai/cowork-controller'
import type { CoworkMessage } from '../../../src/main/ai/types'
import type { OpenclawGateway } from '../../../src/main/ai/gateway'
import type { CoworkStore } from '../../../src/main/data/cowork-store'

// Mock Gateway
function createMockGateway() {
  const gw = new EventEmitter() as EventEmitter & {
    chatSend: ReturnType<typeof vi.fn>
    chatStop: ReturnType<typeof vi.fn>
    approvalResolve: ReturnType<typeof vi.fn>
  }
  gw.chatSend = vi.fn().mockResolvedValue(undefined)
  gw.chatStop = vi.fn().mockResolvedValue(undefined)
  gw.approvalResolve = vi.fn().mockResolvedValue(undefined)
  return gw
}

// Mock Store
function createMockStore() {
  return {
    updateSession: vi.fn(),
    addMessage: vi.fn().mockReturnValue({
      id: 'msg-1',
      type: 'user',
      content: 'test',
      timestamp: Date.now()
    } satisfies CoworkMessage),
    updateMessageContent: vi.fn(),
    getMessages: vi.fn().mockReturnValue([
      {
        id: 'msg-1',
        type: 'user',
        content: 'test',
        timestamp: Date.now()
      } satisfies CoworkMessage
    ])
  }
}

describe('CoworkController', () => {
  let gateway: ReturnType<typeof createMockGateway>
  let store: ReturnType<typeof createMockStore>
  let controller: CoworkController

  beforeEach(() => {
    gateway = createMockGateway()
    store = createMockStore()
    controller = new CoworkController(
      gateway as unknown as OpenclawGateway,
      store as unknown as CoworkStore
    )
  })

  describe('startSession', () => {
    it('设置 status=running，添加 user message，调用 gateway.chatSend', async () => {
      const sessionId = 'session-1'
      const prompt = 'hello'

      await controller.startSession(sessionId, prompt)

      expect(store.updateSession).toHaveBeenCalledWith(sessionId, { status: 'running' })
      expect(store.addMessage).toHaveBeenCalledWith(sessionId, 'user', prompt)
      expect(gateway.chatSend).toHaveBeenCalledWith(sessionId, prompt, undefined)
    })

    it('将 sessionId 加入 activeSessionIds', async () => {
      await controller.startSession('session-1', 'test')
      expect(controller.isSessionActive('session-1')).toBe(true)
    })

    it('转发 message 事件给监听方', async () => {
      const msgListener = vi.fn()
      controller.on('message', msgListener)

      await controller.startSession('session-1', 'hello')

      expect(msgListener).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ type: 'user' })
      )
    })

    it('传递 options 给 gateway.chatSend', async () => {
      const options = { skillIds: ['skill-a'], autoApprove: true }
      await controller.startSession('session-1', 'hello', options)
      expect(gateway.chatSend).toHaveBeenCalledWith('session-1', 'hello', options)
    })
  })

  describe('Gateway 事件路由', () => {
    it('message 事件 → 持久化到 Store 并转发', () => {
      const msg: CoworkMessage = {
        id: 'msg-2',
        type: 'assistant',
        content: 'hi',
        timestamp: Date.now()
      }
      const listener = vi.fn()
      controller.on('message', listener)

      gateway.emit('message', 'session-1', msg)

      expect(store.addMessage).toHaveBeenCalledWith(
        'session-1',
        msg.type,
        msg.content,
        msg.metadata
      )
      expect(listener).toHaveBeenCalledWith('session-1', msg)
    })

    it('messageUpdate 事件 → 更新 Store 并转发', () => {
      const listener = vi.fn()
      controller.on('messageUpdate', listener)

      gateway.emit('messageUpdate', 'session-1', 'msg-2', 'updated content')

      expect(store.updateMessageContent).toHaveBeenCalledWith('msg-2', 'updated content')
      expect(listener).toHaveBeenCalledWith('session-1', 'msg-2', 'updated content')
    })

    it('complete 事件 → 移除 activeSessionIds，更新 status=completed', async () => {
      await controller.startSession('session-1', 'test')
      expect(controller.isSessionActive('session-1')).toBe(true)

      const listener = vi.fn()
      controller.on('complete', listener)

      gateway.emit('complete', 'session-1', 'engine-session-abc')

      expect(controller.isSessionActive('session-1')).toBe(false)
      expect(store.updateSession).toHaveBeenCalledWith('session-1', {
        status: 'completed',
        engineSessionId: 'engine-session-abc'
      })
      expect(listener).toHaveBeenCalledWith('session-1', 'engine-session-abc')
    })

    it('error 事件 → 移除 activeSessionIds，更新 status=error', async () => {
      await controller.startSession('session-1', 'test')
      expect(controller.isSessionActive('session-1')).toBe(true)

      const listener = vi.fn()
      controller.on('error', listener)

      gateway.emit('error', 'session-1', 'something went wrong')

      expect(controller.isSessionActive('session-1')).toBe(false)
      expect(store.updateSession).toHaveBeenCalledWith('session-1', { status: 'error' })
      expect(listener).toHaveBeenCalledWith('session-1', 'something went wrong')
    })

    it('permissionRequest 事件 → 直接转发给监听方', () => {
      const listener = vi.fn()
      controller.on('permissionRequest', listener)

      const req = { requestId: 'req-1', toolName: 'bash', toolInput: { command: 'ls' } }
      gateway.emit('permissionRequest', 'session-1', req)

      expect(listener).toHaveBeenCalledWith('session-1', req)
    })

    it('disconnected 事件 → 所有活跃 session 变 error，清空 activeSessionIds', async () => {
      await controller.startSession('session-1', 'test1')
      await controller.startSession('session-2', 'test2')
      expect(controller.getActiveSessionCount()).toBe(2)

      const errorListener = vi.fn()
      controller.on('error', errorListener)

      gateway.emit('disconnected', 'network timeout')

      expect(controller.getActiveSessionCount()).toBe(0)
      expect(store.updateSession).toHaveBeenCalledWith('session-1', { status: 'error' })
      expect(store.updateSession).toHaveBeenCalledWith('session-2', { status: 'error' })
      expect(errorListener).toHaveBeenCalledWith('session-1', 'Gateway 连接断开: network timeout')
      expect(errorListener).toHaveBeenCalledWith('session-2', 'Gateway 连接断开: network timeout')
    })

    it('disconnected 事件 → 无活跃 session 时不发出 error 事件', () => {
      const errorListener = vi.fn()
      controller.on('error', errorListener)

      gateway.emit('disconnected', 'server closed')

      expect(errorListener).not.toHaveBeenCalled()
      expect(controller.getActiveSessionCount()).toBe(0)
    })
  })

  describe('respondToPermission', () => {
    it('调用 gateway.approvalResolve', () => {
      const result = { behavior: 'allow' as const }
      controller.respondToPermission('req-1', result)
      expect(gateway.approvalResolve).toHaveBeenCalledWith('req-1', result)
    })
  })

  describe('stopSession', () => {
    it('移除 activeSessionIds，更新 status=idle，发出 sessionStopped 事件', async () => {
      await controller.startSession('session-1', 'test')
      expect(controller.isSessionActive('session-1')).toBe(true)

      const listener = vi.fn()
      controller.on('sessionStopped', listener)

      controller.stopSession('session-1')

      expect(controller.isSessionActive('session-1')).toBe(false)
      expect(store.updateSession).toHaveBeenCalledWith('session-1', { status: 'idle' })
      expect(listener).toHaveBeenCalledWith('session-1')
    })
  })

  describe('状态查询', () => {
    it('isSessionActive 正确反映活跃状态', async () => {
      expect(controller.isSessionActive('session-1')).toBe(false)
      await controller.startSession('session-1', 'test')
      expect(controller.isSessionActive('session-1')).toBe(true)
    })

    it('getActiveSessionCount 返回活跃 session 数量', async () => {
      expect(controller.getActiveSessionCount()).toBe(0)

      await controller.startSession('session-1', 'test')
      expect(controller.getActiveSessionCount()).toBe(1)

      await controller.startSession('session-2', 'test')
      expect(controller.getActiveSessionCount()).toBe(2)

      controller.stopSession('session-1')
      expect(controller.getActiveSessionCount()).toBe(1)
    })
  })
})
