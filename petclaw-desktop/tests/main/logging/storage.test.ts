import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createLogStorage } from '../../../src/main/logging/storage'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-log-storage-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('createLogStorage', () => {
  test('writes json lines into the source daily file', () => {
    const storage = createLogStorage({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })

    storage.write({
      level: 'info',
      source: 'main',
      module: 'App',
      event: 'app.started',
      fields: { token: 'secret-token' }
    })

    const filePath = path.join(root, 'logs', 'main', 'main-2026-05-05.log')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).toContain('"event":"app.started"')
    expect(content).toContain('[redacted]')
    expect(content).not.toContain('secret-token')
  })

  test('reports snapshot entries for every source', () => {
    const storage = createLogStorage({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })

    const snapshot = storage.snapshot()

    expect(snapshot.writable).toBe(true)
    expect(snapshot.sources.some((source) => source.source === 'main')).toBe(true)
    expect(snapshot.sources.some((source) => source.source === 'gateway')).toBe(true)
  })
})
