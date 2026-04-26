import { useState, useEffect } from 'react'

import { RefreshCw, Circle } from 'lucide-react'

import { useI18n } from '../../i18n'

// 引擎状态类型
interface EngineStatus {
  running: boolean
  version?: string
  uptime?: number
  pid?: number
}

export function EngineSettings() {
  const { t } = useI18n()
  const [status, setStatus] = useState<EngineStatus | null>(null)

  // 订阅引擎状态推送
  useEffect(() => {
    const unsub = window.api.engine.onStatus((raw) => {
      const s = raw as EngineStatus
      setStatus(s)
    })
    return unsub
  }, [])

  const isRunning = status?.running === true

  return (
    <div>
      <h1 className="text-[20px] font-bold text-text-primary mb-1">{t('engineSettings.title')}</h1>
      <p className="text-[13px] text-text-tertiary mb-6">{t('engineSettings.subtitle')}</p>

      {/* 状态卡片 */}
      <div className="rounded-[14px] bg-bg-card border border-border overflow-hidden mb-4">
        {/* 运行状态 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <span className="text-[14px] text-text-primary">{t('engineSettings.status')}</span>
          <div className="flex items-center gap-2">
            <Circle
              size={8}
              className={
                isRunning
                  ? 'text-green-500 fill-green-500'
                  : 'text-text-tertiary fill-text-tertiary'
              }
            />
            <span className={`text-[14px] ${isRunning ? 'text-green-500' : 'text-text-tertiary'}`}>
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
      </div>

      {/* 说明文字 */}
      <p className="text-[12px] text-text-tertiary flex items-center gap-1.5">
        <RefreshCw size={12} />
        {t('engineSettings.hint')}
      </p>
    </div>
  )
}
