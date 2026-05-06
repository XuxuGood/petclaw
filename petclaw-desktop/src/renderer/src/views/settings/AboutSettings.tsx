import { useState, useEffect } from 'react'

import { ExternalLink, FolderOpen, Archive } from 'lucide-react'

import { useI18n } from '../../i18n'

export function AboutSettings() {
  const [version, setVersion] = useState<string>('—')
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<string | null>(null)
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false)
  const { t } = useI18n()

  // 获取应用版本号
  useEffect(() => {
    window.api.getAppVersion().then((v) => setVersion(v))
  }, [])

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
          module: 'AboutSettings',
          event: 'renderer.logging.openLogFolder.failed',
          message: 'Failed to open log folder from about settings',
          fields: { errorMessage: message }
        })
      } catch {
        // renderer 错误上报失败时不能阻断关于页操作。
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
          module: 'AboutSettings',
          event: 'renderer.logging.exportDiagnostics.failed',
          message: 'Failed to export diagnostics from about settings',
          fields: { errorMessage: message }
        })
      } catch {
        // renderer 错误上报失败时不能阻断关于页操作。
      }
    } finally {
      setIsExportingDiagnostics(false)
    }
  }

  return (
    <div>
      <h1 className="text-[20px] font-bold text-text-primary mb-1">{t('about.title')}</h1>
      <p className="text-[13px] text-text-tertiary mb-6">{t('about.subtitle')}</p>

      {/* 版本信息卡片 */}
      <div className="rounded-[12px] bg-bg-card border border-border overflow-hidden mb-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <span className="text-[14px] text-text-primary">{t('about.version')}</span>
          <span className="text-[14px] text-text-secondary font-mono">{version}</span>
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[14px] text-text-primary">{t('about.buildEnv')}</span>
          <span className="text-[14px] text-text-secondary">Electron + React</span>
        </div>
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

      {/* 外部链接 */}
      <div className="rounded-[12px] bg-bg-card border border-border overflow-hidden">
        <a
          href="https://github.com/petclaw"
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between px-5 py-4 hover:bg-bg-hover transition-colors duration-[120ms] border-b border-border"
        >
          <span className="text-[14px] text-text-primary">{t('about.github')}</span>
          <ExternalLink size={14} className="text-text-tertiary" />
        </a>
        <a
          href="https://github.com/petclaw/issues"
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between px-5 py-4 hover:bg-bg-hover transition-colors duration-[120ms] border-b border-border"
        >
          <span className="text-[14px] text-text-primary">{t('about.feedback')}</span>
          <ExternalLink size={14} className="text-text-tertiary" />
        </a>
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[14px] text-text-primary">{t('about.license')}</span>
          <span className="text-[14px] text-text-secondary">MIT License</span>
        </div>
      </div>
    </div>
  )
}
