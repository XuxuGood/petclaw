// scripts/run-build-openclaw-runtime.cjs
// 跨平台启动 build-openclaw-runtime.sh
// 用法: node scripts/run-build-openclaw-runtime.cjs --target=mac-arm64

'use strict'

const path = require('path')
const { spawnSync, execSync } = require('child_process')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')

// 解析 --target 参数
let targetId = null
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--target=')) {
    targetId = arg.split('=')[1]
  }
}
if (!targetId) {
  console.error('Usage: node run-build-openclaw-runtime.cjs --target=<mac-arm64|mac-x64|win-x64|linux-x64>')
  process.exit(1)
}

const scriptPath = path.join(__dirname, 'build-openclaw-runtime.sh')
if (!fs.existsSync(scriptPath)) {
  console.error(`[run-build] build-openclaw-runtime.sh not found at ${scriptPath}`)
  process.exit(1)
}

// 查找 bash
let bashPath = 'bash'
if (process.platform === 'win32') {
  // Windows: 避免使用 WSL 的 bash，优先使用 Git Bash
  const gitBashCandidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
  ]
  for (const candidate of gitBashCandidates) {
    if (fs.existsSync(candidate)) {
      bashPath = candidate
      break
    }
  }
} else {
  try {
    bashPath = execSync('which bash', { encoding: 'utf8' }).trim()
  } catch {
    // 使用默认 'bash'
  }
}

console.log(`[run-build] bash: ${bashPath}`)
console.log(`[run-build] target: ${targetId}`)

// 构建环境变量
const env = { ...process.env }
if (process.platform === 'win32') {
  // Windows: 确保 Node.js 在 PATH 中
  const nodeDir = path.dirname(process.execPath)
  env.PATH = `${nodeDir};${env.PATH || env.Path || ''}`
}

const result = spawnSync(bashPath, [scriptPath, targetId], {
  cwd: ROOT,
  stdio: 'inherit',
  env
})

if (result.status !== 0) {
  console.error(`[run-build] Build failed with exit code ${result.status}`)
  process.exit(result.status || 1)
}