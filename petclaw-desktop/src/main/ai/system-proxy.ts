import { app, session } from 'electron'

import { getLogger } from '../logging/facade'

const logger = getLogger('SystemProxy', 'runtime')

const PROXY_ENV_KEYS = [
  'http_proxy',
  'https_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'no_proxy',
  'NO_PROXY'
] as const

type ProxyEnvKey = (typeof PROXY_ENV_KEYS)[number]
type ProxyEnvSnapshot = Record<ProxyEnvKey, string | undefined>

// 在模块加载时快照原始代理环境变量，确保 toggle 可逆
const originalProxyEnv: ProxyEnvSnapshot = PROXY_ENV_KEYS.reduce((acc, key) => {
  acc[key] = process.env[key]
  return acc
}, {} as ProxyEnvSnapshot)

let systemProxyEnabled = false

export const DEFAULT_PROXY_RESOLUTION_TARGETS = [
  'https://api.openai.com',
  'https://api.anthropic.com',
  'https://generativelanguage.googleapis.com',
  'https://openrouter.ai'
] as const

function setEnvValue(key: ProxyEnvKey, value: string | undefined): void {
  if (typeof value === 'string' && value.length > 0) {
    process.env[key] = value
    return
  }
  delete process.env[key]
}

// 将 PAC 格式规则解析成标准代理 URL，DIRECT 返回 null
function parseProxyRule(rule: string): string | null {
  const normalizedRule = rule.trim()
  if (!normalizedRule || normalizedRule.toUpperCase() === 'DIRECT') {
    return null
  }

  // 匹配标准 PAC 格式：TYPE host:port
  // 严格匹配 host:port，避免贪心捕获 ";SOCKS5 ..." 等后续内容
  const match = normalizedRule.match(/^(PROXY|HTTPS?|SOCKS5?|SOCKS4?)\s+([\w.-]+:\d+)$/i)
  if (!match) {
    // 兼容部分代理工具直接返回 URL 格式：http://host:port
    const urlMatch = normalizedRule.match(/^(https?|socks5?|socks4?):\/\/([\w.-]+:\d+)\/?$/i)
    if (urlMatch) {
      return `${urlMatch[1].toLowerCase()}://${urlMatch[2]}`
    }
    return null
  }

  const type = match[1].toUpperCase()
  const hostPort = match[2]

  if (type === 'HTTPS') {
    return `https://${hostPort}`
  }
  if (type.startsWith('SOCKS4')) {
    return `socks4://${hostPort}`
  }
  if (type.startsWith('SOCKS')) {
    return `socks5://${hostPort}`
  }
  return `http://${hostPort}`
}

export function isSystemProxyEnabled(): boolean {
  return systemProxyEnabled
}

export function setSystemProxyEnabled(enabled: boolean): void {
  systemProxyEnabled = enabled
}

export function restoreOriginalProxyEnv(): void {
  PROXY_ENV_KEYS.forEach((key) => {
    setEnvValue(key, originalProxyEnv[key])
  })
}

// 将代理 URL 写入环境变量；传 null 则还原为原始值
export function applySystemProxyEnv(proxyUrl: string | null): void {
  // 始终从原始环境变量开始，确保切换代理可逆且行为确定
  restoreOriginalProxyEnv()
  if (!proxyUrl) {
    return
  }

  setEnvValue('http_proxy', proxyUrl)
  setEnvValue('https_proxy', proxyUrl)
  setEnvValue('HTTP_PROXY', proxyUrl)
  setEnvValue('HTTPS_PROXY', proxyUrl)
}

// 通过 Electron session 解析目标 URL 对应的系统代理
export async function resolveSystemProxyUrl(targetUrl: string): Promise<string | null> {
  // app 未就绪时 session 不可用，跳过解析
  if (!app.isReady()) {
    return null
  }

  try {
    const proxyResult = await session.defaultSession.resolveProxy(targetUrl)
    if (!proxyResult) {
      return null
    }

    // resolveProxy 可能返回多条规则，以 ";" 分隔，取第一个可用的代理
    const rules = proxyResult.split(';')
    for (const rule of rules) {
      const proxyUrl = parseProxyRule(rule)
      if (proxyUrl) {
        return proxyUrl
      }
    }
  } catch (error) {
    logger.error('proxy.resolve.failed', undefined, error)
  }

  return null
}

// 遍历多个目标 URL，返回第一个成功解析到代理的结果
export async function resolveSystemProxyUrlForTargets(
  targetUrls: readonly string[] = DEFAULT_PROXY_RESOLUTION_TARGETS
): Promise<{ proxyUrl: string | null; targetUrl: string | null }> {
  for (const targetUrl of targetUrls) {
    const proxyUrl = await resolveSystemProxyUrl(targetUrl)
    if (proxyUrl) {
      return { proxyUrl, targetUrl }
    }
  }

  return { proxyUrl: null, targetUrl: null }
}
