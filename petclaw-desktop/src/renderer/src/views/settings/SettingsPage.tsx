import { useState } from 'react'
import {
  ArrowLeft,
  Settings,
  User,
  Info,
  Cpu,
  Brain,
  FolderOpen,
  BookOpen,
  Cable,
  Wrench,
  Menu
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useI18n } from '../../i18n'
import { WorkspaceHeader } from '../../components/workspace/WorkspaceHeader'
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
  const [navigationOpen, setNavigationOpen] = useState(false)
  const { t } = useI18n()

  // 菜单分组配置放在组件内，以便使用 t() 动态翻译
  const MENU_SECTIONS: Array<{
    label: string
    items: Array<{ id: string; label: string; icon: LucideIcon }>
  }> = [
    {
      label: t('settings.general'),
      items: [
        { id: 'preferences', label: t('settings.preferences'), icon: Settings },
        { id: 'profile', label: t('settings.profile'), icon: User },
        { id: 'about', label: t('settings.about'), icon: Info }
      ]
    },
    {
      label: t('settings.aiConfig'),
      items: [
        { id: 'engine', label: t('settings.engine'), icon: Cpu },
        { id: 'models', label: t('settings.models'), icon: Brain },
        { id: 'directories', label: t('settings.directories'), icon: FolderOpen },
        { id: 'memory', label: t('settings.memory'), icon: BookOpen }
      ]
    },
    {
      label: t('settings.extensions'),
      items: [
        { id: 'connectors', label: t('settings.connectors'), icon: Cable },
        { id: 'mcp', label: t('settings.mcp'), icon: Wrench }
      ]
    }
  ]
  const activeItem = MENU_SECTIONS.flatMap((section) => section.items).find(
    (item) => item.id === activeTab
  )
  const handleTabChange = (tab: string): void => {
    onTabChange(tab)
    setNavigationOpen(false)
  }

  return (
    <div className="app-shell">
      <div className="workspace-window">
        {/* Settings 是独占管理台：桌面态用左侧设置导航承载返回与分区，
            窄屏态才降级为紧凑顶栏，避免同时出现全局工作区顶栏和设置导航。 */}
        <div className="settings-compact-topbar">
          <button
            type="button"
            onClick={onBack}
            className="panel-toggle ui-focus"
            aria-label={t('settings.backToApp')}
            title={t('settings.backToApp')}
          >
            <ArrowLeft size={15} strokeWidth={1.9} />
          </button>
          <div className="min-w-0 flex-1 truncate text-center text-[13px] font-semibold text-text-primary">
            {activeItem?.label ?? t('settings.preferences')}
          </div>
          <button
            type="button"
            onClick={() => setNavigationOpen(true)}
            className="panel-toggle ui-focus"
            aria-label={t('settings.openNavigation')}
            title={t('settings.openNavigation')}
          >
            <Menu size={16} strokeWidth={1.9} />
          </button>
        </div>

        {/* 左侧菜单：与主页侧栏共用同一块毛玻璃底板和红绿灯安全区。 */}
        <aside
          className={`settings-sidebar-shell ${navigationOpen ? 'settings-sidebar-shell-open' : ''}`}
        >
          <WorkspaceHeader
            className="workspace-sidebar-header"
            title={
              <button
                onClick={onBack}
                className="settings-back-button no-drag ui-focus"
                title={t('settings.backToApp')}
              >
                <ArrowLeft size={15} strokeWidth={1.9} />
                <span className="truncate">{t('settings.backToApp')}</span>
              </button>
            }
          />

          {/* 菜单导航 */}
          <nav className="flex-1 overflow-y-auto px-3 py-2">
            {MENU_SECTIONS.map((section) => (
              <div key={section.label} className="mb-4">
                <div className="px-2.5 mb-1.5 text-[11px] text-text-tertiary font-medium uppercase tracking-wider">
                  {section.label}
                </div>
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleTabChange(item.id)}
                      title={item.label}
                      className={`no-drag ui-row-button ui-focus ${
                        activeTab === item.id ? 'ui-row-button-active' : ''
                      }`}
                    >
                      <item.icon size={15} strokeWidth={1.8} className="shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {navigationOpen && (
          <button
            type="button"
            className="settings-sidebar-backdrop"
            aria-label={t('common.close')}
            onClick={() => setNavigationOpen(false)}
          />
        )}

        {/* 右侧内容区 */}
        <section className="workspace-center-column">
          <div className="workspace-main-surface">
            <div className="page-scroll">
              <div className="page-container-workbench workspace-page-container">
                <div className="page-hero">
                  <h1 className="page-title">{activeItem?.label ?? t('settings.preferences')}</h1>
                </div>
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
        </section>
      </div>
    </div>
  )
}
