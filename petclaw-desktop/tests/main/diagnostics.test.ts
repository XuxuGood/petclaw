import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { app } from 'electron'

import { diagAppReady, diagBootResult } from '../../src/main/diagnostics'
import { resetLoggingPlatformForTest } from '../../src/main/logging'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-diagnostics-'))
  vi.mocked(app.getPath).mockImplementation((name: string) => {
    if (name === 'userData') return tmpDir
    return tmpDir
  })
  vi.mocked(app.getVersion).mockReturnValue('0.0.0-test')
  resetLoggingPlatformForTest()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
  resetLoggingPlatformForTest()
})

function diagnosticsLogPath(): string {
  return path.join(tmpDir, 'logs', 'startup', 'startup-diagnostics.jsonl')
}

describe('diagnostics log path', () => {
  it('writes startup diagnostics under userData logs', () => {
    diagAppReady()

    const content = fs.readFileSync(diagnosticsLogPath(), 'utf8')
    expect(content).toContain('"event":"app-when-ready"')
    expect(content).toContain('"source":"startup"')
    expect(content).toContain('"module":"StartupDiagnostics"')
  })

  it('appends boot result without using legacy home directory', () => {
    const homeDir = path.join(tmpDir, 'home')
    vi.mocked(app.getPath).mockImplementation((name: string) => {
      if (name === 'userData') return tmpDir
      if (name === 'home') return homeDir
      return tmpDir
    })

    diagBootResult(false, 'missing runtime')

    const content = fs.readFileSync(diagnosticsLogPath(), 'utf8')
    expect(content).toContain('"event":"boot-check-result"')
    expect(content).toContain('"success":false')
    expect(fs.existsSync(path.join(homeDir, '.petclaw'))).toBe(false)
  })
})
