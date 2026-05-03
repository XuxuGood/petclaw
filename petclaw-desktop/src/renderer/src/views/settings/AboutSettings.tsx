import { useState, useEffect } from 'react'

import { ExternalLink } from 'lucide-react'

import { useI18n } from '../../i18n'

export function AboutSettings() {
  const { t } = useI18n()
  const [version, setVersion] = useState<string>('—')

  // 获取应用版本号
  useEffect(() => {
    window.api.getAppVersion().then((v) => setVersion(v))
  }, [])

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
      </div>

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
