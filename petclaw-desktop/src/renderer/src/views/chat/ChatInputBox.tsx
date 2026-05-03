import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  Check,
  ChevronRight,
  FileArchive,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  Image as ImageIcon,
  Package,
  Paperclip,
  Plug,
  Plus,
  Send,
  Settings,
  Trash2,
  Wrench,
  X
} from 'lucide-react'

import { CwdSelector } from '../../components/CwdSelector'
import { ModelSelector, type SelectedModel } from '../../components/ModelSelector'
import { ContextUsageIndicator } from '../../components/chat/ContextUsageIndicator'
import { useChatStore } from '../../stores/chat-store'
import { useI18n } from '../../i18n'

interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
  isBuiltIn: boolean
}

// 聊天附件统一数据模型。kind 决定 chip 视觉和发送时归平去向：
// - 'file'/'directory'：来自菜单的原生对话框选择，有绝对 path，会组装成 pathReferences 传给主进程
// - 'image'：来自拖放/粘贴/<input type=file>，有 base64Data，走 imageAttachments
interface ChatAttachment {
  id: string
  name: string
  kind: 'file' | 'directory' | 'image'
  path?: string
  mimeType?: string
  base64Data?: string
  size?: number
}

interface ChatImageAttachment {
  name: string
  mimeType: string
  base64Data: string
}

interface ChatPathReference {
  path: string
  kind: 'file' | 'directory'
}

interface ChatInputBoxProps {
  onSend: (
    message: string,
    cwd: string,
    skillIds: string[],
    selectedModel: SelectedModel | null,
    imageAttachments: ChatImageAttachment[],
    pathReferences: ChatPathReference[]
  ) => void
  disabled?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSkills(raw: unknown): Skill[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): Skill[] => {
    if (!isRecord(item) || item.enabled !== true) return []
    const id = String(item.id ?? '')
    if (!id) return []
    return [
      {
        id,
        name: String(item.name ?? id),
        description: String(item.description ?? ''),
        enabled: true,
        // 数据层目前 SkillManager 统一写死 false，分组全落为“自定义”；
        // 与设计稿“自定义/内置”分组一致，待后续 isBuiltIn 识别打通后自动生效
        isBuiltIn: item.isBuiltIn === true
      }
    ]
  })
}

function readImageAttachment(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.includes(',') ? result.split(',')[1] : undefined)
    }
    reader.onerror = () => resolve(undefined)
    reader.readAsDataURL(file)
  })
}

// 以扩展名推断文件视觉类别，将同类型映射到字符形状不同的 lucide 图标。
// 这里故意不引入新的语义色块（项目为中性极简），仅通过图标形状区分文件类型，
// 避免 png/py/md/json 共用一个 FileText 图标造成识别度不足。
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'heic'
])
const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'm',
  'mm',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'html',
  'css',
  'scss',
  'sass',
  'less',
  'vue',
  'svelte',
  'php'
])
const DATA_EXTENSIONS = new Set(['json', 'yml', 'yaml', 'toml', 'xml', 'csv', 'tsv', 'sql'])
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'])

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx < 0 || idx === name.length - 1) return ''
  return name.slice(idx + 1).toLowerCase()
}

type ChipIconKind = 'image' | 'code' | 'data' | 'archive' | 'directory' | 'file'

function getChipIconKind(attachment: ChatAttachment): ChipIconKind {
  if (attachment.kind === 'directory') return 'directory'
  if (attachment.kind === 'image') return 'image'
  const ext = getFileExtension(attachment.name)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (DATA_EXTENSIONS.has(ext)) return 'data'
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive'
  return 'file'
}

// 扩展名徽章文本：目录 → FOLDER，无扩展名 → FILE，其余 → 大写扩展名。
// 对齐设计稿《选择技能文件.png》的双行大卡片规范（第二行小胶囊徽章）
function getBadgeText(attachment: ChatAttachment): string {
  if (attachment.kind === 'directory') return 'FOLDER'
  const ext = getFileExtension(attachment.name)
  return ext ? ext.toUpperCase() : 'FILE'
}

