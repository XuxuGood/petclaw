// 将 App 管理的 MCP 服务器工具暴露为 Openclaw 原生工具
// 每个 MCP 工具注册一个代理 tool（名称格式 mcp_{server}_{tool}）
// Agent 调用代理 tool → HTTP POST 回调 App → App 调用实际 MCP → 返回结果

export interface McpBridgeConfig {
  callbackUrl: string
  secret: string
  requestTimeoutMs?: number
  tools: McpToolDescriptor[]
}

export interface McpToolDescriptor {
  server: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export function register(_sdk: unknown): void {
  // _sdk.registerTool('mcp_{server}_{tool}', { ... }) for each tool
  // tool handler:
  //   1. fetch(config.callbackUrl, { method: 'POST', headers: { 'x-ask-user-secret': config.secret }, body: { server, tool, input } })
  //   2. 等待响应或 requestTimeoutMs 超时
  //   3. 返回结果
  console.warn('[mcp-bridge] Extension registered (skeleton)')
}
