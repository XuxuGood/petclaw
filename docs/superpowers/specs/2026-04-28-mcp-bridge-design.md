# MCP Bridge 完整实现设计

## 概述

为 PetClaw 实现完整的 MCP Bridge 基础设施，使 OpenClaw 本地扩展插件（`mcp-bridge` 和 `ask-user-question`）能正常工作。

PetClaw 已有两个 OpenClaw 本地扩展：
- **mcp-bridge**（`openclaw-extensions/mcp-bridge/`）：将 PetClaw 管理的 MCP 服务器工具暴露为 OpenClaw 原生工具
- **ask-user-question**（`openclaw-extensions/ask-user-question/`）：让 Agent 在执行危险操作前弹出结构化确认弹窗

两者都通过 HTTP callback 模式工作，但当前缺少主进程侧的关键基础设施。

## 问题

1. 没有 HTTP callback server 接收扩展插件的请求
2. 没有 MCP 连接管理器（连接 MCP server、发现 tools、调用 tools）
3. ConfigSync 没有将 `callbackUrl`/`secret`/`tools` 写入 `openclaw.json` 的 plugin config
4. `McpManager.toOpenclawConfig()` 输出旧格式（直接传 servers 连接信息），需改为 callback + tools 清单格式

## 数据流

### MCP 工具调用链路

```
Agent 调用 mcp_xxx_yyy tool
  -> OpenClaw runtime -> mcp-bridge 扩展 -> HTTP POST /mcp/execute
  -> McpBridgeServer 验证 secret
  -> McpServerManager.callTool(server, tool, args)
  -> MCP SDK Client -> 实际 MCP server 执行
  -> 结果返回 -> HTTP 响应 -> 扩展返回给 Agent
```

### AskUser 确认链路

```
Agent 调用 AskUserQuestion tool
  -> OpenClaw runtime -> ask-user-question 扩展 -> HTTP POST /askuser
  -> McpBridgeServer 验证 secret, 生成 requestId, 创建 pending Promise
  -> onAskUser callback -> IPC send 'cowork:stream:permission'
  -> Renderer CoworkPermissionModal 弹窗 -> 用户选择
  -> IPC 'cowork:permission:respond' -> mcpBridgeServer.resolveAskUser()
  -> HTTP 响应 -> 扩展返回给 Agent
```

### MCP 配置变更链路

```
用户在 Settings 增删改 MCP Server
  -> McpManager CRUD -> emit 'change'
  -> index.ts: refreshMcpBridge()
    -> McpServerManager.stopServers()
    -> McpServerManager.startServers(mcpManager.listEnabled())
    -> ConfigSync.sync('mcp-bridge-refresh')
      -> getMcpBridgeConfig() 回调返回最新 callbackUrl/secret/tools
      -> 写入 openclaw.json plugins.entries
      -> mcpBridgeConfigChanged 检测 -> needsGatewayRestart
    -> restartScheduler.requestRestart()
```

## 架构设计

### 模块职责

```
McpManager (已有, 修改)
  ├── MCP 服务器 CRUD（SQLite 持久化）
  ├── listEnabled() → 返回已启用的 MCP servers
  └── 删除 toOpenclawConfig()（不再直接输出 plugin 配置）

McpServerManager (新建)
  ├── MCP SDK 连接生命周期管理
  ├── startServers(servers) → 连接 + tools 发现
  ├── stopServers() → 断开所有连接
  ├── callTool(server, tool, args) → 路由到对应 server 执行
  └── toolManifest → 所有已发现的 tools 清单

McpBridgeServer (新建)
  ├── HTTP callback server (127.0.0.1 随机端口)
  ├── POST /mcp/execute → 验证 secret → callTool
  ├── POST /askuser → 验证 secret → AskUser 异步挂起
  ├── callbackUrl / askUserCallbackUrl
  ├── resolveAskUser(requestId, response)
  └── onAskUser / onAskUserDismiss 回调注册

mcpLog (新建)
  ├── serializeForLog(value) → 安全序列化（脱敏 apiKey/secret/token、截断长文本、处理循环引用）
  ├── truncateForLog(value, maxChars) → 截断字符串
  ├── serializeToolContentForLog(content) → MCP tool 结果内容日志格式化
  ├── getToolTextPreview(content) → 提取 text 内容摘要
  └── looksLikeTransportErrorText(text) → 判断是否为传输层错误（ECONNREFUSED/ENOTFOUND/timeout 等）

ConfigSync (修改)
  ├── 新增 getMcpBridgeConfig 回调注入
  ├── buildPluginsConfig() 写入 mcp-bridge + ask-user-question config
  ├── mcpBridgeConfigChanged 检测 → needsGatewayRestart
  ├── collectSecretEnvVars() 新增 PETCLAW_MCP_BRIDGE_SECRET
  └── bindChangeListeners() 移除 mcpManager change 监听

index.ts (修改)
  ├── boot: 创建实例 → startServers → startBridgeServer
  ├── refreshMcpBridge(): stop → start → sync → restart
  ├── mcpManager change → refreshMcpBridge()
  ├── AskUser callbacks → IPC 转发到 renderer
  ├── cowork:permission:respond dual-dispatch
  └── before-quit: stopServers + stopBridgeServer
```

