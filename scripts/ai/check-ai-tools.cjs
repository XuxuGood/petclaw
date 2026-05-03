#!/usr/bin/env node

// AI 工具链只读检查脚本。
// 使用场景：
// - 新机器或新仓库拉取后运行 pnpm ai:tools:check。
// - 排查 GitNexus / Serena / MCP 模板为什么不可用。
// 设计原则：
// - 只检查，不安装、不写文件。
// - 缺失项用可执行建议提示，避免开发者猜下一步。

const {
  AI_TOOLS_DIR,
  PROJECT_MCP_CONFIG,
  getCommandVersion,
  getSerenaDashboardUrls,
  hasCommand,
  logInfo,
  logWarn,
  resolveGitNexusCommand
} = require('./gitnexus-utils.cjs')

const { existsSync } = require('node:fs')

function printStatus(label, ok, detail) {
  // 统一状态输出格式，让 CI、终端和 AI 都能稳定读懂检查结果。
  const state = ok ? 'OK' : '缺失'
  console.log(`[AI Tools] ${label}: ${state}${detail ? ` - ${detail}` : ''}`)
}

function checkGitNexus() {
  // GitNexus 可能来自本地依赖、全局命令或显式 npx 开关，所以复用共享解析逻辑。
  const command = resolveGitNexusCommand()
  if (!command) {
    printStatus('GitNexus', false, '未找到 gitnexus；可设置 PETCLAW_GITNEXUS_USE_NPX=1 使用 npx 临时运行')
    return false
  }

  printStatus('GitNexus', true, `${command.command} ${command.argsPrefix.join(' ')}`.trim())
  return true
}

function checkSerena() {
  // Serena 版本命令会触发 Python 包入口，但不启动 MCP server；这里只验证命令是否可被客户端调用。
  const version = getCommandVersion('serena')
  if (!version) {
    printStatus('Serena', false, '未找到 serena；推荐用 uv tool install 安装')
    return false
  }

  printStatus('Serena', true, version)
  const dashboardUrls = getSerenaDashboardUrls()
  if (dashboardUrls.length > 0) {
    printStatus('Serena Dashboard', true, dashboardUrls.join(', '))
  } else {
    printStatus('Serena Dashboard', false, '未发现正在监听的 dashboard；MCP server 启动后通常为 http://127.0.0.1:24282/dashboard/')
  }
  return true
}

function main() {
  // 整体流程：检查基础命令 → 检查代码图谱工具 → 检查 MCP 模板目录 → 输出 bootstrap 建议。
  logInfo('检查 PetClaw AI 工具链。')

  const nodeVersion = process.version
  printStatus('Node.js', true, nodeVersion)
  printStatus('Git', hasCommand('git'), getCommandVersion('git'))
  printStatus('pnpm', hasCommand('pnpm'), getCommandVersion('pnpm'))
  printStatus('uv', hasCommand('uv'), getCommandVersion('uv'))

  const hasGitNexus = checkGitNexus()
  const hasSerena = checkSerena()
  // 这里只检查项目配置和模板目录是否存在，不校验每个客户端是否已经导入 MCP；客户端导入由 install/guide 处理。
  printStatus('项目级 MCP 配置', existsSync(PROJECT_MCP_CONFIG), PROJECT_MCP_CONFIG)
  printStatus('MCP 模板目录', existsSync(AI_TOOLS_DIR), AI_TOOLS_DIR)

  if (!hasGitNexus || !hasSerena) {
    // 检查脚本只负责告诉开发者缺什么，不执行安装；安装由 setup/bootstrap 的显式初始化流程触发。
    logWarn('AI 工具链尚未完整。首次接入推荐运行：pnpm ai:setup -- --client codex')
  }
}

main()
