import { EventEmitter } from 'events'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { BrowserWindow } from 'electron'

import { PetEventBridge } from '../../../src/main/pet/pet-event-bridge'
import type { CoworkController } from '../../../src/main/ai/cowork-controller'
import type { CoworkMessage } from '../../../src/main/ai/types'

vi.mock('electron')

function createMockWindow() {
  return { webContents: { send: vi.fn() } } as unknown as BrowserWindow
}

function createUserMessage(content = 'hello'): CoworkMessage {
  return { id: '1', type: 'user', content, timestamp: Date.now() }
}

function createAssistantMessage(content = 'hi'): CoworkMessage {
  return { id: '2', type: 'assistant', content, timestamp: Date.now() }
}

describe('PetEventBridge', () => {
  let emitter: EventEmitter
  let win: BrowserWindow
  let send: ReturnType<typeof vi.fn>

  beforeEach(() => {
    emitter = new EventEmitter()
    win = createMockWindow()
    send = win.webContents.send as ReturnType<typeof vi.fn>
    // 构造 bridge 时绑定事件
    new PetEventBridge(win, emitter as unknown as CoworkController)
  })

  it('用户消息触发 CHAT_SENT', () => {
    emitter.emit('message', 's1', createUserMessage())
    expect(send).toHaveBeenCalledWith('pet:state-event', { event: 'CHAT_SENT' })
  })

  it('多个用户消息只在首次(0->1)触发 CHAT_SENT', () => {
    emitter.emit('message', 's1', createUserMessage())
    emitter.emit('message', 's2', createUserMessage())

    const chatSentCalls = send.mock.calls.filter(
      (c: unknown[]) =>
        c[0] === 'pet:state-event' && (c[1] as { event: string }).event === 'CHAT_SENT'
    )
    expect(chatSentCalls).toHaveLength(1)
  })

  it('非用户消息不触发 CHAT_SENT', () => {
    emitter.emit('message', 's1', createAssistantMessage())
    expect(send).not.toHaveBeenCalled()
  })

  it('messageUpdate 首次触发 AI_RESPONDING', () => {
    emitter.emit('messageUpdate', 's1', 'msg1', 'some content')
    expect(send).toHaveBeenCalledWith('pet:state-event', { event: 'AI_RESPONDING' })
  })

  it('同一 session 的后续 messageUpdate 不再触发 AI_RESPONDING', () => {
    emitter.emit('messageUpdate', 's1', 'msg1', 'first')
    emitter.emit('messageUpdate', 's1', 'msg1', 'second')

    const respondingCalls = send.mock.calls.filter(
      (c: unknown[]) =>
        c[0] === 'pet:state-event' && (c[1] as { event: string }).event === 'AI_RESPONDING'
    )
    expect(respondingCalls).toHaveLength(1)
  })

  it('messageUpdate 发送气泡文本（截取末尾50字符）', () => {
    const longText = 'a'.repeat(100)
    emitter.emit('messageUpdate', 's1', 'msg1', longText)
    // sendBubble 现在携带 source 字段标识消息来源
    expect(send).toHaveBeenCalledWith('pet:bubble', { text: 'a'.repeat(50), source: 'chat' })
  })

  it('complete 递减计数，最后一个会话完成时触发 AI_DONE', () => {
    // 启动两个会话
    emitter.emit('message', 's1', createUserMessage())
    emitter.emit('message', 's2', createUserMessage())
    send.mockClear()

    // 第一个完成，不应触发 AI_DONE
    emitter.emit('complete', 's1', null)
    const doneCalls1 = send.mock.calls.filter(
      (c: unknown[]) =>
        c[0] === 'pet:state-event' && (c[1] as { event: string }).event === 'AI_DONE'
    )
    expect(doneCalls1).toHaveLength(0)

    // 第二个完成，应触发 AI_DONE
    emitter.emit('complete', 's2', null)
    const doneCalls2 = send.mock.calls.filter(
      (c: unknown[]) =>
        c[0] === 'pet:state-event' && (c[1] as { event: string }).event === 'AI_DONE'
    )
    expect(doneCalls2).toHaveLength(1)
  })

  it('error 也触发 AI_DONE（最后一个会话）', () => {
    emitter.emit('message', 's1', createUserMessage())
    send.mockClear()

    emitter.emit('error', 's1', 'some error')
    expect(send).toHaveBeenCalledWith('pet:state-event', { event: 'AI_DONE' })
  })

  it('sessionStopped 也触发清理和 AI_DONE', () => {
    emitter.emit('message', 's1', createUserMessage())
    send.mockClear()

    emitter.emit('sessionStopped', 's1')
    expect(send).toHaveBeenCalledWith('pet:state-event', { event: 'AI_DONE' })
  })

  it('complete 清理 firstResponseSent 标记，新会话可重新触发 AI_RESPONDING', () => {
    emitter.emit('message', 's1', createUserMessage())
    emitter.emit('messageUpdate', 's1', 'msg1', 'content')
    emitter.emit('complete', 's1', null)
    send.mockClear()

    // 同一 sessionId 再次开始，应重新触发 AI_RESPONDING
    emitter.emit('message', 's1', createUserMessage())
    emitter.emit('messageUpdate', 's1', 'msg2', 'new content')
    expect(send).toHaveBeenCalledWith('pet:state-event', { event: 'AI_RESPONDING' })
  })

  it('permissionRequest 发送气泡消息包含工具名', () => {
    emitter.emit('permissionRequest', 's1', { toolName: 'bash' })
    // sendBubble 携带 source:'approval' 标识消息来源
    expect(send).toHaveBeenCalledWith('pet:bubble', { text: '等待审批：bash', source: 'approval' })
  })

  it('permissionRequest 无工具名时显示 unknown', () => {
    emitter.emit('permissionRequest', 's1', {})
    expect(send).toHaveBeenCalledWith('pet:bubble', {
      text: '等待审批：unknown',
      source: 'approval'
    })
  })
})
