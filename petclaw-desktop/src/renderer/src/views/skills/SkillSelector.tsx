import { useEffect, useRef, useState } from 'react'

import { Wrench, Search, X, Settings } from 'lucide-react'

// Skill 数据形状（来自 window.api.skills.list()）
interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
}

interface SkillSelectorProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  /** 点击"管理技能"时的回调 */
  onManage?: () => void
}

export function SkillSelector({ selectedIds, onChange, onManage }: SkillSelectorProps) {
  const [open, setOpen] = useState(false)
  const [skills, setSkills] = useState<Skill[]>([])
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // 打开时加载 skill 列表
  useEffect(() => {
    if (!open) return
    window.api.skills
      .list()
      .then((raw) => {
        // raw 为 unknown[]，向下收窄
        if (!Array.isArray(raw)) return
        const parsed: Skill[] = raw
          .filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
          .filter((s) => s.enabled === true)
          .map((s) => ({
            id: String(s.id ?? ''),
            name: String(s.name ?? ''),
            description: String(s.description ?? ''),
            enabled: true
          }))
        setSkills(parsed)
      })
      .catch(() => setSkills([]))
  }, [open])

  const filtered = search.trim()
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase())
      )
    : skills

  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((v) => v !== id) : [...selectedIds, id])
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-1">
      {/* 工具栏按钮 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1.5 rounded-[10px] text-[12px] text-text-secondary hover:bg-bg-card hover:text-text-primary transition-all duration-[120ms]"
        title="选择技能"
      >
        <Wrench size={14} strokeWidth={1.75} />
        {/* 已选数量 badge */}
        {selectedIds.length > 0 && (
          <span className="min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center leading-none">
            {selectedIds.length}
          </span>
        )}
      </button>

      {/* 已选 skill chip 标签条 */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {selectedIds.map((id) => {
            const skill = skills.find((s) => s.id === id)
            return (
              <span
                key={id}
                className="flex items-center gap-1 px-2 py-0.5 rounded-[8px] bg-bg-card border border-border text-[11px] text-text-secondary"
              >
                <Wrench size={10} strokeWidth={2} />
                <span>{skill?.name ?? id}</span>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  className="hover:text-text-primary transition-colors"
                >
                  <X size={10} strokeWidth={2} />
                </button>
              </span>
            )
          })}
          {/* 全部清除 */}
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors duration-[120ms] px-1"
          >
            全部清除
          </button>
        </div>
      )}

      {/* 多选 Popover */}
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-64 rounded-[14px] bg-bg-card border border-border shadow-[var(--shadow-dropdown)] z-50 overflow-hidden">
          {/* 搜索框 */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
            <Search size={13} strokeWidth={1.75} className="text-text-tertiary shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索技能"
              className="flex-1 text-[13px] bg-transparent text-text-primary placeholder:text-text-tertiary outline-none"
              autoFocus
            />
          </div>

          {/* 技能列表 */}
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-text-tertiary text-center">
                {skills.length === 0 ? '暂无已安装技能' : '无匹配技能'}
              </div>
            ) : (
              filtered.map((skill) => {
                const checked = selectedIds.includes(skill.id)
                return (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => toggle(skill.id)}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-bg-input transition-colors duration-[120ms] ${checked ? 'bg-accent/5' : ''}`}
                  >
                    {/* Checkbox */}
                    <span
                      className={`mt-0.5 w-3.5 h-3.5 rounded-[4px] border shrink-0 flex items-center justify-center transition-colors ${checked ? 'bg-accent border-accent' : 'border-border'}`}
                    >
                      {checked && (
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                          <path
                            d="M1 3l2 2 4-4"
                            stroke="white"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="block text-[13px] text-text-primary font-medium truncate">
                        {skill.name}
                      </span>
                      {skill.description && (
                        <span className="block text-[11px] text-text-tertiary truncate mt-0.5">
                          {skill.description}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* 底部操作 */}
          <div className="border-t border-border">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onManage?.()
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] text-text-tertiary hover:text-text-secondary hover:bg-bg-input transition-all duration-[120ms] text-left"
            >
              <Settings size={13} strokeWidth={1.75} />
              <span>管理技能</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
