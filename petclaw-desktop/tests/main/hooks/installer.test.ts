import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ConfigInstaller } from '../../../src/main/hooks/installer'

describe('ConfigInstaller', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('installs hooks into claude settings.json', () => {
    const settingsDir = path.join(tmpDir, '.claude')
    fs.mkdirSync(settingsDir, { recursive: true })
    const settingsPath = path.join(settingsDir, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({}))

    const installer = new ConfigInstaller('/path/to/bridge')
    installer.installClaudeHooks(settingsPath)

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    expect(settings.hooks).toBeDefined()
    expect(settings.hooks.afterToolUse).toContain('/path/to/bridge')
  })

  it('preserves existing settings when installing hooks', () => {
    const settingsDir = path.join(tmpDir, '.claude')
    fs.mkdirSync(settingsDir, { recursive: true })
    const settingsPath = path.join(settingsDir, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({ existingKey: 'value' }))

    const installer = new ConfigInstaller('/path/to/bridge')
    installer.installClaudeHooks(settingsPath)

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    expect(settings.existingKey).toBe('value')
    expect(settings.hooks).toBeDefined()
  })

  it('does not duplicate hooks on re-install', () => {
    const settingsDir = path.join(tmpDir, '.claude')
    fs.mkdirSync(settingsDir, { recursive: true })
    const settingsPath = path.join(settingsDir, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({}))

    const installer = new ConfigInstaller('/path/to/bridge')
    installer.installClaudeHooks(settingsPath)
    installer.installClaudeHooks(settingsPath)

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const hookEntries = settings.hooks.afterToolUse.filter((h: string) =>
      h.includes('/path/to/bridge')
    )
    expect(hookEntries).toHaveLength(1)
  })
})
