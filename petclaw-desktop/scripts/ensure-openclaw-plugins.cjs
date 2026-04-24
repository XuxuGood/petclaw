// scripts/ensure-openclaw-plugins.cjs
// 从 npm registry 安装 package.json#openclaw.plugins 声明的第三方插件
// 安装到 vendor/openclaw-runtime/current/third-party-extensions/

'use strict'

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const plugins = pkg.openclaw?.plugins || []

if (plugins.length === 0) {
  console.log('[ensure-plugins] No plugins declared, skipping')
  process.exit(0)
}

if (process.env.OPENCLAW_SKIP_PLUGINS === '1') {
  console.log('[ensure-plugins] OPENCLAW_SKIP_PLUGINS=1, skipping')
  process.exit(0)
}

const RUNTIME = path.join(ROOT, 'vendor', 'openclaw-runtime', 'current')
if (!fs.existsSync(RUNTIME)) {
  console.error('[ensure-plugins] Runtime not found at vendor/openclaw-runtime/current/')
  process.exit(1)
}

const EXTENSIONS_DIR = path.join(RUNTIME, 'third-party-extensions')
const CACHE_DIR = path.join(ROOT, 'vendor', 'openclaw-plugins')
fs.mkdirSync(EXTENSIONS_DIR, { recursive: true })
fs.mkdirSync(CACHE_DIR, { recursive: true })

for (const plugin of plugins) {
  const pluginDir = path.join(EXTENSIONS_DIR, plugin.id)
  const cacheKey = `${plugin.id}@${plugin.version}`
  const cacheDir = path.join(CACHE_DIR, plugin.id)
  const cacheMarker = path.join(cacheDir, '.version')

  // 检查缓存
  if (fs.existsSync(cacheMarker)) {
    const cachedVersion = fs.readFileSync(cacheMarker, 'utf8').trim()
    if (cachedVersion === cacheKey) {
      if (!fs.existsSync(pluginDir)) {
        fs.cpSync(cacheDir, pluginDir, { recursive: true })
        console.log(`[ensure-plugins] ${plugin.id}@${plugin.version} (cached)`)
      } else {
        console.log(`[ensure-plugins] ${plugin.id}@${plugin.version} (already installed)`)
      }
      continue
    }
  }

  console.log(`[ensure-plugins] Installing ${plugin.id}@${plugin.version}...`)

  const npmSpec = `${plugin.npm}@${plugin.version}`
  const stagingDir = path.join(ROOT, 'vendor', 'openclaw-plugins', '.staging', plugin.id)
  fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })

  try {
    const registryArgs = plugin.registry ? `--registry ${plugin.registry}` : ''
    execSync(`npm install ${npmSpec} ${registryArgs} --legacy-peer-deps --no-save`, {
      cwd: stagingDir,
      stdio: 'inherit',
      env: { ...process.env, npm_config_legacy_peer_deps: 'true' }
    })

    // 将安装结果复制到目标
    const installedDir = path.join(stagingDir, 'node_modules', plugin.npm.startsWith('@') ? plugin.npm : plugin.npm)
    if (fs.existsSync(installedDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true })
      fs.cpSync(installedDir, pluginDir, { recursive: true })
    } else {
      fs.rmSync(pluginDir, { recursive: true, force: true })
      fs.cpSync(stagingDir, pluginDir, { recursive: true })
    }

    // 写入缓存
    fs.rmSync(cacheDir, { recursive: true, force: true })
    fs.cpSync(pluginDir, cacheDir, { recursive: true })
    fs.writeFileSync(cacheMarker, cacheKey)

    console.log(`[ensure-plugins] ${plugin.id}@${plugin.version} installed`)
  } catch (err) {
    if (plugin.optional) {
      console.warn(`[ensure-plugins] Optional plugin ${plugin.id} failed, skipping: ${err.message}`)
    } else {
      console.error(`[ensure-plugins] Failed to install ${plugin.id}: ${err.message}`)
      process.exit(1)
    }
  }

  fs.rmSync(stagingDir, { recursive: true, force: true })
}

fs.rmSync(path.join(ROOT, 'vendor', 'openclaw-plugins', '.staging'), { recursive: true, force: true })
console.log(`[ensure-plugins] All ${plugins.length} plugins ready`)