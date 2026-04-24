// scripts/install-openclaw-channel-deps.cjs
// 临时修复：安装 channel 缺失的 bare specifier 依赖
// Openclaw v2026.4.5-v2026.4.8 打包 bug 导致 dist chunks 引用了 channel 内部依赖
// 此脚本在升级到修复版本后可移除

'use strict'

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'vendor', 'openclaw-runtime', 'current')

if (!fs.existsSync(RUNTIME)) {
  console.log('[channel-deps] Runtime not found, skipping')
  process.exit(0)
}

// 需要补装的依赖列表
const DEPS = [
  '@buape/carbon',
  '@larksuiteoapi/node-sdk',
  'grammy',
  '@grammyjs/runner',
  '@grammyjs/transformer-throttler'
]

// 检查哪些依赖缺失
const missing = DEPS.filter(dep => {
  const depDir = path.join(RUNTIME, 'node_modules', dep)
  return !fs.existsSync(depDir)
})

if (missing.length === 0) {
  console.log('[channel-deps] All channel dependencies present')
  process.exit(0)
}

console.log(`[channel-deps] Installing ${missing.length} missing deps: ${missing.join(', ')}`)

try {
  execSync(`npm install ${missing.join(' ')} --no-save --legacy-peer-deps`, {
    cwd: RUNTIME,
    stdio: 'inherit',
    env: { ...process.env, npm_config_legacy_peer_deps: 'true' }
  })
  console.log('[channel-deps] Done')
} catch (err) {
  console.warn(`[channel-deps] Some deps failed (non-fatal): ${err.message}`)
}