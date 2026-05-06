import path from 'path'
import { describe, expect, test } from 'vitest'

import { sanitizeLogEvent, sanitizeUnknownForLog } from '../../../src/main/logging/sanitizer'

const userData = path.join('/Users/alice/Library/Application Support/PetClaw')
const workspace = path.join('/Users/alice/work/petclaw')

describe('sanitizeUnknownForLog', () => {
  test('redacts sensitive keys recursively', () => {
    const result = sanitizeUnknownForLog({
      apiKey: 'sk-secret',
      nested: { authorization: 'Bearer abc', value: 'ok' }
    })

    expect(result.value).toEqual({
      apiKey: '[redacted]',
      nested: { authorization: '[redacted]', value: 'ok' }
    })
    expect(result.redactionCount).toBe(2)
  })

  test('redacts sensitive string values', () => {
    const result = sanitizeUnknownForLog({
      header: 'Bearer eyJhbGciOiJIUzI1NiJ9.abc.def',
      tokenValue: 'sk-live-1234567890'
    })

    expect(JSON.stringify(result.value)).not.toContain('Bearer eyJ')
    expect(JSON.stringify(result.value)).not.toContain('sk-live')
    expect(result.redactionCount).toBeGreaterThanOrEqual(2)
  })

  test('normalizes known local paths', () => {
    const result = sanitizeUnknownForLog(
      {
        db: path.join(userData, 'petclaw.db'),
        cwd: path.join(workspace, 'src/main/index.ts')
      },
      { userDataPath: userData, workspacePath: workspace }
    )

    expect(result.value).toEqual({
      db: path.join('{userData}', 'petclaw.db'),
      cwd: path.join('{workspace}', 'src/main/index.ts')
    })
  })

  test('truncates large strings', () => {
    const result = sanitizeUnknownForLog({ value: 'x'.repeat(100) }, { maxChars: 20 })

    expect(JSON.stringify(result.value).length).toBeLessThan(80)
    expect(result.truncated).toBe(true)
  })

  test('handles circular objects', () => {
    const value: Record<string, unknown> = { name: 'root' }
    value.self = value

    const result = sanitizeUnknownForLog(value)

    expect(result.value).toEqual({ name: 'root', self: '[circular]' })
  })
})

describe('sanitizeLogEvent', () => {
  test('preserves error name, message, and stack without raw fields', () => {
    const error = new Error('boom')
    error.stack = `Error: boom\n    at run (${path.join(userData, 'app.js')}:1:1)`

    const event = sanitizeLogEvent(
      {
        level: 'error',
        source: 'main',
        module: 'ConfigSync',
        event: 'sync.failed',
        fields: { token: 'secret-token' },
        error
      },
      {
        appVersion: '0.1.0',
        userDataPath: userData
      }
    )

    expect(event.error?.name).toBe('Error')
    expect(event.error?.message).toBe('boom')
    expect(event.error?.stack).toContain('{userData}')
    expect(JSON.stringify(event.fields)).not.toContain('secret-token')
  })
})
