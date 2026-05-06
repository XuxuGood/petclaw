import { create } from 'zustand'

let nextId = 0

export interface ChatMessage {
  id: number
  sourceId?: string
  role: 'user' | 'assistant'
  content: string
}

interface ChatState {
  activeSessionId: string | null
  loadedSessionId: string | null
  isHistoryLoading: boolean
  historyLoadError: string | null
  messages: ChatMessage[]
  isLoading: boolean
  runningSessionIds: string[]
  setActiveSession: (sessionId: string | null) => void
  bindDraftToSession: (sessionId: string) => void
  addMessage: (msg: Omit<ChatMessage, 'id'>, sessionId?: string | null) => void
  appendToLastMessage: (text: string, sessionId?: string | null) => void
  replaceLastAssistantMessage: (
    text: string,
    sessionId?: string | null,
    sourceId?: string | null
  ) => void
  setLoading: (loading: boolean, sessionId?: string | null) => void
  beginHistoryLoad: (sessionId: string) => void
  loadHistory: (messages: Omit<ChatMessage, 'id'>[], sessionId?: string | null) => void
  failHistoryLoad: (sessionId: string, error: string) => void
  reset: () => void
}

function resolveTargetSessionId(
  sessionId: string | null | undefined,
  activeSessionId: string | null
): string | null {
  return sessionId ?? activeSessionId
}

function shouldUpdateVisibleMessages(
  sessionId: string | null | undefined,
  activeSessionId: string | null
): boolean {
  const targetSessionId = resolveTargetSessionId(sessionId, activeSessionId)
  return targetSessionId === activeSessionId
}

function setRunningSession(
  runningSessionIds: string[],
  sessionId: string | null,
  isRunning: boolean
): string[] {
  if (!sessionId) return runningSessionIds
  const exists = runningSessionIds.includes(sessionId)
  if (isRunning) return exists ? runningSessionIds : [...runningSessionIds, sessionId]
  return exists ? runningSessionIds.filter((id) => id !== sessionId) : runningSessionIds
}

function mergeHistoryWithLiveMessages(
  history: ChatMessage[],
  live: ChatMessage[],
  shouldMergeLiveMessages: boolean
): ChatMessage[] {
  if (!shouldMergeLiveMessages || live.length === 0) return history

  const historySourceIds = new Set(
    history.flatMap((message) => (message.sourceId ? [message.sourceId] : []))
  )
  const historyFingerprints = new Set(
    history.map((message) => `${message.role}\u0000${message.content}`)
  )
  const liveOnlyMessages = live.filter((message) => {
    if (message.sourceId) return !historySourceIds.has(message.sourceId)
    return !historyFingerprints.has(`${message.role}\u0000${message.content}`)
  })
  return [...history, ...liveOnlyMessages]
}

export const useChatStore = create<ChatState>()((set) => ({
  activeSessionId: null,
  loadedSessionId: null,
  isHistoryLoading: false,
  historyLoadError: null,
  messages: [],
  isLoading: false,
  runningSessionIds: [],

  setActiveSession: (sessionId) =>
    set((state) => {
      if (state.activeSessionId === sessionId) return state
      return {
        activeSessionId: sessionId,
        loadedSessionId: null,
        isHistoryLoading: Boolean(sessionId),
        historyLoadError: null,
        messages: [],
        isLoading: sessionId ? state.runningSessionIds.includes(sessionId) : false
      }
    }),

  bindDraftToSession: (sessionId) =>
    set((state) => {
      const runningSessionIds = setRunningSession(
        state.runningSessionIds,
        sessionId,
        state.isLoading
      )
      return {
        activeSessionId: sessionId,
        loadedSessionId: sessionId,
        isHistoryLoading: false,
        historyLoadError: null,
        runningSessionIds
      }
    }),

  addMessage: (msg, sessionId) =>
    set((state) => {
      if (!shouldUpdateVisibleMessages(sessionId, state.activeSessionId)) return state
      if (msg.sourceId) {
        const existingIndex = state.messages.findIndex(
          (message) => message.sourceId === msg.sourceId
        )
        if (existingIndex !== -1) {
          const messages = [...state.messages]
          messages[existingIndex] = { ...messages[existingIndex], ...msg }
          return { messages }
        }
      }
      return { messages: [...state.messages, { ...msg, id: nextId++ }] }
    }),

  appendToLastMessage: (text, sessionId) =>
    set((state) => {
      if (!shouldUpdateVisibleMessages(sessionId, state.activeSessionId)) return state
      const messages = [...state.messages]
      const last = messages[messages.length - 1]
      if (last && last.role === 'assistant') {
        messages[messages.length - 1] = { ...last, content: last.content + text }
      }
      return { messages }
    }),

  replaceLastAssistantMessage: (text, sessionId, sourceId) =>
    set((state) => {
      if (!shouldUpdateVisibleMessages(sessionId, state.activeSessionId)) return state
      const messages = [...state.messages]
      const sourceIndex = sourceId
        ? messages.findIndex((message) => message.sourceId === sourceId)
        : -1
      if (sourceIndex !== -1) {
        messages[sourceIndex] = { ...messages[sourceIndex], content: text }
        return { messages }
      }
      let lastAssistantIndex = -1
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === 'assistant') {
          lastAssistantIndex = index
          break
        }
      }
      if (lastAssistantIndex !== -1) {
        messages[lastAssistantIndex] = { ...messages[lastAssistantIndex], content: text }
      }
      return { messages }
    }),

  setLoading: (isLoading, sessionId) =>
    set((state) => {
      const targetSessionId = resolveTargetSessionId(sessionId, state.activeSessionId)
      const runningSessionIds = setRunningSession(
        state.runningSessionIds,
        targetSessionId,
        isLoading
      )
      if (targetSessionId !== state.activeSessionId) return { runningSessionIds }
      return { runningSessionIds, isLoading }
    }),

  beginHistoryLoad: (sessionId) =>
    set((state) => {
      if (state.activeSessionId !== sessionId) return state
      if (
        state.isHistoryLoading &&
        state.loadedSessionId === null &&
        state.historyLoadError === null
      ) {
        return state
      }
      return {
        isHistoryLoading: true,
        historyLoadError: null,
        loadedSessionId: null
      }
    }),

  loadHistory: (messages, sessionId) =>
    set((state) => {
      if (!shouldUpdateVisibleMessages(sessionId, state.activeSessionId)) return state
      const historyMessages = messages.map((m) => ({ ...m, id: nextId++ }))
      return {
        loadedSessionId: state.activeSessionId,
        isHistoryLoading: false,
        historyLoadError: null,
        messages: mergeHistoryWithLiveMessages(
          historyMessages,
          state.messages,
          state.isHistoryLoading
        ),
        isLoading: state.activeSessionId
          ? state.runningSessionIds.includes(state.activeSessionId)
          : false
      }
    }),

  failHistoryLoad: (sessionId, error) =>
    set((state) => {
      if (state.activeSessionId !== sessionId) return state
      return {
        isHistoryLoading: false,
        historyLoadError: error,
        loadedSessionId: null
      }
    }),

  reset: () =>
    set({
      activeSessionId: null,
      loadedSessionId: null,
      isHistoryLoading: false,
      historyLoadError: null,
      messages: [],
      isLoading: false,
      runningSessionIds: []
    })
}))
