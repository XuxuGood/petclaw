import {
  MessageSquare,
  Zap,
  Clock,
  Radio,
  CreditCard,
  Plus,
  PawPrint,
  Gift,
  Settings,
  Moon,
  User
} from 'lucide-react'
import type { ViewType } from '../ChatApp'

const NAV_ITEMS: Array<{
  id: ViewType | string
  label: string
  icon: typeof MessageSquare
}> = [
  { id: 'chat', label: '聊天', icon: MessageSquare },
  { id: 'skills', label: '技能', icon: Zap },
  { id: 'cron', label: '定时任务', icon: Clock },
  { id: 'channels', label: '频道', icon: Radio },
  { id: 'pricing', label: '价格', icon: CreditCard }
]

interface SidebarProps {
  activeView: ViewType
  onViewChange: (view: ViewType) => void
}

export function Sidebar({ activeView, onViewChange }: SidebarProps): JSX.Element {
  const handleNav = (id: string): void => {
    if (id === 'chat' || id === 'monitor' || id === 'settings') {
      onViewChange(id as ViewType)
    }
    // skills/cron/channels/pricing — TODO，暂时不切换
  }

  return (
    <div className="w-[220px] bg-bg-sidebar flex flex-col select-none shrink-0 border-r border-border">
      {/* Top: traffic lights area + Logo */}
      <div className="drag-region h-[52px] shrink-0 flex items-center pl-[78px] pr-4">
        <div className="no-drag flex items-center gap-2">
          <div className="w-6 h-6 rounded-[7px] bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center shadow-sm">
            <PawPrint size={12} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-[14px] tracking-tight">
            <span className="font-bold text-text-primary">PetClaw</span>
            <span className="ml-0.5 text-[10px] font-semibold text-text-tertiary align-top relative top-[-1px]">
              AI
            </span>
          </span>
        </div>
      </div>

      {/* New chat button */}
      <div className="px-3 mb-1">
        <button
          onClick={() => onViewChange('chat')}
          className="no-drag w-full flex items-center gap-2.5 px-3 py-[7px] rounded-[8px] text-[13px] text-text-secondary border border-border hover:text-text-primary hover:bg-bg-hover hover:border-text-tertiary active:scale-[0.98] transition-all duration-150 ease"
        >
          <Plus size={15} strokeWidth={2} />
          <span>新建聊天</span>
        </button>
      </div>

      {/* Navigation */}
      <nav className="px-3 py-1 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = activeView === item.id
          return (
            <button
              key={item.id}
              onClick={() => handleNav(item.id)}
              className={`no-drag w-full flex items-center gap-2.5 px-3 py-[7px] rounded-[8px] text-[13px] transition-all duration-150 ease ${
                isActive
                  ? 'bg-bg-active text-text-primary font-medium'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              }`}
            >
              <Icon size={15} strokeWidth={isActive ? 2 : 1.75} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Divider */}
      <div className="mx-4 mt-2 mb-1.5 h-px bg-border" />

      {/* Conversation history */}
      <div className="flex-1 flex flex-col min-h-0 px-3">
        <div className="px-2 mb-1">
          <span className="text-[11px] text-text-tertiary font-medium">今天</span>
        </div>
        <div className="flex-1 overflow-y-auto space-y-0.5 pr-0.5">
          <button className="no-drag w-full flex items-center gap-2.5 px-3 py-[7px] rounded-[8px] bg-bg-active text-[13px] text-text-primary hover:bg-bg-active/80 active:scale-[0.98] transition-all duration-150 ease text-left">
            <MessageSquare size={14} strokeWidth={1.75} className="shrink-0 text-text-tertiary" />
            <span className="truncate">当前对话</span>
          </button>
        </div>
      </div>

      {/* Invite code */}
      <div className="px-3 py-1.5">
        <button className="no-drag w-full flex items-center gap-2.5 px-3 py-[7px] rounded-[8px] text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all duration-150 ease">
          <Gift size={15} strokeWidth={1.75} />
          <span>邀请码</span>
        </button>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-border" />

      {/* Bottom: user + settings + dark mode */}
      <div className="px-3 py-2 flex items-center gap-1">
        {/* User avatar */}
        <button className="no-drag w-8 h-8 rounded-full bg-bg-active flex items-center justify-center hover:bg-bg-active/70 active:scale-[0.95] transition-all duration-150 ease">
          <User size={15} className="text-text-secondary" strokeWidth={1.75} />
        </button>

        <div className="flex-1" />

        {/* Settings */}
        <button
          onClick={() => onViewChange('settings')}
          className={`no-drag w-8 h-8 rounded-[8px] flex items-center justify-center transition-all duration-150 ease ${
            activeView === 'settings'
              ? 'bg-bg-active text-text-primary'
              : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'
          }`}
        >
          <Settings size={15} strokeWidth={1.75} />
        </button>

        {/* Dark mode toggle */}
        <button className="no-drag w-8 h-8 rounded-[8px] flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-all duration-150 ease">
          <Moon size={15} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
