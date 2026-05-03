import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const nativeAbi = require('../../../scripts/check-native-abi.cjs') as {
  parseNativeAbiFromError: (message: string) => string | null
  decideNativeAbiAction: (input: {
    moduleExists: boolean
    expectedAbi: string
    detectedAbi: string | null
  }) => { shouldRebuild: boolean; reason: string }
}

describe('check-native-abi', () => {
  it('parses NODE_MODULE_VERSION from native module load errors', () => {
    const message = [
      "The module 'better_sqlite3.node'",
      'was compiled against a different Node.js version using',
      'NODE_MODULE_VERSION 145. This version of Node.js requires',
      'NODE_MODULE_VERSION 137.'
    ].join('\n')

    expect(nativeAbi.parseNativeAbiFromError(message)).toBe('145')
  })

  it('skips rebuild when the native module ABI matches Electron ABI', () => {
    expect(
      nativeAbi.decideNativeAbiAction({
        moduleExists: true,
        expectedAbi: '145',
        detectedAbi: '145'
      })
    ).toEqual({ shouldRebuild: false, reason: 'better-sqlite3 ok (abi 145)' })
  })

  it('rebuilds when the native module ABI does not match Electron ABI', () => {
    expect(
      nativeAbi.decideNativeAbiAction({
        moduleExists: true,
        expectedAbi: '145',
        detectedAbi: '137'
      })
    ).toEqual({ shouldRebuild: true, reason: 'native ABI 137 does not match Electron ABI 145' })
  })
})