### McpServerManager

**文件**：`src/main/mcp/mcp-server-manager.ts`

紧密参考 LobsterAI 的 `mcpServerManager.ts`。

```ts
export interface McpToolManifestEntry {
  server: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export class McpServerManager {
  private servers: Map<string, ManagedMcpServer>
  private _toolManifest: McpToolManifestEntry[]

  get toolManifest(): McpToolManifestEntry[]
  get isRunning(): boolean

  async startServers(servers: McpServer[]): Promise<McpToolManifestEntry[]>
  async stopServers(): Promise<void>
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<{ content: Array<{ type: string; text?: string }>; isError: boolean }>
}
```

实现要点：
- `startServers()` 先 `stopServers()` 清理旧连接，`Promise.allSettled()` 并行启动
- 每个 server 根据 `transportType` 创建 MCP SDK transport（Stdio/SSE/StreamableHTTP）
- `Client.connect(transport)` → `client.listTools()` 发现 tools
- `callTool()` 支持 `AbortSignal`，gateway 断连时取消进行中的 MCP 调用
- stdio transport 捕获 stderr 用于诊断日志
- 单个 server 连接/发现失败不阻塞其他 server

**Stdio Command Resolution**（参考 LobsterAI `resolveStdioCommand()`）：
- 打包环境下 node/npx/npm 命令解析：优先使用系统 Node.js，fallback 到 Electron runtime（`ELECTRON_RUN_AS_NODE=1`）
- macOS 打包：检测 command 是否指向 app 自身可执行文件，重写为 Electron helper
- Windows 打包：注入 `windowsHide` init script（`--require` 预加载），避免 subprocess console 窗口弹出
- `findSystemNodePath()` 缓存 `which node` 结果（进程生命周期内只查一次）

**Stderr 诊断**（参考 LobsterAI `appendRecentStderr()`/`summarizeRecentStderr()`）：
- stdio transport 监听 `stderr.on('data')`，保留最近 20 行
- `callTool()` 失败或返回 `isError=true` 时附带 stderr 摘要
- `looksLikeTransportErrorText()` 检测：即使 `isError=false` 也检查返回文本是否像传输错误

**AbortSignal Race**（参考 LobsterAI `raceAbortSignal()`）：
- `raceAbortSignal(promise, signal, reason)` 辅助函数
- signal 触发时立即 reject，原 promise 继续运行但结果丢弃
- `callTool()` 开始前也检查 `signal.aborted`

**Remote Transport**：
- SSE/StreamableHTTP 支持 `record.headers` → `requestInit.headers`
- 验证 URL 格式，无效 URL 跳过并记录警告

### mcpLog

**文件**：`src/main/mcp/mcp-log.ts`

紧密参考 LobsterAI 的 `mcpLog.ts`。

诊断日志工具模块，供 McpServerManager 和 McpBridgeServer 在日志输出时使用：

```ts
export function truncateForLog(value: string, maxChars?: number): string
export function serializeForLog(value: unknown, maxChars?: number): string
export function serializeToolContentForLog(
  content: Array<{ type?: string; text?: string; [key: string]: unknown }>,
  maxChars?: number
): string
export function getToolTextPreview(
  content: Array<{ type?: string; text?: string; [key: string]: unknown }>,
  maxChars?: number
): string
export function looksLikeTransportErrorText(text: string): boolean
```

实现要点：
- `serializeForLog()` 递归遍历对象/数组，脱敏敏感 key（`api-key`/`token`/`secret`/`password`/`authorization` 等），截断长字符串，处理循环引用
- 数组超过 10 项截断，对象超过 20 个 key 截断
- `looksLikeTransportErrorText()` 匹配 `ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT`/`fetch failed`/`socket hang up`/`tls`/`certificate` 等传输层错误模式
- 用于区分 MCP server 逻辑错误 vs 网络/传输错误，便于诊断

### McpBridgeServer

**文件**：`src/main/mcp/mcp-bridge-server.ts`

紧密参考 LobsterAI 的 `mcpBridgeServer.ts`。

