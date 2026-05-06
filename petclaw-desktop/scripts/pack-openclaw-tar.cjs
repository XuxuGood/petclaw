// scripts/pack-openclaw-tar.cjs
// Windows NSIS 优化：将 runtime + skills 打包为单个 tar 加速安装解压
// 用法:
//   node scripts/pack-openclaw-tar.cjs --win-combined
//   node scripts/pack-openclaw-tar.cjs [sourceDir] [outputTar]

'use strict'

const fs = require('fs')
const path = require('path')
const tar = require('tar')

// ── 过滤规则 ──────────────────────────────────────────────────────────────────

// 需要排除的文件名模式（source map、类型声明、文档、配置等）
const EXCLUDED_FILE_PATTERNS = [
  /\.map$/i,
  /\.d\.ts$/i,
  /\.d\.cts$/i,
  /\.d\.mts$/i,
  /^readme(\.(md|txt|rst))?$/i,
  /^changelog(\.(md|txt|rst))?$/i,
  /^history(\.(md|txt|rst))?$/i,
  /^license(\.(md|txt))?$/i,
  /^licence(\.(md|txt))?$/i,
  /^authors(\.(md|txt))?$/i,
  /^contributors(\.(md|txt))?$/i,
  /^\.eslintrc/i,
  /^\.prettierrc/i,
  /^\.editorconfig$/i,
  /^\.npmignore$/i,
  /^\.gitignore$/i,
  /^\.gitattributes$/i,
  /^tsconfig(\..+)?\.json$/i,
  /^jest\.config/i,
  /^vitest\.config/i,
  /^\.babelrc/i,
  /^babel\.config/i,
  /\.test\.\w+$/i,
  /\.spec\.\w+$/i,
]

// 需要排除的目录名（测试、CI、工具链配置等）
const EXCLUDED_DIRS = new Set([
  'test',
  'tests',
  '__tests__',
  '__mocks__',
  '.github',
  'example',
  'examples',
  'coverage',
  '.venv',
  '.bin', // node_modules/.bin 只含 symlink，运行时不使用
])

// 排除 .env 文件，防止敏感配置泄漏
const EXCLUDED_ENVFILE = /^\.env(\..+)?$/i

/**
 * 判断给定路径是否应被排除。
 * entryPath 可以是相对路径（含目录分隔符）或纯文件名。
 */
function shouldExclude(entryPath) {
  const basename = path.basename(entryPath)
  // 检查路径各段是否命中目录黑名单
  const segments = entryPath.split(/[/\\]/)
  for (const seg of segments) {
    if (EXCLUDED_DIRS.has(seg.toLowerCase())) return true
  }
  if (EXCLUDED_ENVFILE.test(basename)) return true
  if (EXCLUDED_FILE_PATTERNS.some((p) => p.test(basename))) return true
  return false
}

// ── 打包核心 ──────────────────────────────────────────────────────────────────

/**
 * 将单个目录打包为 tar 文件（纯 JS，不依赖系统 tar 命令）。
 * @param {string} sourceDir  源目录绝对路径
 * @param {string} outputTar  输出 tar 文件绝对路径
 * @param {string} [prefix]   tar 内条目前缀（可选）
 * @returns {{ totalFiles: number, skipped: number }}
 */
function packSingleSource(sourceDir, outputTar, prefix) {
  if (!fs.existsSync(sourceDir)) {
    console.error(`[pack-openclaw-tar] 源目录不存在: ${sourceDir}`)
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(outputTar), { recursive: true })

  // 统计实际写入 / 跳过的文件数量（用于日志）
  let totalFiles = 0
  let skipped = 0

  function countFiles(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue
      const full = path.join(dir, item.name)
      if (item.isDirectory()) {
        if (!EXCLUDED_DIRS.has(item.name.toLowerCase())) countFiles(full)
      } else if (item.isFile()) {
        if (!shouldExclude(item.name)) totalFiles++
        else skipped++
      }
    }
  }
  countFiles(sourceDir)

  // tar.create 使用 sync 模式，避免回调地狱；filter 在条目级别过滤
  tar.create(
    {
      file: outputTar,
      cwd: sourceDir,
      prefix: prefix || '',
      sync: true,
      follow: true,
      // filter 参数：返回 false 的条目会被跳过
      filter: (filePath) => !shouldExclude(filePath),
    },
    fs.readdirSync(sourceDir).filter((name) => !EXCLUDED_DIRS.has(name.toLowerCase()))
  )

  return { totalFiles, skipped }
}

/**
 * 将多个源目录追加打包进同一个 tar 文件。
 * 第一个来源用 tar.create，后续用 tar.replace 追加（均为 sync 模式）。
 * @param {Array<{ dir: string, prefix: string }>} sources  源目录列表
 * @param {string} outputTar  输出 tar 文件绝对路径
 * @returns {{ totalFiles: number, skipped: number }}
 */
