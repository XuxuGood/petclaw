// openclaw-extensions/mcp-bridge/index.ts
// MCP Bridge — OpenClaw 本地扩展
//
// 将 PetClaw 管理的 MCP (Model Context Protocol) 服务器工具暴露为 OpenClaw 原生工具。
// Agent 调用代理 tool 时，本扩展通过 HTTP POST 转发给 PetClaw，PetClaw 再调用真实的 MCP server。
//
// 工作流程：
//   1. PetClaw 启动时，将用户配置的 MCP server 列表写入 openclaw.json → plugins → mcp-bridge → config.tools
//   2. 本扩展读取 tools 数组，为每个 MCP tool 注册一个代理 tool（名称格式 mcp_{server}_{tool}）
//   3. Agent 调用代理 tool → invokeBridge() 发起 HTTP POST 到 PetClaw callbackUrl
//   4. PetClaw 收到请求后调用对应的 MCP server，将结果返回
//   5. 本扩展将结果规范化后返回给 Agent
//
// 命名去重：
//   如果两个不同 MCP server 暴露了同名 tool，buildRegisteredToolName() 会自动追加序号
//   例如：mcp_server1_read、mcp_server2_read_2
//
// 配置来源：openclaw.json → plugins → mcp-bridge → config
//   - callbackUrl: PetClaw HookServer 的 MCP 转发端点（如 http://127.0.0.1:{port}/mcp-bridge）
//   - secret: 共享密钥，通过 x-mcp-bridge-secret 头验证
//   - requestTimeoutMs: 单次 MCP 调用超时（默认 120s，最小 1s）
//   - tools: MCP tool 描述数组 [{ server, name, description, inputSchema }]

import { Type } from '@sinclair/typebox'
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'

// ── 类型定义 ────────────────────────────────────────────────────────────────────

/** 单个 MCP tool 的配置（由 PetClaw 注入） */
type McpBridgeToolConfig = {
  server: string
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

/** 插件整体配置 */
type McpBridgePluginConfig = {
  callbackUrl: string
  secret: string
  requestTimeoutMs: number
  tools: McpBridgeToolConfig[]
}

/** OpenClaw tool 执行结果的标准格式 */
type ToolResultPayload = {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>
  isError?: boolean
  details?: unknown
}

// ── 常量 ────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000
// inputSchema 缺失时的降级 schema：接受任意对象
const FALLBACK_INPUT_SCHEMA = Type.Object({}, { additionalProperties: true })

// ── 工具函数 ────────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 将 server/tool 名称规范化为合法的 OpenClaw tool 注册名片段。
 * 仅保留小写字母、数字、下划线，去除首尾下划线。
 * 例如："My Server!" → "my_server"
 */
const sanitizeToolSegment = (value: string): string => {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return sanitized || 'tool'
}

/**
 * 拼接 mcp_{server}_{tool} 格式的注册名。
 * 同名冲突时自动追加递增序号（_2、_3...），保证全局唯一。
 */
const buildRegisteredToolName = (server: string, tool: string, usedNames: Set<string>): string => {
  const base = `mcp_${sanitizeToolSegment(server)}_${sanitizeToolSegment(tool)}`
  let next = base
  let index = 2
  while (usedNames.has(next)) {
    next = `${base}_${index}`
    index += 1
  }
  usedNames.add(next)
  return next
}

/** inputSchema 无效时降级为接受任意对象的 schema */
const normalizeInputSchema = (value: unknown): Record<string, unknown> => {
  return isRecord(value) ? value : FALLBACK_INPUT_SCHEMA
}

/** 从 unknown 中安全解析单个 tool 配置，无效则返回 null 跳过 */
const parseToolConfig = (value: unknown): McpBridgeToolConfig | null => {
  if (!isRecord(value)) {
    return null
  }

  const server = typeof value.server === 'string' ? value.server.trim() : ''
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!server || !name) {
    return null
  }

  return {
    server,
    name,
    description: typeof value.description === 'string' ? value.description.trim() : undefined,
    inputSchema: normalizeInputSchema(value.inputSchema)
  }
}

/** 从 unknown 中安全解析插件整体配置 */
const parsePluginConfig = (value: unknown): McpBridgePluginConfig => {
  const raw = isRecord(value) ? value : {}
  const tools = Array.isArray(raw.tools)
    ? raw.tools.map(parseToolConfig).filter((tool): tool is McpBridgeToolConfig => !!tool)
    : []

  return {
    callbackUrl: typeof raw.callbackUrl === 'string' ? raw.callbackUrl.trim() : '',
    secret: typeof raw.secret === 'string' ? raw.secret.trim() : '',
    requestTimeoutMs:
      typeof raw.requestTimeoutMs === 'number' &&
      Number.isFinite(raw.requestTimeoutMs) &&
      raw.requestTimeoutMs > 0
        ? Math.max(1_000, Math.floor(raw.requestTimeoutMs))
        : DEFAULT_TIMEOUT_MS,
    tools
  }
}

/**
 * 从 MCP server 的错误响应中提取人类可读的错误消息。
 * 依次尝试：string → payload.error → payload.content[0].text
 */
