import { describe, it, expect, beforeEach, vi } from 'vitest'

// 因为模块有模块级状态（systemProxyEnabled、originalProxyEnv），
// 每个测试前必须重置模块，并通过动态 import 获取全新实例
beforeEach(() => {
  vi.resetModules()

  // 重置进程环境变量，避免测试间相互污染
  delete process.env.http_proxy
  delete process.env.https_proxy
  delete process.env.HTTP_PROXY
  delete process.env.HTTPS_PROXY
  delete process.env.no_proxy
  delete process.env.NO_PROXY
})

// ── Mock electron ──
vi.mock('electron', () => ({
  app: {
    isReady: vi.fn()
  },
  session: {
    defaultSession: {
      resolveProxy: vi.fn()
    }
  }
}))

describe('isSystemProxyEnabled', () => {
  it('默认值为 false', async () => {
    const { isSystemProxyEnabled } = await import('../../../src/main/ai/system-proxy')
    expect(isSystemProxyEnabled()).toBe(false)
  })
})

describe('setSystemProxyEnabled', () => {
  it('可以切换为 true', async () => {
    const { isSystemProxyEnabled, setSystemProxyEnabled } =
      await import('../../../src/main/ai/system-proxy')
    setSystemProxyEnabled(true)
    expect(isSystemProxyEnabled()).toBe(true)
  })

  it('可以从 true 切换回 false', async () => {
    const { isSystemProxyEnabled, setSystemProxyEnabled } =
      await import('../../../src/main/ai/system-proxy')
    setSystemProxyEnabled(true)
    setSystemProxyEnabled(false)
    expect(isSystemProxyEnabled()).toBe(false)
  })
})

describe('applySystemProxyEnv', () => {
  it('传入代理 URL 时，设置所有代理环境变量', async () => {
    const { applySystemProxyEnv } = await import('../../../src/main/ai/system-proxy')
    applySystemProxyEnv('http://127.0.0.1:7890')

    expect(process.env.http_proxy).toBe('http://127.0.0.1:7890')
    expect(process.env.https_proxy).toBe('http://127.0.0.1:7890')
    expect(process.env.HTTP_PROXY).toBe('http://127.0.0.1:7890')
    expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:7890')
  })

  it('传入 null 时，清除代理环境变量', async () => {
    const { applySystemProxyEnv } = await import('../../../src/main/ai/system-proxy')
    // 先设置再清除
    applySystemProxyEnv('http://127.0.0.1:7890')
    applySystemProxyEnv(null)

    // 模块加载时 originalProxyEnv 快照为 undefined，所以应恢复为不存在
    expect(process.env.http_proxy).toBeUndefined()
    expect(process.env.https_proxy).toBeUndefined()
    expect(process.env.HTTP_PROXY).toBeUndefined()
    expect(process.env.HTTPS_PROXY).toBeUndefined()
  })

  it('切换代理 URL 可逆：先 set 再 null 恢复原始值', async () => {
    const { applySystemProxyEnv } = await import('../../../src/main/ai/system-proxy')
    applySystemProxyEnv('http://proxy.example.com:8080')
    applySystemProxyEnv(null)

    expect(process.env.http_proxy).toBeUndefined()
    expect(process.env.HTTPS_PROXY).toBeUndefined()
  })
})

