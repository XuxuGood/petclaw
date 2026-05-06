import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { FolderOpen, FolderPlus, Clock, X, ChevronRight, Replace } from 'lucide-react'

import { useI18n } from '../i18n'
import { Tooltip } from './Tooltip'

// 从完整路径中提取最后一级文件夹名
function getFolderName(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

// 首尾截断：保留头尾特征，中间用 … 替代。
// 统一整个组件（trigger chip + recent submenu）共用同一套截断策略，
// 相比尾部省略更能帮用户同时识别前缀（路径根）和后缀（末级名/版本/日期）。
function truncateMiddle(text: string, max = 18): string {
  if (!text) return ''
  if (text.length <= max) return text
  // 前后各留一半（减去 … 占位），前缀多保留一位帮助识别
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${text.slice(0, head)}\u2026${text.slice(-tail)}`
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
  // 一级菜单外层 ref：二级 submenu 的定位基准（底边对齐一级菜单底边、
  // 贴一级菜单右边），与 ChatInputBox 二级 flyout 完全同一套 cascade 规则。
  const menuRef = useRef<HTMLDivElement>(null)
  // "最近使用"行 ref：只负责 hover 触发二级 submenu 展开，不再参与定位计算。
  const recentBtnRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  // 用于延迟关闭子菜单，避免鼠标移动时闪烁
  const submenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 点击外部关闭弹层。
  // 二级 submenu 经 Portal 挂到 body 后不在 containerRef 子树内，必须额外排除
  // submenuRef，否则点击 submenu 里的目录项时 mousedown 会被判为"外部点击"，
  // 导致 submenu 卸载、click 打不到按钮（用户无法选择最近目录）。
  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      const target = e.target as Node
      if (!containerRef.current?.contains(target) && !submenuRef.current?.contains(target)) {
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
    // cowork.listSessions() 返回 unknown[]，向下收窄取 cwd 字段
    window.api.cowork
      .listSessions()
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
    // 调用主进程 Electron dialog.showOpenDialog，打开系统原生目录选择器。
    // 默认路径用当前值，方便用户基于已选目录做附近二次选择；用户取消时保持原值。
    try {
      const dir = await window.api.directories.selectDirectory({
        defaultPath: value || undefined
      })
      if (dir) onChange(dir)
    } catch (err) {
      await window.api.logging.report({
        level: 'error',
        module: 'CwdSelector',
        event: 'directory.select.failed',
        message: err instanceof Error ? err.message : 'Failed to select directory',
        fields: {
          errorName: err instanceof Error ? err.name : typeof err,
          errorMessage: err instanceof Error ? err.message : String(err)
        }
      })
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
      {/* 触发按钮：已选中时使用项目中性 token（workspace-state-active + text-primary）的灰胶囊，
          未选中时维持默认 ghost 风格，符合整体中性设计语言。
          完整路径通过 Radix Tooltip 呈现（300ms 延迟 / Portal 定位），未选时 content 为空时 Tooltip 透传。 */}
      <Tooltip content={value || undefined}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`ui-icon-button max-w-[180px] gap-1.5 px-2.5 text-[12px] font-semibold text-text-primary ui-focus${value ? ' cwd-trigger-filled' : ''}`}
          aria-label={value || t('cwdSelector.title')}
        >
          <FolderOpen size={14} strokeWidth={1.75} className="shrink-0 cwd-trigger-icon" />
          {value ? (
            <>
              <span className="truncate">{truncateMiddle(getFolderName(value), 18)}</span>
              {/* × 清除按钮：默认不显示，hover 或聚焦 chip 时从右侧展开（由 .cwd-trigger-clear 接管），
                  阻止冒泡避免触发下拉 */}
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  onChange('')
                }}
                className="cwd-trigger-clear shrink-0"
              >
                <X size={13} strokeWidth={2} />
              </span>
            </>
          ) : (
            // 未选中态文案承担"选择工作目录"的可操作语义，使用 secondary 保证 7.5:1 对比度，
            // 与已选态（chip 内 primary）形成自然层级，避免回落到 tertiary 的装饰色。
            <span className="text-text-secondary">{t('cwdSelector.title')}</span>
          )}
        </button>
      </Tooltip>

      {/* 主下拉菜单 */}
      {open && (
        <div ref={menuRef} className="ui-popover absolute bottom-full left-0 mb-2 w-52">
          {/* 添加 / 更换目录：根据是否已选切换图标与文案，避免用户误以为是"新增另一个";
              完整路径交给 chip 的 title tooltip 展示，不在此重复 */}
          <button type="button" onClick={handleAddFolder} className="ui-popover-row">
            {value ? (
              <Replace size={15} strokeWidth={1.75} className="shrink-0 text-text-secondary" />
            ) : (
              <FolderPlus size={15} strokeWidth={1.75} className="shrink-0 text-text-secondary" />
            )}
            <span className="flex-1 truncate">
              {value ? t('cwdSelector.changeFolder') : t('cwdSelector.addFolder')}
            </span>
          </button>

          {/* 最近使用（悬停展开子菜单） */}
          <div
            ref={recentBtnRef}
            onMouseEnter={handleSubmenuEnter}
            onMouseLeave={handleSubmenuLeave}
            className="ui-popover-row cursor-default"
          >
            <Clock size={15} strokeWidth={1.75} className="shrink-0 text-text-secondary" />
            <span className="flex-1 truncate">{t('cwdSelector.recent')}</span>
            <ChevronRight size={13} strokeWidth={1.75} className="shrink-0 text-text-tertiary" />
          </div>
        </div>
      )}

      {/* 最近目录子菜单（Portal + fixed 定位；anchor 是一级菜单本身，不是"最近使用"行） */}
      {open && showRecent && (
        <RecentSubmenu
          ref={submenuRef}
          menuAnchor={menuRef.current}
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

// 子菜单：Portal 到 body + fixed 定位，和 ChatInputBox 二级 flyout 采用
// 完全一致的 cascade 定位规则，确保聊天输入框上方两类二级弹层视觉统一：
//   - 水平：默认紧贴一级菜单右缘（gap=0），溢出主画布则翻向一级左侧同样紧贴；
//   - 垂直：底边对齐一级菜单底边（bottom 基准而非 top），超长时向上延展；
//   - maxHeight：以一级菜单底边到主画布顶边的可用空间为上限，内部滚动兜底。
// anchor 取"一级菜单自身"而非"最近使用"行，避免二级从菜单中段伸出的错位感。
interface RecentSubmenuProps {
  menuAnchor: HTMLElement | null
  dirs: string[]
  loading: boolean
  onSelect: (dir: string) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  ref: React.RefObject<HTMLDivElement | null>
}

function RecentSubmenu({
  menuAnchor,
  dirs,
  loading,
  onSelect,
  onMouseEnter,
  onMouseLeave,
  ref
}: RecentSubmenuProps) {
  const { t } = useI18n()
  if (!menuAnchor || typeof document === 'undefined') return null

  const SUB_W = 224 // 与 className 中的 w-56（14rem）保持一致
  const MARGIN = 8 // 视口/主画布边距护栏

  const menuRect = menuAnchor.getBoundingClientRect()
  // 翻面 bounds 取 viewport 而不是 .workspace-main-surface：
  // 二级 submenu 已 Portal 到 body、zIndex 1000，不受主画布 overflow 裁切；
  // 若用 main-surface 作 bounds，sidebar+monitor 都展开时主画布可能只剩 ~600px，
  // 小于一级(208=w-52) + 二级(224=w-56) 的翻面阈值（或在窄屏达不到时）
  // 会被错误翻到左侧，表现与 ChatInputBox 二级不一致。
  // 与 ChatInputBox 二级 flyout 保持完全同一套 cascade 规则。
  const bounds = {
    left: 0,
    right: window.innerWidth,
    top: 0,
    bottom: window.innerHeight
  }

  // 水平：默认紧贴一级菜单右缘（gap=0，与 ChatInputBox 二级 flyout 同规则）；
  // 右侧超出视口时翻向一级左侧，同样紧贴
  let left = menuRect.right
  if (left + SUB_W + MARGIN > bounds.right) {
    left = menuRect.left - SUB_W
  }
  // clamp 兜底：极窄视口下仍保持在视口内
  left = Math.max(bounds.left + MARGIN, Math.min(left, bounds.right - SUB_W - MARGIN))

  // 垂直：底边对齐一级菜单底边（bottom 固定而非 top 固定），超长向上延展。
  // 这与 ChatInputBox 二级 flyout 的规则完全一致 —— 两个弹窗的二级都从
  // 一级菜单底边齐平伸出，视觉规则统一。
  const bottom = window.innerHeight - menuRect.bottom
  // maxHeight 护栏：从一级菜单底边向上最多延展到视口顶边 - MARGIN，
  // 保底 200 防极端小视口下过窄；配合 overflow-y 内部滚动，目录过多时不撞出视口。
  const maxHeight = Math.max(200, menuRect.bottom - bounds.top - MARGIN)

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        bottom,
        left,
        maxHeight,
        overflowY: 'auto',
        zIndex: 1000
      }}
      className="ui-popover ui-contained-scroll w-56"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {loading ? (
        <div className="ui-popover-empty">
          <div className="ui-popover-empty-title">{t('common.loading')}</div>
        </div>
      ) : dirs.length === 0 ? (
        <div className="ui-popover-empty">
          <div className="ui-popover-empty-title">{t('cwdSelector.noRecent')}</div>
        </div>
      ) : (
        dirs.map((dir) => (
          // Tooltip side="right" 避免遮挡下方列表项；长路径完整内容由 Radix Tooltip 承载
          <Tooltip key={dir} content={dir} side="right">
            <button type="button" onClick={() => onSelect(dir)} className="ui-popover-row">
              <FolderOpen size={14} strokeWidth={1.75} className="shrink-0 text-text-secondary" />
              <span className="truncate">{truncateMiddle(dir, 32)}</span>
            </button>
          </Tooltip>
        ))
      )}
    </div>,
    document.body
  )
}
