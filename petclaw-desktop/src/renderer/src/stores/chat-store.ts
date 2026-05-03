import { create } from 'zustand'

let nextId = 0
const DRAFT_SESSION_KEY = '__draft__'

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
}

interface ChatBucket {
  messages: ChatMessage[]
  isLoading: boolean
}

interface ChatState {
  activeSessionId: string | null
  messages: ChatMessage[]
  isLoading: boolean
  buckets: Record<string, ChatBucket>
  setActiveSession: (sessionId: string | null) => void
  bindDraftToSession: (sessionId: string) => void
  addMessage: (msg: Omit<ChatMessage, 'id'>, sessionId?: string | null) => void
  appendToLastMessage: (text: string, sessionId?: string | null) => void
  replaceLastAssistantMessage: (text: string, sessionId?: string | null) => void
  setLoading: (loading: boolean, sessionId?: string | null) => void
  loadHistory: (messages: Omit<ChatMessage, 'id'>[], sessionId?: string | null) => void
  reset: () => void
}

function getBucketKey(
  sessionId: string | null | undefined,
  activeSessionId: string | null
): string {
  return sessionId ?? activeSessionId ?? DRAFT_SESSION_KEY
}

function emptyBucket(): ChatBucket {
  return { messages: [], isLoading: false }
}

function withBucket(
  state: ChatState,
  sessionId: string | null | undefined,
  updater: (bucket: ChatBucket) => ChatBucket
): Partial<ChatState> {
  const key = getBucketKey(sessionId, state.activeSessionId)
  const currentBucket = state.buckets[key] ?? emptyBucket()
  const nextBucket = updater(currentBucket)
  const buckets = { ...state.buckets, [key]: nextBucket }
  const isActiveBucket = key === getBucketKey(undefined, state.activeSessionId)
  return {
    buckets,
    ...(isActiveBucket
      ? {
          messages: nextBucket.messages,
          isLoading: nextBucket.isLoading
        }
      : {})
  }
}

export const useChatStore = create<ChatState>()((set) => ({
  activeSessionId: null,
  messages: [],
  isLoading: false,
  buckets: {
    [DRAFT_SESSION_KEY]: emptyBucket()
  },

  setActiveSession: (sessionId) =>
    set((state) => {
      const key = getBucketKey(sessionId, null)
      const bucket = state.buckets[key] ?? emptyBucket()
      return {
        activeSessionId: sessionId,
        messages: bucket.messages,
        isLoading: bucket.isLoading,
        buckets: state.buckets[key] ? state.buckets : { ...state.buckets, [key]: bucket }
      }
    }),

  bindDraftToSession: (sessionId) =>
    set((state) => {
      const draft = state.buckets[DRAFT_SESSION_KEY] ?? emptyBucket()
      const sessionBucket = state.buckets[sessionId] ?? emptyBucket()
      // 新建会话时用户消息先落在草稿 bucket；主进程返回 sessionId 后把草稿迁移过去，
      // 后续流事件才能按真实 sessionId 继续追加，避免首轮消息丢失或串到下一次新建任务。
      const nextBucket =
        sessionBucket.messages.length === 0 && draft.messages.length > 0 ? draft : sessionBucket
      return {
        activeSessionId: sessionId,
        messages: nextBucket.messages,
        isLoading: nextBucket.isLoading,
        buckets: {
          ...state.buckets,
          [sessionId]: nextBucket,
          [DRAFT_SESSION_KEY]: emptyBucket()
        }
      }
    }),

  addMessage: (msg, sessionId) =>
    set((state) =>
      withBucket(state, sessionId, (bucket) => ({
        ...bucket,
        messages: [...bucket.messages, { ...msg, id: nextId++ }]
      }))
    ),

  appendToLastMessage: (text, sessionId) =>
    set((state) =>
      withBucket(state, sessionId, (bucket) => {
        const messages = [...bucket.messages]
        const last = messages[messages.length - 1]
        if (last && last.role === 'assistant') {
          messages[messages.length - 1] = { ...last, content: last.content + text }
        }
        return { ...bucket, messages }
      })
    ),

  replaceLastAssistantMessage: (text, sessionId) =>
    set((state) =>
      withBucket(state, sessionId, (bucket) => {
        const messages = [...bucket.messages]
        const last = messages[messages.length - 1]
        if (last && last.role === 'assistant') {
          messages[messages.length - 1] = { ...last, content: text }
        }
        return { ...bucket, messages }
      })
    ),

  setLoading: (isLoading, sessionId) =>
    set((state) => withBucket(state, sessionId, (bucket) => ({ ...bucket, isLoading }))),

  loadHistory: (messages, sessionId) =>
    set((state) =>
      withBucket(state, sessionId, () => ({
        messages: messages.map((m) => ({ ...m, id: nextId++ })),
        isLoading: false
      }))
    ),

  reset: () =>
    set({
      activeSessionId: null,
      messages: [],
      isLoading: false,
      buckets: {
        [DRAFT_SESSION_KEY]: emptyBucket()
      }
    })
}))
