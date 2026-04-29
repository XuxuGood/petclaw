import { useState, useEffect } from 'react'

import {
  Eye,
  EyeOff,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  Circle,
  X,
  Star
} from 'lucide-react'

import { useI18n } from '../../i18n'
import type {
  ModelApiFormat,
  ModelDefinition,
  ModelProviderConfig,
  SelectedModel
} from '../../../../shared/models/types'
import {
  getProviderAbbreviation,
  getProviderColor
} from '../../../../shared/models/provider-display'

// ── 类型定义 ────────────────────────────────────────────────────────────────

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'

// ── 预设 Provider 图标（文字 Logo）───────────────────────────────────────────

function ProviderLogo({ provider }: { provider: ModelProviderConfig }) {
  const abbr = getProviderAbbreviation(provider.id, provider.name)
  const color = getProviderColor(provider.id)
  return (
    <div className={`w-8 h-8 rounded-[8px] ${color} flex items-center justify-center shrink-0`}>
      <span className="text-[10px] font-bold text-white leading-none">{abbr}</span>
    </div>
  )
}

function buildProviderId(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || `custom-${Date.now()}`
}

function parseSelectedModel(raw: unknown): SelectedModel | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.providerId !== 'string' || typeof record.modelId !== 'string') return null
  return { providerId: record.providerId, modelId: record.modelId }
}

// ── 添加模型弹窗 ─────────────────────────────────────────────────────────────

interface AddModelDialogProps {
  onConfirm: (model: Omit<ModelDefinition, 'id'> & { id: string }) => void
  onCancel: () => void
}

