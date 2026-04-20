import { create } from 'zustand'

let nextId = 0

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
}

interface ChatState {
  messages: ChatMessage[]
  isLoading: boolean
  addMessage: (msg: Omit<ChatMessage, 'id'>) => void
  appendToLastMessage: (text: string) => void
  setLoading: (loading: boolean) => void
  loadHistory: (messages: Omit<ChatMessage, 'id'>[]) => void
}

export const useChatStore = create<ChatState>()((set) => ({
  messages: [],
  isLoading: false,

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, { ...msg, id: nextId++ }] })),

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

  loadHistory: (messages) => set({ messages: messages.map((m) => ({ ...m, id: nextId++ })) })
}))
