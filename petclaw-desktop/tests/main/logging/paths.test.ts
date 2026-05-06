import path from 'path'
import { describe, expect, test } from 'vitest'

import { getLogFileNameForDate, resolveLoggingPaths } from '../../../src/main/logging/paths'

const root = path.join('Users', 'alice', 'Library', 'Application Support', 'PetClaw')

describe('resolveLoggingPaths', () => {
  test('derives all log directories from userData', () => {
    const paths = resolveLoggingPaths(root)

    expect(paths.root).toBe(path.join(root, 'logs'))
    expect(paths.sources.main.dir).toBe(path.join(root, 'logs', 'main'))
    expect(paths.sources.renderer.dir).toBe(path.join(root, 'logs', 'renderer'))
    expect(paths.sources.startup.dir).toBe(path.join(root, 'logs', 'startup'))
    expect(paths.sources.cowork.dir).toBe(path.join(root, 'logs', 'cowork'))
    expect(paths.sources.mcp.dir).toBe(path.join(root, 'logs', 'mcp'))
    expect(paths.sources.updater.dir).toBe(path.join(root, 'logs', 'updater'))
    expect(paths.sources.installer.dir).toBe(path.join(root, 'logs', 'installer'))
    expect(paths.sources.gateway.dir).toBe(path.join(root, 'openclaw', 'logs', 'gateway'))
    expect(paths.sources.runtime.dir).toBe(path.join(root, 'openclaw', 'logs', 'runtime'))
    expect(paths.diagnostics.dir).toBe(path.join(root, 'logs', 'diagnostics'))
  })

  test('builds stable daily log filenames', () => {
    const date = new Date('2026-05-05T08:15:00.000Z')

    expect(getLogFileNameForDate('main', date)).toBe('main-2026-05-05.log')
    expect(getLogFileNameForDate('renderer', date)).toBe('renderer-2026-05-05.log')
    expect(getLogFileNameForDate('startup', date)).toBe('startup-diagnostics.jsonl')
    expect(getLogFileNameForDate('installer', date)).toBe('installer.log')
  })
})
