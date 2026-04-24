// scripts/bundle-openclaw-gateway.cjs
// 将 gateway 入口打包为单文件 gateway-bundle.mjs（esbuild）
// 减少 1000+ ESM 模块冷启动到单文件加载

'use strict'

const path = require('path')
const fs = require('fs')

async function main() {
  const esbuild = require('esbuild')

  const ROOT = path.resolve(__dirname, '..')
  const RUNTIME = path.join(ROOT, 'vendor', 'openclaw-runtime', 'current')

  if (!fs.existsSync(RUNTIME)) {
    console.error('[bundle-gateway] Runtime not found at vendor/openclaw-runtime/current/')
    console.error('[bundle-gateway] Run openclaw:runtime:host first')
    process.exit(1)
  }

  // 查找入口文件
  const entryCandidates = [
    'dist/gateway-entry.js',
    'dist/gateway-entry.mjs',
    'dist/entry.js',
    'dist/entry.mjs'
  ]
  let entryFile = null
  for (const candidate of entryCandidates) {
    const fullPath = path.join(RUNTIME, candidate)
    if (fs.existsSync(fullPath)) {
      entryFile = fullPath
      break
    }
  }

  if (!entryFile) {
    // 尝试 openclaw.mjs 作为入口
    const oclawEntry = path.join(RUNTIME, 'openclaw.mjs')
    if (fs.existsSync(oclawEntry)) {
      entryFile = oclawEntry
    }
  }

  if (!entryFile) {
    console.error('[bundle-gateway] No gateway entry found')
    process.exit(1)
  }

  const outFile = path.join(RUNTIME, 'gateway-bundle.mjs')

  // 跳过检查：如果 bundle 比入口文件新，则跳过
  if (fs.existsSync(outFile)) {
    const bundleStat = fs.statSync(outFile)
    const entryStat = fs.statSync(entryFile)
    if (bundleStat.mtimeMs > entryStat.mtimeMs && process.env.OPENCLAW_FORCE_BUILD !== '1') {
      console.log('[bundle-gateway] gateway-bundle.mjs is up-to-date, skipping')
      return
    }
  }

  console.log(`[bundle-gateway] Bundling ${path.relative(RUNTIME, entryFile)} → gateway-bundle.mjs`)

  // 不打包进 bundle 的模块（原生模块、大型可选依赖）
  const external = [
    'sharp', '@img/*', '@lydell/*', '@mariozechner/*', '@napi-rs/*', '@snazzah/*',
    'koffi', 'electron', 'node-llama-cpp', 'ffmpeg-static',
    'chromium-bidi', 'playwright*', 'better-sqlite3', 'jiti'
  ]

  const startTime = Date.now()

  await esbuild.build({
    entryPoints: [entryFile],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    minify: true,
    treeShaking: true,
    external,
    // 注入 CJS 兼容（__filename/__dirname/require）
    banner: {
      js: [
        'import { createRequire as __petclaw_createRequire } from "module";',
        'import { fileURLToPath as __petclaw_fileURLToPath } from "url";',
        'import { dirname as __petclaw_dirname } from "path";',
        'const require = __petclaw_createRequire(import.meta.url);',
        'const __filename = __petclaw_fileURLToPath(import.meta.url);',
        'const __dirname = __petclaw_dirname(__filename);'
      ].join('\n')
    },
    logLevel: 'warning'
  })

  const stats = fs.statSync(outFile)
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1)
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log(`[bundle-gateway] Done: ${sizeMB} MB in ${elapsed}s`)
}

main().catch(err => {
  console.error('[bundle-gateway] Failed:', err.message)
  process.exit(1)
})