function packMultipleSources(sources, outputTar) {
  let totalFiles = 0
  let totalSkipped = 0
  let first = true

  for (const { dir, prefix } of sources) {
    if (!fs.existsSync(dir)) {
      console.log(`[pack-openclaw-tar]   跳过 ${prefix}：${dir} 不存在`)
      continue
    }

    console.log(`[pack-openclaw-tar]   添加 ${prefix} ← ${dir}`)

    // 统计本次来源的文件数
    let count = 0
    function countDir(d) {
      for (const item of fs.readdirSync(d, { withFileTypes: true })) {
        if (item.isSymbolicLink()) continue
        const full = path.join(d, item.name)
        if (item.isDirectory()) {
          if (!EXCLUDED_DIRS.has(item.name.toLowerCase())) countDir(full)
        } else if (item.isFile()) {
          if (!shouldExclude(item.name)) count++
          else totalSkipped++
        }
      }
    }
    countDir(dir)
    totalFiles += count

    const opts = {
      file: outputTar,
      cwd: dir,
      prefix,
      sync: true,
      follow: true,
      filter: (filePath) => !shouldExclude(filePath),
    }

    const entries = fs.readdirSync(dir).filter((n) => !EXCLUDED_DIRS.has(n.toLowerCase()))

    if (first) {
      // 首次创建 tar 文件
      tar.create(opts, entries)
      first = false
    } else {
      // 后续来源追加进已有 tar
      tar.replace(opts, entries)
    }
  }

  return { totalFiles, skipped: totalSkipped }
}

// ── 业务场景封装 ──────────────────────────────────────────────────────────────

/**
 * 打包 Windows combined tar（runtime + skills）。
 * electron-builder-hooks.cjs 调用此函数，保持向后兼容。
 */
function packWinCombined() {
  const projectRoot = path.join(__dirname, '..')
  const outputTar = path.join(projectRoot, 'build-tar', 'win-resources.tar')

  fs.mkdirSync(path.dirname(outputTar), { recursive: true })
  // 先删除旧文件，防止 tar.replace 追加到过期内容
  if (fs.existsSync(outputTar)) fs.unlinkSync(outputTar)

  const sources = [
    // petmind: OpenClaw 运行时，安装后解压为 petmind/ 目录
    { dir: path.join(projectRoot, 'vendor', 'openclaw-runtime', 'current'), prefix: 'petmind' },
    // skills: 技能包，安装后解压为 skills/ 目录
    { dir: path.join(projectRoot, 'skills'), prefix: 'skills' },
  ]

  console.log(`[pack-openclaw-tar] 打包 Windows combined tar: ${outputTar}`)
  const t0 = Date.now()
  const { totalFiles, skipped } = packMultipleSources(sources, outputTar)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const sizeMB = (fs.statSync(outputTar).size / (1024 * 1024)).toFixed(1)
  console.log(`[pack-openclaw-tar] 完成 ${elapsed}s：${totalFiles} 个文件，跳过 ${skipped} 个，共 ${sizeMB} MB`)
}

// ── CLI 入口 ──────────────────────────────────────────────────────────────────

function main() {
  const projectRoot = path.join(__dirname, '..')

  if (process.argv.includes('--win-combined')) {
    packWinCombined()
    return
  }

  // 单目录模式：node pack-openclaw-tar.cjs [sourceDir] [outputTar]
  const sourceDir = process.argv[2] || path.join(projectRoot, 'vendor', 'openclaw-runtime', 'current')
  const outputTar = process.argv[3] || path.join(projectRoot, 'vendor', 'openclaw-runtime', 'petmind.tar')

  if (!fs.existsSync(sourceDir)) {
    console.error(`[pack-openclaw-tar] 源目录不存在: ${sourceDir}`)
    process.exit(1)
  }
  if (fs.existsSync(outputTar)) fs.unlinkSync(outputTar)

  console.log(`[pack-openclaw-tar] 打包: ${sourceDir}`)
  console.log(`[pack-openclaw-tar] 输出: ${outputTar}`)

  const t0 = Date.now()
  const basename = path.basename(outputTar, '.tar')
  const { totalFiles, skipped } = packSingleSource(sourceDir, outputTar, basename)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const sizeMB = (fs.statSync(outputTar).size / (1024 * 1024)).toFixed(1)
  console.log(`[pack-openclaw-tar] 完成 ${elapsed}s：${totalFiles} 个文件，跳过 ${skipped} 个，共 ${sizeMB} MB`)
}

if (require.main === module) {
  main()
}

module.exports = { packSingleSource, packMultipleSources, packWinCombined }
