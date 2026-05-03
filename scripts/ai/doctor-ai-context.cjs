#!/usr/bin/env node

// AI 上下文 harness 诊断脚本。
// 使用场景：
// - GitNexus 锁、Serena dashboard、MCP 配置、客户端接入异常时运行 pnpm ai:doctor。
// - AI 需要判断“工具链环境异常”还是“业务风险”时运行 pnpm --silent ai:doctor -- --json。
// 设计原则：
// - 只做诊断，不安装、不改配置、不删除锁文件、不结束进程。
// - 输出同时适合人看和 AI 解析；--json 模式只输出结构化结果。
// - 能降级就降级，避免诊断工具本身成为开发阻断点。

const { accessSync, constants, existsSync } = require('node:fs')
const { join } = require('node:path')

const {
  AI_TOOLS_DIR,
  PROJECT_MCP_CONFIG,
  PROJECT_ROOT,
  describeGitNexusEnvironmentError,
  getCommandVersion,
  getGitNexusListResult,
  getGitNexusRepoName,
  getSerenaDashboardUrls,
  hasCommand,
  isGitNexusEnvironmentError,
  isGitNexusRepoRegistered,
  logInfo,
  logWarn,
  resolveGitNexusCommand,
  runCommand,
  runGitNexus,
  runGitNexusForRepo
} = require('./gitnexus-utils.cjs')

const jsonOutput = process.argv.includes('--json')
const deepCheck = process.argv.includes('--deep') || process.argv.includes('--serena-health')

function createCheck(name, ok, detail = '', meta = {}) {
  return {
    name,
    ok,
    detail,
    ...meta
  }
}

function printCheck(check) {
  if (jsonOutput) {
    return
  }

  const state = check.ok ? 'OK' : 'WARN'
  console.log(`[AI Doctor] ${check.name}: ${state}${check.detail ? ` - ${check.detail}` : ''}`)
}

function addCheck(report, check) {
  report.checks.push(check)
  printCheck(check)
}

function canAccess(path, mode) {
  try {
    accessSync(path, mode)
    return true
  } catch {
    return false
  }
}

function checkCommand(report, name, command, versionArgs = ['--version']) {
  // 命令检查只验证本机能否找到入口；真实项目能力由后面的 GitNexus/Serena 专项检查覆盖。
  const version = getCommandVersion(command, versionArgs)
  addCheck(
    report,
    createCheck(name, Boolean(version), version || `${command} 未找到`, {
      category: 'command'
    })
  )
}

function checkFiles(report) {
  // MCP 配置和模板目录是所有客户端共享的事实源，缺失时 setup/write-mcp 才需要介入。
  addCheck(
    report,
    createCheck('项目级 MCP 配置', existsSync(PROJECT_MCP_CONFIG), PROJECT_MCP_CONFIG, {
      category: 'mcp'
    })
  )
  addCheck(
    report,
    createCheck('MCP 模板目录', existsSync(AI_TOOLS_DIR), AI_TOOLS_DIR, {
      category: 'mcp'
    })
  )

  const registryPath = join(process.env.HOME || '', '.gitnexus', 'registry.json')
  const registryExists = Boolean(process.env.HOME) && existsSync(registryPath)
  const registryReadable = registryExists && canAccess(registryPath, constants.R_OK)
  const registryWritable = registryExists && canAccess(registryPath, constants.W_OK)
  addCheck(
    report,
    createCheck('GitNexus registry 权限', registryReadable && registryWritable, registryPath, {
      category: 'gitnexus',
      exists: registryExists,
      readable: registryReadable,
      writable: registryWritable
    })
  )
}

function parseLockOwners(output) {
  return output
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('COMMAND'))
    .map((line) => line.trim())
}

function checkLocks(report) {
  // lsof 是只读检查；发现占用时只报告进程，不自动 kill，避免误伤用户正在使用的 MCP server。
  const lbugPath = join(PROJECT_ROOT, '.gitnexus', 'lbug')
  if (!existsSync(lbugPath)) {
    addCheck(
      report,
      createCheck('GitNexus 本地索引锁', true, '.gitnexus/lbug 不存在或尚未生成', {
        category: 'gitnexus',
        owners: []
      })
    )
    return
  }

  const lsof = runCommand('lsof', [lbugPath])
  const owners = lsof.status === 0 ? parseLockOwners(lsof.stdout) : []
  addCheck(
    report,
    createCheck('GitNexus 本地索引占用', owners.length === 0, owners.length ? owners.join(' | ') : '未发现占用进程', {
      category: 'gitnexus',
      owners
    })
  )
}

