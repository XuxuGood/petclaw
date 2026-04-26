import { useEffect } from 'react'
import { Activity, AlertCircle, Clock } from 'lucide-react'

import { useHookStore, AgentSession } from '../../stores/hook-store'
import { useI18n } from '../../i18n'

export function MonitorView() {
  const { t } = useI18n()
  const { sessions, updateSession, removeSession } = useHookStore()

  useEffect(() => {
    const unsub = window.api.onHookEvent((event) => {
      if (event.type === 'session_end') {
        removeSession(event.sessionId)
        return
      }

      const existing = useHookStore.getState().sessions.get(event.sessionId)
      updateSession({
        sessionId: event.sessionId,
        tool: event.tool,
        status: event.type === 'error' ? 'error' : 'active',
        lastEventType: event.type,
        lastEventData: event.data,
        startedAt: existing?.startedAt ?? event.timestamp,
        updatedAt: event.timestamp
      })
    })
    return unsub
  }, [updateSession, removeSession])

  const sessionList = Array.from(sessions.values())

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="drag-region h-[52px] shrink-0 flex items-center px-6">
        <div className="w-[70px]" />
        <h2 className="text-[13px] font-semibold text-text-primary">{t('monitor.title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <div>
          {sessionList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-text-tertiary">
              <div className="w-12 h-12 rounded-2xl bg-bg-input flex items-center justify-center mb-4">
                <Activity size={22} className="text-text-tertiary" strokeWidth={1.75} />
              </div>
              <p className="text-[13px] font-medium text-text-secondary mb-1">
                {t('monitor.noActive')}
              </p>
              <p className="text-[12px] text-text-tertiary">{t('monitor.hint')}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {sessionList.map((session) => (
                <SessionCard key={session.sessionId} session={session} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SessionCard({ session }: { session: AgentSession }) {
  const isError = session.status === 'error'
  const StatusIcon = isError ? AlertCircle : Activity

  const elapsed = Math.round((Date.now() - session.startedAt) / 1000)
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`

  return (
    <div className="p-4 bg-bg-card rounded-[10px] shadow-[var(--shadow-card)] border border-border">
      <div className="flex items-center gap-3">
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            isError ? 'bg-error' : 'bg-success status-pulse'
          }`}
        />
        <StatusIcon size={15} className={isError ? 'text-error' : 'text-success'} strokeWidth={2} />
        <span className="text-[13px] font-medium text-text-primary">{session.tool}</span>
        <div className="ml-auto flex items-center gap-1.5 text-text-tertiary">
          <Clock size={12} strokeWidth={2} />
          <span className="text-[11px]">{elapsedStr}</span>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-[11px] px-2 py-0.5 rounded-md bg-bg-input text-text-secondary font-medium">
          {session.lastEventType}
        </span>
      </div>

      {session.lastEventData && Object.keys(session.lastEventData).length > 0 && (
        <div className="mt-2 text-[11px] text-text-tertiary truncate font-mono leading-relaxed bg-bg-input rounded-lg px-3 py-1.5">
          {JSON.stringify(session.lastEventData).slice(0, 120)}
        </div>
      )}
    </div>
  )
}
