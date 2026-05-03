#!/usr/bin/env node

// MCP 客户端接入说明脚本。
// 使用场景：
// - pnpm ai:mcp:guide -- --client claude-code
// - pnpm ai:mcp:guide -- --client qoder
// 设计原则：
// - 只准备仓库内项目级配置和客户端模板，不写用户全局配置。
// - 当客户端无法安全自动写入时，输出明确的最短人工步骤。

const { existsSync } = require('node:fs')

const {
  PROJECT_MCP_CONFIG,
  logInfo,
  runCommand
} = require('./gitnexus-utils.cjs')
const {
  CLIENTS,
  clientConfig
} = require('./mcp-client-registry.cjs')

function readArg(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function ensureProjectConfig(client) {
  const config = clientConfig(client)
  if (existsSync(PROJECT_MCP_CONFIG) && existsSync(config.templatePath)) {
    return
  }

  // guide 输出的路径必须真实存在，所以缺模板时先复用统一生成脚本补齐。
  const result = runCommand('node', ['scripts/ai/write-mcp-config.cjs', '--client', client], { inherit: true })
  if (result.status !== 0) {
    process.exit(result.status)
  }
}

function printClientInstructions(client) {
  // guide 的输出刻意保持为短步骤，方便开发者直接照着做，也方便 AI 客户端读取后转述给用户。
  const config = clientConfig(client)
  console.log('')
  console.log(`[AI Context] ${client} 接入说明：`)
  console.log(`- 项目级 MCP 配置：${config.projectConfigPath}`)
  console.log(`- 客户端模板：${config.templatePath}`)

  if (client === 'claude-code') {
    console.log('- Claude Code 支持项目级 MCP 时，直接打开本仓库即可读取 .mcp.json。')
    console.log('- 如果当前版本需要手动导入，请把 claude-code 模板合并到 MCP 配置。')
    return
  }

  if (client === 'qoder') {
    console.log('- Qoder 支持项目级 .mcp.json 时，优先使用仓库根目录配置。')
    console.log('- 如果当前 Qoder 版本只支持 UI 导入，请在 Agent mode 的 MCP 设置中粘贴 qoder 模板内容。')
    console.log('- 如果你知道 Qoder 本机配置路径，可运行：pnpm ai:mcp:install -- --client qoder --config <path>')
    return
  }

  if (client === 'codex') {
    console.log('- 推荐运行：pnpm ai:mcp:install -- --client codex')
    console.log('- 该命令会备份并安全更新 ~/.codex/config.toml 的 PetClaw MCP 托管区块。')
    return
  }

  if (config.installKind === 'guide-only') {
    console.log('- 当前客户端没有稳定的自动写入路径，脚本只生成模板并给出接入说明。')
    console.log('- 请把模板内容导入客户端 MCP 设置。')
    return
  }

  console.log(`- 推荐运行：pnpm ai:mcp:install -- --client ${client}`)
  console.log('- install 会先备份配置，再只合并 PetClaw 管理的 GitNexus / Serena MCP server。')
}

function main() {
  const client = readArg('--client')
  if (!client || !CLIENTS.has(client)) {
    // 客户端名称严格白名单化，避免拼错后生成不存在的模板路径。
    console.error(`用法：pnpm ai:mcp:guide -- --client <${Array.from(CLIENTS).join('|')}>`)
    process.exit(1)
  }

  ensureProjectConfig(client)
  logInfo(`已准备 ${client} 的 MCP 配置和接入说明。`)
  printClientInstructions(client)
}

main()
