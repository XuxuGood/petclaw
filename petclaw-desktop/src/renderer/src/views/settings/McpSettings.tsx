import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Server } from 'lucide-react'

import { useI18n } from '../../i18n'

interface McpServerItem {
  id: string
  name: string
  description?: string
  enabled: boolean
  transportType: 'stdio' | 'sse' | 'streamable-http'
}

function parseMcpServers(raw: unknown): McpServerItem[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): McpServerItem[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.name !== 'string') return []
    const transportType =
      record.transportType === 'sse' || record.transportType === 'streamable-http'
        ? record.transportType
        : 'stdio'
    return [
      {
        id: record.id,
        name: record.name,
        description: typeof record.description === 'string' ? record.description : undefined,
        enabled: record.enabled === true,
        transportType
      }
    ]
  })
}

export function McpSettings() {
  const { t } = useI18n()
  const [servers, setServers] = useState<McpServerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const loadServers = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const raw = await window.api.mcp.list()
      setServers(parseMcpServers(raw))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadServers()
  }, [loadServers])

  useEffect(() => {
    const unsubStart = window.api.mcp.onBridgeSyncStart(() => setSyncing(true))
    const unsubDone = window.api.mcp.onBridgeSyncDone(() => {
      setSyncing(false)
      loadServers()
    })
    return () => {
      unsubStart()
      unsubDone()
    }
  }, [loadServers])

  const handleToggle = async (server: McpServerItem): Promise<void> => {
    setTogglingId(server.id)
    setServers((current) =>
      current.map((item) => (item.id === server.id ? { ...item, enabled: !server.enabled } : item))
    )
    try {
      await window.api.mcp.setEnabled(server.id, !server.enabled)
    } catch {
      setServers((current) =>
        current.map((item) => (item.id === server.id ? { ...item, enabled: server.enabled } : item))
      )
    } finally {
      setTogglingId(null)
    }
  }

  const handleRefreshBridge = async (): Promise<void> => {
    setSyncing(true)
    try {
      await window.api.mcp.refreshBridge()
    } finally {
      setSyncing(false)
      await loadServers()
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-[20px] font-bold text-text-primary">{t('mcpSettings.title')}</h1>
          <p className="text-[13px] text-text-tertiary">{t('mcpSettings.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={handleRefreshBridge}
          disabled={syncing}
          className="flex min-h-[var(--size-control-min)] items-center gap-2 rounded-[8px] border border-border bg-bg-card px-3 py-2 text-[13px] text-text-secondary transition-all duration-[120ms] hover:bg-bg-hover active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 ui-focus"
        >
          <RefreshCw size={14} strokeWidth={1.9} className={syncing ? 'animate-spin' : ''} />
          <span>{t('common.refresh')}</span>
        </button>
      </div>

      <div className="ui-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-12 text-text-tertiary">
            <Loader2 size={15} strokeWidth={2} className="animate-spin" />
            <span className="text-[13px]">{t('common.loading')}</span>
          </div>
        ) : servers.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-text-tertiary">
            {t('connectorPopup.noMcp')}
          </div>
        ) : (
          servers.map((server, index) => (
            <div
              key={server.id}
              className={`flex min-w-0 items-center gap-4 px-5 py-4 ${
                index < servers.length - 1 ? 'border-b border-border' : ''
              }`}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-bg-active text-text-secondary">
                <Server size={16} strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-[14px] font-semibold text-text-primary">
                    {server.name}
                  </span>
                  <span className="rounded-[6px] bg-bg-hover px-1.5 py-0.5 text-[11px] font-medium text-text-tertiary">
                    {server.transportType}
                  </span>
                </div>
                {server.description && (
                  <p className="mt-0.5 truncate text-[12px] text-text-tertiary">
                    {server.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleToggle(server)}
                disabled={togglingId === server.id}
                role="switch"
                aria-checked={server.enabled}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-all duration-[120ms] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60 ${
                  server.enabled ? 'bg-accent' : 'border border-border bg-bg-hover'
                }`}
                aria-label={`${server.enabled ? t('common.disable') : t('common.enable')} ${
                  server.name
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-[120ms] ${
                    server.enabled ? 'left-[18px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
