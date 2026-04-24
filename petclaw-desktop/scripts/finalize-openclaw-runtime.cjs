// scripts/finalize-openclaw-runtime.cjs
// 开发模式下重新打包 gateway.asar（修改 dist/ 后调用）

'use strict'

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'vendor', 'openclaw-runtime', 'current')

if (!fs.existsSync(RUNTIME)) {
  console.log('[finalize] Runtime not found, skipping')
  process.exit(0)
}

const gatewayAsar = path.join(RUNTIME, 'gateway.asar')
const oclawMjs = path.join(RUNTIME, 'openclaw.mjs')
const distDir = path.join(RUNTIME, 'dist')

// 如果已经有 gateway.asar 并且 openclaw.mjs 不在外面，说明已打包
if (fs.existsSync(gatewayAsar) && !fs.existsSync(oclawMjs)) {
  console.log('[finalize] gateway.asar already packed, nothing to do')
  console.log('[finalize] Delete gateway.asar to rebuild')
  process.exit(0)
}

if (!fs.existsSync(oclawMjs) || !fs.existsSync(distDir)) {
  console.log('[finalize] openclaw.mjs or dist/ not found, nothing to pack')
  process.exit(0)
}

// 创建 asar 打包临时目录
const tmpDir = path.join(RUNTIME, '.asar-stage')
fs.rmSync(tmpDir, { recursive: true, force: true })
fs.mkdirSync(tmpDir, { recursive: true })

// 复制入口和 dist（排除 extensions）
fs.copyFileSync(oclawMjs, path.join(tmpDir, 'openclaw.mjs'))
fs.cpSync(distDir, path.join(tmpDir, 'dist'), { recursive: true })
fs.rmSync(path.join(tmpDir, 'dist', 'extensions'), { recursive: true, force: true })

// 打包
execSync(`npx asar pack "${tmpDir}" "${gatewayAsar}"`, { stdio: 'inherit', cwd: ROOT })

// 清理
fs.rmSync(tmpDir, { recursive: true, force: true })
fs.unlinkSync(oclawMjs)

// 保留 dist/extensions 和 dist/control-ui
const distEntries = fs.readdirSync(distDir, { withFileTypes: true })
for (const entry of distEntries) {
  if (entry.name !== 'extensions' && entry.name !== 'control-ui') {
    fs.rmSync(path.join(distDir, entry.name), { recursive: true, force: true })
  }
}

console.log('[finalize] gateway.asar repacked')