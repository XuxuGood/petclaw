// Task 22 会完整实现 MCP 服务器快捷开关列表
import { useI18n } from '../../i18n'

export function ConnectorSettings() {
  const { t } = useI18n()
  return (
    <div>
      <h1 className="text-[20px] font-bold text-text-primary mb-1">
        {t('connectorSettings.title')}
      </h1>
      <p className="text-[13px] text-text-tertiary mb-6">{t('connectorSettings.subtitle')}</p>
      <div className="rounded-[14px] bg-bg-card border border-border flex items-center justify-center py-16">
        <span className="text-[13px] text-text-tertiary">{t('common.comingSoon')}</span>
      </div>
    </div>
  )
}
