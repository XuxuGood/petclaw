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
        className="flex max-w-[170px] items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-[12px] text-text-secondary transition-all duration-[120ms] hover:bg-bg-card hover:text-text-primary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        title={displayName}
        aria-label={displayName}
        aria-expanded={open}
      >
        {currentOption?.model.reasoning ? (
          <Brain size={13} strokeWidth={1.75} className="shrink-0 text-accent" />
        ) : (
          <Zap size={13} strokeWidth={1.75} className="shrink-0 text-text-secondary" />
        )}
        <span className="truncate">{loading ? t('common.loading') : displayName}</span>
        <ChevronDown size={11} strokeWidth={2} className="shrink-0 text-text-tertiary" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-[14px] border border-border bg-bg-card shadow-[var(--shadow-dropdown)]">
          {loading ? (
            <div className="px-3 py-3 text-center text-[12px] text-text-tertiary">
              {t('common.loading')}
            </div>
          ) : groupedOptions.length === 0 ? (
            <div className="px-3 py-3 text-center text-[12px] text-text-tertiary">
              {t('modelSelector.noModels')}
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto py-1">
              {groupedOptions.map((group, index) => (
                <div
                  key={group.provider.id}
                  className={index === 0 ? '' : 'mt-1 border-t border-border pt-1'}
                >
                  <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase text-text-tertiary">
                    <Server size={10} strokeWidth={2} />
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
      className={`flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors duration-[120ms] hover:bg-bg-input active:scale-[0.96] ${
        selected ? 'text-accent' : 'text-text-primary'
      }`}
    >
      {option.model.reasoning ? (
        <Brain size={13} strokeWidth={1.75} className="shrink-0 text-accent" />
      ) : (
        <Zap size={13} strokeWidth={1.75} className="shrink-0 text-text-secondary" />
      )}
      <span className="flex-1 truncate">{option.model.name}</span>
      {selected && <Check size={13} strokeWidth={2.5} className="shrink-0 text-accent" />}
    </button>
  )
}
