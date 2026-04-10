import { create } from 'zustand'

export interface AgentSession {
  sessionId: string
  tool: string
  status: 'active' | 'idle' | 'error'
  lastEventType: string
  lastEventData: Record<string, unknown>
  startedAt: number
  updatedAt: number
}

interface HookState {
  sessions: Map<string, AgentSession>
  updateSession: (session: AgentSession) => void
  removeSession: (sessionId: string) => void
}

export const useHookStore = create<HookState>()((set) => ({
  sessions: new Map(),

  updateSession: (session) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      sessions.set(session.sessionId, session)
      return { sessions }
    }),

  removeSession: (sessionId) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      sessions.delete(sessionId)
      return { sessions }
    })
}))
