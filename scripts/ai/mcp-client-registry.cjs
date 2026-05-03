const { homedir, platform } = require('node:os')
const { join } = require('node:path')

const {
  AI_TOOLS_DIR,
  PROJECT_MCP_CONFIG
} = require('./gitnexus-utils.cjs')

// MCP 客户端注册表。
// 所有客户端的路径、配置格式和自动化能力集中放在这里，避免 install/guide/write 三类脚本各自猜路径。
// 对无法稳定确认全局配置路径的客户端，默认只生成项目配置和模板，避免把用户个人 IDE 配置写坏。
const CLIENTS = new Set([
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

function expandHome(path) {
  // 用户常在 --config 里传 ~/xxx，这里统一展开，后续脚本只处理绝对或普通路径。
  if (!path || !path.startsWith('~')) {
    return path
  }

  return join(homedir(), path.slice(2))
}

function templateFileFor(client) {
  // Codex / Continue 的模板格式特殊，其余客户端使用 mcpServers JSON 模板。
  if (client === 'codex') {
    return join(AI_TOOLS_DIR, 'mcp.codex.example.toml')
  }

  if (client === 'continue') {
    return join(AI_TOOLS_DIR, 'mcp.continue.example.yaml')
  }

  return join(AI_TOOLS_DIR, `mcp.${client}.example.json`)
}

function claudeDesktopConfigPath() {
  // Claude Desktop 的配置文件路径按操作系统区分；这里只负责路径推断，不验证应用是否已安装。
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }

  if (platform() === 'win32') {
    return join(homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
  }

  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json')
}

function zedConfigPath() {
  // Zed 的 settings.json 位于用户配置目录；context_servers 会与其他设置共存。
  if (platform() === 'darwin') {
    return join(homedir(), '.config', 'zed', 'settings.json')
  }

  if (platform() === 'win32') {
    return join(homedir(), 'AppData', 'Roaming', 'Zed', 'settings.json')
  }

  return join(homedir(), '.config', 'zed', 'settings.json')
}

function clientConfig(client, options = {}) {
  // 显式 --config 或 PETCLAW_<CLIENT>_MCP_CONFIG 优先级最高，用于 Qoder 等路径不稳定客户端。
  const explicitPath = options.configPath || process.env[`PETCLAW_${client.toUpperCase().replace(/-/g, '_')}_MCP_CONFIG`]

  if (!CLIENTS.has(client)) {
    return null
  }

  if (client === 'codex') {
    return {
      client,
      installKind: 'toml-managed-block',
      configPath: explicitPath ? expandHome(explicitPath) : join(homedir(), '.codex', 'config.toml'),
      templatePath: templateFileFor(client),
      projectConfigPath: PROJECT_MCP_CONFIG,
      description: 'Codex 使用 ~/.codex/config.toml 的 mcp_servers 配置。'
    }
  }

  if (client === 'claude-code') {
    // Claude Code 的推荐路径是项目级 .mcp.json，因此 install 不写用户全局配置。
    return {
      client,
      installKind: 'project-config',
      configPath: PROJECT_MCP_CONFIG,
      templatePath: templateFileFor(client),
      projectConfigPath: PROJECT_MCP_CONFIG,
      description: 'Claude Code 优先使用仓库根目录 .mcp.json 的项目级 MCP 配置。'
    }
  }

  if (client === 'claude-desktop') {
    return {
      client,
      installKind: 'json-mcpServers',
      configPath: explicitPath ? expandHome(explicitPath) : claudeDesktopConfigPath(),
      templatePath: templateFileFor(client),
      projectConfigPath: PROJECT_MCP_CONFIG,
      description: 'Claude Desktop 使用 claude_desktop_config.json 的 mcpServers 配置。'
    }
  }

  if (client === 'cursor') {
    return {
      client,
      installKind: 'json-mcpServers',
      configPath: explicitPath ? expandHome(explicitPath) : join(homedir(), '.cursor', 'mcp.json'),
      templatePath: templateFileFor(client),
      projectConfigPath: PROJECT_MCP_CONFIG,
      description: 'Cursor 使用 ~/.cursor/mcp.json 的 mcpServers 配置。'
    }
  }

  if (client === 'zed') {
    return {
      client,
      installKind: 'json-context_servers',
      configPath: explicitPath ? expandHome(explicitPath) : zedConfigPath(),
      templatePath: templateFileFor(client),
      projectConfigPath: PROJECT_MCP_CONFIG,
      description: 'Zed 使用 settings.json 的 context_servers 配置。'
    }
  }

  if (client === 'qoder' && explicitPath) {
    // Qoder 当前没有稳定的跨平台默认路径；只有用户显式给路径时才执行自动合并。
    return {
      client,
      installKind: 'json-mcpServers',
      configPath: expandHome(explicitPath),
      templatePath: templateFileFor(client),
      projectConfigPath: PROJECT_MCP_CONFIG,
      description: 'Qoder 显式指定了 MCP 配置路径，脚本会按 mcpServers JSON 安全合并。'
    }
  }

  return {
    // 未明确支持自动写入的客户端统一 guide-only，保证“自动化”不会越权写未知配置文件。
    client,
    installKind: 'guide-only',
    configPath: null,
    templatePath: templateFileFor(client),
    projectConfigPath: PROJECT_MCP_CONFIG,
    description: '当前客户端未配置稳定的自动写入路径，默认生成项目配置和模板并输出接入说明。'
  }
}

module.exports = {
  CLIENTS,
  clientConfig,
  templateFileFor
}
