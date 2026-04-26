import { useEffect, useRef, useState } from 'react'

import { FolderOpen, FolderPlus, Clock, X, ChevronRight } from 'lucide-react'

import { useI18n } from '../i18n'

// 从完整路径中提取最后一级文件夹名
function getFolderName(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

// 截断显示过长路径（中间省略）
function truncatePath(p: string, max = 30): string {
  if (!p) return ''
  if (p.length <= max) return p
  const name = getFolderName(p)
  if (name.length >= max - 3) return `.../${name}`
  const keep = max - name.length - 4
  return `${p.slice(0, keep)}.../${name}`
}

interface CwdSelectorProps {
  value: string
  onChange: (dir: string) => void
}

export function CwdSelector({ value, onChange }: CwdSelectorProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [showRecent, setShowRecent] = useState(false)
  const [recentDirs, setRecentDirs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const recentBtnRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  // 用于延迟关闭子菜单，避免鼠标移动时闪烁
  const submenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 点击外部关闭弹层
  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setShowRecent(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // 打开弹层时加载最近目录（从 cowork sessions 查询）
  useEffect(() => {
    if (!open) return
    setLoading(true)
    // cowork.sessions() 返回 unknown[]，向下收窄取 cwd 字段
    window.api.cowork
      .sessions()
      .then((sessions) => {
        const cwdSet = new Set<string>()
        const dirs: string[] = []
        for (const s of sessions) {
          if (
            s !== null &&
            typeof s === 'object' &&
            'cwd' in s &&
            typeof (s as Record<string, unknown>).cwd === 'string'
          ) {
            const cwd = (s as Record<string, unknown>).cwd as string
            if (cwd && !cwdSet.has(cwd)) {
              cwdSet.add(cwd)
              dirs.push(cwd)
              if (dirs.length >= 8) break
            }
          }
        }
        setRecentDirs(dirs)
      })
      .catch(() => setRecentDirs([]))
      .finally(() => setLoading(false))
  }, [open])

  const handleAddFolder = async () => {
    setOpen(false)
    setShowRecent(false)
    // 通过 IPC 打开系统文件夹选择对话框
    // 当前 preload 未暴露 dialog API，使用 getSetting 间接触发或直接调用
    // 注意：此处调用 window.api.setSetting 触发主进程的 dialog:selectDirectory
    // TODO: Task 19 补充 dialog:selectDirectory IPC，此处临时用 prompt 降级
    const dir = window.prompt(t('cwdSelector.promptPath'), value || '')
    if (dir?.trim()) {
      onChange(dir.trim())
    }
  }

  const handleSelectRecent = (dir: string) => {
    onChange(dir)
    setOpen(false)
    setShowRecent(false)
  }

  const handleSubmenuEnter = () => {
    if (submenuTimerRef.current) {
      clearTimeout(submenuTimerRef.current)
      submenuTimerRef.current = null
    }
    setShowRecent(true)
  }

  const handleSubmenuLeave = () => {
    if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current)
    submenuTimerRef.current = setTimeout(() => {
      setShowRecent(false)
      submenuTimerRef.current = null
    }, 150)
  }

  return (
    <div ref={containerRef} className="relative">
      {/* 触发按钮：显示当前选中目录或占位图标 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-[10px] text-[12px] text-text-secondary hover:bg-bg-card hover:text-text-primary transition-all duration-[120ms] max-w-[160px]"
        title={value || t('cwdSelector.title')}
      >
        <FolderOpen size={14} strokeWidth={1.75} className="shrink-0" />
        {value ? (
          <>
            <span className="truncate">{truncatePath(getFolderName(value), 20)}</span>
            {/* × 清除按钮，阻止冒泡避免触发下拉 */}
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation()
                onChange('')
              }}
              className="shrink-0 ml-0.5 p-0.5 rounded hover:bg-text-tertiary/20 transition-colors"
            >
              <X size={11} strokeWidth={2} />
            </span>
          </>
        ) : (
          <span className="text-text-tertiary">{t('cwdSelector.title')}</span>
        )}
      </button>

      {/* 主下拉菜单 */}
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-52 rounded-[14px] bg-bg-card border border-border shadow-[var(--shadow-dropdown)] z-50 overflow-hidden">
          {/* 添加文件夹 */}
          <button
            type="button"
            onClick={handleAddFolder}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-text-primary hover:bg-bg-input transition-colors duration-[120ms] text-left"
          >
            <FolderPlus size={15} strokeWidth={1.75} className="text-text-secondary shrink-0" />
            <span>{t('cwdSelector.addFolder')}</span>
          </button>

          {/* 最近使用（悬停展开子菜单） */}
          <div
            ref={recentBtnRef}
            onMouseEnter={handleSubmenuEnter}
            onMouseLeave={handleSubmenuLeave}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-[13px] text-text-primary hover:bg-bg-input transition-colors duration-[120ms] cursor-default"
          >
            <div className="flex items-center gap-2.5">
              <Clock size={15} strokeWidth={1.75} className="text-text-secondary shrink-0" />
              <span>{t('cwdSelector.recent')}</span>
            </div>
            <ChevronRight size={13} strokeWidth={1.75} className="text-text-tertiary" />
          </div>
        </div>
      )}

      {/* 最近目录子菜单（fixed 定位避免溢出） */}
      {open && showRecent && (
        <RecentSubmenu
          ref={submenuRef}
          anchor={recentBtnRef.current}
          dirs={recentDirs}
          loading={loading}
          onSelect={handleSelectRecent}
          onMouseEnter={handleSubmenuEnter}
          onMouseLeave={handleSubmenuLeave}
        />
      )}
    </div>
  )
}

// 子菜单：fixed 定位渲染，跟随父菜单中最近使用行
interface RecentSubmenuProps {
  anchor: HTMLElement | null
  dirs: string[]
  loading: boolean
  onSelect: (dir: string) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  ref: React.RefObject<HTMLDivElement>
}

function RecentSubmenu({
  anchor,
  dirs,
  loading,
  onSelect,
  onMouseEnter,
  onMouseLeave,
  ref
}: RecentSubmenuProps) {
  const { t } = useI18n()
  const [pos, setPos] = useState({ top: 0, left: 0 })

  // 计算子菜单位置（锚点左边）
  useEffect(() => {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    // 主菜单宽度 208px，子菜单在主菜单右侧
    setPos({ top: rect.top, left: rect.right + 4 })
  }, [anchor])

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: pos.top, left: pos.left }}
      className="w-60 max-h-72 overflow-y-auto rounded-[14px] bg-bg-card border border-border shadow-[var(--shadow-dropdown)] z-[60]"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {loading ? (
        <div className="px-3 py-2.5 text-[12px] text-text-tertiary">{t('common.loading')}</div>
      ) : dirs.length === 0 ? (
        <div className="px-3 py-2.5 text-[12px] text-text-tertiary">
          {t('cwdSelector.noRecent')}
        </div>
      ) : (
        dirs.map((dir) => (
          <button
            key={dir}
            type="button"
            onClick={() => onSelect(dir)}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-text-primary hover:bg-bg-input transition-colors duration-[120ms] text-left first:rounded-t-[14px] last:rounded-b-[14px]"
            title={dir}
          >
            <FolderOpen size={14} strokeWidth={1.75} className="text-text-secondary shrink-0" />
            <span className="truncate">{truncatePath(dir, 28)}</span>
          </button>
        ))
      )}
    </div>
  )
}
