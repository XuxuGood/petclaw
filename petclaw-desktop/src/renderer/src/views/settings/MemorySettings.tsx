// Task 22 会完整实现记忆条目查看/编辑/搜索
import { useI18n } from '../../i18n'

export function MemorySettings() {
  const { t } = useI18n()
  return (
    <div>
      <h1 className="text-[20px] font-bold text-text-primary mb-1">{t('memorySettings.title')}</h1>
      <p className="text-[13px] text-text-tertiary mb-6">{t('memorySettings.subtitle')}</p>
      <div className="rounded-[12px] bg-bg-card border border-border flex items-center justify-center py-16">
        <span className="text-[13px] text-text-tertiary">{t('common.comingSoon')}</span>
      </div>
    </div>
  )
}
