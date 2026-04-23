import { useRef, useState } from 'react'

import { Send } from 'lucide-react'

import { CwdSelector } from './CwdSelector'
import { ModelSelector } from './ModelSelector'
import { SkillSelector } from './SkillSelector'

interface ChatInputBoxProps {
  onSend: (message: string, cwd: string, skillIds: string[], modelOverride: string) => void
  disabled?: boolean
}

export function ChatInputBox({ onSend, disabled = false }: ChatInputBoxProps) {
  const [input, setInput] = useState('')
  const [cwd, setCwd] = useState('')
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [activeModel, setActiveModel] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const canSend = !disabled && input.trim().length > 0

  const handleSend = () => {
    if (!canSend) return
    onSend(input.trim(), cwd, selectedSkills, activeModel)
    setInput('')
    // 重置 textarea 高度
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 输入中不触发发送（isComposing 检测中文输入）
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="shrink-0 px-6 pb-4 pt-2">
      <div className="rounded-[16px] bg-bg-input border border-border-input focus-within:border-accent transition-all duration-[120ms]">
        {/* 文本输入区 */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            // 自动增长，最高 120px
            const el = e.target
            el.style.height = 'auto'
            el.style.height = Math.min(el.scrollHeight, 120) + 'px'
          }}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
          disabled={disabled}
          className="w-full px-4 pt-3 pb-2 text-[14px] text-text-primary bg-transparent outline-none placeholder:text-text-tertiary resize-none leading-[1.5] min-h-[44px] max-h-[120px]"
        />

        {/* 工具栏（工作目录 + 技能 + 模型 + 发送） */}
        <div className="flex items-center gap-1 px-3 pb-2.5">
          {/* 左侧工具 */}
          <CwdSelector value={cwd} onChange={setCwd} />

          <div className="w-px h-3.5 bg-border mx-0.5" />

          <SkillSelector selectedIds={selectedSkills} onChange={setSelectedSkills} />

          <div className="w-px h-3.5 bg-border mx-0.5" />

          <ModelSelector value={activeModel} onChange={setActiveModel} />

          {/* 弹性空间 */}
          <div className="flex-1" />

          {/* 发送按钮 */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center shrink-0 hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-[120ms] active:scale-[0.96]"
            aria-label="发送消息"
          >
            <Send size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}
