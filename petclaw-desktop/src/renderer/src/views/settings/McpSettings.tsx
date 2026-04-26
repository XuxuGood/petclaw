// Task 22 会完整实现 MCP 服务器详细管理（添加/编辑/删除 + 传输协议选择）
import { useI18n } from '../../i18n'

export function McpSettings() {
  const { t } = useI18n()
  return (
    <div>
      <h1 className="text-[20px] font-bold text-text-primary mb-1">{t('mcpSettings.title')}</h1>
      <p className="text-[13px] text-text-tertiary mb-6">{t('mcpSettings.subtitle')}</p>
      <div className="rounded-[14px] bg-bg-card border border-border flex items-center justify-center py-16">
        <span className="text-[13px] text-text-tertiary">{t('common.comingSoon')}</span>
      </div>
    </div>
  )
}
