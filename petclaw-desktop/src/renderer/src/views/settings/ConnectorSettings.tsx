import { Plug, Wrench } from 'lucide-react'

import { useI18n } from '../../i18n'

export function ConnectorSettings() {
  const { t } = useI18n()

  const openMcpSettings = (): void => {
    window.dispatchEvent(new CustomEvent('app:navigate-settings', { detail: { tab: 'mcp' } }))
  }

  return (
    <div>
      <h1 className="mb-1 text-[20px] font-bold text-text-primary">
        {t('connectorSettings.title')}
      </h1>
      <p className="mb-6 text-[13px] text-text-tertiary">{t('connectorSettings.subtitle')}</p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={openMcpSettings}
          className="flex min-w-0 items-start gap-3 rounded-[12px] border border-border bg-bg-card p-4 text-left transition-all duration-[120ms] hover:bg-bg-hover active:scale-[0.96] ui-focus"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-bg-active text-text-secondary">
            <Wrench size={16} strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-text-primary">
              {t('mcpSettings.title')}
            </div>
            <p className="mt-1 text-[12px] leading-[1.55] text-text-tertiary">
              {t('mcpSettings.subtitle')}
            </p>
          </div>
        </button>

        <div className="flex min-w-0 items-start gap-3 rounded-[12px] border border-border bg-bg-card p-4 opacity-70">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-bg-active text-text-secondary">
            <Plug size={16} strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-text-primary">
              {t('settings.connectors')}
            </div>
            <p className="mt-1 text-[12px] leading-[1.55] text-text-tertiary">
              {t('common.comingSoon')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
