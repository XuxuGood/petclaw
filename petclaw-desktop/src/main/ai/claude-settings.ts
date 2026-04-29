// claude-settings.ts：API 配置管理
// 负责从应用配置解析当前使用的 provider，构造 CoworkApiConfig 供 OpenClaw 引擎使用。

// ── 内联类型定义（shared/providers 依赖） ──────────────────────────

type ApiFormat = 'anthropic' | 'openai'

interface ProviderModelDef {
  id: string
  name?: string
  supportsImage?: boolean
}

interface ProviderConfig {
  enabled?: boolean
  apiKey?: string
  baseUrl?: string
  apiFormat?: ApiFormat | 'native'
  authType?: string
  codingPlanEnabled?: boolean
  models?: ProviderModelDef[]
}

// PetClaw 支持的 Provider 枚举，对应 app_config.providers 的 key
const ProviderName = {
  Anthropic: 'anthropic',
  OpenAI: 'openai',
  Gemini: 'gemini',
  Ollama: 'ollama',
  LmStudio: 'lm-studio',
  PetclawServer: 'petclaw-server'
} as const

// PetClaw 不需要 CodingPlan 路由，直接透传 baseUrl 和 apiFormat
function resolveCodingPlanBaseUrl(
  _providerName: string,
  _enabled: boolean,
  apiFormat: string,
  baseUrl: string
): { baseUrl: string; effectiveFormat: AnthropicApiFormat } {
  return { baseUrl, effectiveFormat: normalizeProviderApiFormat(apiFormat) }
}

// ── 内联 coworkFormatTransform 所需工具 ──────────────────────────────────────────

type AnthropicApiFormat = 'anthropic' | 'openai'

function normalizeProviderApiFormat(apiFormat: unknown): AnthropicApiFormat {
  if (apiFormat === 'anthropic') return 'anthropic'
  return 'openai'
}

// ── CoworkApiConfig 类型定义 ────────��────────

export type CoworkApiType = 'anthropic' | 'openai'

export type CoworkApiConfig = {
  apiKey: string
  baseURL: string
  model: string
  apiType?: CoworkApiType
}

// ── cowork-openai-compat-proxy 前向依赖（Task 9 实现后由该模块提供） ──────────────
// 当前以最小接口占位，避免 import 循环；代理模块完成后可替换为真实 import。

export type OpenAICompatProxyTarget = 'local' | 'sandbox'

// 动态引入代理模块，避免编译时强依赖（模块可能尚未存在）
// 运行时若模块存在则调用，否则降级为 null（resolveCurrentApiConfig 会返回 error）
async function tryImportCompatProxy(): Promise<{
  configureCoworkOpenAICompatProxy: (cfg: {
    baseURL: string
    apiKey?: string
    model: string
    provider: string
  }) => void
  getCoworkOpenAICompatProxyBaseURL: (target: OpenAICompatProxyTarget) => string | null
  getCoworkOpenAICompatProxyStatus: () => { running: boolean }
} | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./cowork-openai-compat-proxy') as {
      configureCoworkOpenAICompatProxy: (cfg: {
        baseURL: string
        apiKey?: string
        model: string
        provider: string
      }) => void
      getCoworkOpenAICompatProxyBaseURL: (target: OpenAICompatProxyTarget) => string | null
      getCoworkOpenAICompatProxyStatus: () => { running: boolean }
    }
  } catch {
    return null
  }
}

// ── KVStore 接口 ────────────────────────────────

interface KVStore {
  get<T>(key: string): T | undefined
}

// ── 应用配置类型 ──────────────────────────────────────────────────────────────────

type LocalProviderConfig = Omit<ProviderConfig, 'apiFormat'> & { apiFormat?: ApiFormat | 'native' }

type AppConfig = {
  model?: {
    defaultModel?: string
    defaultModelProvider?: string
  }
  providers?: Record<string, LocalProviderConfig>
}

// ── 对外导出类型 ──────────────────────────────────────────────────────────────────

export type ApiConfigResolution = {
  config: CoworkApiConfig | null
  error?: string
  providerMetadata?: {
    providerName: string
    authType?: ProviderConfig['authType']
    codingPlanEnabled: boolean
    supportsImage?: boolean
    modelName?: string
  }
}

export type ProviderRawConfig = {
  providerName: string
  baseURL: string
  apiKey: string
  apiType: 'anthropic' | 'openai'
  authType?: ProviderConfig['authType']
  codingPlanEnabled: boolean
  models: Array<{ id: string; name?: string; supportsImage?: boolean }>
}

