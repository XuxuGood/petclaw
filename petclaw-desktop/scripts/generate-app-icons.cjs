'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { validateAppIcons } = require('./check-app-icons.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourceIcon = path.join(projectRoot, 'resources', 'icon.png')
const iconRoot = path.join(projectRoot, 'build', 'icons')
const pngDir = path.join(iconRoot, 'png')
const macDir = path.join(iconRoot, 'mac')
const winDir = path.join(iconRoot, 'win')
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icnsEntries = [
  { size: 16, type: 'icp4' },
  { size: 32, type: 'icp5' },
  { size: 64, type: 'icp6' },
  { size: 128, type: 'ic07' },
  { size: 256, type: 'ic08' },
  { size: 512, type: 'ic09' },
  { size: 1024, type: 'ic10' }
]

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`)
  }
}

function ensureMacIconTools() {
  for (const command of ['sips']) {
    const result = spawnSync('which', [command], {
      stdio: 'ignore'
    })
    if (result.status !== 0) {
      throw new Error(`Missing ${command}; app icon generation currently requires macOS icon tools.`)
    }
  }
}

function resizePng(size, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  run('sips', ['-z', String(size), String(size), sourceIcon, '--out', outputPath])
}

function generatePngSet() {
  fs.mkdirSync(pngDir, { recursive: true })
  for (const size of pngSizes) {
    resizePng(size, path.join(pngDir, `${size}x${size}.png`))
  }
}

function buildIcnsBuffer(entries) {
  const chunks = entries.map((entry) => {
    const data = fs.readFileSync(path.join(pngDir, `${entry.size}x${entry.size}.png`))
    const header = Buffer.alloc(8)
    header.write(entry.type, 0, 4, 'ascii')
    header.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([header, data])
  })
  const totalLength = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(totalLength, 4)
  return Buffer.concat([header, ...chunks], totalLength)
}

function generateMacIcon() {
  fs.mkdirSync(macDir, { recursive: true })
  fs.writeFileSync(path.join(macDir, 'icon.icns'), buildIcnsBuffer(icnsEntries))
}

function buildIcoBuffer(entries) {
  const headerSize = 6
  const entrySize = 16
  const dataOffset = headerSize + entries.length * entrySize
  let currentOffset = dataOffset

  const withOffsets = entries.map((entry) => {
    const next = { ...entry, offset: currentOffset }
    currentOffset += entry.data.length
    return next
  })

  const ico = Buffer.alloc(currentOffset)
  ico.writeUInt16LE(0, 0)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(withOffsets.length, 4)

  for (const [index, entry] of withOffsets.entries()) {
    const offset = headerSize + index * entrySize
    ico.writeUInt8(entry.size >= 256 ? 0 : entry.size, offset)
    ico.writeUInt8(entry.size >= 256 ? 0 : entry.size, offset + 1)
    ico.writeUInt8(0, offset + 2)
    ico.writeUInt8(0, offset + 3)
    ico.writeUInt16LE(1, offset + 4)
    ico.writeUInt16LE(32, offset + 6)
    ico.writeUInt32LE(entry.data.length, offset + 8)
    ico.writeUInt32LE(entry.offset, offset + 12)
    entry.data.copy(ico, entry.offset)
  }

  return ico
}

function generateWindowsIcon() {
  fs.mkdirSync(winDir, { recursive: true })
  const entries = icoSizes.map((size) => ({
    size,
    data: fs.readFileSync(path.join(pngDir, `${size}x${size}.png`))
  }))
  fs.writeFileSync(path.join(winDir, 'icon.ico'), buildIcoBuffer(entries))
}

function main() {
  if (!fs.existsSync(sourceIcon)) {
    throw new Error(`Missing source icon: ${sourceIcon}`)
  }

  ensureMacIconTools()
  generatePngSet()
  generateMacIcon()
  generateWindowsIcon()

  const issues = validateAppIcons(projectRoot)
  if (issues.length > 0) {
    throw new Error(`Generated icon set failed validation:\n${issues.map((issue) => `- ${issue}`).join('\n')}`)
  }

  console.log('[app-icons] generated build/icons for macOS, Windows, and Linux')
}

if (require.main === module) {
  main()
}
