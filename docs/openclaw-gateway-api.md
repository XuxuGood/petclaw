# Openclaw Gateway API 完整参考

**来源**: `openclaw/src/gateway/protocol/schema/*.ts` (TypeBox 定义)  
**协议**: WebSocket JSON-RPC (`ws://localhost:PORT`)  
**帧格式**:

```
请求: { type: "req", id: "uuid", method: "...", params: {...} }
响应: { type: "res", id: "uuid", ok: true|false, payload|error }
事件: { type: "event", event: "...", payload: {...}, seq?, stateVersion? }
```

---

## 目录

1. [连接握手 (Connect)](#1-连接握手-connect)
2. [系统状态 (System)](#2-系统状态-system)
3. [聊天 (Chat)](#3-聊天-chat)
4. [会话管理 (Sessions)](#4-会话管理-sessions)
5. [Agent](#5-agent)
6. [Agents 管理 (CRUD)](#6-agents-管理-crud)
7. [模型 (Models)](#7-模型-models)
8. [Skills](#8-skills)
9. [工具 (Tools)](#9-工具-tools)
10. [配置 (Config)](#10-配置-config)
11. [定时任务 (Cron)](#11-定时任务-cron)
12. [执行审批 (Exec Approvals)](#12-执行审批-exec-approvals)
13. [插件审批 (Plugin Approvals)](#13-插件审批-plugin-approvals)
14. [节点管理 (Nodes)](#14-节点管理-nodes)
15. [设备配对 (Devices)](#15-设备配对-devices)
16. [通道 (Channels)](#16-通道-channels)
17. [语音 (Talk / TTS)](#17-语音-talk--tts)
18. [向导 (Wizard)](#18-向导-wizard)
19. [日志 (Logs)](#19-日志-logs)
20. [Secrets](#20-secrets)
21. [推送 (Push)](#21-推送-push)
22. [记忆 (Doctor/Memory)](#22-记忆-doctormemory)
23. [其他方法](#23-其他方法)
24. [事件 (Events)](#24-事件-events)
25. [错误码 (Error Codes)](#25-错误码-error-codes)

---

## 1. 连接握手 (Connect)

### 握手流程

```
Gateway → Client:  { event: "connect.challenge", payload: { nonce, ts } }
Client → Gateway:  { method: "connect", params: ConnectParams }
Gateway → Client:  { payload: { type: "hello-ok", protocol, policy } }
```

### `connect`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `minProtocol` | integer | ✅ | 最低支持的协议版本 |
| `maxProtocol` | integer | ✅ | 最高支持的协议版本 |
| `client.id` | string | ✅ | 客户端标识 (如 "cli", "petclaw") |
| `client.version` | string | ✅ | 客户端版本号 |
| `client.platform` | string | | 平台 ("macos", "ios", "android") |
| `client.mode` | string | | 模式 ("operator", "node") |
| `role` | string | ✅ | 角色: `"operator"` / `"node"` |
| `scopes` | string[] | ✅ | 权限范围 (如 `["operator.admin"]`) |
| `caps` | string[] | | 能力声明 (如 `["tool-events"]`) |
| `commands` | string[] | | 命令白名单 (节点用) |
| `permissions` | object | | 权限开关 (如 `{ "camera.capture": true }`) |
| `auth.token` | string | | 认证 token |
| `locale` | string | | 语言区域 (如 "zh-CN") |
| `userAgent` | string | | UA 字符串 |
| `device.id` | string | | 设备唯一标识 |
| `device.publicKey` | string | | 设备公钥 |
| `device.signature` | string | | 签名 |
| `device.signedAt` | integer | | 签名时间戳 |
| `device.nonce` | string | | 服务端下发的 nonce |

**响应** (`hello-ok`):

```json
{
  "type": "hello-ok",
  "protocol": 3,
  "policy": { "tickIntervalMs": 15000 },
  "auth": {
    "deviceToken": "...",
    "role": "operator",
    "scopes": ["operator.admin"]
  }
}
```

---

## 2. 系统状态 (System)

### `health`

无参数。返回 Gateway 健康状态。

### `status`

无参数。返回系统快照 (Snapshot):

| 响应字段 | 类型 | 说明 |
|----------|------|------|
| `presence` | PresenceEntry[] | 在线设备列表 |
| `health` | any | 健康快照 |
| `stateVersion` | `{ presence, health }` | 状态版本号 |
| `uptimeMs` | integer | 运行时间(ms) |
| `configPath` | string? | 配置文件路径 |
| `stateDir` | string? | 状态目录 |
| `sessionDefaults` | object? | 默认 session 配置 |
| `authMode` | string? | "none" / "token" / "password" / "trusted-proxy" |
| `updateAvailable` | object? | 可用更新信息 |

### `system-presence`

无参数。返回在线设备列表。

### `system-event`

系统事件发送。

### `usage.status`

无参数。返回使用量状态。

### `usage.cost`

无参数。返回费用统计。

---

## 3. 聊天 (Chat)

### `chat.send` ⭐

PetClaw App 最核心的方法。通过 WebSocket 向 Agent 发送消息。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 (如 `"agent:main:main"`) |
| `message` | string | ✅ | 消息内容 |
| `thinking` | string | | 思考过程（部分模型支持） |
| `deliver` | boolean | | 是否投递到通道 (App 通常传 `false`) |
| `attachments` | unknown[] | | 附件列表 |
| `timeoutMs` | integer | | 超时时间(ms) |
| `idempotencyKey` | string | ✅ | 幂等键（UUID） |
| `originatingChannel` | string | | 来源通道（admin） |
| `originatingTo` | string | | 来源目标（admin） |
| `originatingAccountId` | string | | 来源账户（admin） |
| `originatingThreadId` | string | | 来源线程（admin） |
| `systemInputProvenance` | object | | 输入来源证明 |
| `systemProvenanceReceipt` | string | | 来源收据 |

**sessionKey 格式**: `agent:<agentId>:<sessionName>`

**PetClaw 使用示例**:

```typescript
// 普通聊天
await client.request('chat.send', {
  sessionKey: 'agent:main:main',
  message: '你好',
  deliver: false,
  idempotencyKey: crypto.randomUUID(),
})

// Onboarding 对话
await client.request('chat.send', {
  sessionKey: 'agent:main:onboarding',
  message: buildOnboardingPrompt(userName, occupation),
  deliver: false,
  idempotencyKey: crypto.randomUUID(),
})
```

### `chat.abort`

中止正在进行的对话。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |
| `runId` | string | | 指定中止的运行 ID |

### `chat.history`

获取聊天历史记录。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |
| `limit` | integer | | 条数限制 (1-1000) |
| `maxChars` | integer | | 最大字符数 (1-500000) |

---

## 4. 会话管理 (Sessions)

### `sessions.list`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | | 按 agent 过滤 |

### `sessions.create`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | | Agent ID |
| `sessionName` | string | | 会话名称 |
| `label` | string | | 显示标签 |
| `runtimeMode` | string | | 运行模式 ("chat" / "work") |

### `sessions.send`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |
| `message` | string | ✅ | 消息内容 |
| `thinking` | string | | 思考过程 |
| `deliver` | boolean | | 是否投递 |
| `runtimeMode` | string | | "chat" / "work" |
| `modelOverride` | string | | 模型覆盖 |
| `persistRuntimePrefs` | boolean | | 是否持久化运行时偏好 |
| `skillFilter` | string | | Skill 过滤 |
| `attachments` | unknown[] | | 附件 |
| `uploadedFiles` | unknown[] | | 上传文件 |
| `timeoutMs` | integer | | 超时(ms) |
| `idempotencyKey` | string | ✅ | 幂等键 |

### `sessions.abort`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |
| `runId` | string | | 指定运行 ID |

### `sessions.patch`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |
| `label` | string | | 修改标签 |
| `pin` | boolean | | 是否置顶 |

### `sessions.reset`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |

### `sessions.delete`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |

### `sessions.compact`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |
| `force` | boolean | | 强制压缩 |

### `sessions.subscribe`

订阅 session 状态变更事件。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |

### `sessions.unsubscribe`

取消订阅。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |

### `sessions.messages.subscribe`

订阅 session 消息流（逐 token 接收）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |

### `sessions.messages.unsubscribe`

取消消息流订阅。

### `sessions.preview`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |

### `sessions.compaction.list`

列出 compaction 检查点。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |

### `sessions.compaction.get`

获取指定 compaction 检查点。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |
| `checkpointId` | string | ✅ | 检查点 ID |

### `sessions.compaction.branch`

从检查点分支创建新 session。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 源会话标识 |
| `checkpointId` | string | ✅ | 检查点 ID |
| `label` | string | | 新分支标签 |

### `sessions.compaction.restore`

恢复到指定检查点。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionKey` | string | ✅ | 会话标识 |
| `checkpointId` | string | ✅ | 检查点 ID |

---

## 5. Agent

### `agent`

向 Agent 发送任务消息（全功能版 chat.send，支持 channel 路由、子 session、lane 等高级特性）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | ✅ | 消息内容 |
| `agentId` | string | | Agent ID |
| `provider` | string | | LLM provider |
| `model` | string | | 模型名称 |
| `to` | string | | 投递目标 |
| `replyTo` | string | | 回复目标 |
| `sessionId` | string | | 会话 ID |
| `sessionKey` | string | | 会话标识 |
| `thinking` | string | | 思考过程 |
| `deliver` | boolean | | 是否投递 |
| `attachments` | unknown[] | | 附件 |
| `channel` | string | | 来源通道 |
| `replyChannel` | string | | 回复通道 |
| `accountId` | string | | 账户 ID |
| `replyAccountId` | string | | 回复账户 ID |
| `threadId` | string | | 线程 ID |
| `groupId` | string | | 群组 ID |
| `groupChannel` | string | | 群组通道 |
| `groupSpace` | string | | 群组空间 |
| `timeout` | integer | | 超时(ms) |
| `bestEffortDeliver` | boolean | | 尽力投递 |
| `lane` | string | | 执行通道 |
| `extraSystemPrompt` | string | | 额外 system prompt |
| `bootstrapContextMode` | "full" / "lightweight" | | 引导上下文模式 |
| `bootstrapContextRunKind` | "default" / "heartbeat" / "cron" | | 运行类型 |
| `internalEvents` | AgentInternalEvent[] | | 内部事件 |
| `inputProvenance` | object | | 输入来源证明 |
| `idempotencyKey` | string | ✅ | 幂等键 |
| `label` | string | | Session 标签 |

### `agent.identity.get`

获取 Agent 身份信息。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | | Agent ID |
| `sessionKey` | string | | 会话标识 |

**响应**:

```json
{
  "agentId": "main",
  "name": "PetClaw Cat",
  "avatar": "...",
  "emoji": "🐱"
}
```

### `agent.wait`

等待 Agent 运行完成。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `runId` | string | ✅ | 运行 ID |
| `timeoutMs` | integer | | 超时(ms) |

### `send`

发送消息到通道目标。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `to` | string | ✅ | 投递目标 |
| `message` | string | | 文本消息 |
| `mediaUrl` | string | | 媒体 URL |
| `mediaUrls` | string[] | | 多个媒体 URL |
| `gifPlayback` | boolean | | GIF 播放 |
| `channel` | string | | 通道 |
| `accountId` | string | | 账户 ID |
| `agentId` | string | | Agent ID |
| `threadId` | string | | 线程 ID |
| `sessionKey` | string | | Session 标识 |
| `idempotencyKey` | string | ✅ | 幂等键 |

### `gateway.identity.get`

获取 Gateway 身份信息。无参数。

### `wake`

唤醒 Agent。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mode` | "now" / "next-heartbeat" | ✅ | 唤醒模式 |
| `text` | string | ✅ | 唤醒文本 |

### `last-heartbeat`

获取最后一次心跳信息。无参数。

### `set-heartbeats`

设置心跳配置。

---

## 6. Agents 管理 (CRUD)

### `agents.list`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `includeInternal` | boolean | | 包含内部 agent |

**响应**: `{ agents: AgentSummary[] }`

### `agents.create`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | ✅ | Agent ID |
| `displayName` | string | | 显示名称 |
| `emoji` | string | | 图标 |
| `avatar` | string | | 头像 URL |
| `model` | string | | 默认模型 |
| `description` | string | | 描述 |

### `agents.update`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | ✅ | Agent ID |
| `displayName` | string | | 显示名称 |
| `emoji` | string | | 图标 |
| `avatar` | string | | 头像 URL |
| `model` | string | | 默认模型 |
| `description` | string | | 描述 |

### `agents.delete`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | ✅ | Agent ID |

### `agents.files.list`

列出 Agent 的 workspace 文件。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | ✅ | Agent ID |

**响应**: `{ files: AgentsFileEntry[] }`

### `agents.files.get`

获取 Agent workspace 文件内容。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | ✅ | Agent ID |
| `path` | string | ✅ | 文件路径 |

### `agents.files.set`

写入 Agent workspace 文件。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | ✅ | Agent ID |
| `path` | string | ✅ | 文件路径 |
| `content` | string | ✅ | 文件内容 |

---

## 7. 模型 (Models)

### `models.list`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | | Agent ID |

**响应**: `{ models: ModelChoice[] }`

---

## 8. Skills

### `skills.status`

获取所有 skills 状态（安装状态、依赖检查结果）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | | Agent ID |

### `skills.search`

在 ClawHub 搜索 skills。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | | 搜索关键词 |
| `limit` | integer | | 结果数量限制 |

### `skills.detail`

获取 ClawHub skill 详情。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `slug` | string | ✅ | Skill 标识 |

### `skills.install`

安装 skill。两种模式：

**模式 1 — 按名称安装（本地）**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | Skill 名称 |
| `installId` | string | ✅ | 安装 ID |

**模式 2 — 从 ClawHub 安装**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `source` | "clawhub" | ✅ | 来源标识 |
| `slug` | string | ✅ | ClawHub slug |
| `version` | string | | 指定版本 |
| `force` | boolean | | 强制覆盖安装 |

### `skills.update`

更新 skill 配置。两种模式：

**模式 1 — 按 key 更新**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `skillKey` | string | ✅ | Skill 标识 |
| `enabled` | boolean | | 启用/禁用 |
| `apiKey` | string | | API 密钥 |
| `env` | Record<string,string> | | 环境变量 |

**模式 2 — 从 ClawHub 批量更新**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `source` | "clawhub" | ✅ | 来源标识 |
| `slug` | string | | 指定 skill |
| `all` | boolean | | 更新全部 |

### `skills.bins`

获取 skill 可执行文件列表（节点自动放行检查用）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | | Agent ID |

---

## 9. 工具 (Tools)

### `tools.catalog`

获取 runtime 工具目录。需要 `operator.read` 权限。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | | Agent ID |
| `sessionKey` | string | | Session 标识 |

**响应**: `{ groups: ToolCatalogGroup[] }`

每个 `ToolCatalogEntry` 包含：`source` ("core" / "plugin")、`pluginId`、`optional` 等元信息。

### `tools.effective`

获取实际生效的工具列表。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | | Agent ID |

---

## 10. 配置 (Config)

### `config.get`

获取配置项。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | string | | 配置键（不填返回全部） |

### `config.set`

设置配置项（整体覆盖）。需要 `operator.admin` 权限。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | string | ✅ | 配置键 |
| `value` | unknown | ✅ | 配置值 |

### `config.apply`

应用配置变更（原子操作）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `operations` | object[] | ✅ | 操作列表 `[{ op, path, value }]` |

### `config.patch`

合并补丁到配置。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `patch` | object | ✅ | JSON merge patch |

### `config.schema`

获取配置 JSON Schema。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `format` | string | | Schema 格式 |

### `config.schema.lookup`

查找特定配置键的 Schema 信息。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | ✅ | 配置路径 |

### `update.run`

执行 Openclaw 更新。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | string | | 目标版本 |
| `channel` | string | | 更新通道 |
| `force` | boolean | | 强制更新 |

---

## 11. 定时任务 (Cron)

### `cron.list`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | | 按 Agent 过滤 |

### `cron.status`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `jobId` | string | ✅ | 任务 ID |

### `cron.add`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 任务名称 |
| `schedule` | string | ✅ | Cron 表达式 |
| `payload.message` | string | ✅ | 消息内容 |
| `payload.agentId` | string | | Agent ID |
| `payload.deliver` | boolean | | 是否投递 |
| `payload.deliverTo` | string | | 投递目标 |
| `payload.channel` | string | | 通道 |
| `payload.accountId` | string | | 账户 ID |
| `payload.threadId` | string | | 线程 ID |
| `payload.runtimeMode` | string | | "chat" / "work" |
| `payload.modelOverride` | string | | 模型覆盖 |
| `payload.sessionKey` | string | | Session 标识 |
| `enabled` | boolean | | 是否启用 |
| `expiresAt` | string | | 过期时间 (ISO 8601) |

### `cron.update`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `jobId` | string | ✅ | 任务 ID |
| `name` | string | | 名称 |
| `schedule` | string | | Cron 表达式 |
| `payload` | object | | 负载 (同 add) |
| `enabled` | boolean | | 启用/禁用 |
| `expiresAt` | string / null | | 过期时间 |

### `cron.remove`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `jobId` | string | ✅ | 任务 ID |

### `cron.run`

手动触发执行。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `jobId` | string | ✅ | 任务 ID |

### `cron.runs`

获取执行记录。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `jobId` | string | | 按任务过滤 |
| `limit` | integer | | 数量限制 (1-100) |

---

## 12. 执行审批 (Exec Approvals)

当 Agent 需要执行命令时，Gateway 广播审批请求，Operator 客户端决定允许/拒绝。

### `exec.approvals.get`

获取审批策略配置。无参数。

### `exec.approvals.set`

设置审批策略。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | ExecApprovalsFile | ✅ | 审批策略文件 |
| `baseHash` | string | | 乐观锁基线哈希 |

**ExecApprovalsFile 结构**:

```json
{
  "version": 1,
  "socket": { "path": "...", "token": "..." },
  "defaults": {
    "security": "...",
    "ask": "...",
    "askFallback": "...",
    "autoAllowSkills": true
  },
  "agents": {
    "main": {
      "security": "...",
      "ask": "...",
      "allowlist": [
        { "pattern": "ls *", "argPattern": "..." }
      ]
    }
  }
}
```

### `exec.approvals.node.get`

获取节点的审批策略。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeId` | string | ✅ | 节点 ID |

### `exec.approvals.node.set`

设置节点的审批策略。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeId` | string | ✅ | 节点 ID |
| `file` | ExecApprovalsFile | ✅ | 审批策略 |
| `baseHash` | string | | 基线哈希 |

### `exec.approval.get`

获取单个审批请求详情。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 审批 ID |

### `exec.approval.list`

列出所有待审批请求。

### `exec.approval.request`

发起审批请求。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | | 审批 ID |
| `command` | string | | 命令名 |
| `commandArgv` | string[] | | 命令参数 |
| `systemRunPlan` | object | | 执行计划 (argv, cwd, commandText 等) |
| `env` | Record<string,string> | | 环境变量 |
| `cwd` | string / null | | 工作目录 |
| `nodeId` | string / null | | 节点 ID |
| `host` | string / null | | 主机标识 |
| `security` | string / null | | 安全级别 |
| `ask` | string / null | | 审批策略 |
| `agentId` | string / null | | Agent ID |
| `resolvedPath` | string / null | | 解析后的命令路径 |
| `sessionKey` | string / null | | Session 标识 |
| `timeoutMs` | integer | | 超时(ms) |
| `twoPhase` | boolean | | 两阶段审批 |

### `exec.approval.waitDecision`

等待审批决定。

### `exec.approval.resolve`

解决审批请求。需要 `operator.approvals` 权限。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 审批 ID |
| `decision` | string | ✅ | 决定 ("allow" / "deny" / "allow-always" 等) |

---

## 13. 插件审批 (Plugin Approvals)

### `plugin.approval.list`

列出待审批的插件请求。

### `plugin.approval.request`

发起插件审批请求。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pluginId` | string | | 插件 ID |
| `title` | string | ✅ | 标题 (≤ 200 字符) |
| `description` | string | ✅ | 描述 |
| `severity` | "info" / "warning" / "critical" | | 严重级别 |
| `toolName` | string | | 工具名 |
| `toolCallId` | string | | 工具调用 ID |
| `agentId` | string | | Agent ID |
| `sessionKey` | string | | Session 标识 |
| `timeoutMs` | integer | | 超时(ms) |
| `twoPhase` | boolean | | 两阶段 |

### `plugin.approval.waitDecision`

等待插件审批决定。

### `plugin.approval.resolve`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 审批 ID |
| `decision` | string | ✅ | 决定 |

---

## 14. 节点管理 (Nodes)

节点是远程设备（iOS/Android/桌面），通过 Gateway 提供 camera/screen/canvas 等能力。

### `node.pair.request`

发起节点配对请求。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeId` | string | ✅ | 节点 ID |
| `displayName` | string | | 显示名称 |
| `platform` | string | | 平台 |
| `version` | string | | 版本 |
| `coreVersion` | string | | 核心版本 |
| `uiVersion` | string | | UI 版本 |
| `deviceFamily` | string | | 设备系列 |
| `modelIdentifier` | string | | 型号标识 |
| `caps` | string[] | | 能力列表 |
| `commands` | string[] | | 命令列表 |
| `remoteIp` | string | | 远程 IP |
| `silent` | boolean | | 静默配对 |

### `node.pair.list`

列出配对请求。无参数。

### `node.pair.approve`

批准配对。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `requestId` | string | ✅ | 请求 ID |

### `node.pair.reject`

拒绝配对。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `requestId` | string | ✅ | 请求 ID |

### `node.pair.verify`

验证配对。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeId` | string | ✅ | 节点 ID |
| `token` | string | ✅ | 验证 token |

### `node.rename`

重命名节点。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeId` | string | ✅ | 节点 ID |
| `displayName` | string | ✅ | 新名称 |

### `node.list`

列出所有节点。无参数。

### `node.describe`

获取节点详情。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeId` | string | ✅ | 节点 ID |

### `node.invoke`

远程调用节点命令。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeId` | string | ✅ | 节点 ID |
| `command` | string | ✅ | 命令名 |
| `params` | unknown | | 命令参数 |
| `timeoutMs` | integer | | 超时(ms) |
| `idempotencyKey` | string | ✅ | 幂等键 |

### `node.invoke.result`

节点返回调用结果（节点端调用）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 调用 ID |
| `nodeId` | string | ✅ | 节点 ID |
| `ok` | boolean | ✅ | 是否成功 |
| `payload` | unknown | | 成功负载 |
| `payloadJSON` | string | | JSON 序列化负载 |
| `error` | object | | 错误 `{ code?, message? }` |

### `node.event`

节点主动上报事件。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `event` | string | ✅ | 事件名称 |
| `payload` | unknown | | 事件数据 |
| `payloadJSON` | string | | JSON 序列化 |

### `node.pending.drain`

节点拉取待处理任务。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `maxItems` | integer | | 最大拉取数 (1-10) |

### `node.pending.enqueue`

为节点添加待处理任务（operator 端调用）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeId` | string | ✅ | 节点 ID |
| `type` | "status.request" / "location.request" | ✅ | 任务类型 |
| `priority` | "normal" / "high" | | 优先级 |
| `expiresInMs` | integer | | 过期时间 (1000-86400000) |
| `wake` | boolean | | 是否唤醒节点 |

### `node.pending.pull`

节点拉取任务（同 drain）。

### `node.pending.ack`

节点确认已处理任务。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ids` | string[] | ✅ | 任务 ID 列表 (≥1) |

### `node.canvas.capability.refresh`

刷新节点 canvas 能力。

---

## 15. 设备配对 (Devices)

设备级别的认证与配对管理。

### `device.pair.list`

列出设备配对请求。无参数。

### `device.pair.approve`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `requestId` | string | ✅ | 请求 ID |

### `device.pair.reject`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `requestId` | string | ✅ | 请求 ID |

### `device.pair.remove`

移除已配对设备。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `deviceId` | string | ✅ | 设备 ID |

### `device.token.rotate`

轮换设备 token。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `deviceId` | string | ✅ | 设备 ID |
| `role` | string | ✅ | 角色 |
| `scopes` | string[] | | 新权限范围 |

### `device.token.revoke`

吊销设备 token。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `deviceId` | string | ✅ | 设备 ID |
| `role` | string | ✅ | 角色 |

---

## 16. 通道 (Channels)

### `channels.status`

获取所有通道状态。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `channel` | string | | 指定通道 |

### `channels.logout`

登出通道。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `channel` | string | ✅ | 通道标识 |
| `accountId` | string | | 账户 ID |

> 注：通道插件可能扩展额外的 Gateway 方法（如 `web.login.start`、`web.login.wait` 等）。

---

## 17. 语音 (Talk / TTS)

### `talk.config`

获取/设置语音配置。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `locale` | string | | 语言设置 |

### `talk.speak`

语音合成（TTS 发送文本，返回音频）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `text` | string | ✅ | 合成文本 |
| `voice` | string | | 声音选择 |

### `talk.mode`

设置语音模式。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mode` | string | ✅ | 模式标识 |

### `tts.status`

TTS 状态。无参数。

### `tts.providers`

列出 TTS 提供商。无参数。

### `tts.enable`

启用 TTS。

### `tts.disable`

禁用 TTS。

### `tts.convert`

文字转语音。

### `tts.setProvider`

设置 TTS 提供商。

### `voicewake.get`

获取语音唤醒设置。

### `voicewake.set`

设置语音唤醒。

---

## 18. 向导 (Wizard)

用于 Gateway 配置向导（CLI `openclaw onboard`），不是用户 onboarding。

### `wizard.start`

启动向导。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mode` | "quickstart" / "advanced" | ✅ | 向导模式 |
| `workspace` | string | | Workspace 路径 |

**响应**: `{ sessionId, done, step? }`

### `wizard.next`

提交答案并获取下一步。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | ✅ | 向导会话 ID |
| `answer` | `{ stepId?, value? }` | | 当前步骤的答案 |

### `wizard.cancel`

取消向导。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | ✅ | 向导会话 ID |

### `wizard.status`

查询向导状态。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | ✅ | 向导会话 ID |

---

## 19. 日志 (Logs)

### `logs.tail`

获取日志尾部内容。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cursor` | integer | | 游标位置 |
| `limit` | integer | | 行数限制 (1-5000) |
| `maxBytes` | integer | | 最大字节数 (1-1000000) |

**响应**:

```json
{
  "file": "/path/to/log",
  "cursor": 12345,
  "size": 67890,
  "lines": ["..."],
  "truncated": false,
  "reset": false
}
```

---

## 20. Secrets

### `secrets.reload`

重新加载 secrets 配置。无参数。

### `secrets.resolve`

解析 secrets 引用。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `commandName` | string | ✅ | 命令名 |
| `targetIds` | string[] | ✅ | 目标 ID 列表 |

**响应**:

```json
{
  "ok": true,
  "assignments": [
    { "path": "...", "pathSegments": ["..."], "value": "..." }
  ],
  "diagnostics": [],
  "inactiveRefPaths": []
}
```

---

## 21. 推送 (Push)

### `push.test`

发送测试推送通知（APNs）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeId` | string | ✅ | 节点 ID |
| `title` | string | | 通知标题 |
| `body` | string | | 通知内容 |
| `environment` | "sandbox" / "production" | | APNs 环境 |

**响应**:

```json
{
  "ok": true,
  "status": 200,
  "apnsId": "...",
  "tokenSuffix": "...xxxx",
  "topic": "com.example.app",
  "environment": "production",
  "transport": "direct"
}
```

---

## 22. 记忆 (Doctor/Memory)

### `doctor.memory.status`

获取记忆系统状态。

### `doctor.memory.dreamDiary`

获取 Dream Diary（记忆摘要）。

### `doctor.memory.backfillDreamDiary`

回填 Dream Diary。

### `doctor.memory.resetDreamDiary`

重置 Dream Diary。

### `doctor.memory.resetGroundedShortTerm`

重置短期记忆。

---

## 23. 其他方法

### `poll` (通过 `agent` 方法)

向通道发送投票。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `to` | string | ✅ | 投递目标 |
| `question` | string | ✅ | 投票问题 |
| `options` | string[] | ✅ | 选项 (2-12 个) |
| `maxSelections` | integer | | 最大可选数 (1-12) |
| `durationSeconds` | integer | | 投票时长(秒) |
| `durationHours` | integer | | 投票时长(小时) |
| `silent` | boolean | | 静默发送 |
| `isAnonymous` | boolean | | 匿名投票 |
| `threadId` | string | | 线程 ID |
| `channel` | string | | 通道 |
| `accountId` | string | | 账户 ID |
| `idempotencyKey` | string | ✅ | 幂等键 |

---

## 24. 事件 (Events)

Gateway 通过 `{ type: "event" }` 帧向客户端推送事件：

| 事件 | 说明 |
|------|------|
| `connect.challenge` | 连接质询（握手第一步） |
| `chat` | 聊天事件流（delta/final/aborted/error） |
| `agent` | Agent 事件流（runId, seq, stream, data） |
| `session.message` | Session 消息事件 |
| `session.tool` | Session 工具调用事件 |
| `sessions.changed` | Session 列表变更 |
| `presence` | 在线状态变更 |
| `tick` | 心跳 tick |
| `talk.mode` | 语音模式变更 |
| `shutdown` | Gateway 关闭 |
| `health` | 健康状态变更 |
| `heartbeat` | Agent 心跳 |
| `cron` | 定时任务事件 |
| `node.pair.requested` | 节点配对请求 |
| `node.pair.resolved` | 节点配对结果 |
| `node.invoke.request` | 节点调用请求（发给节点） |
| `device.pair.requested` | 设备配对请求 |
| `device.pair.resolved` | 设备配对结果 |
| `voicewake.changed` | 语音唤醒变更 |
| `exec.approval.requested` | 执行审批请求 |
| `exec.approval.resolved` | 执行审批结果 |
| `plugin.approval.requested` | 插件审批请求 |
| `plugin.approval.resolved` | 插件审批结果 |
| `update.available` | 有可用更新 |

### `chat` 事件结构

```json
{
  "event": "chat",
  "payload": {
    "runId": "uuid",
    "sessionKey": "agent:main:main",
    "seq": 0,
    "state": "delta",        // "delta" | "final" | "aborted" | "error"
    "message": "...",         // 增量/完整消息
    "errorMessage": "...",    // 错误信息
    "usage": { ... },         // token 使用量
    "stopReason": "end_turn"  // 停止原因
  }
}
```

### `device.pair.requested` 事件结构

```json
{
  "event": "device.pair.requested",
  "payload": {
    "requestId": "uuid",
    "deviceId": "fingerprint",
    "publicKey": "...",
    "displayName": "iPhone",
    "platform": "ios",
    "deviceFamily": "iPhone",
    "clientId": "petclaw-ios",
    "role": "node",
    "roles": ["node"],
    "scopes": [],
    "remoteIp": "192.168.1.100",
    "ts": 1737264000000
  }
}
```

---

## 25. 错误码 (Error Codes)

| 错误码 | 说明 |
|--------|------|
| `NOT_LINKED` | 未关联 |
| `NOT_PAIRED` | 未配对 |
| `AGENT_TIMEOUT` | Agent 超时 |
| `INVALID_REQUEST` | 无效请求 |
| `APPROVAL_NOT_FOUND` | 审批未找到 |
| `UNAVAILABLE` | 服务不可用 |

**错误响应格式**:

```json
{
  "type": "res",
  "id": "uuid",
  "ok": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "session not found",
    "details": { ... },
    "retryable": false,
    "retryAfterMs": 5000
  }
}
```

---

## 完整方法列表 (129 个)

```
health
doctor.memory.status / dreamDiary / backfillDreamDiary / resetDreamDiary / resetGroundedShortTerm
logs.tail
channels.status / logout
status
usage.status / cost
tts.status / providers / enable / disable / convert / setProvider
config.get / set / apply / patch / schema / schema.lookup
exec.approvals.get / set / node.get / node.set
exec.approval.get / list / request / waitDecision / resolve
plugin.approval.list / request / waitDecision / resolve
wizard.start / next / cancel / status
talk.config / speak / mode
models.list
tools.catalog / effective
agents.list / create / update / delete / files.list / files.get / files.set
skills.status / search / detail / bins / install / update
update.run
voicewake.get / set
secrets.reload / resolve
sessions.list / subscribe / unsubscribe / messages.subscribe / messages.unsubscribe
sessions.preview / compaction.list / compaction.get / compaction.branch / compaction.restore
sessions.create / send / abort / patch / reset / delete / compact
last-heartbeat / set-heartbeats / wake
node.pair.request / pair.list / pair.approve / pair.reject / pair.verify
device.pair.list / pair.approve / pair.reject / pair.remove
device.token.rotate / token.revoke
node.rename / list / describe
node.pending.drain / pending.enqueue / pending.pull / pending.ack
node.invoke / invoke.result / event / canvas.capability.refresh
cron.list / status / add / update / remove / run / runs
gateway.identity.get
system-presence / system-event
send / agent / agent.identity.get / agent.wait
chat.history / abort / send
```

> 注：通道插件可能注册额外方法（如 `web.login.start`、`web.login.wait`），总数会更多。