# MCP 架构设计

## 1. 模块定位

MCP 模块负责 MCP 配置 CRUD、server 连接管理、bridge 回调服务和 OpenClaw runtime 集成。

## 2. 核心概念

- McpManager：配置管理。
- McpServerManager：SDK 连接和生命周期管理。
- McpBridgeServer：HTTP 回调服务。
- mcp-bridge extension：OpenClaw 侧桥接插件。
- AskUserQuestion：与 MCP Bridge 共用 HTTP server 和 secret 的用户提问扩展。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ Renderer                                                           │
│ MCP 设置页：server 列表 / 配置表单 / tool manifest / 同步状态        │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ window.api.mcp
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Main Process                                                        │
│                                                                    │
│  McpManager                     McpServerManager                    │
│  - mcp_servers CRUD             - SDK connection                    │
│  - enabled toggle        ─────▶  - tool discovery                    │
│  - emit change                  - callTool                          │
│                                                                    │
│  McpBridgeServer                                                    │
│  - POST /mcp/execute  ◀──── OpenClaw mcp-bridge extension           │
│  - POST /askuser      ◀──── OpenClaw ask-user-question extension     │
│  - x-mcp-bridge-secret validation                                   │
│                                                                    │
│  ConfigSync                                                         │
│  - plugins.entries.mcp-bridge                                       │
│  - plugins.entries.ask-user-question                                │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ External MCP Servers                                                │
│ stdio / sse / streamable-http                                       │
└────────────────────────────────────────────────────────────────────┘
```

三层职责：

| 层 | 职责 |
|---|---|
| McpManager | `mcp_servers` 配置 CRUD，emit change |
| McpServerManager | SDK 连接、tool 发现、tool 调用 |
| McpBridgeServer | 绑定本地 HTTP callback，处理 runtime 回调 |

关键文件：

| 层 | 文件 |
|---|---|
| Config CRUD | `petclaw-desktop/src/main/mcp/mcp-manager.ts` |
| SDK connection | `petclaw-desktop/src/main/mcp/mcp-server-manager.ts` |
| HTTP bridge | `petclaw-desktop/src/main/mcp/mcp-bridge-server.ts` |
| Safe logging | `petclaw-desktop/src/main/mcp/mcp-log.ts` |
| Store | `petclaw-desktop/src/main/data/mcp-store.ts` |
| IPC | `petclaw-desktop/src/main/ipc/mcp-ipc.ts` |
| Renderer settings | `petclaw-desktop/src/renderer/src/views/settings/McpSettings.tsx` |
| Connector popup | `petclaw-desktop/src/renderer/src/components/ConnectorPopup.tsx` |

## 4. 端到端数据流

用户新增 MCP server；main 持久化配置并测试连接；McpServerManager 建立或刷新连接；McpBridgeServer 暴露回调；ConfigSync 将 bridge 配置写入 runtime；OpenClaw 调用 mcp-bridge 时回到 PetClaw 主进程执行。

完整刷新流：

```text
McpManager change
→ refreshMcpBridge()
  → renderer mcp:bridge:syncStart
  → McpServerManager.stopServers()
  → McpServerManager.startServers(enabledServers)
  → 发现 tools
  → ConfigSync.sync('mcp-bridge-refresh')
  → needsGatewayRestart ? restartScheduler.requestRestart()
  → renderer mcp:bridge:syncDone
```

Agent 调用工具：

```text
OpenClaw runtime
→ mcp-bridge extension
→ POST /mcp/execute (x-mcp-bridge-secret)
→ McpBridgeServer
→ McpServerManager.callTool(server, tool, args, { signal })
→ MCP server
→ 返回 { content, isError }
```

AskUserQuestion：

```text
OpenClaw ask-user-question extension
→ POST /askuser
→ McpBridgeServer pending Promise
→ IPC 推送 renderer 权限/问题弹窗
→ 用户选择或 120s 超时
→ resolveAskUser()
→ HTTP response
```

MCP tool 调用时序图：

```text
Agent runtime       mcp-bridge       McpBridgeServer      McpServerManager      MCP Server
     │                  │                  │                     │                 │
     │ tool call         │                  │                     │                 │
     │─────────────────▶│ POST /mcp/execute│                     │                 │
     │                  │─────────────────▶│ validate secret      │                 │
     │                  │                  │ callTool             │                 │
     │                  │                  │────────────────────▶│ SDK request      │
     │                  │                  │                     │────────────────▶│
     │                  │                  │                     │ result           │
     │                  │                  │◀────────────────────│◀────────────────│
     │                  │ HTTP response    │                     │                 │
     │◀─────────────────│◀─────────────────│                     │                 │
