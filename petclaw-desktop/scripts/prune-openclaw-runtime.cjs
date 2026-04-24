// scripts/prune-openclaw-runtime.cjs
// 裁剪 runtime 体积：删除未用扩展、stub 大包、清理文件模式

'use strict'

const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'vendor', 'openclaw-runtime', 'current')

if (!fs.existsSync(RUNTIME)) {
  console.log('[prune] Runtime not found, skipping')
  process.exit(0)
}

let totalSaved = 0

// === 1. 移除未使用的 bundled extensions ===

const BUNDLED_EXTENSIONS_TO_KEEP = [
  // Providers
  'anthropic', 'deepseek', 'google', 'openai', 'openrouter',
  'qwen', 'moonshot', 'volcengine', 'kimi-coding',
  // Channels
  'telegram', 'discord', 'feishu', 'qqbot',
  // Core
  'browser', 'memory-core',
  // Media
  'image-generation-core', 'media-understanding-core'
]

const bundledExtDir = path.join(RUNTIME, 'dist', 'extensions')
if (fs.existsSync(bundledExtDir)) {
  const entries = fs.readdirSync(bundledExtDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (BUNDLED_EXTENSIONS_TO_KEEP.includes(entry.name)) continue
    const dirPath = path.join(bundledExtDir, entry.name)
    const size = getDirSize(dirPath)
    fs.rmSync(dirPath, { recursive: true, force: true })
    totalSaved += size
    console.log(`[prune] Removed bundled extension: ${entry.name} (${formatSize(size)})`)
  }
}

// === 2. Stub 大型未使用包 ===

const PACKAGES_TO_STUB = [
  'koffi', '@lancedb', '@jimp', '@napi-rs', 'pdfjs-dist', '@matrix-org'
]

const nodeModules = path.join(RUNTIME, 'node_modules')
if (fs.existsSync(nodeModules)) {
  for (const pkgPattern of PACKAGES_TO_STUB) {
    const pkgDir = path.join(nodeModules, pkgPattern)
    if (!fs.existsSync(pkgDir)) continue

    const size = getDirSize(pkgDir)
    fs.rmSync(pkgDir, { recursive: true, force: true })

    // 创建 stub
    fs.mkdirSync(pkgDir, { recursive: true })
    const stubPkg = { name: pkgPattern, version: '0.0.0-stub', main: 'index.js' }
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(stubPkg))
    fs.writeFileSync(path.join(pkgDir, 'index.js'),
      `module.exports = new Proxy({}, { get: () => { throw new Error('${pkgPattern} is stubbed') } });\n`)

    totalSaved += size
    console.log(`[prune] Stubbed: ${pkgPattern} (${formatSize(size)})`)
  }
}

// === 3. 移除 openclaw SDK 重复 ===

const thirdPartyDir = path.join(RUNTIME, 'third-party-extensions')
if (fs.existsSync(thirdPartyDir)) {
  const entries = fs.readdirSync(thirdPartyDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const sdkDir = path.join(thirdPartyDir, entry.name, 'node_modules', 'openclaw')
    if (fs.existsSync(sdkDir)) {
      const size = getDirSize(sdkDir)
      fs.rmSync(sdkDir, { recursive: true, force: true })
      totalSaved += size
      console.log(`[prune] Removed SDK duplicate in ${entry.name} (${formatSize(size)})`)
    }
  }
}

// === 4. 清理文件模式 ===

const CLEAN_PATTERNS = ['.map', '.d.ts', '.d.cts', '.d.mts']
const CLEAN_FILES = ['README.md', 'readme.md', 'CHANGELOG.md', 'HISTORY.md', 'LICENSE.md', 'LICENSE.txt']
const CLEAN_DIRS = ['test', 'tests', '__tests__', '.github', 'examples', 'coverage', 'docs']

function cleanDir(dir, depth = 0) {
  if (depth > 10) return
  if (!fs.existsSync(dir)) return

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isFile()) {
      const shouldClean = CLEAN_PATTERNS.some(p => entry.name.endsWith(p)) ||
        CLEAN_FILES.includes(entry.name)
      if (shouldClean) {
        const size = fs.statSync(fullPath).size
        fs.unlinkSync(fullPath)
        totalSaved += size
      }
    } else if (entry.isDirectory()) {
      if (CLEAN_DIRS.includes(entry.name)) {
        const size = getDirSize(fullPath)
        fs.rmSync(fullPath, { recursive: true, force: true })
        totalSaved += size
      } else if (entry.name !== '.bin') {
        cleanDir(fullPath, depth + 1)
      }
    }
  }
}

if (fs.existsSync(nodeModules)) {
  cleanDir(nodeModules)
}

console.log(`\n[prune] Total saved: ${formatSize(totalSaved)}`)

// === 工具函数 ===

function getDirSize(dir) {
  let size = 0
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile()) {
        size += fs.statSync(fullPath).size
      } else if (entry.isDirectory()) {
        size += getDirSize(fullPath)
      }
    }
  } catch {
    // ignore
  }
  return size
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}