import { create } from 'zustand'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatState {
  messages: ChatMessage[]
  isLoading: boolean
  addMessage: (msg: ChatMessage) => void
  appendToLastMessage: (text: string) => void
  setLoading: (loading: boolean) => void
  loadHistory: (messages: ChatMessage[]) => void
}

export const useChatStore = create<ChatState>()((set) => ({
  messages: [],
  isLoading: false,

  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

  appendToLastMessage: (text) =>
    set((state) => {
      const messages = [...state.messages]
      const last = messages[messages.length - 1]
      if (last && last.role === 'assistant') {
        messages[messages.length - 1] = { ...last, content: last.content + text }
      }
      return { messages }
    }),

  setLoading: (isLoading) => set({ isLoading }),

  loadHistory: (messages) => set({ messages })
}))
