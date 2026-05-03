#!/usr/bin/env node

// GitNexus 索引刷新脚本。
// 使用场景：
// - Husky post-checkout / post-merge / post-rewrite 自动调用。
// - 开发者手动运行 pnpm ai:index。
// 设计原则：
// - 默认先看 status，只在索引可能 stale 时 analyze。
// - --force 才做强制全量重建。
// - post hook 场景下失败只提示，不破坏 Git 操作。

const {
  describeGitNexusEnvironmentError,
  getGitNexusListResult,
  getGitNexusRepoName,
  isGitNexusRepoRegistered,
  isGitNexusEnvironmentError,
  logInfo,
  logWarn,
  looksLikeStaleIndex,
  runGitNexus,
  runGitNexusForRepo
} = require('./gitnexus-utils.cjs')

const force = process.argv.includes('--force')
// embeddings 生成成本更高，默认关闭；只在显式参数或环境变量打开时附带，避免日常切分支变慢。
const embeddings = process.argv.includes('--embeddings') || process.env.PETCLAW_GITNEXUS_EMBEDDINGS === '1'
const reasonIndex = process.argv.indexOf('--reason')
// reason 仅用于日志定位：同一个脚本会被手动命令和多个 Husky post hook 复用。
const reason = reasonIndex >= 0 ? process.argv[reasonIndex + 1] : 'manual'

function printCommandOutput(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
}

function main() {
  // 整体流程：记录触发来源 → 可选强制重建 → 检查 status → stale 时刷新 → 失败宽松降级。
  logInfo(`检查 GitNexus 索引状态，触发来源：${reason}`)

  if (force) {
    // 只有索引损坏或大规模结构调整时才强制全量重建，避免日常开发被重任务拖慢。
    const args = embeddings ? ['analyze', '--force', '--embeddings'] : ['analyze', '--force']
    const result = runGitNexusForRepo(args)
    if (isGitNexusEnvironmentError(result)) {
      logWarn(describeGitNexusEnvironmentError(result))
      process.exit(0)
    }
    printCommandOutput(result)

    process.exit(result.status)
  }

  const list = getGitNexusListResult()
  if (isGitNexusEnvironmentError(list)) {
    logWarn(describeGitNexusEnvironmentError(list))
    process.exit(0)
  }

  if (!isGitNexusRepoRegistered()) {
    // 当前仓库使用唯一 alias 注册；如果还没注册，先建索引，避免多个同名仓库落到同一个默认别名。
    logInfo(`GitNexus 仓库索引未注册到当前别名，开始注册：${getGitNexusRepoName()}`)
    const analyzeArgs = embeddings ? ['analyze', '--embeddings'] : ['analyze']
    const analyze = runGitNexusForRepo(analyzeArgs)
    if (isGitNexusEnvironmentError(analyze)) {
      logWarn(describeGitNexusEnvironmentError(analyze))
      process.exit(0)
    }
    printCommandOutput(analyze)

    process.exit(analyze.status)
  }

  const status = runGitNexus(['status'])
  if (status.skipped) {
    return
  }

  if (isGitNexusEnvironmentError(status)) {
    logWarn(describeGitNexusEnvironmentError(status))
    process.exit(0)
  }

  // status 文案在不同 GitNexus 版本可能变化，所以 stale 判断集中在工具函数里做宽松匹配。
  const statusOutput = `${status.stdout}\n${status.stderr}`
  if (!looksLikeStaleIndex(statusOutput, status.status)) {
    logInfo('GitNexus 索引仍然可用，跳过 analyze。')
    return
  }

  logInfo('GitNexus 索引可能已过期，开始刷新。')
  const analyzeArgs = embeddings ? ['analyze', '--embeddings'] : ['analyze']
  const analyze = runGitNexusForRepo(analyzeArgs)

  if (analyze.status !== 0) {
    if (isGitNexusEnvironmentError(analyze)) {
      logWarn(describeGitNexusEnvironmentError(analyze))
      process.exit(0)
    }

    // post-checkout / post-merge 中刷新失败不应破坏 Git 操作；pre-commit 的严格校验由 impact 脚本负责。
    logWarn('GitNexus analyze 未成功完成，请稍后手动运行 pnpm ai:index 检查。')
  }
  printCommandOutput(analyze)

  process.exit(0)
}

main()
