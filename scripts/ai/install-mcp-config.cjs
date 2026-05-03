#!/usr/bin/env node

// MCP 客户端自动安装脚本。
// 使用场景：
// - pnpm ai:mcp:install -- --client codex
// - pnpm ai:mcp:install -- --client qoder --config ~/path/to/mcp.json
// 设计原则：
// - 能安全确认配置路径时自动合并，不能确认时自动降级到 guide。
// - 写入前必须备份已有配置，只管理 gitnexus / serena 两个 server。
// - 支持 --dry-run 预览，方便开发者确认脚本会改哪里。

const { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } = require('node:fs')
const { dirname } = require('node:path')

const {
  createMcpServersConfig,
  logInfo,
  logWarn,
  runCommand
} = require('./gitnexus-utils.cjs')
const {
  CLIENTS,
  clientConfig
} = require('./mcp-client-registry.cjs')

const MANAGED_START = '# >>> PetClaw AI Context MCP'
const MANAGED_END = '# <<< PetClaw AI Context MCP'

function readArg(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function timestamp() {
  // 备份文件名使用本地时间即可，便于开发者在配置目录里肉眼找到最近一次脚本写入。
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('')
}

function ensureProjectConfig(client) {
  // install 之前先保证 .mcp.json 和对应模板存在，失败时直接终止，避免写入过期 server 命令。
  const result = runCommand('node', ['scripts/ai/write-mcp-config.cjs', '--client', client], { inherit: true })
  if (result.status !== 0) {
    process.exit(result.status)
  }
}

function readJsonFile(path) {
  // 客户端配置不存在时按空对象处理，让 install 可以完成首次创建。
  if (!existsSync(path)) {
    return {}
  }

  const content = readFileSync(path, 'utf8').trim()
  if (!content) {
    return {}
  }

  return JSON.parse(content)
}

function backupFile(path, dryRun) {
  // 只有已有配置才备份；dry-run 只打印将要备份的位置，不实际写文件。
  if (!existsSync(path)) {
    return null
  }

  const backupPath = `${path}.bak.${timestamp()}`
  if (!dryRun) {
    copyFileSync(path, backupPath)
  }

  return backupPath
}

function writeJsonConfig(path, key, servers, dryRun) {
  // JSON 客户端使用浅合并：只更新 mcpServers/context_servers 下的 PetClaw server，不动用户已有 server。
  const current = readJsonFile(path)
  const next = {
    ...current,
    [key]: {
      ...(current[key] || {}),
      ...servers
    }
  }

  if (dryRun) {
    console.log(`[AI Context] dry-run：将写入 ${path}`)
    console.log(JSON.stringify(next, null, 2))
    return
  }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

function codexManagedBlock() {
  // Codex 使用 TOML，不能像 JSON 一样安全深合并，所以用明确托管区块实现可重复更新。
  return `${MANAGED_START}
[mcp_servers.gitnexus]
command = "gitnexus"
args = ["mcp"]

[mcp_servers.serena]
startup_timeout_sec = 15
command = "serena"
args = ["start-mcp-server", "--project-from-cwd", "--open-web-dashboard=false", "--context=codex"]
${MANAGED_END}`
}

function writeTomlManagedBlock(path, dryRun) {
  // 如果托管区块已存在，只替换区块内容；如果不存在，追加到文件末尾，避免解析并重写用户整份 TOML。
  const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const block = codexManagedBlock()
  const managedPattern = new RegExp(`${MANAGED_START}[\\s\\S]*?${MANAGED_END}`, 'm')
  const next = managedPattern.test(current)
    ? current.replace(managedPattern, block)
    : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`

  if (dryRun) {
    console.log(`[AI Context] dry-run：将写入 ${path}`)
    console.log(next)
    return
  }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, next.endsWith('\n') ? next : `${next}\n`, 'utf8')
}

function runGuide(client) {
  // 路径不稳定的客户端走 guide，而不是猜测全局配置路径后写坏用户设置。
  const result = runCommand('node', ['scripts/ai/guide-mcp-config.cjs', '--client', client], { inherit: true })
  process.exit(result.status)
}

function installForClient(config, dryRun) {
  // installKind 来自注册表，决定写入形态：项目级配置、JSON 合并、TOML 托管区块或降级 guide。
  const servers = createMcpServersConfig().mcpServers

  if (config.installKind === 'project-config') {
    logInfo(`${config.client} 使用项目级配置，无需写入全局配置：${config.projectConfigPath}`)
    return
  }

  if (config.installKind === 'guide-only') {
    logWarn(`${config.client} 未配置稳定的自动写入路径，已降级为接入说明。`)
    runGuide(config.client)
    return
  }

  const backupPath = backupFile(config.configPath, dryRun)
  if (backupPath) {
    logInfo(`${dryRun ? 'dry-run：将备份原配置到' : '已备份原配置'}：${backupPath}`)
  }

  if (config.installKind === 'json-mcpServers') {
    writeJsonConfig(config.configPath, 'mcpServers', servers, dryRun)
    logInfo(`已${dryRun ? '预览' : '写入'} ${config.client} MCP 配置：${config.configPath}`)
    return
  }

  if (config.installKind === 'json-context_servers') {
    writeJsonConfig(config.configPath, 'context_servers', servers, dryRun)
    logInfo(`已${dryRun ? '预览' : '写入'} ${config.client} MCP 配置：${config.configPath}`)
    return
  }

  if (config.installKind === 'toml-managed-block') {
    writeTomlManagedBlock(config.configPath, dryRun)
    logInfo(`已${dryRun ? '预览' : '写入'} ${config.client} MCP 配置：${config.configPath}`)
  }
}

function main() {
  const client = readArg('--client')
  const configPath = readArg('--config')
  const dryRun = hasFlag('--dry-run')

  if (!client || !CLIENTS.has(client)) {
    // install 会写用户配置，客户端名必须明确有效，不能用默认值猜测。
    console.error(`用法：pnpm ai:mcp:install -- --client <${Array.from(CLIENTS).join('|')}> [--config <path>] [--dry-run]`)
    process.exit(1)
  }

  ensureProjectConfig(client)
  const config = clientConfig(client, { configPath })
  logInfo(config.description)
  installForClient(config, dryRun)
}

main()
