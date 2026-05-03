import { useState, useRef, useEffect } from 'react'
import { Check, Pencil } from 'lucide-react'

import { useI18n } from '../../i18n'

/**
 * 聊天标题 slot：显示在 AppTopBar 的 centerSlot 中。
 * 支持内联编辑会话标题。
 */

interface ChatTitleSlotProps {
  sessionId?: string | null
  sidebarCollapsed?: boolean
}

export function ChatTitleSlot({ sessionId, sidebarCollapsed = false }: ChatTitleSlotProps) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(() => t('chat.newConversation'))
  const inputRef = useRef<HTMLInputElement>(null)

  // 没有会话时显示默认标题
  useEffect(() => {
    if (!sessionId) {
      setTitle(t('chat.newConversation'))
    }
  }, [sessionId, t])

  // 进入编辑模式后聚焦输入框并全选
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commitEdit = () => {
    setEditing(false)
    // TODO: 调用 IPC 保存标题
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') {
      setTitle(t('chat.newConversation'))
      setEditing(false)
    }
  }

  // 折叠态才显示居中标题，展开态侧栏有 header 已经足够
  if (!sidebarCollapsed && !sessionId) return null

  return (
    <div className="flex items-center gap-1.5 max-w-[400px] min-w-0">
      {editing ? (
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className="no-drag min-w-0 flex-1 rounded-[8px] border border-accent bg-white/70 px-2.5 py-1 text-[13px] font-semibold text-text-primary outline-none"
        />
      ) : (
        <span className="truncate text-[13px] font-semibold text-text-primary">{title}</span>
      )}
      <button
        onClick={() => (editing ? commitEdit() : setEditing(true))}
        className="no-drag panel-toggle shrink-0 ui-focus"
        aria-label={editing ? t('chat.confirmTitle') : t('chat.editTitle')}
      >
        {editing ? <Check size={13} strokeWidth={2.5} /> : <Pencil size={13} strokeWidth={2} />}
      </button>
    </div>
  )
}
