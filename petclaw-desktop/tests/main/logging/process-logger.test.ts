import { PassThrough } from 'stream'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createLoggingPlatform } from '../../../src/main/logging/facade'
import { attachProcessLogger } from '../../../src/main/logging/process-logger'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-process-logger-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('attachProcessLogger', () => {
  test('writes stdout and stderr to the selected source with redaction', () => {
    const platform = createLoggingPlatform({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })
    const stdout = new PassThrough()
    const stderr = new PassThrough()

    attachProcessLogger({
      platform,
      source: 'gateway',
      module: 'OpenClaw',
      stdout,
      stderr
    })

    stdout.write('[gateway] started token=secret-token\n')
    stderr.write('Bearer eyJhbGciOiJIUzI1NiJ9.abc.def\n')

    const filePath = path.join(root, 'openclaw', 'logs', 'gateway', 'gateway-2026-05-05.log')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).toContain('[redacted]')
    expect(content).not.toContain('secret-token')
    expect(content).not.toContain('Bearer eyJ')
  })

  test('mirrors gateway milestones to the main source', () => {
    const platform = createLoggingPlatform({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })
    const stdout = new PassThrough()

    attachProcessLogger({
      platform,
      source: 'gateway',
      module: 'OpenClaw',
      stdout
    })

    stdout.write('[gateway] listening\n')

    const filePath = path.join(root, 'logs', 'main', 'main-2026-05-05.log')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).toContain('"event":"process.milestone"')
    expect(content).toContain('[gateway] listening')
  })
})
