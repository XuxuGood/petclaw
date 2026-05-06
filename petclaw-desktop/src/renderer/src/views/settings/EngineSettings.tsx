import { useState, useEffect } from 'react'

import { RefreshCw, Circle, FolderOpen, Archive } from 'lucide-react'

import { useI18n } from '../../i18n'

// 引擎状态类型
interface EngineStatus {
  running: boolean
  version?: string
  uptime?: number
  pid?: number
}

export function EngineSettings() {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<string | null>(null)
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false)
  const { t } = useI18n()

  // 订阅引擎状态推送
  useEffect(() => {
    const unsub = window.api.engine.onStatus((raw) => {
      const s = raw as EngineStatus
      setStatus(s)
    })
    return unsub
  }, [])

  const isRunning = status?.running === true

  const handleOpenLogFolder = async (): Promise<void> => {
    try {
      await window.api.logging.openLogFolder()
      setDiagnosticsStatus(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setDiagnosticsStatus(t('logging.openLogFolderFailed', { error: message }))
      try {
        await window.api.logging.report({
          level: 'error',
          module: 'EngineSettings',
          event: 'renderer.logging.openLogFolder.failed',
          message: 'Failed to open log folder from engine settings',
          fields: { errorMessage: message }
        })
      } catch {
        // renderer 错误上报失败时不能阻断设置页操作。
      }
    }
  }

  const handleExportDiagnostics = async (): Promise<void> => {
    setIsExportingDiagnostics(true)
    try {
      await window.api.logging.exportDiagnostics({ timeRangeDays: 3 })
      setDiagnosticsStatus(t('logging.exportSuccess'))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setDiagnosticsStatus(t('logging.exportFailed', { error: message }))
      try {
        await window.api.logging.report({
          level: 'error',
          module: 'EngineSettings',
          event: 'renderer.logging.exportDiagnostics.failed',
          message: 'Failed to export diagnostics from engine settings',
          fields: { errorMessage: message }
        })
      } catch {
        // renderer 错误上报失败时不能阻断设置页操作。
      }
    } finally {
      setIsExportingDiagnostics(false)
    }
  }

  return (
    <div>
      <h1 className="text-[20px] font-bold text-text-primary mb-1">{t('engineSettings.title')}</h1>
      <p className="text-[13px] text-text-tertiary mb-6">{t('engineSettings.subtitle')}</p>

      {/* 状态卡片 */}
      <div className="rounded-[12px] bg-bg-card border border-border overflow-hidden mb-4">
        {/* 运行状态 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <span className="text-[14px] text-text-primary">{t('engineSettings.status')}</span>
          <div className="flex items-center gap-2">
            <Circle
              size={8}
              className={
                isRunning ? 'text-success fill-success' : 'text-text-tertiary fill-text-tertiary'
              }
            />
            <span className={`text-[14px] ${isRunning ? 'text-success' : 'text-text-tertiary'}`}>
              {status === null
                ? t('engineSettings.loading')
                : isRunning
                  ? t('engineSettings.running')
                  : t('engineSettings.notRunning')}
            </span>
          </div>
        </div>

        {/* 版本号 */}
        {status?.version && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <span className="text-[14px] text-text-primary">{t('engineSettings.version')}</span>
            <span className="text-[14px] text-text-secondary font-mono">{status.version}</span>
          </div>
        )}

        {/* 进程 ID */}
        {status?.pid && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <span className="text-[14px] text-text-primary">{t('engineSettings.pid')}</span>
            <span className="text-[14px] text-text-secondary font-mono">{status.pid}</span>
          </div>
        )}

        {/* 运行时长 */}
        {status?.uptime !== undefined && (
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-[14px] text-text-primary">{t('engineSettings.uptime')}</span>
            <span className="text-[14px] text-text-secondary">
              {t('engineSettings.uptimeMinutes', {
                minutes: String(Math.floor(status.uptime / 60))
              })}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-border">
          <span className="text-[14px] text-text-primary">{t('logging.diagnostics')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleOpenLogFolder}
              className="inline-flex min-h-[36px] items-center gap-2 rounded-[8px] border border-border px-3 text-[13px] text-text-primary transition-colors duration-[120ms] hover:bg-bg-hover"
            >
              <FolderOpen size={14} />
              {t('logging.openLogFolder')}
            </button>
            <button
              type="button"
              onClick={handleExportDiagnostics}
              disabled={isExportingDiagnostics}
              className="inline-flex min-h-[36px] items-center gap-2 rounded-[8px] bg-text-primary px-3 text-[13px] text-bg-primary transition-all duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Archive size={14} />
              {isExportingDiagnostics ? t('logging.exporting') : t('logging.exportDiagnostics')}
            </button>
          </div>
        </div>
      </div>

      {diagnosticsStatus && (
        <p className="mb-3 text-[12px] leading-relaxed text-text-tertiary">{diagnosticsStatus}</p>
      )}

      {/* 说明文字 */}
      <p className="text-[12px] text-text-tertiary flex items-center gap-1.5">
        <RefreshCw size={12} />
        {t('engineSettings.hint')}
      </p>
    </div>
  )
}