function checkGitNexus(report) {
  // GitNexus 诊断分三层：命令入口、registry/list、当前 repo alias/status，方便定位到底卡在哪一层。
  const command = resolveGitNexusCommand()
  addCheck(
    report,
    createCheck('GitNexus 命令入口', Boolean(command), command ? `${command.command} ${command.argsPrefix.join(' ')}`.trim() : '未找到 gitnexus', {
      category: 'gitnexus'
    })
  )
  if (!command) {
    return
  }

  const list = getGitNexusListResult()
  if (isGitNexusEnvironmentError(list)) {
    addCheck(
      report,
      createCheck('GitNexus registry/list', false, describeGitNexusEnvironmentError(list), {
        category: 'gitnexus',
        toolingDegraded: true
      })
    )
    return
  }
  addCheck(
    report,
    createCheck('GitNexus registry/list', list.status === 0, `status=${list.status}`, {
      category: 'gitnexus'
    })
  )

  const repoName = getGitNexusRepoName()
  const registered = isGitNexusRepoRegistered()
  addCheck(
    report,
    createCheck('GitNexus 当前仓库 alias', registered, repoName, {
      category: 'gitnexus',
      repo: repoName
    })
  )

  const status = runGitNexus(['status'], { timeoutMs: 15000 })
  const environmentError = isGitNexusEnvironmentError(status)
  addCheck(
    report,
    createCheck('GitNexus status', status.status === 0 && !environmentError, environmentError ? describeGitNexusEnvironmentError(status) : `status=${status.status}`, {
      category: 'gitnexus',
      toolingDegraded: environmentError
    })
  )

  const context = runGitNexusForRepo(['context', '--', 'ConfigSync'], { timeoutMs: 15000 })
  const contextBlocked = isGitNexusEnvironmentError(context)
  addCheck(
    report,
    createCheck('GitNexus context smoke test', context.status === 0 && !contextBlocked, contextBlocked ? describeGitNexusEnvironmentError(context) : `status=${context.status}`, {
      category: 'gitnexus',
      toolingDegraded: contextBlocked
    })
  )
}

function checkSerena(report) {
  // Serena 能否被 AI 使用，关键看命令入口、项目 health、dashboard 地址；dashboard 未监听不等于 MCP 不可用。
  const version = getCommandVersion('serena')
  addCheck(
    report,
    createCheck('Serena 命令入口', Boolean(version), version || '未找到 serena', {
      category: 'serena'
    })
  )

  const dashboardUrls = getSerenaDashboardUrls()
  addCheck(
    report,
    createCheck('Serena Dashboard', true, dashboardUrls.length ? dashboardUrls.join(', ') : '未发现监听；MCP 启动后默认 http://127.0.0.1:24282/dashboard/', {
      category: 'serena',
      urls: dashboardUrls
    })
  )

  if (!version) {
    return
  }

  if (!deepCheck) {
    addCheck(
      report,
      createCheck('Serena project health', true, '未运行深度检查；需要时执行 pnpm ai:doctor -- --deep', {
        category: 'serena',
        skipped: true
      })
    )
    return
  }

  const health = runCommand('serena', ['project', 'health-check'], { timeoutMs: 20000 })
  addCheck(
    report,
    createCheck('Serena project health', health.status === 0, health.error?.code === 'ETIMEDOUT' ? 'health-check timeout after 20s' : health.status === 0 ? 'health-check passed' : `status=${health.status}`, {
      category: 'serena'
    })
  )
}

function printSummary(report) {
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const failed = report.checks.filter((check) => !check.ok)
  if (failed.length === 0) {
    logInfo('AI Context Harness 诊断通过。')
    return
  }

  logWarn(`AI Context Harness 有 ${failed.length} 项需要关注；上述 WARN 已给出定位信息。`)
}

function main() {
  const report = {
    projectRoot: PROJECT_ROOT,
    repo: getGitNexusRepoName(),
    deepCheck,
    checks: []
  }

  if (!jsonOutput) {
    logInfo('开始 AI Context Harness 诊断。')
  }

  checkCommand(report, 'Node.js', 'node')
  checkCommand(report, 'Git', 'git')
  checkCommand(report, 'pnpm', 'pnpm')
  checkCommand(report, 'uv', 'uv')
  checkFiles(report)
  checkLocks(report)
  checkGitNexus(report)
  checkSerena(report)
  printSummary(report)
}

main()
