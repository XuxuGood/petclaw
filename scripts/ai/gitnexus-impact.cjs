#!/usr/bin/env node

// GitNexus 变更影响分析脚本。
// 使用场景：
// - Husky pre-commit 在 lint-staged 后自动调用。
// - 开发者手动运行 pnpm ai:impact。
// 设计原则：
// - 只分析暂存区，避免把用户未准备提交的草稿混入风险报告。
// - 默认宽松失败，避免工具链缺失导致无法提交。
// - 设置 PETCLAW_AI_IMPACT_STRICT=1 后可切换为严格阻断。

const {
  describeGitNexusEnvironmentError,
  getGitNexusRepoName,
  hasStagedChanges,
  isGitNexusEnvironmentError,
  logInfo,
  logWarn,
  runGitNexusForRepo
} = require('./gitnexus-utils.cjs')

const jsonOutput = process.argv.includes('--json')

function printInfo(message) {
  if (!jsonOutput) {
    logInfo(message)
  }
}

function printWarn(message) {
  if (!jsonOutput) {
    logWarn(message)
  }
}

function printCommandOutput(result) {
  if (jsonOutput) {
    return
  }

  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
}

function parseGitNexusSummary(output) {
  try {
    const parsed = JSON.parse(output)
    return {
      risk: parsed?.summary?.risk_level ?? parsed?.risk ?? null,
      changedCount: parsed?.summary?.changed_count ?? null,
      affectedCount: parsed?.summary?.affected_count ?? null,
      changedFiles: parsed?.summary?.changed_files ?? null
    }
  } catch {
    return {
      risk: null,
      changedCount: null,
      affectedCount: null,
      changedFiles: null
    }
  }
}

function main() {
  // 整体流程：无暂存变更则跳过 → 有变更则运行 detect_changes → 根据严格模式决定是否阻断。
  const report = {
    repo: getGitNexusRepoName(),
    scope: 'staged',
    strict: process.env.PETCLAW_AI_IMPACT_STRICT === '1',
    stagedChanges: false,
    skipped: false,
    status: 0,
    toolingDegraded: false,
    risk: null,
    changedCount: null,
    affectedCount: null,
    changedFiles: null
  }

  if (!hasStagedChanges()) {
    report.skipped = true
    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2))
      return
    }

    printInfo('暂存区没有变更，跳过 GitNexus 变更影响分析。')
    return
  }

  report.stagedChanges = true
  printInfo('开始 GitNexus 变更影响分析。')
  // detect_changes 基于暂存区输出影响面；lint-staged 已经先运行，所以这里看到的是格式化后的最终提交内容。
  const result = runGitNexusForRepo(['detect_changes', '--scope', 'staged'])
  report.status = result.status
  if (result.skipped) {
    report.skipped = true
    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2))
    }
    return
  }
  printCommandOutput(result)

  const summary = parseGitNexusSummary(result.stdout)
  Object.assign(report, summary)

  if (result.status !== 0) {
    if (isGitNexusEnvironmentError(result)) {
      report.toolingDegraded = true
      printWarn(describeGitNexusEnvironmentError(result))
      printWarn('GitNexus 锁/权限问题属于工具链环境异常，不视为业务代码风险。')
    }

    // 默认不因为工具不可用或报告命令失败而阻断提交；需要强制阻断时可设置 PETCLAW_AI_IMPACT_STRICT=1。
    if (report.strict) {
      if (jsonOutput) {
        console.log(JSON.stringify(report, null, 2))
      }

      printWarn('GitNexus 变更影响分析失败，严格模式下阻断提交。')
      process.exit(result.status)
    }

    printWarn('GitNexus 变更影响分析未成功完成；当前为宽松模式，提交继续。')
  }

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2))
  }
}

main()
