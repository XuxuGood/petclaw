import { createRequire } from 'module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)

type NotarizeContext = {
  electronPlatformName: string
  appOutDir: string
  packager: {
    appInfo: {
      productFilename: string
    }
  }
}

type NotarizeModule = {
  default: (context: NotarizeContext) => Promise<void>
}

const originalEnv = { ...process.env }

function loadNotarizeModule(): NotarizeModule {
  const modulePath = require.resolve('../../../scripts/notarize.js')
  delete require.cache[modulePath]
  return require(modulePath) as NotarizeModule
}

function createContext(electronPlatformName = 'darwin'): NotarizeContext {
  return {
    electronPlatformName,
    appOutDir: '/tmp/petclaw-release',
    packager: {
      appInfo: {
        productFilename: 'PetClaw'
      }
    }
  }
}

beforeEach(() => {
  process.env = { ...originalEnv }
})

afterEach(() => {
  vi.restoreAllMocks()
  process.env = { ...originalEnv }
})

describe('notarize script', () => {
  it('skips non-macOS builds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const notarizeModule = loadNotarizeModule()

    await expect(notarizeModule.default(createContext('win32'))).resolves.toBeUndefined()

    expect(warn).not.toHaveBeenCalled()
  })

  it('allows local macOS builds to skip notarization when credentials are missing', async () => {
    delete process.env.APPLE_ID
    delete process.env.APPLE_ID_PASSWORD
    delete process.env.APPLE_APP_SPECIFIC_PASSWORD
    delete process.env.APPLE_TEAM_ID
    delete process.env.PETCLAW_REQUIRE_MAC_NOTARIZATION
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const notarizeModule = loadNotarizeModule()

    await expect(notarizeModule.default(createContext())).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('跳过公证'))
  })

  it('fails release macOS builds when signing or notarization credentials are missing', async () => {
    process.env.PETCLAW_REQUIRE_MAC_NOTARIZATION = '1'
    delete process.env.CSC_LINK
    delete process.env.CSC_KEY_PASSWORD
    delete process.env.APPLE_ID
    delete process.env.APPLE_ID_PASSWORD
    delete process.env.APPLE_APP_SPECIFIC_PASSWORD
    delete process.env.APPLE_TEAM_ID
    const notarizeModule = loadNotarizeModule()

    await expect(notarizeModule.default(createContext())).rejects.toThrow(
      /Missing required macOS release credentials/
    )
  })
})
