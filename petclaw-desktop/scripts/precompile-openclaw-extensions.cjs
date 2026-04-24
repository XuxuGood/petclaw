// scripts/precompile-openclaw-extensions.cjs
// 使用 esbuild 预编译 TS 扩展为 JS，消除 jiti 运行时编译开销

'use strict'

const path = require('path')
const fs = require('fs')

async function precompileExtensions(runtimeRoot) {
  const esbuild = require('esbuild')

  const root = runtimeRoot || path.join(__dirname, '..', 'vendor', 'openclaw-runtime', 'current')
  const extDir = path.join(root, 'third-party-extensions')

  if (!fs.existsSync(extDir)) {
    console.log('[precompile] No third-party-extensions/ directory, skipping')
    return
  }

  const entries = fs.readdirSync(extDir, { withFileTypes: true })
  let compiled = 0
  let skipped = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const pluginDir = path.join(extDir, entry.name)
    const pkgPath = path.join(pluginDir, 'package.json')

    if (!fs.existsSync(pkgPath)) {
      skipped++
      continue
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const extensions = pkg.openclaw?.extensions || []

    for (const ext of extensions) {
      if (!ext.endsWith('.ts')) {
        skipped++
        continue
      }

      const tsFile = path.join(pluginDir, ext)
      if (!fs.existsSync(tsFile)) {
        console.warn(`[precompile] ${entry.name}: ${ext} not found, skipping`)
        skipped++
        continue
      }

      const jsFile = tsFile.replace(/\.ts$/, '.js')

      try {
        await esbuild.build({
          entryPoints: [tsFile],
          outfile: jsFile,
          bundle: true,
          format: 'cjs',
          platform: 'node',
          packages: 'external',
          external: ['openclaw/plugin-sdk', 'clawdbot/plugin-sdk'],
          logLevel: 'warning'
        })

        // 更新 package.json 中的入口
        const idx = extensions.indexOf(ext)
        extensions[idx] = ext.replace(/\.ts$/, '.js')
        pkg.openclaw.extensions = extensions
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

        compiled++
        console.log(`[precompile] ${entry.name}/${ext} → ${path.basename(jsFile)}`)
      } catch (err) {
        console.warn(`[precompile] ${entry.name}/${ext} failed (will use jiti fallback): ${err.message}`)
      }
    }
  }

  console.log(`[precompile] Done: ${compiled} compiled, ${skipped} skipped`)
}

module.exports = { precompileExtensions }

if (require.main === module) {
  precompileExtensions().catch(err => {
    console.error('[precompile] Failed:', err.message)
    process.exit(1)
  })
}