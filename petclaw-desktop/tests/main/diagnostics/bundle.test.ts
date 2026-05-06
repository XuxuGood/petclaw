import fs from 'fs'
import os from 'os'
import path from 'path'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createDiagnosticsBundle } from '../../../src/main/diagnostics'
import { createLogStorage } from '../../../src/main/logging/storage'
import type { LogStorage } from '../../../src/main/logging/storage'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-diagnostics-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('diagnostics bundle', () => {
  test('exports sanitized logs and manifest', async () => {
    const storage = createLogStorage({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })
    storage.write({
      level: 'error',
      source: 'main',
      module: 'ConfigSync',
      event: 'sync.failed',
      fields: { token: 'secret-token' }
    })

    const result = await createDiagnosticsBundle({
      userDataPath: root,
      appVersion: '0.1.0',
      storage,
      options: { timeRangeDays: 3 },
      now: () => new Date('2026-05-05T10:05:00.000Z')
    })

    expect(fs.existsSync(result.filePath)).toBe(true)
    expect(result.filePath.endsWith('.zip')).toBe(true)

    const archive = unzipSync(fs.readFileSync(result.filePath))
    const manifest = JSON.parse(strFromU8(archive['manifest.json'])) as Record<string, unknown>
    const mainLog = strFromU8(archive['logs/main/main-2026-05-05.log'])

    expect(manifest.includedSources).toContain('main')
    expect(manifest.redactionCounts).toBeGreaterThanOrEqual(1)
    expect(mainLog).toContain('[redacted]')
    expect(mainLog).not.toContain('secret-token')
  })

  test('sanitizes historical plain text logs again during export', async () => {
    const storage = createLogStorage({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })
    const filePath = storage.getCurrentFile('gateway')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, 'Bearer eyJhbGciOiJIUzI1NiJ9.abc.def\n', 'utf8')

    const result = await createDiagnosticsBundle({
      userDataPath: root,
      appVersion: '0.1.0',
      storage,
      options: { timeRangeDays: 1, includeSources: ['gateway'] },
      now: () => new Date('2026-05-05T10:05:00.000Z')
    })

    const archive = unzipSync(fs.readFileSync(result.filePath))
    const gatewayLog = strFromU8(archive['logs/gateway/gateway-2026-05-05.log'])

    expect(gatewayLog).toContain('[redacted]')
    expect(gatewayLog).not.toContain('Bearer eyJ')
    expect(result.redactionCount).toBeGreaterThanOrEqual(1)
  })

  test('keeps only the latest diagnostics bundles', async () => {
    const storage = createLogStorage({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })

    for (let index = 0; index < 6; index += 1) {
      await createDiagnosticsBundle({
        userDataPath: root,
        appVersion: '0.1.0',
        storage,
        options: { timeRangeDays: 1 },
        now: () => new Date(`2026-05-05T10:0${index}:00.000Z`)
      })
    }

    const diagnosticsDir = path.join(root, 'logs', 'diagnostics')
    const bundles = fs
      .readdirSync(diagnosticsDir)
      .filter((name) => name.startsWith('petclaw-diagnostics-'))

    expect(bundles).toHaveLength(5)
    expect(bundles).not.toContain('petclaw-diagnostics-20260505T100000.zip')
  })

  test('sanitizes read failure warnings before writing manifest', async () => {
    const storage = {
      getRecentEntries: () => [
        {
          archiveName: 'main/missing.log',
          filePath: path.join(root, 'logs', 'main', 'missing-token=secret-token.log')
        }
      ],
      getCurrentFile: () => path.join(root, 'logs', 'main', 'main-2026-05-05.log'),
      snapshot: () => ({ writable: true, sources: [], errors: [] }),
      write: () => undefined
    } satisfies LogStorage

    const result = await createDiagnosticsBundle({
      userDataPath: root,
      appVersion: '0.1.0',
      storage,
      options: { timeRangeDays: 1, includeSources: ['main'] },
      now: () => new Date('2026-05-05T10:05:00.000Z')
    })

    const archive = unzipSync(fs.readFileSync(result.filePath))
    const manifest = JSON.parse(strFromU8(archive['manifest.json'])) as {
      exportErrors: string[]
    }

    expect(manifest.exportErrors).toHaveLength(1)
    expect(manifest.exportErrors[0]).toContain('{userData}')
    expect(manifest.exportErrors[0]).toContain('[redacted]')
    expect(manifest.exportErrors[0]).not.toContain(root)
    expect(manifest.exportErrors[0]).not.toContain('secret-token')
  })
})