import { coworkLog } from './cowork-logger'

// ── 模块级注入点 ──────────────────────────────────────────────────────────────────

// Store getter 由 main.ts 注入，避免循环依赖
let storeGetter: (() => KVStore | null) | null = null

export function setStoreGetter(getter: () => KVStore | null): void {
  storeGetter = getter
}

// Auth token getter，用于 petclaw-server provider 动态获取 accessToken
let authTokensGetter: (() => { accessToken: string; refreshToken: string } | null) | null = null

export function setAuthTokensGetter(
  getter: () => { accessToken: string; refreshToken: string } | null
): void {
  authTokensGetter = getter
}

// 服务器 base URL getter，由 main.ts 注入
let serverBaseUrlGetter: (() => string) | null = null

export function setServerBaseUrlGetter(getter: () => string): void {
  serverBaseUrlGetter = getter
}

// 服务器端模型元数据缓存，key = modelId
let serverModelMetadataCache: Map<string, { supportsImage?: boolean }> = new Map()

export function updateServerModelMetadata(
  models: Array<{ modelId: string; supportsImage?: boolean }>
): void {
  serverModelMetadataCache = new Map(
    models.map((m) => [m.modelId, { supportsImage: m.supportsImage }])
  )
}

export function clearServerModelMetadata(): void {
  serverModelMetadataCache.clear()
}

export function getAllServerModelMetadata(): Array<{ modelId: string; supportsImage?: boolean }> {
  return Array.from(serverModelMetadataCache.entries()).map(([modelId, meta]) => ({
    modelId,
    supportsImage: meta.supportsImage
  }))
}

// ── 内部工具 ──────────────────────────────────────────────────────────────────────

const getStore = (): KVStore | null => {
  if (!storeGetter) return null
  return storeGetter()
}

// ── Provider 匹配逻辑 ─────────────────────────────────────────────────────────────

type MatchedProvider = {
  providerName: string
  providerConfig: LocalProviderConfig
  modelId: string
  apiFormat: AnthropicApiFormat
  baseURL: string
  supportsImage?: boolean
  modelName?: string
}

function getEffectiveProviderApiFormat(
  providerName: string,
  apiFormat: unknown
): AnthropicApiFormat {
  // 固定使用 openai 格式的 provider
  if (providerName === ProviderName.OpenAI || providerName === ProviderName.Gemini) {
    return 'openai'
  }
  if (providerName === ProviderName.Anthropic) {
    return 'anthropic'
  }
  return normalizeProviderApiFormat(apiFormat)
}

// Ollama 和 LmStudio 为本地服务，不需要 API key
function providerRequiresApiKey(providerName: string): boolean {
  return providerName !== ProviderName.Ollama && providerName !== ProviderName.LmStudio
}

// petclaw-server fallback：用 accessToken 作为 API key 代理到服务端
function tryPetclawServerFallback(modelId?: string): MatchedProvider | null {
  const tokens = authTokensGetter?.()
  const serverBaseUrl = serverBaseUrlGetter?.()
  if (!tokens?.accessToken || !serverBaseUrl) return null
  const effectiveModelId = modelId?.trim() || ''
  if (!effectiveModelId) return null
  const baseURL = `${serverBaseUrl}/api/proxy/v1`
  const cachedMeta = serverModelMetadataCache.get(effectiveModelId)
  coworkLog('INFO', 'ClaudeSettings', 'petclaw-server fallback activated', {
    baseURL,
    modelId: effectiveModelId,
    supportsImage: cachedMeta?.supportsImage
  })
  return {
    providerName: ProviderName.PetclawServer,
    providerConfig: {
      enabled: true,
      apiKey: tokens.accessToken,
      baseUrl: baseURL,
      apiFormat: 'openai',
      models: [
        { id: effectiveModelId, name: effectiveModelId, supportsImage: cachedMeta?.supportsImage }
      ]
    },
    modelId: effectiveModelId,
    apiFormat: 'openai',
    baseURL,
    supportsImage: cachedMeta?.supportsImage
  }
}

