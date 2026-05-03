#!/usr/bin/env node

// AI 上下文工具链一键初始化脚本。
// 使用场景：
// - pnpm ai:setup -- --client codex
// - pnpm ai:setup -- --client codex --dry-run
// 设计原则：
// - 新机器或新仓库尽量一条命令完成工具安装、项目配置生成、客户端接入。
// - 日常开发不依赖本脚本，Git hooks 会自动刷新索引和做影响分析。
// - 客户端无法安全自动写入时，自动降级到 guide，不强行写未知路径。

const {
  logInfo,
  logWarn,
  runCommand
} = require('./gitnexus-utils.cjs')
const { CLIENTS } = require('./mcp-client-registry.cjs')

function readArg(name, fallback) {
  // setup 只需要少量参数，保持零依赖解析，避免首次接入前还要安装 CLI 参数库。
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function runStep(label, command, args, options = {}) {
  // setup 是组合入口：多数步骤失败都应继续跑后续检查，让用户一次看到所有缺口。
  logInfo(label)
  const result = runCommand(command, args, { inherit: true })
  if (result.status !== 0 && options.required) {
    process.exit(result.status)
  }

  if (result.status !== 0) {
    logWarn(`${label} 未成功完成，继续执行后续可降级步骤。`)
  }

  return result.status === 0
}

function main() {
  const client = readArg('--client', 'codex')
  const dryRun = hasFlag('--dry-run')
  // --skip-install-tools 给已安装工具的开发者或 CI 使用，只生成配置和检查状态。
  const skipInstallTools = hasFlag('--skip-install-tools')
  const skipIndex = hasFlag('--skip-index')
  const configPath = readArg('--config')

  if (!CLIENTS.has(client)) {
    console.error(`用法：pnpm ai:setup -- --client <${Array.from(CLIENTS).join('|')}> [--dry-run] [--config <path>]`)
    process.exit(1)
  }

  logInfo(`开始初始化 PetClaw AI 上下文工具链，目标客户端：${client}`)

  if (dryRun) {
    logInfo('dry-run 模式不会安装外部工具，也不会写客户端全局配置。')
  }

  const bootstrapArgs = ['scripts/ai/bootstrap-tools.cjs', '--write-mcp', '--client', 'all']
  if (!skipInstallTools && !dryRun) {
    bootstrapArgs.push('--install')
  }
  if (skipIndex || dryRun) {
    bootstrapArgs.push('--skip-index')
  }
  if (dryRun) {
    // dry-run 不能写用户 home 下的 Serena 配置，也不应触发耗时索引任务。
    bootstrapArgs.push('--skip-serena-init')
  }

  runStep('准备 GitNexus / Serena / MCP 项目配置。', 'node', bootstrapArgs, { required: false })

  const installArgs = ['scripts/ai/install-mcp-config.cjs', '--client', client]
  if (dryRun) {
    installArgs.push('--dry-run')
  }
  if (configPath) {
    // --config 只传给 install 阶段，用于 Qoder 等没有稳定默认路径的客户端。
    installArgs.push('--config', configPath)
  }

  runStep('安装或准备客户端 MCP 配置。', 'node', installArgs, { required: false })
  runStep('检查 AI 工具链状态。', 'node', ['scripts/ai/check-ai-tools.cjs'], { required: false })

  logInfo('AI 上下文工具链初始化流程结束。日常开发由 Husky 和 AI 入口规则自动处理。')
}

main()
