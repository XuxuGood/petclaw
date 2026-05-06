import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

type ExtraResource = {
  from?: string
  to?: string
  filter?: string[]
}

type ElectronBuilderConfig = {
  mac?: {
    icon?: string
    extendInfo?: Record<string, unknown>
    extraResources?: ExtraResource[]
  }
  linux?: {
    extraResources?: ExtraResource[]
  }
}

function readElectronBuilderConfig(): ElectronBuilderConfig {
  const configPath = path.resolve(__dirname, '../../../electron-builder.json')
  return JSON.parse(readFileSync(configPath, 'utf8')) as ElectronBuilderConfig
}

function expectRuntimeNodeModulesResource(extraResources: ExtraResource[] | undefined) {
  expect(extraResources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        from: 'vendor/openclaw-runtime/current',
        to: 'petmind'
      }),
      expect.objectContaining({
        from: 'vendor/openclaw-runtime/current/node_modules',
        to: 'petmind/node_modules',
        filter: expect.arrayContaining(['**/*', '!**/.bin', '!**/.bin/**'])
      })
    ])
  )
}

describe('electron-builder runtime resources', () => {
  it('uses electron-builder mac.icon as the only macOS icon plist source', () => {
    const config = readElectronBuilderConfig()

    expect(config.mac?.icon).toBe('build/icons/mac/icon.icns')
    expect(config.mac?.extendInfo ?? {}).not.toHaveProperty('CFBundleIconName')
  })

  it('copies macOS OpenClaw runtime node_modules as a separate FileSet', () => {
    const config = readElectronBuilderConfig()

    expectRuntimeNodeModulesResource(config.mac?.extraResources)
  })

  it('copies Linux OpenClaw runtime node_modules as a separate FileSet', () => {
    const config = readElectronBuilderConfig()

    expectRuntimeNodeModulesResource(config.linux?.extraResources)
  })
})
