// scripts/sync-local-openclaw-extensions.cjs
// 复制 openclaw-extensions/ 下所有子目录到 runtime 的 third-party-extensions/

'use strict'

const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const EXTENSIONS_SRC = path.join(ROOT, 'openclaw-extensions')
const runtimeRoot = process.argv[2] || path.join(ROOT, 'vendor', 'openclaw-runtime', 'current')
const EXTENSIONS_DEST = path.join(runtimeRoot, 'third-party-extensions')

function syncLocalOpenClawExtensions(destRoot) {
  const dest = destRoot ? path.join(destRoot, 'third-party-extensions') : EXTENSIONS_DEST

  if (!fs.existsSync(EXTENSIONS_SRC)) {
    console.log('[sync-extensions] No openclaw-extensions/ directory, skipping')
    return
  }

  fs.mkdirSync(dest, { recursive: true })

  const entries = fs.readdirSync(EXTENSIONS_SRC, { withFileTypes: true })
  let count = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const src = path.join(EXTENSIONS_SRC, entry.name)
    const target = path.join(dest, entry.name)

    fs.rmSync(target, { recursive: true, force: true })
    fs.cpSync(src, target, { recursive: true })
    count++
    console.log(`[sync-extensions] ${entry.name} → ${path.relative(ROOT, target)}`)
  }

  console.log(`[sync-extensions] Synced ${count} local extension(s)`)
}

// 导出供 electron-builder-hooks.cjs 使用
module.exports = { syncLocalOpenClawExtensions }

// 直接运行时执行
if (require.main === module) {
  syncLocalOpenClawExtensions()
}