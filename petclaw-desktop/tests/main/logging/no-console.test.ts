import fs from 'fs'
import path from 'path'
import { describe, expect, test } from 'vitest'

const SRC_ROOT = path.resolve(__dirname, '../../../src')
const CONSOLE_PATTERN = /\bconsole\.(log|warn|error|info|debug)\b/

function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(entryPath)
    return /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : []
  })
}

describe('production source logging', () => {
  test('does not use console.* in desktop src', () => {
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((filePath) => CONSOLE_PATTERN.test(fs.readFileSync(filePath, 'utf8')))
      .map((filePath) => path.relative(SRC_ROOT, filePath))

    expect(offenders).toEqual([])
  })
})