function resolveMatchedProvider(appConfig: AppConfig): {
  matched: MatchedProvider | null
  error?: string
} {
  const providers = appConfig.providers ?? {}

  // 从所有启用的 provider 中找到第一个有效 model 作为兜底
  const resolveFallbackModel = (): {
    providerName: string
    providerConfig: LocalProviderConfig
    modelId: string
  } | null => {
    for (const [providerName, providerConfig] of Object.entries(providers)) {
      if (
        !providerConfig?.enabled ||
        !providerConfig.models ||
        providerConfig.models.length === 0
      ) {
        continue
      }
      const fallbackModel = providerConfig.models.find((model) => model.id?.trim())
      if (!fallbackModel) continue
      return { providerName, providerConfig, modelId: fallbackModel.id.trim() }
    }
    return null
  }

  const configuredModelId = appConfig.model?.defaultModel?.trim()
  let modelId = configuredModelId || ''

  // 没有配置 defaultModel 时，先找兜底 model
  if (!modelId) {
    const fallback = resolveFallbackModel()
    if (!fallback) {
      const serverFallback = tryPetclawServerFallback(configuredModelId)
      if (serverFallback) return { matched: serverFallback }
      return { matched: null, error: 'No available model configured in enabled providers.' }
    }
    modelId = fallback.modelId
  }

  let providerEntry: [string, LocalProviderConfig] | undefined
  const preferredProviderName = appConfig.model?.defaultModelProvider?.trim()

  // petclaw-server provider：动态从 auth token 构造
  if (preferredProviderName === ProviderName.PetclawServer) {
    const serverMatch = tryPetclawServerFallback(modelId)
    if (serverMatch) return { matched: serverMatch }
  }

  // 优先尝试 defaultModelProvider 中找到对应 model
  if (preferredProviderName) {
    const preferredProvider = providers[preferredProviderName]
    if (
      preferredProvider?.enabled &&
      preferredProvider.models?.some((model) => model.id === modelId)
    ) {
      providerEntry = [preferredProviderName, preferredProvider]
    }
  }

  // 未命中则全量搜索
  if (!providerEntry) {
    providerEntry = Object.entries(providers).find(([, provider]) => {
      if (!provider?.enabled || !provider.models) return false
      return provider.models.some((model) => model.id === modelId)
    })
  }

  // 仍未找到则降级到兜底 model
  if (!providerEntry) {
    const fallback = resolveFallbackModel()
    if (fallback) {
      modelId = fallback.modelId
      providerEntry = [fallback.providerName, fallback.providerConfig]
    } else {
      const serverFallback = tryPetclawServerFallback(modelId)
      if (serverFallback) return { matched: serverFallback }
      return { matched: null, error: `No enabled provider found for model: ${modelId}` }
    }
  }

  const [providerName, providerConfig] = providerEntry

  let apiFormat = getEffectiveProviderApiFormat(providerName, providerConfig.apiFormat)
  let baseURL = providerConfig.baseUrl?.trim()

  if (providerConfig.codingPlanEnabled) {
    const resolved = resolveCodingPlanBaseUrl(providerName, true, apiFormat, baseURL ?? '')
    baseURL = resolved.baseUrl
    apiFormat = resolved.effectiveFormat
  }

  if (!baseURL) {
    const serverFallback = tryPetclawServerFallback(modelId)
    if (serverFallback) return { matched: serverFallback }
    return { matched: null, error: `Provider ${providerName} is missing base URL.` }
  }

  // Anthropic 格式必须有 API key（Ollama/LmStudio 除外）
  if (
    apiFormat === 'anthropic' &&
    providerRequiresApiKey(providerName) &&
    !providerConfig.apiKey?.trim()
  ) {
    const serverFallback = tryPetclawServerFallback(modelId)
    if (serverFallback) return { matched: serverFallback }
    return {
      matched: null,
      error: `Provider ${providerName} requires API key for Anthropic-compatible mode.`
    }
  }

  const matchedModel = providerConfig.models?.find((m) => m.id === modelId)

  return {
    matched: {
      providerName,
      providerConfig,
      modelId,
      apiFormat,
      baseURL,
      supportsImage: matchedModel?.supportsImage,
      modelName: matchedModel?.name
    }
  }
}

// ── 对外 API ──────────────────────────────────────────────────────────────────────

/**
 * 解析当前 API 配置（含 OpenAI compat proxy 路由）。
 * 异步原因：需要动态检测 cowork-openai-compat-proxy 是否可用。
 */
