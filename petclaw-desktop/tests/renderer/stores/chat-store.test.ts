import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, ChatMessage } from '../../../src/renderer/src/stores/chat-store'

describe('ChatStore', () => {
  beforeEach(() => {
    useChatStore.setState({ messages: [], isLoading: false })
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

  it('sets loading state', () => {
    useChatStore.getState().setLoading(true)
    expect(useChatStore.getState().isLoading).toBe(true)
  })

  it('loads history messages', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' }
    ]
    useChatStore.getState().loadHistory(history)
    expect(useChatStore.getState().messages).toHaveLength(2)
  })
})
