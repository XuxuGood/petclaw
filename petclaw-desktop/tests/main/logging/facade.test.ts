import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createLoggingPlatform } from '../../../src/main/logging/facade'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-log-facade-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('createLoggingPlatform', () => {
  test('creates scoped loggers that write sanitized events', () => {
    const platform = createLoggingPlatform({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })

    const logger = platform.getLogger('ConfigSync')
    logger.error(
      'sync.failed',
      'Config sync failed',
      { gatewayToken: 'secret-token' },
      new Error('boom')
    )

    const filePath = path.join(root, 'logs', 'main', 'main-2026-05-05.log')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).toContain('"module":"ConfigSync"')
    expect(content).toContain('"event":"sync.failed"')
    expect(content).toContain('"message":"Config sync failed"')
    expect(content).toContain('"error":{"name":"Error","message":"boom"')
    expect(content).not.toContain('secret-token')
  })

  test('supports renderer reports as renderer source events', () => {
    const platform = createLoggingPlatform({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })

    platform.reportRendererLog({
      level: 'error',
      module: 'BootCheckPanel',
      event: 'renderer.render.failed',
      message: 'render failed',
      fields: { apiKey: 'secret' }
    })

    const filePath = path.join(root, 'logs', 'renderer', 'renderer-2026-05-05.log')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).toContain('"source":"renderer"')
    expect(content).not.toContain('secret')
  })

  test('supports error as the third argument when fields are omitted', () => {
    const platform = createLoggingPlatform({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })

    const logger = platform.getLogger('Gateway')
    logger.error('reconnect.failed', 'Gateway reconnect attempt failed', new Error('offline'))

    const filePath = path.join(root, 'logs', 'main', 'main-2026-05-05.log')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).toContain('"event":"reconnect.failed"')
    expect(content).toContain('"message":"Gateway reconnect attempt failed"')
    expect(content).toContain('"error":{"name":"Error","message":"offline"')
  })
})
