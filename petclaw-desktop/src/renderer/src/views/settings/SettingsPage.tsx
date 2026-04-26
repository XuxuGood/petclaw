import { ArrowLeft } from 'lucide-react'

import { useI18n } from '../../i18n'
import { PreferenceSettings } from './PreferenceSettings'
import { ProfileSettings } from './ProfileSettings'
import { AboutSettings } from './AboutSettings'
import { EngineSettings } from './EngineSettings'
import { ModelSettings } from './ModelSettings'
import { DirectorySettings } from './DirectorySettings'
import { MemorySettings } from './MemorySettings'
import { ConnectorSettings } from './ConnectorSettings'
import { McpSettings } from './McpSettings'

interface SettingsPageProps {
  activeTab: string
  onTabChange: (tab: string) => void
  onBack: () => void
}

export function SettingsPage({ activeTab, onTabChange, onBack }: SettingsPageProps) {
  const { t } = useI18n()

  // 菜单分组配置放在组件内，以便使用 t() 动态翻译
  const MENU_SECTIONS = [
    {
      label: t('settings.general'),
      items: [
        { id: 'preferences', label: t('settings.preferences'), icon: '⚙️' },
        { id: 'profile', label: t('settings.profile'), icon: '👤' },
        { id: 'about', label: t('settings.about'), icon: 'ℹ️' }
      ]
    },
    {
      label: t('settings.aiConfig'),
      items: [
        { id: 'engine', label: t('settings.engine'), icon: '⚙️' },
        { id: 'models', label: t('settings.models'), icon: '🧠' },
        { id: 'directories', label: t('settings.directories'), icon: '📂' },
        { id: 'memory', label: t('settings.memory'), icon: '📝' }
      ]
    },
    {
      label: t('settings.extensions'),
      items: [
        { id: 'connectors', label: t('settings.connectors'), icon: '🔌' },
        { id: 'mcp', label: t('settings.mcp'), icon: '🔧' }
      ]
    }
  ]

  return (
    <div className="w-full h-full flex bg-bg-root overflow-hidden">
      {/* 左侧菜单 */}
      <div className="w-[240px] shrink-0 flex flex-col border-r border-border bg-bg-sidebar">
        {/* 标题栏拖拽区 + 返回按钮 */}
        <div className="drag-region h-[52px] shrink-0 flex items-center pl-[78px]">
          <button
            onClick={onBack}
            className="no-drag flex items-center gap-1.5 text-[14px] text-text-secondary hover:text-text-primary transition-colors duration-[120ms]"
          >
            <ArrowLeft size={15} strokeWidth={2} />
            <span>{t('settings.backToApp')}</span>
          </button>
        </div>

        {/* 菜单导航 */}
        <nav className="flex-1 overflow-y-auto px-3 py-1">
          {MENU_SECTIONS.map((section) => (
            <div key={section.label} className="mb-4">
              <div className="px-3 mb-1.5 text-[11px] text-text-tertiary font-medium uppercase tracking-wider">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onTabChange(item.id)}
                    className={`no-drag w-full flex items-center gap-2.5 px-3 py-[7px] rounded-[10px] text-[13px] transition-all duration-[120ms] active:scale-[0.96] ${
                      activeTab === item.id
                        ? 'bg-bg-active text-text-primary font-medium'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                    }`}
                  >
                    <span className="text-[14px]">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="drag-region h-[52px] shrink-0" />
        <div className="flex-1 overflow-y-auto px-8 py-4">
          {activeTab === 'preferences' && <PreferenceSettings />}
          {activeTab === 'profile' && <ProfileSettings />}
          {activeTab === 'about' && <AboutSettings />}
          {activeTab === 'engine' && <EngineSettings />}
          {activeTab === 'models' && <ModelSettings />}
          {activeTab === 'directories' && <DirectorySettings />}
          {activeTab === 'memory' && <MemorySettings />}
          {activeTab === 'connectors' && <ConnectorSettings />}
          {activeTab === 'mcp' && <McpSettings />}
        </div>
      </div>
    </div>
  )
}
