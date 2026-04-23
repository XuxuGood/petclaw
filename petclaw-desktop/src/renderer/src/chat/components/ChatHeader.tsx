import { useState, useRef, useEffect } from 'react'
import { PanelRight, MoreHorizontal, Check, Pencil } from 'lucide-react'

interface ChatHeaderProps {
  sessionTitle: string
  onToggleMonitor: () => void
  /** 当前右侧面板是否已打开，用于高亮 toggle 按钮 */
  monitorOpen?: boolean
}

/**
 * 聊天顶栏：会话标题（可内联编辑）+ 右侧操作按钮。
 * 该区域同时作为 drag region，拖拽手柄通过 css class `drag-region` 实现。
 */
export function ChatHeader({ sessionTitle, onToggleMonitor, monitorOpen }: ChatHeaderProps) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(sessionTitle)
  const inputRef = useRef<HTMLInputElement>(null)

  // 外部标题变更时同步本地状态
  useEffect(() => {
    if (!editing) setTitle(sessionTitle)
  }, [sessionTitle, editing])

  // 进入编辑模式后聚焦输入框并全选
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commitEdit = () => {
    setEditing(false)
    // TODO: 调用 IPC 保存标题（Task 18 实现）
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') {
      setTitle(sessionTitle)
      setEditing(false)
    }
  }

  return (
    // drag-region 让整个顶栏可拖拽；子元素按钮需要 no-drag 阻止透传
    <div className="drag-region h-[52px] shrink-0 flex items-center px-4 gap-2 border-b border-border">
      {/* 左侧：标题区（点击铅笔图标进入编辑） */}
      <div className="flex-1 flex items-center gap-1.5 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className="no-drag flex-1 min-w-0 text-[13px] font-semibold text-text-primary bg-bg-input rounded-[10px] px-2.5 py-1 outline-none border border-accent"
          />
        ) : (
          <span className="text-[13px] font-semibold text-text-primary truncate">{title}</span>
        )}

        {/* 编辑 / 确认按钮 */}
        <button
          onClick={() => (editing ? commitEdit() : setEditing(true))}
          className="no-drag shrink-0 w-6 h-6 flex items-center justify-center rounded-[10px] text-text-tertiary hover:text-text-secondary hover:bg-bg-input transition-all duration-[120ms] ease active:scale-[0.96]"
          aria-label={editing ? '确认标题' : '编辑标题'}
        >
          {editing ? <Check size={13} strokeWidth={2.5} /> : <Pencil size={13} strokeWidth={2} />}
        </button>
      </div>

      {/* 右侧操作按钮组 */}
      <div className="no-drag flex items-center gap-1">
        {/* 任务监控面板开关 */}
        <button
          onClick={onToggleMonitor}
          className={`w-7 h-7 flex items-center justify-center rounded-[10px] transition-all duration-[120ms] ease active:scale-[0.96] ${
            monitorOpen
              ? 'bg-accent/10 text-accent'
              : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-input'
          }`}
          aria-label="切换任务监控面板"
          aria-pressed={monitorOpen}
        >
          <PanelRight size={15} strokeWidth={2} />
        </button>

        {/* 更多操作（占位，后续扩展） */}
        <button
          className="w-7 h-7 flex items-center justify-center rounded-[10px] text-text-tertiary hover:text-text-secondary hover:bg-bg-input transition-all duration-[120ms] ease active:scale-[0.96]"
          aria-label="更多操作"
        >
          <MoreHorizontal size={15} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
