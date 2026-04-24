// scripts/pack-openclaw-tar.cjs
// Windows NSIS 优化：将 runtime + SKILLs 打包为单个 tar 加速安装解压
// 用法: node scripts/pack-openclaw-tar.cjs --win-combined

'use strict'

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')

function packSingleSource(sourceDir, outputTar, prefix) {
  if (!fs.existsSync(sourceDir)) {
    console.error(`[pack-tar] Source not found: ${sourceDir}`)
    process.exit(1)
  }

  const outputDir = path.dirname(outputTar)
  fs.mkdirSync(outputDir, { recursive: true })

  const relSource = path.relative(path.dirname(sourceDir), sourceDir)
  execSync(
    `tar -cf "${outputTar}" --exclude=".bin" --exclude="*.map" --exclude="*.d.ts" -C "${path.dirname(sourceDir)}" "${relSource}"`,
    { stdio: 'inherit' }
  )

  const stats = fs.statSync(outputTar)
  console.log(`[pack-tar] ${path.basename(outputTar)}: ${(stats.size / 1024 / 1024).toFixed(1)} MB`)
}

function packWinCombined() {
  const outputTar = path.join(ROOT, 'build-tar', 'win-resources.tar')
  const sources = [
    { dir: path.join(ROOT, 'vendor', 'openclaw-runtime', 'current'), prefix: 'petmind', label: 'runtime' },
    { dir: path.join(ROOT, 'SKILLs'), prefix: 'SKILLs', label: 'skills' }
  ]

  const outputDir = path.dirname(outputTar)
  fs.mkdirSync(outputDir, { recursive: true })

  let first = true
  for (const source of sources) {
    if (!fs.existsSync(source.dir)) {
      console.warn(`[pack-tar] ${source.label} not found at ${source.dir}, skipping`)
      continue
    }

    const flag = first ? '-cf' : '-rf'
    first = false

    execSync(
      `tar ${flag} "${outputTar}" --exclude=".bin" --exclude="*.map" --exclude="*.d.ts" -C "${path.dirname(source.dir)}" "${path.basename(source.dir)}"`,
      { stdio: 'inherit' }
    )
    console.log(`[pack-tar] Added ${source.label}`)
  }

  if (fs.existsSync(outputTar)) {
    const stats = fs.statSync(outputTar)
    console.log(`[pack-tar] win-resources.tar: ${(stats.size / 1024 / 1024).toFixed(1)} MB`)
  }
}

const args = process.argv.slice(2)
if (args.includes('--win-combined')) {
  packWinCombined()
} else {
  console.log('Usage: node pack-openclaw-tar.cjs --win-combined')
}

module.exports = { packSingleSource, packWinCombined }