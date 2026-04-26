import { useState, useEffect } from 'react'

import {
  PawPrint,
  Plus,
  Zap,
  Clock,
  MessageSquare,
  Settings,
  ChevronDown,
  User
} from 'lucide-react'

import type { ViewType } from '../ChatApp'

// 目录数据结构（与后端 DirectoryManager 对应）
interface DirectoryInfo {
  agentId: string
  path: string
  name: string | null
}

// 会话数据结构（与后端 SessionManager 对应）
interface Session {
  id: string
  agentId: string
  title: string
  updatedAt: number
}

interface SidebarProps {
  activeView: ViewType
  onViewChange: (view: ViewType) => void
  currentDirectoryId: string
  onDirectoryChange: (agentId: string) => void
  activeSessionId: string | null
  onSessionSelect: (id: string) => void
  sidebarTab: 'tasks' | 'channels'
  onSidebarTabChange: (tab: 'tasks' | 'channels') => void
  onNewTask: () => void
  onSettingsOpen: () => void
}

export function Sidebar({
  activeView,
  onViewChange,
  currentDirectoryId,
  onDirectoryChange,
  activeSessionId,
  onSessionSelect,
  sidebarTab,
  onSidebarTabChange,
  onNewTask,
  onSettingsOpen
}: SidebarProps) {
  const [directories, setDirectories] = useState<DirectoryInfo[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [dirMenuOpen, setDirMenuOpen] = useState(false)

  // 加载目录列表
  useEffect(() => {
    window.api.directories.list().then((raw: unknown) => {
      if (Array.isArray(raw)) {
        setDirectories(raw as DirectoryInfo[])
      }
    })
  }, [])

  // 加载会话列表（每次 currentDirectoryId 变化时重新过滤）
  useEffect(() => {
    window.api.cowork.sessions().then((raw: unknown) => {
      if (Array.isArray(raw)) {
        setSessions(raw as Session[])
      }
    })
  }, [currentDirectoryId])

  // 当前目录显示名称
  const currentDir = directories.find((d) => d.agentId === currentDirectoryId)
  const dirDisplayName = currentDir?.name ?? currentDir?.path.split('/').pop() ?? 'PetClaw'

  // 过滤当前目录的会话列表，按更新时间倒序
  const filteredSessions = sessions
    .filter((s) => s.agentId === currentDirectoryId)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="w-[220px] bg-bg-sidebar flex flex-col select-none shrink-0 border-r border-border">
      {/* 顶部：交通灯区 + Logo */}
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

      {/* 新建任务按钮 */}
      <div className="px-3 mb-1">
        <button
          onClick={onNewTask}
          className="no-drag w-full flex items-center gap-2.5 px-3 py-[7px] rounded-[10px] text-[13px] text-text-secondary border border-border hover:text-text-primary hover:bg-bg-hover hover:border-text-tertiary active:scale-[0.96] transition-all duration-[120ms] ease"
        >
          <Plus size={15} strokeWidth={2} />
          <span>新建任务</span>
        </button>
      </div>

      {/* 功能导航图标区：技能、定时任务 */}
      <div className="px-3 py-1 flex items-center gap-1">
        <button
          onClick={() => onViewChange('skills')}
          title="技能"
          className={`no-drag flex-1 flex items-center justify-center gap-1.5 py-[7px] rounded-[10px] text-[12px] transition-all duration-[120ms] ease active:scale-[0.96] ${
            activeView === 'skills'
              ? 'bg-bg-active text-text-primary font-medium'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          }`}
        >
          <Zap size={14} strokeWidth={activeView === 'skills' ? 2 : 1.75} />
          <span>技能</span>
        </button>
        <button
          onClick={() => onViewChange('cron')}
          title="定时任务"
          className={`no-drag flex-1 flex items-center justify-center gap-1.5 py-[7px] rounded-[10px] text-[12px] transition-all duration-[120ms] ease active:scale-[0.96] ${
            activeView === 'cron'
              ? 'bg-bg-active text-text-primary font-medium'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          }`}
        >
          <Clock size={14} strokeWidth={activeView === 'cron' ? 2 : 1.75} />
          <span>定时</span>
        </button>
      </div>

      {/* IM 频道导航（独占一行） */}
      <div className="px-3 pb-1">
        <button
          onClick={() => onViewChange('im-channels')}
          title="IM 频道"
          className={`no-drag w-full flex items-center gap-2.5 px-3 py-[7px] rounded-[10px] text-[13px] transition-all duration-[120ms] ease active:scale-[0.96] ${
            activeView === 'im-channels'
              ? 'bg-bg-active text-text-primary font-medium'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          }`}
        >
          <MessageSquare size={14} strokeWidth={activeView === 'im-channels' ? 2 : 1.75} />
          <span>IM 频道</span>
        </button>
      </div>

      {/* 分隔线 */}
      <div className="mx-4 mt-1.5 mb-1.5 h-px bg-border" />

      {/* 工作目录区 */}
      <div className="px-3 mb-1">
        <div className="px-2 mb-1.5">
          <span className="text-[11px] text-text-tertiary font-medium">工作目录</span>
        </div>
        {/* 目录选择器 */}
        <div className="relative">
          <button
            onClick={() => setDirMenuOpen((p) => !p)}
            className="no-drag w-full flex items-center gap-2.5 px-3 py-[7px] rounded-[10px] text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-hover active:scale-[0.96] transition-all duration-[120ms] ease"
          >
            {/* 目录图标 */}
            <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0">
              <PawPrint size={10} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="flex-1 text-left truncate text-text-primary">{dirDisplayName}</span>
            <ChevronDown
              size={13}
              className={`shrink-0 transition-transform duration-[120ms] ${dirMenuOpen ? 'rotate-180' : ''}`}
              strokeWidth={2}
            />
          </button>

          {/* 目录下拉菜单 */}
          {dirMenuOpen && directories.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded-[10px] shadow-[var(--shadow-dropdown)] z-10 overflow-hidden">
              {directories.map((dir) => (
                <button
                  key={dir.agentId}
                  onClick={() => {
                    onDirectoryChange(dir.agentId)
                    setDirMenuOpen(false)
                  }}
                  className={`no-drag w-full flex items-center gap-2.5 px-3 py-[7px] text-[13px] transition-all duration-[120ms] ease active:scale-[0.96] ${
                    dir.agentId === currentDirectoryId
                      ? 'bg-bg-active text-text-primary font-medium'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                  }`}
                >
                  <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0">
                    <PawPrint size={10} className="text-white" strokeWidth={2.5} />
                  </div>
                  <span className="truncate">{dir.name ?? dir.path.split('/').pop()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 分隔线 */}
      <div className="mx-4 mt-1 mb-1.5 h-px bg-border" />

      {/* Tab 切换：任务 | 频道 */}
      <div className="px-3 mb-1">
        <div className="flex rounded-[10px] bg-bg-hover p-0.5 gap-0.5">
          <button
            onClick={() => onSidebarTabChange('tasks')}
            className={`no-drag flex-1 py-[5px] text-[12px] rounded-[8px] transition-all duration-[120ms] ease active:scale-[0.96] ${
              sidebarTab === 'tasks'
                ? 'bg-bg-card text-text-primary font-medium shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            任务
          </button>
          <button
            onClick={() => onSidebarTabChange('channels')}
            className={`no-drag flex-1 py-[5px] text-[12px] rounded-[8px] transition-all duration-[120ms] ease active:scale-[0.96] ${
              sidebarTab === 'channels'
                ? 'bg-bg-card text-text-primary font-medium shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            频道
          </button>
        </div>
      </div>

      {/* 列表区 */}
      <div className="flex-1 flex flex-col min-h-0 px-3 overflow-y-auto">
        {sidebarTab === 'tasks' && (
          <div className="space-y-0.5 py-0.5">
            {filteredSessions.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-text-tertiary">
                暂无任务记录
              </div>
            ) : (
              filteredSessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => {
                    onViewChange('chat')
                    onSessionSelect(session.id)
                  }}
                  className={`no-drag w-full flex items-center gap-2.5 px-3 py-[7px] rounded-[10px] text-[13px] transition-all duration-[120ms] ease active:scale-[0.96] text-left ${
                    activeSessionId === session.id
                      ? 'bg-bg-active text-text-primary'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                  }`}
                >
                  <MessageSquare
                    size={14}
                    strokeWidth={1.75}
                    className="shrink-0 text-text-tertiary"
                  />
                  <span className="truncate">{session.title || '新建任务'}</span>
                </button>
              ))
            )}
          </div>
        )}
        {sidebarTab === 'channels' && (
          <div className="px-3 py-6 text-center text-[12px] text-text-tertiary">
            频道功能即将推出
          </div>
        )}
      </div>

      {/* 底部栏：头像 + 昵称 + 设置 */}
      <div className="mx-4 h-px bg-border" />
      <div className="px-3 py-2 flex items-center gap-1">
        {/* 用户头像 */}
        <button className="no-drag w-8 h-8 rounded-full bg-bg-active flex items-center justify-center hover:bg-bg-hover active:scale-[0.96] transition-all duration-[120ms] ease">
          <User size={15} className="text-text-secondary" strokeWidth={1.75} />
        </button>

        <div className="flex-1" />

        {/* 设置按钮 */}
        <button
          onClick={onSettingsOpen}
          className={`no-drag w-8 h-8 rounded-[10px] flex items-center justify-center transition-all duration-[120ms] ease active:scale-[0.96] ${
            activeView === 'settings'
              ? 'bg-bg-active text-text-primary'
              : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'
          }`}
        >
          <Settings size={15} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
