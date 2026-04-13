import { useEffect } from 'react'
import { useHookStore, AgentSession } from '../stores/hook-store'

export function MonitorPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { sessions, updateSession, removeSession } = useHookStore()

  useEffect(() => {
    const unsub = window.api.onHookEvent((event) => {
      if (event.type === 'session_end') {
        removeSession(event.sessionId)
        return
      }

      updateSession({
        sessionId: event.sessionId,
        tool: event.tool,
        status: event.type === 'error' ? 'error' : 'active',
        lastEventType: event.type,
        lastEventData: event.data,
        startedAt: Date.now(),
        updatedAt: event.timestamp
      })
    })
    return unsub
  }, [removeSession, updateSession])

  const sessionList = Array.from(sessions.values())

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-80 h-96 bg-white/95 backdrop-blur-md rounded-t-2xl shadow-2xl flex flex-col border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">AI 工具监控</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {sessionList.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-8">暂无活跃的 AI 工具</p>
        )}
        {sessionList.map((session) => (
          <SessionCard key={session.sessionId} session={session} />
        ))}
      </div>
    </div>
  )
}

function SessionCard({ session }: { session: AgentSession }): JSX.Element {
  const statusColor =
    session.status === 'active'
      ? 'bg-green-400'
      : session.status === 'error'
        ? 'bg-red-400'
        : 'bg-gray-400'

  return (
    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${statusColor} animate-pulse`} />
        <span className="text-sm font-medium text-gray-700">{session.tool}</span>
        <span className="text-xs text-gray-400 ml-auto">{session.lastEventType}</span>
      </div>
      {session.lastEventData && Object.keys(session.lastEventData).length > 0 && (
        <div className="mt-1 text-xs text-gray-500 truncate">
          {JSON.stringify(session.lastEventData).slice(0, 80)}
        </div>
      )}
    </div>
  )
}
