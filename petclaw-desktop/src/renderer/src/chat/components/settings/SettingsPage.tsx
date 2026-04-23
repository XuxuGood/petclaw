import { ArrowLeft } from 'lucide-react'

interface SettingsPageProps {
  activeTab: string
  onTabChange: (tab: string) => void
  onBack: () => void
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  return (
    <div className="w-full h-full flex flex-col bg-bg-root overflow-hidden">
      {/* 顶部拖拽区 + 返回按钮 */}
      <div className="drag-region h-[52px] shrink-0 flex items-center pl-[78px]">
        <button
          onClick={onBack}
          className="no-drag flex items-center gap-1.5 text-[14px] text-text-secondary hover:text-text-primary transition-colors duration-[120ms]"
        >
          <ArrowLeft size={15} strokeWidth={2} />
          <span>返回应用</span>
        </button>
      </div>
      {/* 内容占位 */}
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-[14px]">
        设置页面（开发中）
      </div>
    </div>
  )
}
