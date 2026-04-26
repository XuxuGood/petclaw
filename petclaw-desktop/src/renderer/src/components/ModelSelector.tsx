import { useEffect, useRef, useState } from 'react'

import { Zap, Brain, ChevronDown, Check } from 'lucide-react'

import { useI18n } from '../i18n'

// 模型数据形状（来自 window.api.models.active() 和 providers()）
interface ModelItem {
  id: string
  name: string
  /** 简单将 claude/gpt 等区分为 standard / reasoning */
  tier: 'standard' | 'reasoning' | 'other'
}

// 从 API 返回的 unknown 数据中提取模型列表
function extractModels(raw: unknown): ModelItem[] {
  if (!Array.isArray(raw)) return []
  const result: ModelItem[] = []
  for (const p of raw) {
    if (p === null || typeof p !== 'object') continue
    const provider = p as Record<string, unknown>
    if (!Array.isArray(provider.models)) continue
    for (const m of provider.models) {
      if (m === null || typeof m !== 'object') continue
      const model = m as Record<string, unknown>
      const id = String(model.id ?? '')
      const name = String(model.name ?? model.id ?? '')
      // 简单判断推理模型：名字含 o3/o1/reasoning/think 等关键词
      const isReasoning = /o3|o1|reasoning|think/i.test(name) || /o3|o1|reasoning|think/i.test(id)
      result.push({ id, name, tier: isReasoning ? 'reasoning' : 'standard' })
    }
  }
  return result
}

interface ModelSelectorProps {
  /** 当前选中的模型 id（空串表示使用默认） */
  value: string
  onChange: (modelId: string) => void
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelItem[]>([])
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // 打开时加载模型列表
  useEffect(() => {
    if (!open) return
    setLoading(true)
    window.api.models
      .providers()
      .then((raw) => {
        setModels(extractModels(raw))
      })
      .catch(() => setModels([]))
      .finally(() => setLoading(false))
  }, [open])

  // 当前模型展示名
  const currentModel = models.find((m) => m.id === value)
  const displayName = currentModel?.name ?? (value || t('modelSelector.default'))
  const isReasoning = currentModel?.tier === 'reasoning'

  return (
    <div ref={containerRef} className="relative">
      {/* 触发按钮：显示当前模型 + 类型图标 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-[10px] text-[12px] text-text-secondary hover:bg-bg-card hover:text-text-primary transition-all duration-[120ms] max-w-[140px]"
        title={displayName}
      >
        {/* ⚡标准 / 🧠推理 图标 */}
        {isReasoning ? (
          <Brain size={13} strokeWidth={1.75} className="text-accent shrink-0" />
        ) : (
          <Zap size={13} strokeWidth={1.75} className="text-text-secondary shrink-0" />
        )}
        <span className="truncate">{displayName}</span>
        <ChevronDown size={11} strokeWidth={2} className="text-text-tertiary shrink-0" />
      </button>

      {/* 模型下拉列表（向上弹出） */}
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-56 rounded-[14px] bg-bg-card border border-border shadow-[var(--shadow-dropdown)] z-50 overflow-hidden">
          {loading ? (
            <div className="px-3 py-3 text-[12px] text-text-tertiary text-center">
              {t('common.loading')}
            </div>
          ) : models.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-text-tertiary text-center">
              {t('modelSelector.noModels')}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto py-1">
              {/* 标准模型组 */}
              {models.filter((m) => m.tier !== 'reasoning').length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider flex items-center gap-1">
                    <Zap size={10} strokeWidth={2} />
                    <span>{t('modelSettings.standard')}</span>
                  </div>
                  {models
                    .filter((m) => m.tier !== 'reasoning')
                    .map((m) => (
                      <ModelOption
                        key={m.id}
                        model={m}
                        selected={value === m.id}
                        onSelect={() => {
                          onChange(m.id)
                          setOpen(false)
                        }}
                      />
                    ))}
                </>
              )}
              {/* 推理模型组 */}
              {models.filter((m) => m.tier === 'reasoning').length > 0 && (
                <>
                  <div className="px-3 pt-3 pb-1 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider flex items-center gap-1 border-t border-border mt-1">
                    <Brain size={10} strokeWidth={2} />
                    <span>{t('modelSettings.reasoning')}</span>
                  </div>
                  {models
                    .filter((m) => m.tier === 'reasoning')
                    .map((m) => (
                      <ModelOption
                        key={m.id}
                        model={m}
                        selected={value === m.id}
                        onSelect={() => {
                          onChange(m.id)
                          setOpen(false)
                        }}
                      />
                    ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface ModelOptionProps {
  model: ModelItem
  selected: boolean
  onSelect: () => void
}

function ModelOption({ model, selected, onSelect }: ModelOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left hover:bg-bg-input transition-colors duration-[120ms] ${selected ? 'text-accent' : 'text-text-primary'}`}
    >
      {model.tier === 'reasoning' ? (
        <Brain size={13} strokeWidth={1.75} className="text-accent shrink-0" />
      ) : (
        <Zap size={13} strokeWidth={1.75} className="text-text-secondary shrink-0" />
      )}
      <span className="flex-1 truncate">{model.name}</span>
      {selected && <Check size={13} strokeWidth={2.5} className="text-accent shrink-0" />}
    </button>
  )
}
