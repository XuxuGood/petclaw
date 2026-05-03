/**
 * 检查 better-sqlite3 native 模块 ABI 是否匹配当前 Electron 版本。
 * 不匹配时自动执行 electron-rebuild，匹配则秒过。
 */
'use strict'

const { createRequire } = require('module')
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const nativeModule = path.join(
  projectRoot,
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node'
)

function parseNativeAbiFromError(message) {
  const match = message.match(/NODE_MODULE_VERSION\s+(\d+)/)
  return match ? match[1] : null
}

function decideNativeAbiAction(input) {
  if (!input.moduleExists) {
    return { shouldRebuild: true, reason: 'native module missing' }
  }

  if (!input.detectedAbi) {
    return { shouldRebuild: true, reason: `unable to detect native ABI for Electron ABI ${input.expectedAbi}` }
  }

  if (input.detectedAbi !== input.expectedAbi) {
    return {
      shouldRebuild: true,
      reason: `native ABI ${input.detectedAbi} does not match Electron ABI ${input.expectedAbi}`
    }
  }

  return { shouldRebuild: false, reason: `better-sqlite3 ok (abi ${input.expectedAbi})` }
}

function readElectronVersion(rootDir) {
  const electronPkg = path.join(rootDir, 'node_modules', 'electron', 'package.json')
  return JSON.parse(fs.readFileSync(electronPkg, 'utf8')).version
}

function resolveElectronAbi(rootDir, electronVersion) {
  // node-abi 是 @electron/rebuild 的传递依赖；复用它避免启动 Electron 进程拖慢 dev:openclaw。
  const rebuildMain = require.resolve('@electron/rebuild', { paths: [rootDir] })
  const rebuildRequire = createRequire(rebuildMain)
  return rebuildRequire('node-abi').getAbi(electronVersion, 'electron')
}

function detectNativeAbi(modulePath) {
  if (!fs.existsSync(modulePath)) {
    return null
  }

  try {
    require(modulePath)
    return process.versions.modules
  } catch (error) {
    if (error instanceof Error) {
      return parseNativeAbiFromError(error.message)
    }
    return null
  }
}

function runElectronRebuild(rootDir) {
  const rebuildBin = path.join(
    rootDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild'
  )
  const result = spawnSync(rebuildBin, ['-f', '-w', 'better-sqlite3'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`electron-rebuild exited with status ${result.status}`)
  }
}

function main() {
  const electronVersion = readElectronVersion(projectRoot)
  const expectedAbi = resolveElectronAbi(projectRoot, electronVersion)
  const moduleExists = fs.existsSync(nativeModule)
  const detectedAbi = detectNativeAbi(nativeModule)
  const action = decideNativeAbiAction({ moduleExists, expectedAbi, detectedAbi })

  if (!action.shouldRebuild) {
    console.log(`[native-abi] ${action.reason}`)
    return
  }

  console.log(`[native-abi] ${action.reason}, rebuilding better-sqlite3...`)
  runElectronRebuild(projectRoot)
  console.log('[native-abi] rebuild complete')
}

if (require.main === module) {
  main()
}

module.exports = {
  parseNativeAbiFromError,
  decideNativeAbiAction,
  detectNativeAbi,
  resolveElectronAbi
}