export function ChatInputBox({ onSend, disabled = false }: ChatInputBoxProps) {
  const { t } = useI18n()
  const [input, setInput] = useState('')
  const [cwd, setCwd] = useState('')
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  // 拖放态：dragCounter 计数 dragenter/leave 避免子元素冒泡导致的闪烁（WHATWG HTML5 Drag and Drop 推荐做法）
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  // “+”菜单当前进入的子面板；null 表示显示主菜单。
  const [flyout, setFlyout] = useState<'expert' | 'skills' | 'connectors' | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const actionMenuRef = useRef<HTMLDivElement>(null)
  const actionPrimaryMenuRef = useRef<HTMLDivElement>(null)
  const actionFlyoutRef = useRef<HTMLDivElement>(null)

  // 上下文用量粗估：聊天消息字符数 / 2 作为 token 粗估值
  // 中英混合大致满足 2 chars/token；run time 提供精准 usage 后可替换
  // total 暂用 128k；后续可从 selectedModel 所属 ModelDefinition 中读 contextWindow
  const messages = useChatStore((state) => state.messages)
  const estimatedUsedTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 2), 0)
  const contextTotal = 128_000

  const canSend = !disabled && input.trim().length > 0
  // 按 kind 分流：image 走 imageAttachments，file/directory 走 pathReferences
  const imageAttachments = attachments.flatMap((attachment): ChatImageAttachment[] => {
    if (attachment.kind !== 'image' || !attachment.base64Data || !attachment.mimeType) return []
    return [
      { name: attachment.name, mimeType: attachment.mimeType, base64Data: attachment.base64Data }
    ]
  })
  const pathReferences = attachments.flatMap((attachment): ChatPathReference[] => {
    if ((attachment.kind !== 'file' && attachment.kind !== 'directory') || !attachment.path)
      return []
    return [{ path: attachment.path, kind: attachment.kind }]
  })

  useEffect(() => {
    if (!actionMenuOpen) return
    // 二级菜单 Portal 到 body 后不在 actionMenuRef 子树内，外部点击必须额外排除。
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (actionMenuRef.current?.contains(target)) return
      if (actionFlyoutRef.current?.contains(target)) return
      setActionMenuOpen(false)
      setFlyout(null)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [actionMenuOpen])

  useEffect(() => {
    if (!actionMenuOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setActionMenuOpen(false)
      setFlyout(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [actionMenuOpen])

  useEffect(() => {
    // 一级菜单打开时预加载 skill 列表，避免二级展开时的空窗闪烁
    if (!actionMenuOpen) return
    setSkillsLoading(true)
    window.api.skills
      .list()
      .then((raw) => setSkills(parseSkills(raw)))
      .catch(() => setSkills([]))
      .finally(() => setSkillsLoading(false))
  }, [actionMenuOpen])

  const handleSend = () => {
    if (!canSend) return
    onSend(input.trim(), cwd, selectedSkills, selectedModel, imageAttachments, pathReferences)
    setInput('')
    setSelectedSkills([])
    setAttachments([])
    // 重置 textarea 高度
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  // 一键清空引用区：同时清理附件和已选技能，用于 selected 条目过多时快速重置
  const handleClearContext = () => {
    setAttachments([])
    setSelectedSkills([])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 输入中不触发发送（isComposing 检测中文输入）
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 统一附件入库逻辑，复用于 <input type=file>、粘贴、拖放三个入口
  // 拖放/粘贴的 File 对象浏览器侧拿不到绝对路径（Electron v32+ 后 file.path 废弃），
  // 因此这里只将图片归为图片附件（有 base64），非图片文件暂用 'file' kind 展示但无 path，
  // 发送时不入 pathReferences（避免 AI 收到无效路径）。要引用本地文件请通过菜单入口。
  const ingestFiles = async (files: File[]) => {
    if (files.length === 0) return
    const nextAttachments: ChatAttachment[] = await Promise.all(
      files.map(async (file) => {
        const isImage = file.type.startsWith('image/')
        const base64Data = await readImageAttachment(file)
        return {
          id: `${file.name}-${file.lastModified}-${file.size}`,
          name: file.name,
          kind: (isImage ? 'image' : 'file') as ChatAttachment['kind'],
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          base64Data
        }
      })
    )
    setAttachments((current) => {
      const existing = new Set(current.map((item) => item.id))
      return [...current, ...nextAttachments.filter((item) => !existing.has(item.id))]
    })
  }

  // 菜单入口：打开系统原生对话框选择文件和/或目录，拿绝对路径入库。
  // 图片文件（kind='image'）由主进程预读 base64，入库时同时写入 path 和 base64Data：
  // path 保证能组装 pathReferences、base64Data 保证 chip 可预览。
  // 去重策略：id = `path:${absPath}` 保证同一路径不会重复添加
  const handleSelectAttachmentsFromMenu = async () => {
    setActionMenuOpen(false)
    setFlyout(null)
    try {
      const defaultPath = cwd.trim().length > 0 ? cwd.trim() : undefined
      const picked = await window.api.chat.selectAttachments({ defaultPath })
      if (!picked || picked.length === 0) return
      setAttachments((current) => {
        const existing = new Set(current.map((item) => item.id))
        const next: ChatAttachment[] = picked.flatMap((item) => {
          const id = `path:${item.path}`
          if (existing.has(id)) return []
          const name = item.path.split(/[\\/]/).pop() || item.path
          return [
            {
              id,
              name,
              kind: item.kind,
              path: item.path,
              mimeType: item.mimeType,
              base64Data: item.base64Data
            }
          ]
        })
        return [...current, ...next]
      })
    } catch (err) {
      // 静默失败：对话框类错误不阻断用户，仅入库，避免涂屏
      console.warn('[ChatInputBox] selectAttachments failed:', err)
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await ingestFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  // 粘贴图片入附件：截图 -> 保存 -> 选择 的三步流程压缩成一次 ⌘V。
  // 只处理 clipboardData.items 里 kind=file 的图片，纯文本粘贴完全不拦截（避免影响中文输入/普通复制粘贴）
  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items
    if (!items || items.length === 0) return
    const imageFiles: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (!file) continue
      // 粘贴图片通常没有可辨识的 name，用时间戳 + 扩展名兜底
      const ext = item.type.split('/')[1]?.split(';')[0] || 'png'
      const renamed = new File([file], `paste-${Date.now()}-${imageFiles.length}.${ext}`, {
        type: item.type,
        lastModified: Date.now()
      })
      imageFiles.push(renamed)
    }
    // 仅当确实捕获到图片时才阻断默认粘贴，否则不影响文本粘贴
    if (imageFiles.length === 0) return
    event.preventDefault()
    await ingestFiles(imageFiles)
  }

  // 拖放文件入附件：onDragOver 必须 preventDefault 浏览器才允许 drop。
  // 用 counter 而不是单一 flag：嵌套子元素（textarea/按钮）触发的 dragleave
  // 会把 flag 提前清掉，导致虚线边框闪烁。
  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragCounterRef.current += 1
    setIsDragging(true)
  }
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) setIsDragging(false)
  }
  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    await ingestFiles(files)
  }

  const toggleSkill = (id: string) => {
    setSelectedSkills((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    )
  }

  const selectedSkillItems = selectedSkills.map(
    (id) =>
      skills.find((skill) => skill.id === id) ?? {
        id,
        name: id,
        description: '',
        enabled: true,
        isBuiltIn: false
      }
  )

  // skill 按 isBuiltIn 分组，与设计稿“自定义技能 / 内置技能”两段对齐
  const groupedSkills = useMemo(() => {
    const custom: Skill[] = []
    const builtIn: Skill[] = []
    for (const s of skills) (s.isBuiltIn ? builtIn : custom).push(s)
    return { custom, builtIn }
  }, [skills])

  // 跳转到 Skills 页：通过 app:navigate 自定义事件穿透到 App 路由，避免 prop drilling
  const navigateToSkills = () => {
    setActionMenuOpen(false)
    setFlyout(null)
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'skills' } }))
  }

  return (
    <div className="shrink-0 px-0 pb-0 pt-2">
      <div
        className={`composer-shell ${isDragging ? 'composer-shell--dragging' : ''}`}
        aria-disabled={disabled || undefined}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {(attachments.length > 0 || selectedSkillItems.length > 0) && (
          <div className="composer-context-strip">
            {attachments.map((attachment) => {
              // 所有附件（图片 / 文件 / 目录）统一双行大卡片：首行「类型图标 + 文件名」，次行「大写类型徽章」。
              // 严格对齐设计稿《选择技能文件.png》；不为图片做特殊缩略图，避免混排时尺寸不一致导致条带凌乱。
              // 技能 chip 继续使用下方的小 pill 结构（composer-ref-chip--skill）。
              const iconKind = getChipIconKind(attachment)
              const title = attachment.path ?? attachment.name
              const badge = getBadgeText(attachment)
              return (
                <div key={attachment.id} className="composer-file-card" title={title}>
                  <div className="composer-file-card-head">
                    {iconKind === 'directory' ? (
                      <Folder size={16} strokeWidth={1.75} className="composer-file-card-icon" />
                    ) : iconKind === 'image' ? (
                      <ImageIcon size={16} strokeWidth={1.75} className="composer-file-card-icon" />
                    ) : iconKind === 'code' ? (
                      <FileCode2 size={16} strokeWidth={1.75} className="composer-file-card-icon" />
                    ) : iconKind === 'data' ? (
                      <FileJson size={16} strokeWidth={1.75} className="composer-file-card-icon" />
                    ) : iconKind === 'archive' ? (
                      <FileArchive
                        size={16}
                        strokeWidth={1.75}
                        className="composer-file-card-icon"
                      />
                    ) : (
                      <FileText size={16} strokeWidth={1.75} className="composer-file-card-icon" />
                    )}
                    <span className="composer-file-card-name">{attachment.name}</span>
                  </div>
                  <span className="composer-file-card-badge">{badge}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((item) => item.id !== attachment.id)
                      )
                    }
                    className="composer-file-card-remove ui-focus"
                    aria-label={t('chat.removeAttachment')}
                  >
                    <X size={12} strokeWidth={2.25} />
                  </button>
                </div>
              )
            })}

            {selectedSkillItems.map((skill) => (
              <span
                key={skill.id}
                className="composer-ref-chip composer-ref-chip--skill"
                title={skill.name}
              >
                <Wrench size={12} strokeWidth={1.75} className="composer-ref-chip-icon" />
                <span className="composer-ref-chip-label">{skill.name}</span>
                <button
                  type="button"
                  onClick={() => toggleSkill(skill.id)}
                  className="composer-ref-chip-remove ui-focus"
                  aria-label={t('chat.removeSkill')}
                >
                  <X size={11} strokeWidth={2.25} />
                </button>
              </span>
            ))}

            {/* 清空全部按钮：总条目 ≥ 2 才出现，数量很少时避免喧宾夺主 */}
            {attachments.length + selectedSkillItems.length >= 2 && (
              <button
                type="button"
                onClick={handleClearContext}
                className="composer-context-strip-clear ui-focus"
                aria-label={t('chat.clearAllContext')}
                title={t('chat.clearAllContext')}
              >
                <Trash2 size={12} strokeWidth={1.75} />
                <span>{t('chat.clearAllContext')}</span>
              </button>
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            // 自动增长，最高 240px（约 10-11 行）；超过后内部滚动。
            // 120 -> 240 的调整是为了让长 prompt 编辑不必依赖滚动看全文
            const el = e.target
            el.style.height = 'auto'
            el.style.height = Math.min(el.scrollHeight, 240) + 'px'
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t('chat.inputPlaceholder')}
          disabled={disabled}
          className="composer-textarea w-full min-h-[52px] max-h-[240px] resize-none bg-transparent px-4 pt-3 pb-2 text-[14px] leading-[1.6] text-text-primary outline-none placeholder:text-text-tertiary"
        />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {/* 底部工具条：所有控件统一 ctrl-sm 高度 + ghost 风格，仅发送按钮为 accent 强调 */}
        <div className="flex items-center gap-1.5 px-3 py-2">
          <CwdSelector value={cwd} onChange={setCwd} />

          <div ref={actionMenuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setActionMenuOpen((next) => {
                  if (next) setFlyout(null)
                  return !next
                })
              }}
              className="ui-icon-button ui-focus"
              aria-label={t('chat.addContext')}
              title={t('chat.addContext')}
              aria-expanded={actionMenuOpen}
            >
              <Plus size={16} strokeWidth={2} />
            </button>
            {actionMenuOpen && (
              <div
                ref={actionPrimaryMenuRef}
                className="ui-popover composer-action-popover absolute bottom-[calc(100%+8px)] left-0"
              >
                <button
                  type="button"
                  className={`ui-popover-row ${flyout === 'expert' ? 'ui-popover-row-flyout-open' : ''}`}
                  onMouseEnter={() => setFlyout('expert')}
                  onClick={() => setFlyout('expert')}
                >
                  <Package size={16} strokeWidth={1.75} className="shrink-0 text-text-secondary" />
                  <span className="flex-1 truncate">{t('chat.actionExpertKits')}</span>
                  <ChevronRight size={14} strokeWidth={2} className="ui-popover-row-chevron" />
                </button>
                <button
                  type="button"
                  className={`ui-popover-row ${flyout === 'skills' ? 'ui-popover-row-flyout-open' : ''}`}
                  onMouseEnter={() => setFlyout('skills')}
                  onClick={() => setFlyout('skills')}
                >
                  <Wrench size={16} strokeWidth={1.75} className="shrink-0 text-text-secondary" />
                  <span className="flex-1 truncate">{t('chat.actionSkills')}</span>
                  <ChevronRight size={14} strokeWidth={2} className="ui-popover-row-chevron" />
                </button>
                <button
                  type="button"
                  className={`ui-popover-row ${flyout === 'connectors' ? 'ui-popover-row-flyout-open' : ''}`}
                  onMouseEnter={() => setFlyout('connectors')}
                  onClick={() => setFlyout('connectors')}
                >
                  <Plug size={16} strokeWidth={1.75} className="shrink-0 text-text-secondary" />
                  <span className="flex-1 truncate">{t('chat.actionConnectors')}</span>
                  <ChevronRight size={14} strokeWidth={2} className="ui-popover-row-chevron" />
                </button>
                <div className="ui-popover-divider" />
                <button
                  type="button"
                  className="ui-popover-row"
                  onMouseEnter={() => setFlyout(null)}
                  onClick={handleSelectAttachmentsFromMenu}
                >
                  <Paperclip
                    size={16}
                    strokeWidth={1.75}
                    className="shrink-0 text-text-secondary"
                  />
                  <span className="flex-1 truncate">{t('chat.actionAddFile')}</span>
                </button>
                {flyout &&
                  actionPrimaryMenuRef.current &&
                  typeof document !== 'undefined' &&
                  createPortal(
                    (() => {
                      // 与 CwdSelector 的最近目录二级菜单保持同一套 cascade 规则：
                      // 默认紧贴一级菜单右缘，空间不足时翻向左侧，二级用 Portal 避免被父级裁切或遮挡。
                      const FLYOUT_W = 240
                      const MARGIN = 8
                      const menuRect = actionPrimaryMenuRef.current.getBoundingClientRect()
                      let left = menuRect.right
                      if (left + FLYOUT_W + MARGIN > window.innerWidth) {
                        left = menuRect.left - FLYOUT_W
                      }
                      left = Math.max(MARGIN, Math.min(left, window.innerWidth - FLYOUT_W - MARGIN))
                      const bottom = window.innerHeight - menuRect.bottom
                      const maxHeight = Math.max(200, menuRect.bottom - MARGIN)
                      return (
                        <div
                          ref={actionFlyoutRef}
                          className="ui-popover ui-contained-scroll composer-action-flyout"
                          style={{
                            position: 'fixed',
                            bottom,
                            left,
                            width: FLYOUT_W,
                            maxHeight,
                            overflowY: 'auto',
                            zIndex: 1000
                          }}
                        >
                          {flyout === 'expert' && (
                            <div className="ui-popover-empty composer-action-empty">
                              <div className="ui-popover-empty-title">
                                {t('chat.expertKitsEmptyTitle')}
                              </div>
                              <div className="ui-popover-empty-desc">
                                {t('chat.expertKitsEmptyDesc')}
                              </div>
                            </div>
                          )}
                          {flyout === 'connectors' && (
                            <div className="ui-popover-empty composer-action-empty">
                              <div className="ui-popover-empty-title">
                                {t('chat.connectorsEmptyTitle')}
                              </div>
                              <div className="ui-popover-empty-desc">
                                {t('chat.connectorsEmptyDesc')}
                              </div>
                            </div>
                          )}
                          {flyout === 'skills' && (
                            <>
                              <div className="ui-contained-scroll composer-action-list">
                                {skillsLoading ? (
                                  <div className="px-3 py-3 text-center text-[12px] text-text-tertiary">
                                    {t('common.loading')}
                                  </div>
                                ) : skills.length === 0 ? (
                                  <div className="px-3 py-6 text-center text-[12px] text-text-tertiary">
                                    {t('chat.selectSkillsEmpty')}
                                  </div>
                                ) : (
                                  <>
                                    {groupedSkills.custom.length > 0 && (
                                      <>
                                        <div className="ui-popover-title">
                                          {t('skills.groupCustom')}
                                        </div>
                                        {groupedSkills.custom.map((skill) => {
                                          const selected = selectedSkills.includes(skill.id)
                                          return (
                                            <button
                                              key={skill.id}
                                              type="button"
                                              onClick={() => toggleSkill(skill.id)}
                                              className={`ui-popover-row ui-popover-row-2l ${selected ? 'ui-popover-row-active' : ''}`}
                                            >
                                              <Wrench
                                                size={15}
                                                strokeWidth={1.75}
                                                className="shrink-0 text-text-secondary"
                                              />
                                              <span className="min-w-0 flex-1">
                                                <span className="block truncate text-[13px] font-semibold text-text-primary">
                                                  {skill.name}
                                                </span>
                                                {skill.description && (
                                                  <span className="mt-0.5 block truncate text-[11px] font-normal text-text-tertiary">
                                                    {skill.description}
                                                  </span>
                                                )}
                                              </span>
                                              {selected && (
                                                <Check
                                                  size={14}
                                                  strokeWidth={2.2}
                                                  className="shrink-0 text-accent"
                                                />
                                              )}
                                            </button>
                                          )
                                        })}
                                      </>
                                    )}
                                    {groupedSkills.builtIn.length > 0 && (
                                      <>
                                        {groupedSkills.custom.length > 0 && (
                                          <div className="ui-popover-divider" />
                                        )}
                                        <div className="ui-popover-title">
                                          {t('skills.groupBuiltIn')}
                                        </div>
                                        {groupedSkills.builtIn.map((skill) => {
                                          const selected = selectedSkills.includes(skill.id)
                                          return (
                                            <button
                                              key={skill.id}
                                              type="button"
                                              onClick={() => toggleSkill(skill.id)}
                                              className={`ui-popover-row ui-popover-row-2l ${selected ? 'ui-popover-row-active' : ''}`}
                                            >
                                              <Wrench
                                                size={15}
                                                strokeWidth={1.75}
                                                className="shrink-0 text-text-secondary"
                                              />
                                              <span className="min-w-0 flex-1">
                                                <span className="block truncate text-[13px] font-semibold text-text-primary">
                                                  {skill.name}
                                                </span>
                                                {skill.description && (
                                                  <span className="mt-0.5 block truncate text-[11px] font-normal text-text-tertiary">
                                                    {skill.description}
                                                  </span>
                                                )}
                                              </span>
                                              {selected && (
                                                <Check
                                                  size={14}
                                                  strokeWidth={2.2}
                                                  className="shrink-0 text-accent"
                                                />
                                              )}
                                            </button>
                                          )
                                        })}
                                      </>
                                    )}
                                  </>
                                )}
                              </div>
                              <div className="ui-popover-divider" />
                              <button
                                type="button"
                                className="ui-popover-row"
                                onClick={navigateToSkills}
                              >
                                <Settings
                                  size={15}
                                  strokeWidth={1.75}
                                  className="shrink-0 text-text-secondary"
                                />
                                <span className="flex-1 truncate">{t('chat.manageSkills')}</span>
                              </button>
                            </>
                          )}
                        </div>
                      )
                    })(),
                    document.body
                  )}
              </div>
            )}
          </div>

          <div className="flex-1" />

          {/* 上下文用量指示器：仅在使用率 ≥ 60% 时自动出现，平时零存在感 */}
          <ContextUsageIndicator used={estimatedUsedTokens} total={contextTotal} />

          <ModelSelector value={selectedModel} onChange={setSelectedModel} />

          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="ui-primary-icon-button h-8 w-8 min-w-0 shrink-0 ui-focus"
            aria-label={t('chat.sendLabel')}
          >
            <Send size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}