export async function resolveCurrentApiConfig(
  target: OpenAICompatProxyTarget = 'local'
): Promise<ApiConfigResolution> {
  const sqliteStore = getStore()
  if (!sqliteStore) {
    return { config: null, error: 'Store is not initialized.' }
  }

  const appConfig = sqliteStore.get<AppConfig>('app_config')
  if (!appConfig) {
    return { config: null, error: 'Application config not found.' }
  }

  const { matched, error } = resolveMatchedProvider(appConfig)
  if (!matched) {
    return { config: null, error }
  }

  const resolvedBaseURL = matched.baseURL
  const resolvedApiKey = matched.providerConfig.apiKey?.trim() || ''

  // 本地服务（Ollama/LmStudio）无需 API key，补充占位符避免下游拒绝
  const effectiveApiKey =
    resolvedApiKey || (!providerRequiresApiKey(matched.providerName) ? 'sk-petclaw-local' : '')

  if (matched.apiFormat === 'anthropic') {
    return {
      config: {
        apiKey: effectiveApiKey,
        baseURL: resolvedBaseURL,
        model: matched.modelId,
        apiType: 'anthropic'
      },
      providerMetadata: {
        providerName: matched.providerName,
        codingPlanEnabled: !!matched.providerConfig.codingPlanEnabled,
        supportsImage: matched.supportsImage
      }
    }
  }

  // openai 格式需要经由 compat proxy 转换
  const compatProxy = await tryImportCompatProxy()
  if (!compatProxy) {
    return { config: null, error: 'OpenAI compatibility proxy module is not available.' }
  }

  const proxyStatus = compatProxy.getCoworkOpenAICompatProxyStatus()
  if (!proxyStatus.running) {
    return { config: null, error: 'OpenAI compatibility proxy is not running.' }
  }

  compatProxy.configureCoworkOpenAICompatProxy({
    baseURL: resolvedBaseURL,
    apiKey: resolvedApiKey || undefined,
    model: matched.modelId,
    provider: matched.providerName
  })

  const proxyBaseURL = compatProxy.getCoworkOpenAICompatProxyBaseURL(target)
  if (!proxyBaseURL) {
    return { config: null, error: 'OpenAI compatibility proxy base URL is unavailable.' }
  }

  return {
    config: {
      apiKey: resolvedApiKey || 'petclaw-openai-compat',
      baseURL: proxyBaseURL,
      model: matched.modelId,
      apiType: 'openai'
    },
    providerMetadata: {
      providerName: matched.providerName,
      codingPlanEnabled: !!matched.providerConfig.codingPlanEnabled
    }
  }
}

export async function getCurrentApiConfig(
  target: OpenAICompatProxyTarget = 'local'
): Promise<CoworkApiConfig | null> {
  return (await resolveCurrentApiConfig(target)).config
}

/**
 * 解析原始 API 配置（不经过 OpenAI compat proxy）。
 * 供 ConfigSync 使用，其有自己的 model 路由逻辑。
 */
export function resolveRawApiConfig(): ApiConfigResolution {
  const sqliteStore = getStore()
  if (!sqliteStore) {
    coworkLog(
      'INFO',
      'ClaudeSettings',
      'resolveRawApiConfig: store is null, storeGetter not set yet'
    )
    return { config: null, error: 'Store is not initialized.' }
  }

  const appConfig = sqliteStore.get<AppConfig>('app_config')
  if (!appConfig) {
    coworkLog('INFO', 'ClaudeSettings', 'resolveRawApiConfig: app_config not found in store')
    return { config: null, error: 'Application config not found.' }
  }

  const { matched, error } = resolveMatchedProvider(appConfig)
  if (!matched) {
    const providerKeys = Object.keys(appConfig.providers ?? {})
    const defaultModel = appConfig.model?.defaultModel
    const defaultProvider = appConfig.model?.defaultModelProvider
    coworkLog('INFO', 'ClaudeSettings', 'resolveRawApiConfig: no matched provider', {
      error,
      providers: providerKeys.join(','),
      defaultModel,
      defaultProvider
    })
    return { config: null, error }
  }

  let apiKey = matched.providerConfig.apiKey?.trim() || ''
  const effectiveBaseURL = matched.baseURL
  const effectiveApiFormat = matched.apiFormat

  // 本地服务无需 API key，补充占位符
  const effectiveApiKey =
    apiKey || (!providerRequiresApiKey(matched.providerName) ? 'sk-petclaw-local' : '')
  apiKey = effectiveApiKey

  coworkLog('INFO', 'ClaudeSettings', 'resolved raw API config', {
    matched: JSON.stringify({
      ...matched,
      providerConfig: { ...matched.providerConfig, apiKey: apiKey ? '***' : '' }
    })
  })

  return {
    config: {
      apiKey,
      baseURL: effectiveBaseURL,
      model: matched.modelId,
      apiType: effectiveApiFormat === 'anthropic' ? 'anthropic' : 'openai'
    },
    providerMetadata: {
      providerName: matched.providerName,
      authType: matched.providerConfig.authType,
      codingPlanEnabled: !!matched.providerConfig.codingPlanEnabled,
      supportsImage: matched.supportsImage,
      modelName: matched.modelName
    }
  }
}