function AddModelDialog({ onConfirm, onCancel }: AddModelDialogProps) {
  const { t } = useI18n()
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [contextWindow, setContextWindow] = useState('128000')
  const [maxTokens, setMaxTokens] = useState('8192')
  const [reasoning, setReasoning] = useState(false)
  const [supportsImage, setSupportsImage] = useState(false)

  const handleSubmit = () => {
    if (!id.trim() || !name.trim()) return
    onConfirm({
      id: id.trim(),
      name: name.trim(),
      contextWindow: parseInt(contextWindow) || 128000,
      maxTokens: parseInt(maxTokens) || 8192,
      reasoning,
      supportsImage
    })
  }

  return (
    // 遮罩层
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
      <div className="w-[420px] rounded-[14px] bg-bg-card border border-border shadow-2xl">
        {/* 标题 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <span className="text-[14px] font-semibold text-text-primary">
            {t('modelSettings.addModel')}
          </span>
          <button
            onClick={onCancel}
            className="text-text-tertiary hover:text-text-primary transition-colors duration-[120ms]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* 模型 ID */}
          <div>
            <label className="block text-[12px] text-text-tertiary mb-1.5 font-medium">
              {t('modelSettings.modelId')} <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="例如：gpt-4o"
              className="w-full px-3 py-2 rounded-[10px] bg-bg-input border border-border-input text-[13px] text-text-primary outline-none focus:border-accent transition-all duration-[120ms]"
            />
          </div>

          {/* 显示名称 */}
          <div>
            <label className="block text-[12px] text-text-tertiary mb-1.5 font-medium">
              {t('modelSettings.displayName')} <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：GPT-4o"
              className="w-full px-3 py-2 rounded-[10px] bg-bg-input border border-border-input text-[13px] text-text-primary outline-none focus:border-accent transition-all duration-[120ms]"
            />
          </div>

          {/* 上下文 + 最大 Token */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[12px] text-text-tertiary mb-1.5 font-medium">
                {t('modelSettings.contextWindow')}
              </label>
              <input
                type="number"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                className="w-full px-3 py-2 rounded-[10px] bg-bg-input border border-border-input text-[13px] text-text-primary outline-none focus:border-accent transition-all duration-[120ms]"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[12px] text-text-tertiary mb-1.5 font-medium">
                {t('modelSettings.maxOutputTokens')}
              </label>
              <input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                className="w-full px-3 py-2 rounded-[10px] bg-bg-input border border-border-input text-[13px] text-text-primary outline-none focus:border-accent transition-all duration-[120ms]"
              />
            </div>
          </div>

          {/* 能力开关 */}
          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={reasoning}
                onChange={(e) => setReasoning(e.target.checked)}
                className="accent-accent w-3.5 h-3.5"
              />
              <span className="text-[13px] text-text-secondary">
                {t('modelSettings.reasoningModel')}
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={supportsImage}
                onChange={(e) => setSupportsImage(e.target.checked)}
                className="accent-accent w-3.5 h-3.5"
              />
              <span className="text-[13px] text-text-secondary">
                {t('modelSettings.imageSupport')}
              </span>
            </label>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded-[10px] text-[13px] text-text-secondary hover:bg-bg-hover transition-all duration-[120ms] active:scale-[0.96]"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!id.trim() || !name.trim()}
            className="px-4 py-1.5 rounded-[10px] text-[13px] bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-[120ms] active:scale-[0.96]"
          >
            {t('common.add')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 添加自定义 Provider 弹窗 ─────────────────────────────────────────────────

interface AddProviderDialogProps {
  onConfirm: (data: {
    name: string
    baseUrl: string
    apiFormat: 'openai-completions' | 'anthropic'
  }) => void
  onCancel: () => void
}

function AddProviderDialog({ onConfirm, onCancel }: AddProviderDialogProps) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiFormat, setApiFormat] = useState<'openai-completions' | 'anthropic'>(
    'openai-completions'
  )

  const handleSubmit = () => {
    if (!name.trim() || !baseUrl.trim()) return
    onConfirm({ name: name.trim(), baseUrl: baseUrl.trim(), apiFormat })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
      <div className="w-[420px] rounded-[14px] bg-bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <span className="text-[14px] font-semibold text-text-primary">
            {t('modelSettings.addProvider')}
          </span>
          <button
            onClick={onCancel}
            className="text-text-tertiary hover:text-text-primary transition-colors duration-[120ms]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-[12px] text-text-tertiary mb-1.5 font-medium">
              {t('modelSettings.displayName')} <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：My OpenAI Proxy"
              className="w-full px-3 py-2 rounded-[10px] bg-bg-input border border-border-input text-[13px] text-text-primary outline-none focus:border-accent transition-all duration-[120ms]"
            />
          </div>

          <div>
            <label className="block text-[12px] text-text-tertiary mb-1.5 font-medium">
              Base URL <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full px-3 py-2 rounded-[10px] bg-bg-input border border-border-input text-[13px] text-text-primary outline-none focus:border-accent transition-all duration-[120ms]"
            />
          </div>

          <div>
            <label className="block text-[12px] text-text-tertiary mb-1.5 font-medium">
              {t('modelSettings.apiFormat')}
            </label>
            <div className="flex gap-3">
              {(['openai-completions', 'anthropic'] as const).map((fmt) => (
                <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="apiFormat"
                    value={fmt}
                    checked={apiFormat === fmt}
                    onChange={() => setApiFormat(fmt)}
                    className="accent-accent"
                  />
                  <span className="text-[13px] text-text-secondary">
                    {fmt === 'openai-completions' ? t('modelSettings.openaiCompat') : 'Anthropic'}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded-[10px] text-[13px] text-text-secondary hover:bg-bg-hover transition-all duration-[120ms] active:scale-[0.96]"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !baseUrl.trim()}
            className="px-4 py-1.5 rounded-[10px] text-[13px] bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-[120ms] active:scale-[0.96]"
          >
            {t('common.add')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 右侧配置面板 ─────────────────────────────────────────────────────────────

interface ProviderPanelProps {
  provider: ModelProviderConfig
  onUpdate: (patch: Partial<ModelProviderConfig>) => Promise<void>
  onSetApiKey: (apiKey: string) => Promise<void>
  onClearApiKey: () => Promise<void>
  onSetDefaultModel: (modelId: string) => Promise<void>
  onTest: () => Promise<void>
  onAddModel: (model: ModelDefinition) => Promise<void>
  onRemoveModel: (modelId: string) => Promise<void>
  defaultModel: SelectedModel | null
  testStatus: TestStatus
  testError: string
}

function ProviderPanel({
  provider,
  onUpdate,
  onSetApiKey,
  onClearApiKey,
  onSetDefaultModel,
  onTest,
  onAddModel,
  onRemoveModel,
  defaultModel,
  testStatus,
  testError
}: ProviderPanelProps) {
  const { t } = useI18n()
  // API Key 本地草稿，失焦时保存
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [apiKeyDirty, setApiKeyDirty] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  // Base URL 草稿
  const [baseUrlDraft, setBaseUrlDraft] = useState(provider.baseUrl)
  // 模型弹窗
  const [showAddModel, setShowAddModel] = useState(false)

  // 切换 Provider 时同步草稿
  useEffect(() => {
    setApiKeyDraft('')
    setApiKeyDirty(false)
    setBaseUrlDraft(provider.baseUrl)
    setShowApiKey(false)
  }, [provider.id, provider.baseUrl])

  const handleApiKeyBlur = () => {
    if (!apiKeyDirty) return
    const nextApiKey = apiKeyDraft.trim()
    if (nextApiKey) {
      void onSetApiKey(nextApiKey)
      setApiKeyDraft('')
      setApiKeyDirty(false)
    }
  }

  const handleBaseUrlBlur = () => {
    if (baseUrlDraft !== provider.baseUrl) {
      onUpdate({ baseUrl: baseUrlDraft })
    }
  }

  const handleApiFormatChange = (fmt: ModelApiFormat) => {
    onUpdate({ apiFormat: fmt })
  }

  const handleAddModel = async (m: ModelDefinition) => {
    await onAddModel(m)
    setShowAddModel(false)
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-4">
      {/* Provider 名称 + 启用开关行 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ProviderLogo provider={provider} />
          <div>
            <h2 className="text-[16px] font-semibold text-text-primary">{provider.name}</h2>
            <p className="text-[12px] text-text-tertiary">
              {!provider.isCustom
                ? t('modelSettings.presetProvider')
                : t('modelSettings.customProvider')}
            </p>
          </div>
        </div>
      </div>

      {/* 配置卡片 */}
      <div className="rounded-[14px] bg-bg-card border border-border overflow-hidden">
        {/* API Key */}
        <div className="px-5 py-4 border-b border-border">
          <label className="block text-[12px] text-text-tertiary mb-2 font-medium">API Key</label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyDraft}
                onChange={(e) => {
                  setApiKeyDraft(e.target.value)
                  setApiKeyDirty(true)
                }}
                onBlur={handleApiKeyBlur}
                placeholder={
                  provider.hasApiKey
                    ? t('modelSettings.apiKeyConfigured')
                    : t('modelSettings.apiKeyPlaceholder')
                }
                className="w-full px-3 py-2 pr-9 rounded-[10px] bg-bg-input border border-border-input text-[13px] text-text-primary outline-none focus:border-accent transition-all duration-[120ms] font-mono"
              />
              {/* 显示/隐藏 API Key 切换按钮 */}
              <button
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors duration-[120ms]"
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {provider.hasApiKey && (
              <button
                type="button"
                onClick={() => {
                  void onClearApiKey()
                  setApiKeyDraft('')
                  setApiKeyDirty(false)
                }}
                className="px-3 py-2 rounded-[10px] text-[12px] text-text-secondary hover:bg-bg-hover hover:text-error transition-all duration-[120ms] active:scale-[0.96]"
              >
                {t('modelSettings.clearApiKey')}
              </button>
            )}
          </div>
        </div>

        {/* Base URL */}
        <div className="px-5 py-4 border-b border-border">
          <label className="block text-[12px] text-text-tertiary mb-2 font-medium">Base URL</label>
          <input
            type="text"
            value={baseUrlDraft}
            onChange={(e) => setBaseUrlDraft(e.target.value)}
            onBlur={handleBaseUrlBlur}
            className="w-full px-3 py-2 rounded-[10px] bg-bg-input border border-border-input text-[13px] text-text-primary outline-none focus:border-accent transition-all duration-[120ms] font-mono"
          />
        </div>

        {/* API 格式 */}
        <div className="px-5 py-4 border-b border-border">
          <label className="block text-[12px] text-text-tertiary mb-2 font-medium">
            {t('modelSettings.apiFormat')}
          </label>
          <div className="flex gap-4">
            {(['openai-completions', 'anthropic', 'google-generative-ai'] as const).map((fmt) => (
              <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={`apiFormat-${provider.id}`}
                  value={fmt}
                  checked={provider.apiFormat === fmt}
                  onChange={() => handleApiFormatChange(fmt)}
                  className="accent-accent"
                />
                <span className="text-[13px] text-text-secondary">
                  {fmt === 'openai-completions'
                    ? t('modelSettings.openaiCompat')
                    : fmt === 'anthropic'
                      ? 'Anthropic'
                      : t('modelSettings.googleGenerativeAi')}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* 测试连接 */}
        <div className="px-5 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onTest}
              disabled={testStatus === 'testing'}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-[10px] text-[13px] bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-[120ms] active:scale-[0.96]"
            >
              {testStatus === 'testing' ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>{t('modelSettings.testing')}</span>
                </>
              ) : (
                t('modelSettings.testConnection')
              )}
            </button>

            {/* 测试结果 */}
            {testStatus === 'ok' && (
              <div className="flex items-center gap-1.5 text-success">
                <CheckCircle size={14} />
                <span className="text-[13px]">{t('modelSettings.connected')}</span>
              </div>
            )}
            {testStatus === 'fail' && (
              <div className="flex items-center gap-1.5 text-error">
                <XCircle size={14} />
                <span className="text-[13px]">{testError || t('modelSettings.connectFailed')}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 模型列表 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-semibold text-text-primary">
            {t('modelSettings.availableModels')}
          </span>
          <button
            onClick={() => setShowAddModel(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[10px] text-[12px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-all duration-[120ms] active:scale-[0.96]"
          >
            <Plus size={13} />
            <span>{t('modelSettings.addModel')}</span>
          </button>
        </div>

        <div className="rounded-[14px] bg-bg-card border border-border overflow-hidden">
          {provider.models.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <span className="text-[13px] text-text-tertiary">{t('modelSettings.noModels')}</span>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {provider.models.map((model) => (
                <div key={model.id} className="flex items-center justify-between px-5 py-3.5 group">
                  <div>
                    <p className="text-[13px] text-text-primary font-medium">{model.name}</p>
                    <p className="text-[11px] text-text-tertiary font-mono mt-0.5">{model.id}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onSetDefaultModel(model.id)}
                      className={`inline-flex items-center gap-1 rounded-[10px] px-2 py-1 text-[11px] transition-all duration-[120ms] active:scale-[0.96] ${
                        defaultModel?.providerId === provider.id &&
                        defaultModel.modelId === model.id
                          ? 'text-accent bg-bg-input'
                          : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
                      }`}
                    >
                      <Star size={12} strokeWidth={2} />
                      <span>
                        {defaultModel?.providerId === provider.id &&
                        defaultModel.modelId === model.id
                          ? t('modelSettings.defaultModel')
                          : t('modelSettings.setDefaultModel')}
                      </span>
                    </button>
                    {/* 能力标签 */}
                    <div className="flex gap-1.5">
                      {model.reasoning && (
                        <span className="px-1.5 py-0.5 rounded-md bg-violet-500/10 text-[10px] text-violet-400 font-medium">
                          {t('modelSettings.reasoning')}
                        </span>
                      )}
                      {model.supportsImage && (
                        <span className="px-1.5 py-0.5 rounded-md bg-sky-500/10 text-[10px] text-sky-400 font-medium">
                          {t('modelSettings.image')}
                        </span>
                      )}
                    </div>
                    {/* 删除按钮 — 鼠标悬浮显示 */}
                    <button
                      onClick={() => onRemoveModel(model.id)}
                      className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-error transition-all duration-[120ms]"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 添加模型弹窗 */}
      {showAddModel && (
        <AddModelDialog onConfirm={handleAddModel} onCancel={() => setShowAddModel(false)} />
      )}
    </div>
  )
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export function ModelSettings() {
  const { t } = useI18n()
  const [providers, setProviders] = useState<ModelProviderConfig[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [defaultModel, setDefaultModel] = useState<SelectedModel | null>(null)
  const [loading, setLoading] = useState(true)
  // 每个 Provider 独立维护测试状态，key 为 provider id
  const [testStatusMap, setTestStatusMap] = useState<Record<string, TestStatus>>({})
  const [testErrorMap, setTestErrorMap] = useState<Record<string, string>>({})
  // 添加自定义 Provider 弹窗
  const [showAddProvider, setShowAddProvider] = useState(false)

  // 初始加载 Provider 列表
  useEffect(() => {
    const load = async () => {
      try {
        const [raw, rawDefaultModel] = await Promise.all([
          window.api.models.providers(),
          window.api.models.defaultModel()
        ])
        const list = raw as ModelProviderConfig[]
        setProviders(list)
        setDefaultModel(parseSelectedModel(rawDefaultModel))
        // 默认选中第一个
        if (list.length > 0) setSelectedId(list[0].id)
      } catch {
        // 接口暂未实现，使用空列表
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const selectedProvider = providers.find((p) => p.id === selectedId) ?? null

  // 更新 Provider 字段并同步到列表
  const handleUpdate = async (id: string, patch: Partial<ModelProviderConfig>) => {
    try {
      await window.api.models.updateProvider(id, patch)
      setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    } catch {
      // 忽略错误，后续可加 toast
    }
  }

  const handleSetApiKey = async (id: string, apiKey: string) => {
    try {
      await window.api.models.setApiKey(id, apiKey)
      setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, hasApiKey: true } : p)))
    } catch {
      // 忽略错误，后续可加 toast
    }
  }

  const handleClearApiKey = async (id: string) => {
    try {
      await window.api.models.clearApiKey(id)
      setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, hasApiKey: false } : p)))
    } catch {
      // 忽略错误，后续可加 toast
    }
  }

  const handleSetDefaultModel = async (providerId: string, modelId: string) => {
    try {
      const next = { providerId, modelId }
      await window.api.models.setDefaultModel(next)
      setDefaultModel(next)
    } catch {
      // 忽略错误，后续可加 toast
    }
  }

  // 启用/禁用切换
  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await window.api.models.toggleProvider(id, enabled)
      setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)))
    } catch {
      // 忽略错误
    }
  }

  // 测试连接
  const handleTest = async (id: string) => {
    setTestStatusMap((prev) => ({ ...prev, [id]: 'testing' }))
    setTestErrorMap((prev) => ({ ...prev, [id]: '' }))
    try {
      const result = await window.api.models.testConnection(id)
      const r = result as { ok: boolean; error?: string }
      if (r.ok) {
        setTestStatusMap((prev) => ({ ...prev, [id]: 'ok' }))
      } else {
        setTestStatusMap((prev) => ({ ...prev, [id]: 'fail' }))
        setTestErrorMap((prev) => ({ ...prev, [id]: r.error ?? t('modelSettings.connectFailed') }))
      }
    } catch (e) {
      setTestStatusMap((prev) => ({ ...prev, [id]: 'fail' }))
      setTestErrorMap((prev) => ({ ...prev, [id]: String(e) }))
    }
  }

  // 添加模型
  const handleAddModel = async (providerId: string, model: ModelDefinition) => {
    try {
      await window.api.models.addModel(providerId, model)
      setProviders((prev) =>
        prev.map((p) => (p.id === providerId ? { ...p, models: [...p.models, model] } : p))
      )
    } catch {
      // 忽略错误
    }
  }

  // 删除模型
  const handleRemoveModel = async (providerId: string, modelId: string) => {
    try {
      await window.api.models.removeModel(providerId, modelId)
      setProviders((prev) =>
        prev.map((p) =>
          p.id === providerId ? { ...p, models: p.models.filter((m) => m.id !== modelId) } : p
        )
      )
    } catch {
      // 忽略错误
    }
  }

  // 添加自定义 Provider
  const handleAddProvider = async (data: {
    name: string
    baseUrl: string
    apiFormat: 'openai-completions' | 'anthropic'
  }) => {
    try {
      const raw = await window.api.models.addProvider({
        id: buildProviderId(data.name),
        ...data,
        enabled: true,
        isCustom: true,
        models: []
      })
      const newProvider = raw as ModelProviderConfig | undefined
      const provider = newProvider ?? {
        id: buildProviderId(data.name),
        name: data.name,
        baseUrl: data.baseUrl,
        apiFormat: data.apiFormat,
        enabled: true,
        isCustom: true,
        hasApiKey: false,
        models: []
      }
      setProviders((prev) => [...prev, provider])
      setSelectedId(provider.id)
    } catch {
      // 忽略错误
    } finally {
      setShowAddProvider(false)
    }
  }

  return (
    <div>
      <h1 className="text-[20px] font-bold text-text-primary mb-1">{t('modelSettings.title')}</h1>
      <p className="text-[13px] text-text-tertiary mb-6">{t('modelSettings.subtitle')}</p>

      {loading ? (
        // 加载中骨架
        <div className="flex items-center justify-center py-20">
          <Loader2 size={20} className="animate-spin text-text-tertiary" />
        </div>
      ) : (
        // 两栏布局
        <div className="flex gap-4 items-start">
          {/* ── 左列：Provider 列表 ─────────────────────────────────── */}
          <div className="w-[200px] shrink-0 flex flex-col gap-2">
            {/* Provider 卡片列表 */}
            <div className="rounded-[14px] bg-bg-card border border-border overflow-hidden">
              {providers.length === 0 ? (
                <div className="flex items-center justify-center py-10">
                  <span className="text-[12px] text-text-tertiary">
                    {t('modelSettings.noProvider')}
                  </span>
                </div>
              ) : (
                <div>
                  {/* 预设 Provider */}
                  {providers.filter((p) => !p.isCustom).length > 0 && (
                    <div>
                      <div className="px-3 py-2 border-b border-border">
                        <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
                          {t('modelSettings.presetProvider')}
                        </span>
                      </div>
                      <div className="divide-y divide-border">
                        {providers
                          .filter((p) => !p.isCustom)
                          .map((provider) => {
                            const isSelected = provider.id === selectedId
                            const tStatus = testStatusMap[provider.id] ?? 'idle'
                            const isEnabled = provider.enabled !== false

                            return (
                              <button
                                key={provider.id}
                                onClick={() => setSelectedId(provider.id)}
                                className={`w-full flex items-center gap-2.5 px-3 py-3 text-left transition-all duration-[120ms] active:scale-[0.98] ${
                                  isSelected ? 'bg-bg-active' : 'hover:bg-bg-hover'
                                }`}
                              >
                                <ProviderLogo provider={provider} />
                                <div className="flex-1 min-w-0">
                                  <p
                                    className={`text-[12px] font-medium truncate ${
                                      isSelected ? 'text-text-primary' : 'text-text-secondary'
                                    }`}
                                  >
                                    {provider.name}
                                  </p>
                                  {/* 连接状态点 */}
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <Circle
                                      size={6}
                                      className={
                                        !isEnabled
                                          ? 'text-text-tertiary fill-text-tertiary'
                                          : tStatus === 'ok'
                                            ? 'text-success fill-success'
                                            : tStatus === 'fail'
                                              ? 'text-error fill-error'
                                              : 'text-text-tertiary fill-text-tertiary'
                                      }
                                    />
                                    <span className="text-[10px] text-text-tertiary">
                                      {!isEnabled
                                        ? t('modelSettings.disabled')
                                        : tStatus === 'ok'
                                          ? t('modelSettings.connectedStatus')
                                          : tStatus === 'fail'
                                            ? t('modelSettings.failed')
                                            : t('modelSettings.notTested')}
                                    </span>
                                  </div>
                                </div>

                                {/* 启用/禁用开关（点击不触发选中）*/}
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleToggle(provider.id, !isEnabled)
                                  }}
                                  className={`w-8 h-[18px] rounded-full transition-colors duration-[120ms] cursor-pointer shrink-0 ${
                                    isEnabled ? 'bg-accent' : 'bg-border'
                                  }`}
                                >
                                  <div
                                    className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-[120ms] mt-[2px] ${
                                      isEnabled ? 'translate-x-[15px]' : 'translate-x-[3px]'
                                    }`}
                                  />
                                </div>

                                {isSelected && (
                                  <ChevronRight size={12} className="text-text-tertiary shrink-0" />
                                )}
                              </button>
                            )
                          })}
                      </div>
                    </div>
                  )}

                  {/* 自定义 Provider */}
                  {providers.filter((p) => p.isCustom).length > 0 && (
                    <div>
                      <div className="px-3 py-2 border-b border-border">
                        <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
                          {t('modelSettings.customProvider')}
                        </span>
                      </div>
                      <div className="divide-y divide-border">
                        {providers
                          .filter((p) => p.isCustom)
                          .map((provider) => {
                            const isSelected = provider.id === selectedId
                            const tStatus = testStatusMap[provider.id] ?? 'idle'
                            const isEnabled = provider.enabled !== false

                            return (
                              <button
                                key={provider.id}
                                onClick={() => setSelectedId(provider.id)}
                                className={`w-full flex items-center gap-2.5 px-3 py-3 text-left transition-all duration-[120ms] active:scale-[0.98] ${
                                  isSelected ? 'bg-bg-active' : 'hover:bg-bg-hover'
                                }`}
                              >
                                <ProviderLogo provider={provider} />
                                <div className="flex-1 min-w-0">
                                  <p
                                    className={`text-[12px] font-medium truncate ${
                                      isSelected ? 'text-text-primary' : 'text-text-secondary'
                                    }`}
                                  >
                                    {provider.name}
                                  </p>
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <Circle
                                      size={6}
                                      className={
                                        !isEnabled
                                          ? 'text-text-tertiary fill-text-tertiary'
                                          : tStatus === 'ok'
                                            ? 'text-success fill-success'
                                            : tStatus === 'fail'
                                              ? 'text-error fill-error'
                                              : 'text-text-tertiary fill-text-tertiary'
                                      }
                                    />
                                    <span className="text-[10px] text-text-tertiary">
                                      {!isEnabled
                                        ? t('modelSettings.disabled')
                                        : tStatus === 'ok'
                                          ? t('modelSettings.connectedStatus')
                                          : tStatus === 'fail'
                                            ? t('modelSettings.failed')
                                            : t('modelSettings.notTested')}
                                    </span>
                                  </div>
                                </div>

                                <div
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleToggle(provider.id, !isEnabled)
                                  }}
                                  className={`w-8 h-[18px] rounded-full transition-colors duration-[120ms] cursor-pointer shrink-0 ${
                                    isEnabled ? 'bg-accent' : 'bg-border'
                                  }`}
                                >
                                  <div
                                    className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-[120ms] mt-[2px] ${
                                      isEnabled ? 'translate-x-[15px]' : 'translate-x-[3px]'
                                    }`}
                                  />
                                </div>

                                {isSelected && (
                                  <ChevronRight size={12} className="text-text-tertiary shrink-0" />
                                )}
                              </button>
                            )
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 添加自定义 Provider 按钮 */}
            <button
              onClick={() => setShowAddProvider(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-[10px] border border-dashed border-border text-[12px] text-text-tertiary hover:border-accent hover:text-accent transition-all duration-[120ms] active:scale-[0.96]"
            >
              <Plus size={13} />
              <span>{t('modelSettings.addCustom')}</span>
            </button>
          </div>

          {/* ── 右列：配置面板 ───────────────────────────────────────── */}
          {selectedProvider ? (
            <ProviderPanel
              key={selectedProvider.id}
              provider={selectedProvider}
              onUpdate={(patch) => handleUpdate(selectedProvider.id, patch)}
              onSetApiKey={(apiKey) => handleSetApiKey(selectedProvider.id, apiKey)}
              onClearApiKey={() => handleClearApiKey(selectedProvider.id)}
              onSetDefaultModel={(modelId) => handleSetDefaultModel(selectedProvider.id, modelId)}
              onTest={() => handleTest(selectedProvider.id)}
              onAddModel={(m) => handleAddModel(selectedProvider.id, m)}
              onRemoveModel={(mid) => handleRemoveModel(selectedProvider.id, mid)}
              defaultModel={defaultModel}
              testStatus={testStatusMap[selectedProvider.id] ?? 'idle'}
              testError={testErrorMap[selectedProvider.id] ?? ''}
            />
          ) : (
            // 未选中时占位
            <div className="flex-1 rounded-[14px] bg-bg-card border border-border flex items-center justify-center py-20">
              <span className="text-[13px] text-text-tertiary">
                {t('modelSettings.selectProvider')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 添加自定义 Provider 弹窗 */}
      {showAddProvider && (
        <AddProviderDialog
          onConfirm={handleAddProvider}
          onCancel={() => setShowAddProvider(false)}
        />
      )}
    </div>
  )
}