describe('resolveSystemProxyUrl', () => {
  it('app 未就绪时返回 null', async () => {
    const electron = await import('electron')
    vi.mocked(electron.app.isReady).mockReturnValue(false)

    const { resolveSystemProxyUrl } = await import('../../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrl('https://api.openai.com')
    expect(result).toBeNull()
  })

  it('解析 PROXY 规则，返回 http:// URL', async () => {
    const electron = await import('electron')
    vi.mocked(electron.app.isReady).mockReturnValue(true)
    vi.mocked(electron.session.defaultSession.resolveProxy).mockResolvedValue(
      'PROXY 127.0.0.1:7890'
    )

    const { resolveSystemProxyUrl } = await import('../../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrl('https://api.openai.com')
    expect(result).toBe('http://127.0.0.1:7890')
  })

  it('解析 SOCKS5 规则，返回 socks5:// URL', async () => {
    const electron = await import('electron')
    vi.mocked(electron.app.isReady).mockReturnValue(true)
    vi.mocked(electron.session.defaultSession.resolveProxy).mockResolvedValue(
      'SOCKS5 127.0.0.1:1080'
    )

    const { resolveSystemProxyUrl } = await import('../../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrl('https://api.openai.com')
    expect(result).toBe('socks5://127.0.0.1:1080')
  })

  it('解析 HTTPS 规则，返回 https:// URL', async () => {
    const electron = await import('electron')
    vi.mocked(electron.app.isReady).mockReturnValue(true)
    vi.mocked(electron.session.defaultSession.resolveProxy).mockResolvedValue(
      'HTTPS proxy.example.com:443'
    )

    const { resolveSystemProxyUrl } = await import('../../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrl('https://api.anthropic.com')
    expect(result).toBe('https://proxy.example.com:443')
  })

  it('解析 DIRECT 规则，返回 null', async () => {
    const electron = await import('electron')
    vi.mocked(electron.app.isReady).mockReturnValue(true)
    vi.mocked(electron.session.defaultSession.resolveProxy).mockResolvedValue('DIRECT')

    const { resolveSystemProxyUrl } = await import('../../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrl('https://api.openai.com')
    expect(result).toBeNull()
  })

  it('多条规则以分号分隔时，跳过 DIRECT 取第一个有效代理', async () => {
    const electron = await import('electron')
    vi.mocked(electron.app.isReady).mockReturnValue(true)
    vi.mocked(electron.session.defaultSession.resolveProxy).mockResolvedValue(
      'DIRECT;PROXY 10.0.0.1:3128'
    )

    const { resolveSystemProxyUrl } = await import('../../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrl('https://api.openai.com')
    expect(result).toBe('http://10.0.0.1:3128')
  })

  it('resolveProxy 抛出异常时，返回 null 而不是崩溃', async () => {
    const electron = await import('electron')
    vi.mocked(electron.app.isReady).mockReturnValue(true)
    vi.mocked(electron.session.defaultSession.resolveProxy).mockRejectedValue(
      new Error('resolve failed')
    )

    const { resolveSystemProxyUrl } = await import('../../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrl('https://api.openai.com')
    expect(result).toBeNull()
  })

  it('兼容 URL 格式规则：http://host:port', async () => {
    const electron = await import('electron')
    vi.mocked(electron.app.isReady).mockReturnValue(true)
    vi.mocked(electron.session.defaultSession.resolveProxy).mockResolvedValue(
      'http://127.0.0.1:7890'
    )

    const { resolveSystemProxyUrl } = await import('../../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrl('https://api.openai.com')
    expect(result).toBe('http://127.0.0.1:7890')
  })
})

describe('resolveSystemProxyUrlForTargets', () => {
  it('第一个目标有代理时，立即返回', async () => {
    const electron = await import('electron')
    vi.mocked(electron.app.isReady).mockReturnValue(true)
    vi.mocked(electron.session.defaultSession.resolveProxy).mockResolvedValue(
      'PROXY 127.0.0.1:7890'
    )

    const { resolveSystemProxyUrlForTargets } = await import('../../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrlForTargets([
      'https://api.openai.com',
      'https://api.anthropic.com'
    ])

    expect(result.proxyUrl).toBe('http://127.0.0.1:7890')
    expect(result.targetUrl).toBe('https://api.openai.com')
  })

  it('第一个目标无代理，迭代到第二个有代理的目标', async () => {
    const electron = await import('electron')
    vi.mocked(electron.app.isReady).mockReturnValue(true)
    vi.mocked(electron.session.defaultSession.resolveProxy)
      .mockResolvedValueOnce('DIRECT')
      .mockResolvedValueOnce('PROXY 10.0.0.1:3128')

    const { resolveSystemProxyUrlForTargets } = await import('../../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrlForTargets([
      'https://api.openai.com',
      'https://api.anthropic.com'
    ])

    expect(result.proxyUrl).toBe('http://10.0.0.1:3128')
    expect(result.targetUrl).toBe('https://api.anthropic.com')
  })

  it('所有目标均无代理时，返回 { proxyUrl: null, targetUrl: null }', async () => {
    const electron = await import('electron')
    vi.mocked(electron.app.isReady).mockReturnValue(true)
    vi.mocked(electron.session.defaultSession.resolveProxy).mockResolvedValue('DIRECT')

    const { resolveSystemProxyUrlForTargets } = await import('../../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrlForTargets([
      'https://api.openai.com',
      'https://api.anthropic.com'
    ])

    expect(result.proxyUrl).toBeNull()
    expect(result.targetUrl).toBeNull()
  })

  it('不传参数时使用 DEFAULT_PROXY_RESOLUTION_TARGETS，所有目标均无代理则返回 null', async () => {
    const electron = await import('electron')
    vi.mocked(electron.app.isReady).mockReturnValue(true)
    vi.mocked(electron.session.defaultSession.resolveProxy).mockResolvedValue('DIRECT')

    const { resolveSystemProxyUrlForTargets } = await import('../../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrlForTargets()

    // 不传参数时使用默认目标列表，均为 DIRECT，结果应为 null
    expect(result.proxyUrl).toBeNull()
    expect(result.targetUrl).toBeNull()
  })
})
