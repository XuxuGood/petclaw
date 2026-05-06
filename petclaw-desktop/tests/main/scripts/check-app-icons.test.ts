import { createRequire } from 'module'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const iconCheck = require('../../../scripts/check-app-icons.cjs') as {
  readPngSize: (filePath: string) => { width: number; height: number }
  parseIcoSizes: (filePath: string) => Array<{ width: number; height: number }>
  validateAppIcons: (rootDir: string) => string[]
}

const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const tempRoots: string[] = []

function createTempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'petclaw-icons-'))
  tempRoots.push(root)
  return root
}

function writePngHeader(filePath: string, width: number, height: number): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  writeFileSync(filePath, buffer)
}

function writeIcoHeader(filePath: string, sizes: number[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const buffer = Buffer.alloc(6 + sizes.length * 16)
  buffer.writeUInt16LE(0, 0)
  buffer.writeUInt16LE(1, 2)
  buffer.writeUInt16LE(sizes.length, 4)

  for (const [index, size] of sizes.entries()) {
    const offset = 6 + index * 16
    buffer.writeUInt8(size === 256 ? 0 : size, offset)
    buffer.writeUInt8(size === 256 ? 0 : size, offset + 1)
    buffer.writeUInt8(0, offset + 2)
    buffer.writeUInt8(0, offset + 3)
  }

  writeFileSync(filePath, buffer)
}

function writeCompleteIconSet(root: string): void {
  writePngHeader(path.join(root, 'resources', 'icon.png'), 1024, 1024)
  const macIcon = path.join(root, 'build', 'icons', 'mac', 'icon.icns')
  mkdirSync(path.dirname(macIcon), { recursive: true })
  writeFileSync(macIcon, Buffer.from('icns'))
  for (const size of pngSizes) {
    writePngHeader(path.join(root, 'build', 'icons', 'png', `${size}x${size}.png`), size, size)
  }
  writeIcoHeader(path.join(root, 'build', 'icons', 'win', 'icon.ico'), icoSizes)
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('check-app-icons', () => {
  it('reads PNG dimensions from the IHDR header', () => {
    const root = createTempRoot()
    const filePath = path.join(root, 'icon.png')
    writePngHeader(filePath, 512, 256)

    expect(iconCheck.readPngSize(filePath)).toEqual({ width: 512, height: 256 })
  })

  it('reads embedded icon sizes from ICO entries', () => {
    const root = createTempRoot()
    const filePath = path.join(root, 'icon.ico')
    writeIcoHeader(filePath, [16, 32, 256])

    expect(iconCheck.parseIcoSizes(filePath)).toEqual([
      { width: 16, height: 16 },
      { width: 32, height: 32 },
      { width: 256, height: 256 }
    ])
  })

  it('accepts the complete platform icon asset set', () => {
    const root = createTempRoot()
    writeCompleteIconSet(root)

    expect(iconCheck.validateAppIcons(root)).toEqual([])
  })

  it('reports missing platform icon assets before packaging', () => {
    const root = createTempRoot()
    writePngHeader(path.join(root, 'resources', 'icon.png'), 1024, 1024)

    expect(iconCheck.validateAppIcons(root)).toEqual(
      expect.arrayContaining([
        'missing build/icons/mac/icon.icns',
        'missing build/icons/win/icon.ico',
        'missing build/icons/png/16x16.png'
      ])
    )
  })
})
