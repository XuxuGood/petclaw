import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '../../../src/renderer/src/stores/chat-store'

describe('ChatStore', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
  })

  it('starts with empty messages', () => {
    const state = useChatStore.getState()
    expect(state.messages).toEqual([])
    expect(state.isLoading).toBe(false)
  })

  it('adds a user message', () => {
    useChatStore.getState().addMessage({ role: 'user', content: 'hello' })
    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0].role).toBe('user')
  })

  it('appends to the last assistant message during streaming', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: '' })
    useChatStore.getState().appendToLastMessage('Hello')
    useChatStore.getState().appendToLastMessage(' world')
    expect(useChatStore.getState().messages[0].content).toBe('Hello world')
  })

  it('replaces the last assistant message with a streaming snapshot', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'Hello' })
    useChatStore.getState().replaceLastAssistantMessage('Hello world')
    expect(useChatStore.getState().messages[0].content).toBe('Hello world')
  })

  it('sets loading state', () => {
    useChatStore.getState().setLoading(true)
    expect(useChatStore.getState().isLoading).toBe(true)
  })

  it('loads history messages', () => {
    const history = [
      { role: 'user' as const, content: 'a' },
      { role: 'assistant' as const, content: 'b' }
    ]
    useChatStore.getState().loadHistory(history)
    expect(useChatStore.getState().messages).toHaveLength(2)
    expect(useChatStore.getState().messages[0].id).toBeDefined()
  })

  it('clears visible messages when switching sessions until history loads', () => {
    useChatStore.getState().setActiveSession('session-a')
    useChatStore.getState().addMessage({ role: 'user', content: 'from a' }, 'session-a')
    useChatStore.getState().setActiveSession('session-b')

    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().isHistoryLoading).toBe(true)
    useChatStore.getState().loadHistory([{ role: 'user', content: 'from b' }], 'session-b')
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['from b'])
    expect(useChatStore.getState().isHistoryLoading).toBe(false)
    expect(useChatStore.getState().loadedSessionId).toBe('session-b')

    useChatStore.getState().setActiveSession('session-a')
    expect(useChatStore.getState().messages).toEqual([])
  })

  it('ignores stale history loads for inactive sessions', () => {
    useChatStore.getState().setActiveSession('session-a')
    useChatStore.getState().setActiveSession('session-b')
    useChatStore.getState().loadHistory([{ role: 'user', content: 'stale a' }], 'session-a')

    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().activeSessionId).toBe('session-b')
  })

  it('does not notify repeatedly when beginning the same history load', () => {
    useChatStore.getState().setActiveSession('session-a')
    let updates = 0
    const unsubscribe = useChatStore.subscribe(() => {
      updates += 1
    })

    useChatStore.getState().beginHistoryLoad('session-a')
    useChatStore.getState().beginHistoryLoad('session-a')

    unsubscribe()
    expect(updates).toBe(0)
    expect(useChatStore.getState().isHistoryLoading).toBe(true)
  })

  it('merges live stream messages that arrive before history load completes', () => {
    useChatStore.getState().setActiveSession('session-a')
    useChatStore
      .getState()
      .addMessage(
        { sourceId: 'live-assistant', role: 'assistant', content: 'streaming' },
        'session-a'
      )
    useChatStore
      .getState()
      .loadHistory([{ sourceId: 'history-user', role: 'user', content: 'earlier' }], 'session-a')

    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'earlier',
      'streaming'
    ])
  })

  it('updates streaming snapshots by source message id', () => {
    useChatStore.getState().setActiveSession('session-a')
    useChatStore
      .getState()
      .addMessage({ sourceId: 'assistant-1', role: 'assistant', content: 'old' }, 'session-a')
    useChatStore
      .getState()
      .addMessage({ sourceId: 'assistant-2', role: 'assistant', content: 'second' }, 'session-a')

    useChatStore.getState().replaceLastAssistantMessage('new', 'session-a', 'assistant-1')

    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'new',
      'second'
    ])
  })

  it('ignores background stream message content outside the current session', () => {
    useChatStore.getState().setActiveSession('session-a')
    useChatStore.getState().addMessage({ role: 'assistant', content: '' }, 'session-b')
    useChatStore.getState().replaceLastAssistantMessage('background response', 'session-b')

    expect(useChatStore.getState().messages).toEqual([])
  })

  it('tracks background loading by session without changing the current view', () => {
    useChatStore.getState().setActiveSession('session-a')
    useChatStore.getState().setLoading(true, 'session-b')

    expect(useChatStore.getState().isLoading).toBe(false)
    expect(useChatStore.getState().runningSessionIds).toEqual(['session-b'])

    useChatStore.getState().setActiveSession('session-b')
    expect(useChatStore.getState().isLoading).toBe(true)
  })

  it('moves draft messages into the created session', () => {
    useChatStore.getState().addMessage({ role: 'user', content: 'draft prompt' }, null)
    useChatStore.getState().setLoading(true, null)
    useChatStore.getState().bindDraftToSession('created-session')

    expect(useChatStore.getState().activeSessionId).toBe('created-session')
    expect(useChatStore.getState().isLoading).toBe(true)
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'draft prompt'
    ])
  })
})
