// scripts/openclaw-runtime-host.cjs
// 检测当前平台架构，运行对应的 openclaw:runtime:<target> 命令

'use strict'

const { execSync } = require('child_process')

const PLATFORM_MAP = { darwin: 'mac', win32: 'win', linux: 'linux' }
const ARCH_MAP = { x64: 'x64', arm64: 'arm64', ia32: 'ia32' }

const platform = PLATFORM_MAP[process.platform]
const arch = ARCH_MAP[process.arch]

if (!platform || !arch) {
  console.error(`Unsupported platform: ${process.platform}-${process.arch}`)
  process.exit(1)
}

const targetId = `${platform}-${arch}`
const script = `openclaw:runtime:${targetId}`

console.log(`[openclaw-runtime-host] Detected platform: ${targetId}`)
console.log(`[openclaw-runtime-host] Running: npm run ${script}`)

try {
  execSync(`npm run ${script}`, { stdio: 'inherit', cwd: __dirname + '/..' })
} catch (err) {
  console.error(`[openclaw-runtime-host] Build failed for ${targetId}`)
  process.exit(1)
}