```ts
export type AskUserRequest = {
  requestId: string
  questions: Array<{
    question: string
    header?: string
    options: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  }>
}

export type AskUserResponse = {
  behavior: 'allow' | 'deny'
  answers?: Record<string, string>
}

export class McpBridgeServer {
  constructor(mcpServerManager: McpServerManager, secret: string)

  get callbackUrl(): string | null      // http://127.0.0.1:{port}/mcp/execute
  get askUserCallbackUrl(): string | null // http://127.0.0.1:{port}/askuser

  onAskUser(callback: (request: AskUserRequest) => void): void
  onAskUserDismiss(callback: (requestId: string) => void): void
  resolveAskUser(requestId: string, response: AskUserResponse): void

  async start(): Promise<number>  // 返回端口号
  async stop(): Promise<void>
}
```

实现要点：
- `http.createServer()` 绑定 `127.0.0.1` 随机端口
- `handleRequest()` 路由：`/mcp/execute` → MCP 调用，`/askuser` → AskUser 流程
- secret 验证：`x-mcp-bridge-secret` 或 `x-ask-user-secret` header
- MCP 执行支持连接中断：`res.on('close')` + AbortController
- AskUser 120 秒超时 → 自动 deny

### ConfigSync 改造

**修改文件**：`src/main/ai/config-sync.ts`

新增类型：
```ts
export interface McpBridgeConfig {
  callbackUrl: string
  askUserCallbackUrl: string
  secret: string
  tools: McpToolManifestEntry[]
}
```

ConfigSyncOptions 新增：
```ts
getMcpBridgeConfig?: () => McpBridgeConfig | null
```

移除：
- `mcpManager` 构造参数和相关依赖
- `bindChangeListeners()` 中的 `mcpManager.on('change')` 监听

修改 `buildPluginsConfig()`：
```ts
private buildPluginsConfig(existingPlugins) {
  const mcpBridgeConfig = this.getMcpBridgeConfig?.()
  const mcpBridgePlugins = mcpBridgeConfig ? {
    entries: {
      'mcp-bridge': {
        enabled: true,
        config: {
          callbackUrl: mcpBridgeConfig.callbackUrl,
          secret: '${PETCLAW_MCP_BRIDGE_SECRET}',
          tools: mcpBridgeConfig.tools
        }
      },
      'ask-user-question': {
        enabled: true,
        config: {
          callbackUrl: mcpBridgeConfig.askUserCallbackUrl,
          secret: '${PETCLAW_MCP_BRIDGE_SECRET}'
        }
      }
    }
  } : {}
  // ... 合并 existing + im + mcpBridge plugins
}
```

`sync()` 新增 mcpBridgeConfigChanged 检测：
- JSON diff 当前 vs 上一次的 `plugins.entries['mcp-bridge'].config`
- `previousMcpBridgeConfigJson` 状态字段
- `needsGatewayRestart = bindingsChanged || secretEnvVarsChanged || mcpBridgeConfigChanged`

`collectSecretEnvVars()` 新增：
```ts
const bridgeConfig = this.getMcpBridgeConfig?.()
if (bridgeConfig?.secret) {
  vars.PETCLAW_MCP_BRIDGE_SECRET = bridgeConfig.secret
}
```

### McpManager 改造

**修改文件**：`src/main/mcp/mcp-manager.ts`

- 删除 `toOpenclawConfig()` 方法
- 新增 `listEnabled(): McpServer[]` — 返回 `enabled=true` 的 MCP servers

### index.ts 编排

**修改文件**：`src/main/index.ts`

新增模块级变量：
```ts
import { McpServerManager } from './mcp/mcp-server-manager'
import { McpBridgeServer } from './mcp/mcp-bridge-server'
let mcpServerManager: McpServerManager
let mcpBridgeServer: McpBridgeServer
const mcpBridgeSecret = crypto.randomUUID()
```

Boot 阶段初始化（在 ConfigSync 构造前）：
```ts
mcpServerManager = new McpServerManager()
mcpBridgeServer = new McpBridgeServer(mcpServerManager, mcpBridgeSecret)

// 启动 MCP servers（非阻塞，失败不影响 boot）
const enabledServers = mcpManager.listEnabled()
if (enabledServers.length > 0) {
  await mcpServerManager.startServers(enabledServers).catch(err =>
    console.error('[McpBridge] startup failed (non-fatal):', err))
}
// 始终启动 HTTP server（AskUser 也需要）
await mcpBridgeServer.start()
```

ConfigSync 构造注入 getMcpBridgeConfig：
```ts
configSync = new ConfigSync({
  // ...existing options, 移除 mcpManager
  getMcpBridgeConfig: () => {
    if (!mcpBridgeServer.callbackUrl || !mcpBridgeServer.askUserCallbackUrl) return null
    return {
      callbackUrl: mcpBridgeServer.callbackUrl,
      askUserCallbackUrl: mcpBridgeServer.askUserCallbackUrl,
      secret: mcpBridgeSecret,
      tools: mcpServerManager.toolManifest
    }
  }
})
```

