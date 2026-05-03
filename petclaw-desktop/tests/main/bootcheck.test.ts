import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { app } from 'electron'

import { runBootCheck } from '../../src/main/bootcheck'

class FakeWindow {
  webContents = {
    send: vi.fn()
  }
}

function createEngineManager(baseDir: string, phase: 'ready' | 'running' = 'ready') {
  return {
    getBaseDir: vi.fn(() => baseDir),
    startGateway: vi.fn(async () => ({ phase })),
    getGatewayConnectionInfo: vi.fn(() => ({ port: 18789, token: 'token' })),
    setSecretEnvVars: vi.fn()
  }
}

function createConfigSync() {
  return {
    sync: vi.fn(() => ({ ok: true, changed: false, configPath: '/tmp/openclaw.json' })),
    collectSecretEnvVars: vi.fn(() => ({}))
  }
}

describe('runBootCheck', () => {
  let tmpDir: string
  let baseDir: string
  let skillsRoot: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-bootcheck-'))
    baseDir = path.join(tmpDir, 'openclaw')
    skillsRoot = path.join(tmpDir, 'SKILLs')

    vi.mocked(app.getPath).mockImplementation((name: string) => {
      if (name === 'userData') return tmpDir
      return tmpDir
    })
    vi.mocked(app.getAppPath).mockReturnValue(tmpDir)
    app.isPackaged = true
  })

  afterEach(() => {
    app.isPackaged = false
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates the shared SKILLs root instead of an openclaw-local skills directory', async () => {
    const result = await runBootCheck(
      new FakeWindow() as never,
      createEngineManager(baseDir) as never,
      createConfigSync() as never
    )

    expect(result.success).toBe(true)
    expect(fs.existsSync(skillsRoot)).toBe(true)
    expect(fs.existsSync(path.join(baseDir, 'skills'))).toBe(false)
  })

  it('treats an already running gateway as boot success', async () => {
    const result = await runBootCheck(
      new FakeWindow() as never,
      createEngineManager(baseDir, 'running') as never,
      createConfigSync() as never
    )

    expect(result.success).toBe(true)
    expect(result.port).toBe(18789)
    expect(result.token).toBe('token')
  })
})