/**
 * 收集所有已配置 provider 的 API key，供 ConfigSync 在引擎启动时批量注入环境变量。
 * petclaw-server 的 token 由 token proxy 管理，不在此注入。
 */
export function resolveAllProviderApiKeys(): Record<string, string> {
  const result: Record<string, string> = {}

  // petclaw-server：用 auth accessToken
  const tokens = authTokensGetter?.()
  const serverBaseUrl = serverBaseUrlGetter?.()
  if (tokens?.accessToken && serverBaseUrl) {
    result.SERVER = tokens.accessToken
  }

  const sqliteStore = getStore()
  if (!sqliteStore) return result

  const appConfig = sqliteStore.get<AppConfig>('app_config')
  if (!appConfig?.providers) return result

  for (const [providerName, providerConfig] of Object.entries(appConfig.providers)) {
    if (!providerConfig?.enabled) continue
    const apiKey = providerConfig.apiKey?.trim()
    if (!apiKey && providerRequiresApiKey(providerName)) continue
    const envName = providerName.toUpperCase().replace(/[^A-Z0-9]/g, '_')
    result[envName] = apiKey || 'sk-petclaw-local'
  }

  coworkLog('INFO', 'ClaudeSettings', 'resolveAllProviderApiKeys', {
    hasServer: !!result.SERVER,
    providers: Object.keys(result)
      .filter((k) => k !== 'SERVER')
      .join(',')
  })

  return result
}

/**
 * 构造传递给 OpenClaw 引擎子进程的环境变量。
 * 将 CoworkApiConfig 的字段映射到 Anthropic SDK 识别的标准环境变量名。
 */
export function buildEnvForConfig(config: CoworkApiConfig): Record<string, string> {
  const baseEnv = { ...process.env } as Record<string, string>
  baseEnv.ANTHROPIC_AUTH_TOKEN = config.apiKey
  baseEnv.ANTHROPIC_API_KEY = config.apiKey
  baseEnv.ANTHROPIC_BASE_URL = config.baseURL
  baseEnv.ANTHROPIC_MODEL = config.model
  return baseEnv
}

/**
 * 解析所有已启用 provider 的完整配置列表。
 * 供 ConfigSync 批量同步 provider 配置到 openclaw.json。
 */
export function resolveAllEnabledProviderConfigs(): ProviderRawConfig[] {
  const sqliteStore = getStore()
  if (!sqliteStore) return []

  const appConfig = sqliteStore.get<AppConfig>('app_config')
  if (!appConfig?.providers) return []

  const result: ProviderRawConfig[] = []

  for (const [providerName, providerConfig] of Object.entries(appConfig.providers)) {
    if (!providerConfig?.enabled) continue
    // petclaw-server 由独立的 token proxy 管理，不在此列出
    if (providerName === ProviderName.PetclawServer) continue

    const apiKey = providerConfig.apiKey?.trim() || ''
    if (!apiKey && providerRequiresApiKey(providerName)) continue

    const baseURL = providerConfig.baseUrl?.trim() || ''
    let effectiveBaseURL = baseURL
    let effectiveApiFormat = getEffectiveProviderApiFormat(providerName, providerConfig.apiFormat)

    if (providerConfig.codingPlanEnabled) {
      const resolved = resolveCodingPlanBaseUrl(
        providerName,
        true,
        effectiveApiFormat,
        effectiveBaseURL
      )
      effectiveBaseURL = resolved.baseUrl
      effectiveApiFormat = resolved.effectiveFormat
    }

    if (!effectiveBaseURL) continue

    const models = (providerConfig.models ?? []).filter((m) => m.id?.trim())
    if (models.length === 0) continue

    result.push({
      providerName,
      baseURL: effectiveBaseURL,
      apiKey: apiKey || 'sk-petclaw-local',
      apiType: effectiveApiFormat === 'anthropic' ? 'anthropic' : 'openai',
      authType: providerConfig.authType,
      codingPlanEnabled: !!providerConfig.codingPlanEnabled,
      models
    })
  }

  return result
}
