import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { checkEnvironment, installHooks } from '../../src/main/onboarding'
import { ConfigInstaller } from '../../src/main/hooks/installer'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('checkEnvironment', () => {
  it('detects node.js availability', async () => {
    const result = await checkEnvironment()
    // In test environment, Node.js should be available
    expect(result.nodeOk).toBe(true)
    expect(result.nodeVersion).toMatch(/^v\d+/)
  })
})

describe('installHooks', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('installs hooks to new settings file', () => {
    const installer = new ConfigInstaller('/usr/local/bin/petclaw-bridge')
    const settingsPath = path.join(tmpDir, 'settings.json')

    const result = installHooks(installer, settingsPath)
    expect(result.success).toBe(true)

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    expect(settings.hooks).toBeDefined()
    expect(settings.hooks.afterToolUse).toContain('/usr/local/bin/petclaw-bridge')
  })

  it('returns error for invalid path', () => {
    const installer = new ConfigInstaller('/usr/local/bin/petclaw-bridge')
    const settingsPath = path.join(tmpDir, 'nonexistent', 'deep', 'settings.json')

    const result = installHooks(installer, settingsPath)
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})