AskUser 回调（boot 后注册）：
```ts
mcpBridgeServer.onAskUser((request) => {
  getMainWindow()?.webContents.send('cowork:stream:permission', {
    sessionId: 'mcp-bridge',
    request: {
      requestId: request.requestId,
      toolName: 'AskUserQuestion',
      toolInput: { questions: request.questions }
    }
  })
})

mcpBridgeServer.onAskUserDismiss((requestId) => {
  getMainWindow()?.webContents.send('cowork:stream:permission-dismiss', { requestId })
})
```

`cowork:permission:respond` dual-dispatch（在 chat-ipc.ts 中修改）：
```ts
safeHandle('cowork:permission:respond', async (_event, requestId, result) => {
  // MCP Bridge AskUser — no-op if requestId doesn't match
  if (mcpBridgeServer) {
    mcpBridgeServer.resolveAskUser(requestId, {
      behavior: result.behavior,
      answers: result.updatedInput?.answers
    })
  }
  // Standard cowork permission
  coworkController.respondToPermission(requestId, result)
})
```

MCP 变更刷新（mcpManager change 事件在 index.ts 管理）：
```ts
let mcpRefreshPromise: Promise<void> | null = null
mcpManager.on('change', () => {
  if (mcpRefreshPromise) return
  mcpRefreshPromise = refreshMcpBridge().finally(() => { mcpRefreshPromise = null })
})

async function refreshMcpBridge(): Promise<void> {
  await mcpServerManager.stopServers()
  const servers = mcpManager.listEnabled()
  if (servers.length > 0) {
    await mcpServerManager.startServers(servers)
  }
  const result = configSync.sync('mcp-bridge-refresh')
  if (result.needsGatewayRestart && engineManager.getStatus().phase === 'running') {
    restartScheduler.requestRestart('mcp-bridge-changed')
  }
}
```

before-quit 清理：
```ts
await mcpServerManager?.stopServers()
await mcpBridgeServer?.stop()
```

### IPC 变更

**mcp-ipc.ts** 新增：
```ts
safeHandle('mcp:bridge:refresh', async () => {
  await refreshMcpBridge()
  return { tools: mcpServerManager.toolManifest.length }
})
```

**preload** 新增：
```ts
mcp: {
  // ...existing
  refreshBridge: () => ipcRenderer.invoke('mcp:bridge:refresh')
}
```

### Renderer UI

**无需新增组件**。现有 `CoworkPermissionModal` 已完整支持 AskUserQuestion 的三种模式（标准审批、确认模式、多选模式）。`ChatView` 已监听 `onPermission`/`onPermissionDismiss` 并渲染弹窗。

## 文件清单

### 新建

| 文件 | 说明 |
|------|------|
| `src/main/mcp/mcp-server-manager.ts` | MCP SDK 连接管理器 |
| `src/main/mcp/mcp-bridge-server.ts` | HTTP callback server |
| `src/main/mcp/mcp-log.ts` | MCP 诊断日志工具（脱敏、截断、传输错误检测） |
| `tests/main/mcp/mcp-server-manager.test.ts` | McpServerManager 单元测试 |
| `tests/main/mcp/mcp-bridge-server.test.ts` | McpBridgeServer 集成测试 |
| `tests/main/mcp/mcp-log.test.ts` | mcpLog 单元测试 |

### 修改

| 文件 | 变更 |
|------|------|
| `src/main/mcp/mcp-manager.ts` | 删除 `toOpenclawConfig()`，新增 `listEnabled()` |
| `src/main/ai/config-sync.ts` | 新增 `getMcpBridgeConfig` 回调，移除 mcpManager 依赖，mcpBridgeConfigChanged 检测 |
| `src/main/ai/types.ts` | 新增 `McpToolManifestEntry` 类型 |
| `src/main/index.ts` | MCP Bridge 启动编排、refreshMcpBridge、AskUser 回调 |
| `src/main/ipc/mcp-ipc.ts` | 新增 `mcp:bridge:refresh` |
| `src/main/ipc/chat-ipc.ts` | `cowork:permission:respond` dual-dispatch |
| `src/preload/index.ts` | 新增 `mcp.refreshBridge` |
| `src/preload/index.d.ts` | 新增类型声明 |
| `tests/main/ai/config-sync.test.ts` | 验证 mcp-bridge 配置输出 |
| `petclaw-desktop/package.json` | 新增 `@modelcontextprotocol/sdk` |

## 验证

```bash
pnpm --filter petclaw-desktop typecheck
pnpm --filter petclaw-desktop test
```
