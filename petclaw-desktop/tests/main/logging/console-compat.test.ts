import { describe, expect, test } from 'vitest'

import { resolveConsoleCompatLog } from '../../../src/main/logging/console-compat'

describe('resolveConsoleCompatLog', () => {
  test('routes bracket-prefixed console logs to their module', () => {
    expect(resolveConsoleCompatLog(['[Gateway] reconnect failed:', new Error('boom')])).toEqual({
      module: 'Gateway',
      args: ['reconnect failed:', expect.any(Error)]
    })
  })

  test('keeps non-prefixed console logs under the compatibility module', () => {
    expect(resolveConsoleCompatLog(['plain message', { retry: true }])).toEqual({
      module: 'ConsoleCompat',
      args: ['plain message', { retry: true }]
    })
  })

  test('keeps non-string first arguments under the compatibility module', () => {
    expect(resolveConsoleCompatLog([{ module: 'Gateway' }])).toEqual({
      module: 'ConsoleCompat',
      args: [{ module: 'Gateway' }]
    })
  })
})