```

## 5. 状态机与生命周期

```text
configured
→ connecting
→ connected
→ refreshing
→ disconnected | error
→ removed
```

## 6. 数据模型

MCP 配置持久化在本地 store。连接状态是内存态，可通过 snapshot + push 暴露给 renderer。

表结构：

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  transport_type TEXT NOT NULL DEFAULT 'stdio',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

`transport_type` 支持：

- `stdio`
- `sse`
- `streamable-http`

## 7. IPC / Preload 契约

mcp API 应覆盖 list、create、update、remove、test、refresh 和 status。server ID 是唯一操作键。

Bridge HTTP 端点：

| 端点 | Header | 请求体 | 行为 |
|---|---|---|---|
| `POST /mcp/execute` | `x-mcp-bridge-secret` | `{ server, tool, args }` | 调用 MCP tool |
| `POST /askuser` | `x-ask-user-secret` | `{ questions }` | 创建用户提问请求 |

## 8. Renderer 布局、状态与交互

MCP 设置页包含 server 列表、配置表单、连接测试、状态标签和错误详情。测试连接期间按钮 pending，失败保留表单。

页面入口与源码：

| 区域 | 源码 |
|---|---|
| Settings 容器 | `petclaw-desktop/src/renderer/src/views/settings/SettingsPage.tsx` |
| MCP 页面 | `petclaw-desktop/src/renderer/src/views/settings/McpSettings.tsx` |
| Connector 快捷入口 | `petclaw-desktop/src/renderer/src/views/settings/ConnectorSettings.tsx` |
| Chat 连接器弹窗 | `petclaw-desktop/src/renderer/src/components/ConnectorPopup.tsx` |

页面结构：

```text
┌────────────────────────────────────────────────────────────────────┐
│  MCP 服务                                             [刷新 Bridge] │
│  管理 MCP server、连接状态、工具清单和 bridge 同步                    │
│                                                                    │
│  Bridge 状态                                                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 同步状态：idle / syncing / synced / error                    │  │
│  │ Tools: 18                                      [重新同步]     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌────────────────────┬─────────────────────────────────────────┐  │
│  │ Server 列表         │  Server 配置                            │  │
│  │ ┌────────────────┐ │                                         │  │
│  │ │ ● filesystem   │ │  名称                                   │  │
│  │ │   stdio  8 tools│ │  [ filesystem                       ]  │  │
│  │ │ ○ github       │ │                                         │  │
│  │ │   http   error │ │  Transport                              │  │
│  │ │ ● browser      │ │  (●) stdio  ( ) sse  ( ) streamable-http │  │
│  │ │                │ │                                         │  │
│  │ │ [+ 添加服务]   │ │  stdio command                           │  │
│  │ └────────────────┘ │  [ npx @modelcontextprotocol/server... ] │  │
│  │                    │                                         │  │
│  │                    │  env / headers                            │  │
│  │                    │  ┌───────────────────────────────────┐  │  │
│  │                    │  │ KEY=value                         │  │  │
│  │                    │  └───────────────────────────────────┘  │  │
│  │                    │                                         │  │
│  │                    │  [测试连接] [保存] [删除]                │  │
│  └────────────────────┴─────────────────────────────────────────┘  │
│                                                                    │
│  Tool manifest preview                                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ filesystem.read_file     Read file contents                  │  │
│  │ filesystem.write_file    Write file contents                 │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

MCP 的连接器 toggle 是全局开关，不是会话级开关。

状态来源：

| 状态 | 所有者 | 说明 |
|---|---|---|
| server list | `McpSettings` 本地 state | 来自 `mcp:list` |
| selected server | `McpSettings` 本地 state | 控制右侧表单 |
| server draft | `McpSettings` 本地 state | 保存前不写主数据 |
| bridge sync | push 订阅 | `mcp:bridge:syncStart` / `syncDone` |
| connection test | `McpSettings` 本地 state | 当前 server pending/error |

交互状态：

- bridge syncing：刷新按钮 pending，server 表单仍可编辑。
- server disabled：不出现在 runtime tools，但仍可编辑。
- 测试失败：保留草稿和错误详情，不关闭表单。
- 删除 server：删除前确认，并清理 selected server。
- runtime 未就绪：可编辑本地 server，禁用 runtime 侧验证和 bridge refresh。

## 9. Runtime / Gateway 集成

MCP 通过 ConfigSync 写入 OpenClaw runtime，并通过 mcp-bridge extension 与 runtime 通信。runtime 未就绪时可编辑配置，但不可验证 runtime 侧调用。

ConfigSync 生成 plugin entries：

```json
{
  "plugins": {
    "entries": {
      "mcp-bridge": {
        "enabled": true,
        "config": {
          "callbackUrl": "http://127.0.0.1:{port}/mcp/execute",
          "secret": "${PETCLAW_MCP_BRIDGE_SECRET}",
          "tools": []
        }
      },
      "ask-user-question": {
        "enabled": true,
        "config": {
          "callbackUrl": "http://127.0.0.1:{port}/askuser",
          "secret": "${PETCLAW_MCP_BRIDGE_SECRET}"
        }
      }
    }
  }
}
```

## 10. 错误态、安全和权限

MCP server 参数可能包含 token 或命令，日志需脱敏。执行外部工具仍需 Cowork 权限审批或 runtime 权限策略保护。

连接中断处理：

- `/mcp/execute` 监听 response close。
- Gateway 断连时 AbortController 取消进行中的 MCP tool 调用。
- 不监听 request close 作为取消依据，因为 body 读完后 request 会自然 close。

## 11. 与其它模块的关系

MCP 为 Cowork 提供工具能力，由 ConfigSync 同步，由 DataStorage 保存配置。

## 12. 测试策略

- 配置 CRUD 测试。
- 连接状态 snapshot + push 测试。
- bridge 回调安全测试。
- ConfigSync 输出测试。
- AbortSignal 取消测试。
- secret 校验和日志脱敏测试。
