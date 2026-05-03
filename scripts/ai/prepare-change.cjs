#!/usr/bin/env node

// AI 改动前上下文准备脚本。
// 使用场景：
// - AI 或开发者在修改核心文件前运行 pnpm ai:prepare-change -- --target <file-or-symbol>。
// 设计原则：
// - 先尽量刷新/确认 GitNexus 索引，再查询 context 和 impact。
// - 即使当前 GitNexus CLI 不支持 context/impact，也输出 PetClaw 必查清单。
// - 目标是把“先查上下游链路”变成固定入口，减少 AI 每次从零扫仓库。

const {
  describeGitNexusEnvironmentError,
  getGitNexusListResult,
  getGitNexusRepoName,
  hasWorkingTreeChanges,
  isGitNexusRepoRegistered,
  isGitNexusEnvironmentError,
  logInfo,
  logWarn,
  looksLikeStaleIndex,
  runCommand,
  runGitNexus,
  runGitNexusForRepo
} = require('./gitnexus-utils.cjs')

const jsonOutput = process.argv.includes('--json')

function readArg(name) {
  // 不引入额外参数解析依赖，保持脚本能在 hook 和最小 Node 环境中直接运行。
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function printUsage() {
  // prepare-change 是给 AI 自动调用的入口；缺 target 直接失败，避免生成没有上下文价值的报告。
  console.log('用法：pnpm ai:prepare-change -- --target <file-or-symbol>')
  console.log('示例：pnpm ai:prepare-change -- --target petclaw-desktop/src/main/ai/config-sync.ts')
}

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

function safeJsonParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function ensureFreshEnoughIndex() {
  // 改动前的索引要求比 post hook 更高：如果发现 stale，就主动刷新一次，尽量让影响分析基于最新代码。
  const list = getGitNexusListResult()
  if (isGitNexusEnvironmentError(list)) {
    printWarn(describeGitNexusEnvironmentError(list))
    return {
      available: false,
      environmentBlocked: true
    }
  }

  if (!isGitNexusRepoRegistered()) {
    // 多仓库场景下，当前目录可能已有旧的默认名索引，但新的唯一 alias 尚未注册；先注册，避免 context/impact 串仓。
    printInfo(`GitNexus 仓库索引未注册到当前别名，准备注册：${getGitNexusRepoName()}`)
    const analyze = runGitNexusForRepo(['analyze'])
    if (isGitNexusEnvironmentError(analyze)) {
      printWarn(describeGitNexusEnvironmentError(analyze))
      return {
        available: false,
        environmentBlocked: true
      }
    }
    if (!jsonOutput) {
      printCommandOutput(analyze)
    }

    return {
      available: !analyze.skipped && analyze.status === 0,
      environmentBlocked: false
    }
  }

  const status = runGitNexus(['status'])
  if (status.skipped) {
    return {
      available: false,
      environmentBlocked: false
    }
  }

  if (isGitNexusEnvironmentError(status)) {
    printWarn(describeGitNexusEnvironmentError(status))
    return {
      available: false,
      environmentBlocked: true
    }
  }

  const statusOutput = `${status.stdout}\n${status.stderr}`
  if (!looksLikeStaleIndex(statusOutput, status.status)) {
    return {
      available: true,
      environmentBlocked: false
    }
  }

  // 准备改动前自动刷新 stale index，让后续 context / impact 尽量基于最新代码图谱。
  printInfo('GitNexus 索引可能已过期，准备变更前先刷新。')
  const analyze = runGitNexusForRepo(['analyze'])
  if (isGitNexusEnvironmentError(analyze)) {
    printWarn(describeGitNexusEnvironmentError(analyze))
    return {
      available: false,
      environmentBlocked: true
    }
  }
  if (!jsonOutput) {
    printCommandOutput(analyze)
  }

  return {
    available: !analyze.skipped && analyze.status === 0,
    environmentBlocked: false
  }
}

function printCommandOutput(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
}

function outputLooksUnknown(result) {
  const output = `${result.stdout}\n${result.stderr}`
  return result.status !== 0 || /"status"\s*:\s*"not_found"|UNKNOWN|not found|Repository .* not found|No symbol/i.test(output)
}

function uniqueSearchPatterns(target) {
  // 非 symbol 目标可能是 CSS 变量、IPC channel、配置 key、i18n key、DB 字段或环境变量，不能只查完整类/函数名。
  const normalized = target.trim()
  const withoutCssVar = normalized.replace(/^var\((--[^)]+)\)$/, '$1')
  const withoutQuotes = withoutCssVar.replace(/^['"`]|['"`]$/g, '')
  const withoutPrefix = withoutCssVar.replace(/^--/, '')
  const withoutBrackets = withoutPrefix.replace(/^\[|\]$/g, '')
  const camelToKebab = withoutQuotes.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

  return Array.from(
    new Set(
      [
        normalized,
        withoutCssVar,
        withoutQuotes,
        withoutPrefix,
        withoutBrackets,
        camelToKebab,
        withoutPrefix.replace(/-/g, '_'),
        withoutPrefix.replace(/_/g, '-'),
        withoutQuotes.replace(/\./g, ':'),
        withoutQuotes.replace(/:/g, '.')
      ].filter((item) => item && item.length >= 2)
    )
  )
}

function runRipgrep(pattern, extraArgs = []) {
  return runCommand('rg', ['--line-number', '--fixed-strings', '--glob', '!node_modules', ...extraArgs, '--', pattern], {
    inherit: false
  })
}

function printLimitedMatches(label, result, limit = 40) {
  const lines = result.stdout.split('\n').filter(Boolean)
  console.log(`\n[AI Context] ${label}`)

  if (lines.length === 0) {
    console.log('- 未找到匹配。')
    return
  }

  for (const line of lines.slice(0, limit)) {
    console.log(`- ${line}`)
  }

  if (lines.length > limit) {
    console.log(`- 还有 ${lines.length - limit} 条匹配未展示；请用 rg 继续收窄。`)
  }
}

function collectLimitedMatches(result, limit = 40) {
  const lines = result.stdout.split('\n').filter(Boolean)
  return {
    count: lines.length,
    matches: lines.slice(0, limit),
    truncated: lines.length > limit
  }
}

function firstMatch(patterns, extraArgs = []) {
  for (const pattern of patterns) {
    const result = runRipgrep(pattern, extraArgs)
    if (result.status === 0) {
      return {
        pattern,
        result
      }
    }
  }

  return null
}

function printSearchGroup(label, patterns, extraArgs = []) {
  const match = firstMatch(patterns, extraArgs)
  if (!match) {
    return false
  }

  printLimitedMatches(`${label}：${match.pattern}`, match.result)
  return true
}

function collectSearchGroup(label, patterns, extraArgs = []) {
  const match = firstMatch(patterns, extraArgs)
  if (!match) {
    return null
  }

  return {
    label,
    pattern: match.pattern,
    ...collectLimitedMatches(match.result)
  }
}

function printNoFallbackMatches() {
  console.log('\n[AI Context] 文本使用面扫描未命中。')
  console.log('- 目标可能是新建概念、动态拼接值、生成文件内容，或需要换用更短关键词。')
  console.log('- 请尝试用模块名、文件名、配置 key 片段、IPC channel 片段或 UI 文案片段重新运行 prepare-change。')
}

function runTextFallback(target) {
  // GitNexus 面向代码 symbol，CSS token / IPC channel / 配置 key / i18n key / DB 字段不一定入图。
  // 这里按前后端常见变更面分组扫描，保证 UNKNOWN 时仍能给 AI 一个可操作的上下文入口。
  printWarn('GitNexus 未命中可用 symbol，改用前后端文本使用面扫描。')

  const patterns = uniqueSearchPatterns(target)
  if (jsonOutput) {
    const groups = [
      collectSearchGroup('全仓使用面', patterns),
      collectSearchGroup('前端组件/页面使用面', patterns, [
        '--glob',
        'petclaw-desktop/src/renderer/src/**/*.{ts,tsx,css}'
      ]),
      collectSearchGroup('样式 token / CSS 使用面', patterns, [
        '--glob',
        'petclaw-desktop/src/renderer/src/**/*.css'
      ]),
      collectSearchGroup('主进程/后端链路使用面', patterns, [
        '--glob',
        'petclaw-desktop/src/main/**/*.ts'
      ]),
      collectSearchGroup('Preload / IPC 类型桥接使用面', patterns, [
        '--glob',
        'petclaw-desktop/src/preload/**/*.{ts,tsx}'
      ]),
      collectSearchGroup('共享类型 / i18n 使用面', patterns, [
        '--glob',
        'petclaw-shared/src/**/*.{ts,tsx}'
      ]),
      collectSearchGroup('测试覆盖面', patterns, [
        '--glob',
        'petclaw-desktop/tests/**/*.{ts,tsx}'
      ]),
      collectSearchGroup('文档和规范引用面', patterns, [
        '--glob',
        '*.{md,mdx}',
        '--glob',
        'docs/**/*'
      ])
    ].filter(Boolean)

    return {
      matched: groups.length > 0,
      groups
    }
  }

  let matched = false

  matched = printSearchGroup('全仓使用面', patterns) || matched
  matched = printSearchGroup('前端组件/页面使用面', patterns, [
    '--glob',
    'petclaw-desktop/src/renderer/src/**/*.{ts,tsx,css}'
  ]) || matched
  matched = printSearchGroup('样式 token / CSS 使用面', patterns, [
    '--glob',
    'petclaw-desktop/src/renderer/src/**/*.css'
  ]) || matched
  matched = printSearchGroup('主进程/后端链路使用面', patterns, [
    '--glob',
    'petclaw-desktop/src/main/**/*.ts'
  ]) || matched
  matched = printSearchGroup('Preload / IPC 类型桥接使用面', patterns, [
    '--glob',
    'petclaw-desktop/src/preload/**/*.{ts,tsx}'
  ]) || matched
  matched = printSearchGroup('共享类型 / i18n 使用面', patterns, [
    '--glob',
    'petclaw-shared/src/**/*.{ts,tsx}'
  ]) || matched
  matched = printSearchGroup('测试覆盖面', patterns, [
    '--glob',
    'petclaw-desktop/tests/**/*.{ts,tsx}'
  ]) || matched
  matched = printSearchGroup('文档和规范引用面', patterns, [
    '--glob',
    '*.{md,mdx}',
    '--glob',
    'docs/**/*'
  ]) || matched

  if (!matched) {
    printNoFallbackMatches()
  }

  console.log('\n[AI Context] 非 symbol 目标额外核对：')
  console.log('- 前端：检查组件 className、CSS token、状态样式、弹层、拖拽区、响应式宽度。')
  console.log('- 主进程：检查 IPC handler、服务组装、ConfigSync、scheduler、IM、Openclaw runtime 调用链。')
  console.log('- Preload：涉及 IPC channel 时必须同步 preload 实现和 index.d.ts 类型。')
  console.log('- 共享层：涉及 i18n、共享类型、常量时必须同步 petclaw-shared 和调用方。')
  console.log('- 数据层：涉及 SQLite/app_config 字段时必须同步 schema 注释、repository、默认值和测试。')
  console.log('- 测试：按命中范围选择 renderer/main/shared 的针对性测试或 typecheck。')
  return {
    matched
  }
}

function main() {
  // 整体流程：读取目标 → 确认索引 → 拉 context/impact → 提醒已有草稿 → 输出项目级核对清单。
  const target = readArg('--target') ?? readArg('-t')
  if (!target) {
    printUsage()
    process.exit(1)
  }

  printInfo(`准备分析改动目标：${target}`)
  const indexState = ensureFreshEnoughIndex()
  if (!indexState.available) {
    printWarn('无法使用最新 GitNexus 索引，下面输出人工核对清单。')
  }

  const report = {
    target,
    repo: getGitNexusRepoName(),
    gitnexus: {
      indexAvailable: indexState.available,
      environmentBlocked: indexState.environmentBlocked,
      contextStatus: null,
      impactStatus: null,
      risk: null
    },
    fallback: {
      used: false,
      matched: false,
      groups: []
    },
    workingTreeChanged: false,
    checklist: [
      '目标文件 / symbol 的调用方和被调用方已经查清。',
      '涉及 IPC 时已同步 main、preload、preload 类型声明、renderer 调用方。',
      '涉及 ConfigSync 时已确认 openclaw.json、AGENTS.md、exec-approvals.json 和 runtime reload 影响。',
      '涉及 SQLite / app_config / i18n 时已找到默认值、使用点、测试和中英文文案。',
      '涉及 UI token / CSS / className 时已找到定义、前端使用面和状态样式影响。',
      '已列出拟修改文件、修改原因、预期影响，并等待用户确认。'
    ]
  }

  if (indexState.environmentBlocked) {
    printWarn('GitNexus 锁/权限问题属于工具链环境异常，不视为业务风险；已自动降级为本地使用面扫描。')
    const fallback = runTextFallback(target)
    report.fallback = {
      used: true,
      matched: Boolean(fallback.matched),
      groups: fallback.groups ?? []
    }
  }

  // 这些命令名来自 GitNexus 面向 AI 的语义：context 用于拿上下文，impact 用于拿影响面。
  // 如果当前 GitNexus 版本仅通过 MCP 暴露同名能力，CLI 失败时不会阻断，但 AI 仍必须按清单核对。
  if (!indexState.environmentBlocked) {
    const context = runGitNexusForRepo(['context', '--', target])
    report.gitnexus.contextStatus = context.status
    if (!jsonOutput) {
      printCommandOutput(context)
    }

    const impact = runGitNexusForRepo(['impact', '--', target])
    report.gitnexus.impactStatus = impact.status
    const parsedImpact = safeJsonParse(impact.stdout)
    if (parsedImpact && typeof parsedImpact.risk === 'string') {
      report.gitnexus.risk = parsedImpact.risk
    }
    if (!jsonOutput) {
      printCommandOutput(impact)
    }

    if (isGitNexusEnvironmentError(context) || isGitNexusEnvironmentError(impact)) {
      printWarn(describeGitNexusEnvironmentError(isGitNexusEnvironmentError(context) ? context : impact))
      printWarn('GitNexus 锁/权限问题属于工具链环境异常，不视为业务风险；已自动降级为本地使用面扫描。')
      const fallback = runTextFallback(target)
      report.fallback = {
        used: true,
        matched: Boolean(fallback.matched),
        groups: fallback.groups ?? []
      }
    } else if (outputLooksUnknown(context) || outputLooksUnknown(impact)) {
      const fallback = runTextFallback(target)
      report.fallback = {
        used: true,
        matched: Boolean(fallback.matched),
        groups: fallback.groups ?? []
      }
    }
  }

  if (hasWorkingTreeChanges()) {
    report.workingTreeChanged = true
    printInfo('工作区已有未提交变更，AI 修改前需要确认这些变更是否属于当前任务。')
  }

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log('\n[AI Context] 改动前必须确认：')
  // 下方清单是 GitNexus/Serena 不可用时的降级护栏，确保 AI 仍按 PetClaw 的高风险链路补齐上下文。
  console.log('- 目标文件 / symbol 的调用方和被调用方已经查清。')
  console.log('- 涉及 IPC 时已同步 main、preload、preload 类型声明、renderer 调用方。')
  console.log('- 涉及 ConfigSync 时已确认 openclaw.json、AGENTS.md、exec-approvals.json 和 runtime reload 影响。')
  console.log('- 涉及 SQLite / app_config / i18n 时已找到默认值、使用点、测试和中英文文案。')
  console.log('- 涉及 UI token / CSS / className 时已找到定义、前端使用面和状态样式影响。')
  console.log('- 已列出拟修改文件、修改原因、预期影响，并等待用户确认。')
}

main()
