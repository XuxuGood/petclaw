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

  it('keeps messages isolated by active session', () => {
    useChatStore.getState().setActiveSession('session-a')
    useChatStore.getState().addMessage({ role: 'user', content: 'from a' }, 'session-a')
    useChatStore.getState().setActiveSession('session-b')
    useChatStore.getState().addMessage({ role: 'user', content: 'from b' }, 'session-b')

    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['from b'])

    useChatStore.getState().setActiveSession('session-a')
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['from a'])
  })

  it('routes background stream updates to their session bucket', () => {
    useChatStore.getState().setActiveSession('session-a')
    useChatStore.getState().addMessage({ role: 'assistant', content: '' }, 'session-b')
    useChatStore.getState().replaceLastAssistantMessage('background response', 'session-b')

    expect(useChatStore.getState().messages).toEqual([])

    useChatStore.getState().setActiveSession('session-b')
    expect(useChatStore.getState().messages[0].content).toBe('background response')
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
