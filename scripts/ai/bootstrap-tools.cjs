#!/usr/bin/env node

// PetClaw AI 工具链 bootstrap 脚本。
// 使用场景：
// - 新机器初始化：pnpm ai:bootstrap -- --install --write-mcp。
// - 仓库迁移或工具链损坏后重新初始化。
// 设计原则：
// - 默认只初始化可用工具，不自动安装外部依赖。
// - 只有显式传 --install 才会安装 GitNexus / Serena。
// - hook 永远不调用本脚本，避免提交时发生下载或全局安装。

const {
  hasCommand,
  logInfo,
  logWarn,
  resolveGitNexusCommand,
  runCommand,
  runGitNexusForRepo
} = require('./gitnexus-utils.cjs')

const install = process.argv.includes('--install')
const initIndex = !process.argv.includes('--skip-index')
const initSerena = !process.argv.includes('--skip-serena-init')
const writeMcp = process.argv.includes('--write-mcp')
const clientIndex = process.argv.indexOf('--client')
// --client 只影响 MCP 模板生成范围，不代表安装某个 AI 客户端；真正接入客户端由 ai:mcp:install / ai:setup 负责。
const mcpClient = clientIndex >= 0 ? process.argv[clientIndex + 1] : 'all'

function installGitNexusIfNeeded() {
  // GitNexus 是代码图谱底座；安装后 hook 和手动脚本都能复用同一个全局命令。
  if (resolveGitNexusCommand()) {
    logInfo('GitNexus 已可用，跳过安装。')
    return true
  }

  if (!install) {
    logWarn('GitNexus 不可用。运行 pnpm ai:bootstrap -- --install 后可尝试自动安装。')
    return false
  }

  if (!hasCommand('npm')) {
    logWarn('未找到 npm，无法自动安装 GitNexus。请先安装 Node.js/npm。')
    return false
  }

  // 只有用户显式传入 --install 时才安装全局命令；这样 Git hooks 后续能直接找到 gitnexus，
  // 同时避免普通检查或提交阶段偷偷下载依赖。
  logInfo('使用 npm 全局安装 GitNexus。')
  const result = runCommand('npm', ['install', '--global', 'gitnexus'], { inherit: true })
  if (result.status !== 0) {
    logWarn('GitNexus 自动安装失败。可稍后设置 PETCLAW_GITNEXUS_USE_NPX=1 或手动安装 gitnexus。')
    return false
  }

  return true
}

function installSerenaIfNeeded() {
  // Serena 负责符号级导航；它依赖 uv 分发，因此这里不擅自安装 uv，只给出明确提示。
  if (hasCommand('serena')) {
    logInfo('Serena 已可用，跳过安装。')
    return true
  }

  if (!install) {
    logWarn('Serena 不可用。运行 pnpm ai:bootstrap -- --install 后可尝试自动安装。')
    return false
  }

  if (!hasCommand('uv')) {
    // uv 的安装方式和平台有关，脚本不擅自 curl 安装，避免把远程安装脚本带进仓库自动流程。
    logWarn('未找到 uv，无法自动安装 Serena。请先安装 uv，再重新运行 bootstrap。')
    logWarn('参考命令：brew install uv 或访问 https://docs.astral.sh/uv/getting-started/installation/')
    return false
  }

  logInfo('使用 uv tool 安装 Serena。')
  const result = runCommand(
    'uv',
    ['tool', 'install', '-p', '3.13', 'serena-agent@latest', '--prerelease=allow'],
    { inherit: true }
  )

  if (result.status !== 0) {
    logWarn('Serena 自动安装失败，请根据 uv 输出排查。')
    return false
  }

  return true
}

function initializeSerenaProject() {
  // Serena 的项目初始化是幂等预期操作；失败时提醒人工处理，不影响 GitNexus 或 MCP 模板生成。
  // dry-run 或沙箱环境可能不允许写 ~/.serena，因此 setup --dry-run 会显式传 --skip-serena-init。
  if (!initSerena) {
    logInfo('已通过 --skip-serena-init 跳过 Serena 项目初始化。')
    return
  }

  if (!hasCommand('serena')) {
    return
  }

  // Serena init 是项目级初始化；如果当前版本已经初始化，命令通常会快速返回或提示无需重复。
  logInfo('初始化 Serena 项目配置。')
  const result = runCommand('serena', ['init'], { inherit: true })
  if (result.status !== 0) {
    logWarn('Serena init 未成功完成，请根据上方输出手动处理。')
  }
}

function initializeGitNexusIndex() {
  // bootstrap 阶段默认建立一次索引，让后续 AI 第一次查询不会从空图谱开始。
  if (!initIndex) {
    logInfo('已通过 --skip-index 跳过 GitNexus 初始索引。')
    return
  }

  logInfo('初始化或刷新 GitNexus 索引。')
  const result = runGitNexusForRepo(['analyze'], { inherit: true })
  if (result.status !== 0) {
    logWarn('GitNexus analyze 未成功完成，可稍后手动运行 pnpm ai:index。')
  }
}

function writeDefaultMcpTemplates() {
  // MCP 写入分两层：项目级 .mcp.json 用于自动接入，.petclaw/ai-tools 模板用于客户端 fallback。
  if (!writeMcp) {
    return
  }

  // MCP 模板生成复用独立脚本，确保 bootstrap 和手动写模板时行为一致。
  const result = runCommand('node', ['scripts/ai/write-mcp-config.cjs', '--client', mcpClient], { inherit: true })
  if (result.status !== 0) {
    logWarn(`MCP 配置生成失败，请手动运行 pnpm ai:mcp:write -- --client ${mcpClient}。`)
  }
}

function main() {
  // 整体流程：安装/复用工具 → 初始化 Serena → 初始化 GitNexus → 可选生成 MCP 模板。
  // 每一步都允许降级继续，因为 bootstrap 的目标是把工具链尽量准备好，而不是阻断开发者进入项目。
  logInfo('启动 PetClaw AI 工具链 bootstrap。')
  installGitNexusIfNeeded()
  installSerenaIfNeeded()
  initializeSerenaProject()
  initializeGitNexusIndex()
  writeDefaultMcpTemplates()
  logInfo('bootstrap 完成。可运行 pnpm ai:tools:check 查看状态。')
}

main()
