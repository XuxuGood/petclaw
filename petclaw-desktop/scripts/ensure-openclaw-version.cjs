// scripts/ensure-openclaw-version.cjs
// git checkout 到 package.json 中锁定的 openclaw 版本 tag
// 环境变量：OPENCLAW_SRC（默认 ../openclaw）、OPENCLAW_SKIP_ENSURE=1 跳过

'use strict'

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const ocConfig = pkg.openclaw
if (!ocConfig) {
  console.log('[ensure-openclaw-version] No openclaw config in package.json, skipping')
  process.exit(0)
}

const desiredTag = ocConfig.version
const repoUrl = ocConfig.repo
const srcDir = process.env.OPENCLAW_SRC || path.resolve(ROOT, '..', 'openclaw')

if (process.env.OPENCLAW_SKIP_ENSURE === '1') {
  console.log('[ensure-openclaw-version] OPENCLAW_SKIP_ENSURE=1, skipping version check')
  process.exit(0)
}

function git(args, opts = {}) {
  return execSync(`git ${args}`, {
    cwd: srcDir,
    encoding: 'utf8',
    stdio: opts.stdio || 'pipe',
    ...opts
  }).trim()
}

function getCurrentTag() {
  try {
    return git('describe --tags --exact-match HEAD')
  } catch {
    return null
  }
}

// 如果源码目录不存在，clone
if (!fs.existsSync(srcDir)) {
  console.log(`[ensure-openclaw-version] Cloning ${repoUrl} → ${srcDir} (tag: ${desiredTag})`)
  execSync(`git clone --branch ${desiredTag} --depth 1 ${repoUrl} "${srcDir}"`, {
    stdio: 'inherit'
  })
  console.log(`[ensure-openclaw-version] Done`)
  process.exit(0)
}

// 检查当前版本
const currentTag = getCurrentTag()
if (currentTag === desiredTag) {
  console.log(`[ensure-openclaw-version] Already at ${desiredTag}`)
  process.exit(0)
}

console.log(`[ensure-openclaw-version] Switching from ${currentTag || 'unknown'} → ${desiredTag}`)

// 获取 tag（可能需要 unshallow）
try {
  git('fetch --tags --depth 1', { stdio: 'inherit' })
} catch {
  try {
    git('fetch --unshallow --tags', { stdio: 'inherit' })
  } catch (e) {
    console.error(`[ensure-openclaw-version] Failed to fetch tags: ${e.message}`)
    process.exit(1)
  }
}

// 丢弃本地修改并 checkout
try {
  git('checkout -- .', { stdio: 'inherit' })
  git(`checkout ${desiredTag}`, { stdio: 'inherit' })
} catch (e) {
  console.error(`[ensure-openclaw-version] Failed to checkout ${desiredTag}: ${e.message}`)
  console.error('If you have local changes, set OPENCLAW_SKIP_ENSURE=1')
  process.exit(1)
}

console.log(`[ensure-openclaw-version] Now at ${desiredTag}`)