import { useEffect, useMemo, useRef, useState } from 'react'

import { Brain, Check, ChevronDown, Server, Zap } from 'lucide-react'

import { useI18n } from '../i18n'
import type { SelectedModel } from '../../../shared/models/types'

// re-export 给依赖方（ChatInputBox、ChatView）继续通过此文件获取
export type { SelectedModel }

interface ModelItem {
  id: string
  name: string
  reasoning: boolean
}

interface ProviderItem {
  id: string
  name: string
  enabled: boolean
  hasApiKey: boolean
  models: ModelItem[]
}

interface ModelOption {
  providerId: string
  providerName: string
  model: ModelItem
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSelectedModel(raw: unknown): SelectedModel | null {
  if (!isRecord(raw)) return null
  if (typeof raw.providerId !== 'string' || typeof raw.modelId !== 'string') return null
  if (!raw.providerId || !raw.modelId) return null
  return { providerId: raw.providerId, modelId: raw.modelId }
}

function extractProviders(raw: unknown): ProviderItem[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): ProviderItem[] => {
    if (!isRecord(item)) return []
    const id = String(item.id ?? '')
    const name = String(item.name ?? id)
    if (!id || !Array.isArray(item.models)) return []
    const models = item.models.flatMap((model): ModelItem[] => {
      if (!isRecord(model)) return []
      const modelId = String(model.id ?? '')
      if (!modelId) return []
      return [
        {
          id: modelId,
          name: String(model.name ?? modelId),
          reasoning: model.reasoning === true
        }
      ]
    })
    if (models.length === 0) return []
    return [
      {
        id,
        name,
        enabled: item.enabled === true,
        hasApiKey: item.hasApiKey === true,
        models
      }
    ]
  })
}

function sameSelectedModel(left: SelectedModel | null, right: SelectedModel | null): boolean {
  return left?.providerId === right?.providerId && left?.modelId === right?.modelId
}

interface ModelSelectorProps {
  value: SelectedModel | null
  onChange: (selected: SelectedModel | null) => void
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [providers, setProviders] = useState<ProviderItem[]>([])
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([window.api.models.providers(), window.api.models.defaultModel()])
      .then(([rawProviders, rawDefault]) => {
        if (cancelled) return
        const nextProviders = extractProviders(rawProviders)
        const defaultModel = parseSelectedModel(rawDefault)
        setProviders(nextProviders)
        const stillExists =
          value &&
          nextProviders.some(
            (provider) =>
              provider.id === value.providerId &&
              provider.models.some((model) => model.id === value.modelId)
          )
        if (!stillExists && defaultModel && !sameSelectedModel(value, defaultModel)) {
          onChange(defaultModel)
        }
      })
      .catch(() => {
        if (!cancelled) setProviders([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [onChange, value])

  useEffect(() => {
    if (!open) return
    const handle = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const groupedOptions = useMemo(
    () =>
      providers
        .filter((provider) => provider.enabled)
        .map((provider) => ({
          provider,
          options: provider.models.map((model) => ({
            providerId: provider.id,
            providerName: provider.name,
            model
          }))
        }))
        .filter((group) => group.options.length > 0),
    [providers]
  )

  const currentOption = groupedOptions
    .flatMap((group) => group.options)
    .find((option) => option.providerId === value?.providerId && option.model.id === value?.modelId)

  const displayName = currentOption
    ? `${currentOption.providerName} / ${currentOption.model.name}`
    : t('modelSelector.default')

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        className="ui-icon-button max-w-[170px] gap-1.5 px-2.5 text-[12px] font-semibold text-text-secondary ui-focus"
        title={displayName}
        aria-label={displayName}
        aria-expanded={open}
      >
        {currentOption?.model.reasoning ? (
          <Brain size={13} strokeWidth={1.75} className="shrink-0 text-brand" />
        ) : (
          <Zap size={13} strokeWidth={1.75} className="shrink-0 text-text-secondary" />
        )}
        <span className="truncate">{loading ? t('common.loading') : displayName}</span>
        <ChevronDown size={11} strokeWidth={2} className="shrink-0 text-text-tertiary" />
      </button>

      {open && (
        <div className="ui-popover absolute bottom-full right-0 mb-2 w-56" style={{ padding: 0 }}>
          {loading ? (
            // 空态/加载态统一走 .ui-popover-empty token，和 CwdSelector、ChatInputBox 空态视觉一致
            <div className="ui-popover-empty">
              <div className="ui-popover-empty-title">{t('common.loading')}</div>
            </div>
          ) : groupedOptions.length === 0 ? (
            <div className="ui-popover-empty">
              <div className="ui-popover-empty-title">{t('modelSelector.noModels')}</div>
            </div>
          ) : (
            <div className="ui-contained-scroll max-h-56 overflow-y-auto p-1.5">
              {groupedOptions.map((group, index) => (
                <div key={group.provider.id}>
                  {index > 0 && <div className="ui-popover-divider" />}
                  <div className="ui-popover-title">
                    <Server size={10} strokeWidth={2} className="shrink-0" />
                    <span className="truncate">{group.provider.name}</span>
                  </div>
                  {group.options.map((option) => (
                    <ModelOption
                      key={`${option.providerId}/${option.model.id}`}
                      option={option}
                      selected={
                        option.providerId === value?.providerId && option.model.id === value.modelId
                      }
                      onSelect={() => {
                        onChange({ providerId: option.providerId, modelId: option.model.id })
                        setOpen(false)
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface ModelOptionProps {
  option: ModelOption
  selected: boolean
  onSelect: () => void
}

function ModelOption({ option, selected, onSelect }: ModelOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`ui-popover-row ${selected ? 'ui-popover-row-active' : ''}`}
    >
      {option.model.reasoning ? (
        <Brain size={13} strokeWidth={1.75} className="shrink-0 text-brand" />
      ) : (
        <Zap size={13} strokeWidth={1.75} className="shrink-0 text-text-secondary" />
      )}
      <span className="flex-1 truncate">{option.model.name}</span>
      {selected && <Check size={13} strokeWidth={2.5} className="shrink-0 text-brand" />}
    </button>
  )
}
