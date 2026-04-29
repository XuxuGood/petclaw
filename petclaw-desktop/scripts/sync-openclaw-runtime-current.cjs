// scripts/sync-openclaw-runtime-current.cjs
// 将指定平台的 runtime 目录 symlink/junction 到 current/
// 用法: node scripts/sync-openclaw-runtime-current.cjs <targetId>
// 不传参数时自动检测当前平台

'use strict'

const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME_BASE = path.join(ROOT, 'vendor', 'openclaw-runtime')
const CURRENT = path.join(RUNTIME_BASE, 'current')

// 检测或使用传入的 targetId
let targetId = process.argv[2]
if (!targetId) {
  const platformMap = { darwin: 'mac', win32: 'win', linux: 'linux' }
  const platform = platformMap[process.platform]
  const arch = process.arch
  targetId = `${platform}-${arch}`
}

const targetDir = path.join(RUNTIME_BASE, targetId)

if (!fs.existsSync(targetDir)) {
  console.error(`[sync-current] Target not found: ${targetDir}`)
  console.error(`[sync-current] Run 'npm run openclaw:runtime:${targetId}' first`)
  process.exit(1)
}

// 移除旧链接
try {
  const stat = fs.lstatSync(CURRENT)
  if (stat.isSymbolicLink() || stat.isDirectory()) {
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(CURRENT)
    } else {
      // Windows junction or real directory
      fs.rmSync(CURRENT, { recursive: true, force: true })
    }
  }
} catch {
  // 不存在，忽略
}

// 创建链接
if (process.platform === 'win32') {
  // Windows: 使用 junction（不需要管理员权限）
  fs.symlinkSync(targetDir, CURRENT, 'junction')
} else {
  // Unix: 使用相对 symlink
  const relPath = path.relative(path.dirname(CURRENT), targetDir)
  fs.symlinkSync(relPath, CURRENT)
}

// 验证
const resolved = fs.realpathSync(CURRENT)
console.log(`[sync-current] ${CURRENT} → ${resolved}`)

// 从 gateway.asar 提取入口文件（openclaw.mjs + dist/）。
// 构建时这些文件被打包进 asar 后从磁盘删除，
// 但插件安装（openclaw CLI）和 Electron utilityProcess.fork() 需要真实文件。
const gatewayAsarPath = path.join(CURRENT, 'gateway.asar')
const bareEntryPath = path.join(CURRENT, 'openclaw.mjs')
if (fs.existsSync(gatewayAsarPath) && !fs.existsSync(bareEntryPath)) {
  try {
    const asar = require('@electron/asar')
    const entries = asar.listPackage(gatewayAsarPath)
    const toExtract = entries.filter(function (e) {
      const normalized = e.replace(/\\/g, '/')
      return normalized === '/openclaw.mjs' || normalized.startsWith('/dist/')
    })

    let extracted = 0
    for (const entry of toExtract) {
      const normalized = entry.replace(/\\/g, '/').replace(/^\//, '')
      const destPath = path.join(CURRENT, normalized)
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      const asarEntry = entry.replace(/^[/\\]/, '')
      try {
        const content = asar.extractFile(gatewayAsarPath, asarEntry)
        fs.writeFileSync(destPath, content)
        extracted++
      } catch {
        // 目录条目，跳过
      }
    }

    console.log(`[sync-current] Extracted ${extracted}/${toExtract.length} entry files from gateway.asar`)
  } catch (err) {
    console.warn(`[sync-current] Could not extract from gateway.asar: ${err.message}`)
  }
}