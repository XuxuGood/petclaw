'use strict'

const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function relative(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/')
}

function existsFile(filePath) {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function readPngSize(filePath) {
  const buffer = fs.readFileSync(filePath)
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(pngSignature)) {
    throw new Error(`invalid PNG: ${filePath}`)
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`invalid PNG IHDR: ${filePath}`)
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  }
}

function parseIcoSizes(filePath) {
  const buffer = fs.readFileSync(filePath)
  if (buffer.length < 6) {
    throw new Error(`invalid ICO: ${filePath}`)
  }
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error(`invalid ICO header: ${filePath}`)
  }

  const count = buffer.readUInt16LE(4)
  const expectedHeaderSize = 6 + count * 16
  if (buffer.length < expectedHeaderSize) {
    throw new Error(`truncated ICO directory: ${filePath}`)
  }

  const sizes = []
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16
    const width = buffer.readUInt8(offset) || 256
    const height = buffer.readUInt8(offset + 1) || 256
    sizes.push({ width, height })
  }
  return sizes
}

function validatePng(rootDir, filePath, size, issues) {
  if (!existsFile(filePath)) {
    issues.push(`missing ${relative(rootDir, filePath)}`)
    return
  }

  try {
    const actual = readPngSize(filePath)
    if (actual.width !== size || actual.height !== size) {
      issues.push(
        `${relative(rootDir, filePath)} must be ${size}x${size}, got ${actual.width}x${actual.height}`
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    issues.push(`${relative(rootDir, filePath)} is not a valid PNG: ${message}`)
  }
}

function validateAppIcons(rootDir = projectRoot) {
  const issues = []
  const sourceIcon = path.join(rootDir, 'resources', 'icon.png')
  const macIcon = path.join(rootDir, 'build', 'icons', 'mac', 'icon.icns')
  const winIcon = path.join(rootDir, 'build', 'icons', 'win', 'icon.ico')
  const pngDir = path.join(rootDir, 'build', 'icons', 'png')

  validatePng(rootDir, sourceIcon, 1024, issues)

  if (!existsFile(macIcon)) {
    issues.push(`missing ${relative(rootDir, macIcon)}`)
  } else if (fs.statSync(macIcon).size === 0) {
    issues.push(`${relative(rootDir, macIcon)} is empty`)
  }

  if (!existsFile(winIcon)) {
    issues.push(`missing ${relative(rootDir, winIcon)}`)
  } else {
    try {
      const actualSizes = parseIcoSizes(winIcon)
      for (const size of icoSizes) {
        if (!actualSizes.some((entry) => entry.width === size && entry.height === size)) {
          issues.push(`${relative(rootDir, winIcon)} missing ${size}x${size} entry`)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      issues.push(`${relative(rootDir, winIcon)} is not a valid ICO: ${message}`)
    }
  }

  for (const size of pngSizes) {
    validatePng(rootDir, path.join(pngDir, `${size}x${size}.png`), size, issues)
  }

  return issues
}

function main() {
  const issues = validateAppIcons(projectRoot)
  if (issues.length === 0) {
    console.log('[app-icons] all platform icon assets are present')
    return
  }

  console.error('[app-icons] platform icon assets are incomplete:')
  for (const issue of issues) {
    console.error(`- ${issue}`)
  }
  console.error('\nRun `pnpm --filter petclaw-desktop assets:icons` after changing resources/icon.png.')
  process.exit(1)
}

if (require.main === module) {
  main()
}

module.exports = {
  readPngSize,
  parseIcoSizes,
  validateAppIcons
}