const extractErrorMessage = (payload: unknown): string | null => {
  if (!payload) {
    return null
  }
  if (typeof payload === 'string') {
    return payload.trim() || null
  }
  if (!isRecord(payload)) {
    return null
  }
  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error.trim()
  }
  // 尝试从 content 数组的第一个 text block 提取
  const content = Array.isArray(payload.content) ? payload.content : []
  for (const block of content) {
    if (!isRecord(block)) {
      continue
    }
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      return block.text.trim()
    }
  }
  return null
}

/**
 * 将 MCP server 的任意响应规范化为 OpenClaw tool 结果格式。
 * 如果响应已经是 { content: [...] } 格式则直接使用，否则包装为 text block。
 */
const ensureToolResultPayload = (
  payload: unknown,
  details: Record<string, unknown>
): ToolResultPayload => {
  // 响应已经是标准格式，直接透传
  if (isRecord(payload) && Array.isArray(payload.content)) {
    return {
      ...payload,
      details: payload.details ?? details
    } as ToolResultPayload
  }

  // 非标准格式，包装为 text block
  const text =
    typeof payload === 'string' ? payload : JSON.stringify(payload ?? { ok: true }, null, 2)

  return {
    content: [{ type: 'text', text }],
    details: payload ?? details
  }
}

/** 生成 tool 描述文本，包含 MCP server/tool 名称和可选的自定义描述 */
const buildToolDescription = (tool: McpBridgeToolConfig): string => {
  const parts = [`Proxy to MCP tool "${tool.name}" on server "${tool.server}".`]
  if (tool.description) {
    parts.push(tool.description)
  }
  return parts.join(' ')
}

// ── 核心逻辑：向 PetClaw 发起 HTTP 转发 ────────────────────────────────────────

/**
 * 向 PetClaw callbackUrl 发起 MCP tool 调用请求。
 * PetClaw 收到后转发给对应的 MCP server，将结果透传回来。
 * 超时由 AbortController 控制，超时后抛出 AbortError。
 */
const invokeBridge = async (
  config: McpBridgePluginConfig,
  tool: McpBridgeToolConfig,
  args: Record<string, unknown>
): Promise<unknown> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs)

  try {
    const response = await fetch(config.callbackUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mcp-bridge-secret': config.secret
      },
      body: JSON.stringify({
        server: tool.server,
        tool: tool.name,
        args
      }),
      signal: controller.signal
    })

    const responseText = await response.text()
    let payload: unknown = null

    if (responseText.trim()) {
      try {
        payload = JSON.parse(responseText)
      } catch {
        // JSON 解析失败：如果 HTTP 也失败则抛错，否则当作纯文本
        if (!response.ok) {
          throw new Error(`MCP bridge HTTP ${response.status}: ${responseText.trim()}`)
        }
        payload = responseText
      }
    }

    if (!response.ok) {
      const message =
        extractErrorMessage(payload) || response.statusText || 'Unknown MCP bridge error'
      throw new Error(`MCP bridge HTTP ${response.status}: ${message}`)
    }

    return payload
  } finally {
    clearTimeout(timer)
  }
}

// ── 插件定义 ────────────────────────────────────────────────────────────────────

const plugin = {
  id: 'mcp-bridge',
  name: 'MCP Bridge',
  description: 'Expose PetClaw-managed MCP servers as native OpenClaw tools.',
  configSchema: {
    parse(value: unknown): McpBridgePluginConfig {
      return parsePluginConfig(value)
    },
    // UI 提示：callbackUrl/secret 是内部配置，对用户隐藏在 Advanced 中
    uiHints: {
      callbackUrl: { label: 'Callback URL', advanced: true },
      secret: { label: 'Secret', sensitive: true, advanced: true },
      requestTimeoutMs: { label: 'Request Timeout (ms)', advanced: true }
    }
  },
  register(api: OpenClawPluginApi) {
    const config = parsePluginConfig(api.pluginConfig)
    // 三者缺一则跳过注册（PetClaw 未配置 MCP server 时 tools 为空）
    if (!config.callbackUrl || !config.secret || config.tools.length === 0) {
      api.logger.info(
        '[mcp-bridge] skipped registration because callbackUrl/secret/tools are incomplete.'
      )
      return
    }

    // 用 Set 跟踪已注册名称，防止同名 tool 覆盖
    const usedToolNames = new Set<string>()

    for (const tool of config.tools) {
      const registeredName = buildRegisteredToolName(tool.server, tool.name, usedToolNames)
      // details 附加在每次执行结果中，方便调试追溯
      const details = {
        alias: registeredName,
        server: tool.server,
        tool: tool.name
      }

      api.registerTool({
        name: registeredName,
        label: `MCP ${tool.server}/${tool.name}`,
        description: buildToolDescription(tool),
        parameters: tool.inputSchema,
        async execute(_id: string, params: Record<string, unknown>) {
          try {
            const payload = await invokeBridge(config, tool, params)
            return ensureToolResultPayload(payload, details)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return {
              content: [{ type: 'text', text: message }],
              isError: true,
              details
            }
          }
        }
      })
    }

    api.logger.info(`[mcp-bridge] registered ${config.tools.length} tool(s).`)
  }
}

export default plugin
