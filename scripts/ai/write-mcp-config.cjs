#!/usr/bin/env node

// MCP 客户端配置生成脚本。
// 使用场景：
// - pnpm ai:mcp:write
// - pnpm ai:mcp:write -- --client codex
// - pnpm ai:mcp:write -- --client all
// 设计原则：
// - 默认写项目级 .mcp.json，让支持项目级 MCP 的客户端自动接入。
// - 同时在 .petclaw/ai-tools 下生成客户端模板，作为不支持项目级配置时的 fallback。
// - 不直接修改用户全局 IDE / Agent 配置，避免污染个人环境。

const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const {
  AI_TOOLS_DIR,
  PROJECT_MCP_CONFIG,
  createMcpServersConfig,
  logInfo
} = require('./gitnexus-utils.cjs')

const CLIENTS = new Set([
  'all',
  'codex',
  'claude-code',
  'claude-desktop',
  'qoder',
  'cursor',
  'windsurf',
  'continue',
  'cline',
  'roo',
  'zed'
])

function readArg(name, fallback) {
  // 保持参数解析轻量，避免为了简单模板生成引入 CLI 依赖。
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function jsonMcpConfig() {
  // 大多数 MCP 客户端接受 mcpServers JSON 结构，因此把通用模板集中在这里生成。
  return createMcpServersConfig()
}

function codexToml() {
  // Codex 使用 TOML 配置片段，单独生成能避免用户手动从 JSON 转格式。
  // Serena 在 Codex 下使用专用 context，让 Serena 的提示和工具行为贴合 Codex 的交互模型。
  return `# PetClaw MCP 配置片段
# 将本片段合并到 Codex 的 config.toml。

[mcp_servers.gitnexus]
command = "gitnexus"
args = ["mcp"]

[mcp_servers.serena]
startup_timeout_sec = 15
command = "serena"
args = ["start-mcp-server", "--project-from-cwd", "--open-web-dashboard=false", "--context=codex"]
`
}

function continueConfig() {
  // Continue 的配置格式随版本变化较快，因此输出 YAML 示例并提示用户合并到当前版本配置。
  return `# PetClaw MCP 配置示例
# Continue 的配置格式会随版本变化；如果当前版本支持 MCP，请把 servers 部分合并到对应配置。

mcpServers:
  gitnexus:
    command: gitnexus
    args:
      - mcp
  serena:
    command: serena
    args:
      - start-mcp-server
      - --project-from-cwd
      - --open-web-dashboard=false
`
}

function zedConfig() {
  // Zed 使用 context_servers 命名，结构和通用 mcpServers 不完全一致。
  const servers = createMcpServersConfig().mcpServers
  return {
    context_servers: {
      gitnexus: servers.gitnexus,
      serena: servers.serena
    }
  }
}

function templateFor(client) {
  // 不同客户端只在文件名和外层格式上差异明显，server 命令保持一致，方便后续统一升级。
  // 新客户端接入时优先在这里新增格式分支，再更新 mcp-client-registry 的安装策略。
  if (client === 'codex') {
    return {
      filename: 'mcp.codex.example.toml',
      content: codexToml()
    }
  }

  if (client === 'continue') {
    return {
      filename: 'mcp.continue.example.yaml',
      content: continueConfig()
    }
  }

  if (client === 'zed') {
    return {
      filename: 'mcp.zed.example.json',
      content: `${JSON.stringify(zedConfig(), null, 2)}\n`
    }
  }

  // Claude Code、Qoder、Cursor、Windsurf、Cline、Roo 等客户端都能消费接近 mcpServers 的 JSON 形态。
  // 不同产品的落盘路径不同，因此仓库只生成模板，不直接写用户全局配置。
  return {
    filename: `mcp.${client}.example.json`,
    content: `${JSON.stringify(jsonMcpConfig(), null, 2)}\n`
  }
}

function clientsToWrite(client) {
  // 明确限制可生成的客户端名称，避免拼错参数时悄悄创建错误文件。
  if (!CLIENTS.has(client)) {
    console.error(`未知客户端：${client}`)
    console.error(`可选值：${Array.from(CLIENTS).join(', ')}`)
    process.exit(1)
  }

  if (client === 'all') {
    return Array.from(CLIENTS).filter((item) => item !== 'all')
  }

  return [client]
}

function main() {
  // 整体流程：先写项目级配置 → 再解析客户端 → 确保目录存在 → 写入一个或全部模板。
  // 即使只请求单个客户端模板，也刷新 .mcp.json，保证项目级入口始终是最新 server 命令。
  const client = readArg('--client', 'all')
  writeFileSync(PROJECT_MCP_CONFIG, `${JSON.stringify(createMcpServersConfig(), null, 2)}\n`, 'utf8')
  logInfo(`已生成项目级 MCP 配置 ${PROJECT_MCP_CONFIG}`)

  mkdirSync(AI_TOOLS_DIR, { recursive: true })

  for (const item of clientsToWrite(client)) {
    const template = templateFor(item)
    const path = join(AI_TOOLS_DIR, template.filename)
    writeFileSync(path, template.content, 'utf8')
    logInfo(`已生成 ${path}`)
  }
}

main()
