import { ArrowLeft } from 'lucide-react'

import { PreferenceSettings } from './PreferenceSettings'
import { ProfileSettings } from './ProfileSettings'
import { AboutSettings } from './AboutSettings'
import { EngineSettings } from './EngineSettings'
import { ModelSettings } from './ModelSettings'
import { AgentSettings } from './AgentSettings'
import { MemorySettings } from './MemorySettings'
import { ConnectorSettings } from './ConnectorSettings'
import { McpSettings } from './McpSettings'

// 左侧菜单分组配置
const MENU_SECTIONS = [
  {
    label: '通用',
    items: [
      { id: 'preferences', label: '偏好设置', icon: '⚙️' },
      { id: 'profile', label: '个人资料', icon: '👤' },
      { id: 'about', label: '关于', icon: 'ℹ️' }
    ]
  },
  {
    label: 'AI 配置',
    items: [
      { id: 'engine', label: 'Agent 引擎', icon: '⚙️' },
      { id: 'models', label: '模型', icon: '🧠' },
      { id: 'agents', label: 'Agent', icon: '🤖' },
      { id: 'memory', label: '记忆', icon: '📝' }
    ]
  },
  {
    label: '扩展与集成',
    items: [
      { id: 'connectors', label: '连接器', icon: '🔌' },
      { id: 'mcp', label: 'MCP 服务', icon: '🔧' }
    ]
  }
]

interface SettingsPageProps {
  activeTab: string
  onTabChange: (tab: string) => void
  onBack: () => void
}

export function SettingsPage({ activeTab, onTabChange, onBack }: SettingsPageProps) {
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
            <span>返回应用</span>
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
          {activeTab === 'agents' && <AgentSettings />}
          {activeTab === 'memory' && <MemorySettings />}
          {activeTab === 'connectors' && <ConnectorSettings />}
          {activeTab === 'mcp' && <McpSettings />}
        </div>
      </div>
    </div>
  )
}
