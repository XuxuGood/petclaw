# Cowork 架构设计

## 1. 模块定位

Cowork 是 PetClaw 的核心协作领域，负责会话、消息、目录上下文、模型上下文、流式输出和权限审批。

## 2. 核心概念

- sessionId：前端状态和主进程消息归属的唯一键。
- cwd/directoryId：会话启动时固化的工作目录上下文。
- system_prompt：会话级固化提示词。
- stream event：Gateway 流式事件转换后的 Cowork 事件。
- approval request：带 `sessionId`、`requestId`、`toolUseId` 的审批请求。
- engineSessionId：OpenClaw runtime 内部 session 标识，与 PetClaw sessionId 做映射。
- active workload：影响 runtime 重启延迟的运行中会话。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ Renderer                                                           │
│  ChatView / ChatInputBox                                           │
│  ├── useChatStore: 当前 session 详情、消息、loading/error            │
│  └── usePermissionStore: 全局 FIFO 审批队列                         │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ window.api.cowork
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Preload / IPC                                                       │
│  cowork:session:*                                                   │
│  cowork:stream:*                                                    │
│  cowork:permission:respond                                          │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Main Process                                                        │
│  CoworkController                                                   │
│  ├── ensureGatewayClientReady()                                     │
│  ├── stream event mapping                                           │
│  ├── exec approval / AskUser dual-dispatch                          │
│  └── command safety                                                 │
│                                                                    │
│  CoworkSessionManager                                               │
│  ├── create / continue / stop / delete                              │
│  ├── 固化 cwd / agentId / model / system_prompt                      │
│  └── 最近 cwd 查询                                                  │
│                                                                    │
│  CoworkStore / CoworkConfigStore                                    │
└──────────────┬───────────────────────────────┬─────────────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────┐   ┌───────────────────────────────┐
│ OpenClaw Gateway             │   │ PetEventBridge                 │
│ sessions.* / stream / approval│   │ AI 状态、气泡、多会话计数       │
└──────────────────────────────┘   └───────────────────────────────┘
```

关键 main 侧职责：

- CoworkSessionManager：会话 CRUD、发送、停止、模型 patch、最近 cwd。
- CoworkController：Gateway 按需连接、流式事件、审批响应。
- CoworkStore：会话和消息持久化。
- CoworkConfigStore：system prompt、默认目录和 Cowork 配置。

关键文件：

| 层 | 文件 |
|---|---|
| Main controller | `petclaw-desktop/src/main/ai/cowork-controller.ts` |
| Session manager | `petclaw-desktop/src/main/ai/cowork-session-manager.ts` |
| Store | `petclaw-desktop/src/main/data/cowork-store.ts` |
| Config store | `petclaw-desktop/src/main/data/cowork-config-store.ts` |
| Command safety | `petclaw-desktop/src/main/ai/command-safety.ts` |
| IPC | `petclaw-desktop/src/main/ipc/chat-ipc.ts` |
| Renderer page | `petclaw-desktop/src/renderer/src/views/chat/ChatView.tsx` |
| Renderer input | `petclaw-desktop/src/renderer/src/views/chat/ChatInputBox.tsx` |
| Renderer store | `petclaw-desktop/src/renderer/src/stores/chat-store.ts` |
| Permission store | `petclaw-desktop/src/renderer/src/stores/permission-store.ts` |

## 4. 端到端数据流

```text
用户输入消息
→ renderer 读取当前 sessionId、cwd、model 和 skills
→ preload 调 cowork:session:start 或 cowork:session:send
→ main 校验目录、模型和 runtime 状态
→ CoworkSessionManager 固化 session、message、system_prompt、cwd
→ GatewayClient 调 OpenClaw sessions.send
→ Gateway 返回流式事件
→ main 转换为 Cowork stream event
→ preload 推送 renderer
→ 当前打开 session 更新消息详情
→ 后台 session 只更新运行状态、未读和摘要
→ PetEventBridge 汇聚 AI 工作状态
```

按需连接：

```text
startSession / continueSession
→ ensureGatewayClientReady()
  → gateway.isConnected() ? skip
  → engineManager.startGateway()
  → engineManager.getGatewayConnectionInfo()
  → gateway.connect(connectionInfo)
→ gateway.sessions.send 或 chatSend
```

时序图：

```text
用户          Renderer        Preload/IPC       CoworkController     Gateway        Pet
 │               │                │                    │              │            │
 │ 输入并发送     │                │                    │              │            │
 │──────────────▶│                │                    │              │            │
 │               │ cowork:start   │                    │              │            │
 │               │───────────────▶│ safeHandle         │              │            │
 │               │                │───────────────────▶│              │            │
 │               │                │                    │ ensureReady  │            │
 │               │                │                    │─────────────▶│            │
 │               │                │                    │ sessions.send│            │
 │               │                │                    │─────────────▶│            │
 │               │                │                    │ stream event │            │
 │               │                │                    │◀─────────────│            │
 │               │ stream message │                    │              │            │
 │               │◀───────────────│◀───────────────────│              │            │
 │ 更新当前会话   │                │                    │ pet event    │            │
 │◀──────────────│                │                    │─────────────────────────▶│
```

## 5. 状态机与生命周期

```text
draft
→ starting
→ running
→ permission_waiting
→ streaming
→ completed | stopped | error
```

切换会话时必须重新从主进程加载历史，并防止旧请求覆盖新会话。

停止/删除会话时必须清理：

- 运行中 Gateway 请求。
- session 相关 pending approvals。
- renderer 中当前详情或列表状态。
- PetEventBridge 中对应活跃状态。

## 6. 数据模型

Cowork 拥有会话、消息、配置和审批上下文相关 store。会话必须固化 `system_prompt`、目录和模型上下文，不能依赖发送时的全局 UI 状态。

最近工作目录不需要额外表，可从 sessions 查询：

```sql
SELECT directory_path, updated_at FROM sessions
WHERE directory_path IS NOT NULL AND TRIM(directory_path) != ''
ORDER BY updated_at DESC
LIMIT ?
```

去重和路径归一化在业务层完成。

## 7. IPC / Preload 契约

Cowork IPC 必须携带 `sessionId` 或返回新 `sessionId`。流式事件必须携带 session 归属。审批请求必须保留 `requestId`、`toolUseId` 和 tool 上下文。

典型 IPC 能力：

- `cowork:session:start`
- `cowork:session:continue`
- `cowork:session:get`
- `cowork:session:list`
- `cowork:session:stop`
- `cowork:session:delete`
- `cowork:permission:respond`
- `cowork:stream:*`

`cowork:permission:respond` 是 dual-dispatch：同一入口同时处理 AskUserQuestion 扩展请求和标准 Gateway exec approval。

## 8. Renderer 布局、状态与交互

Chat 页面由会话列表、消息区、任务/审批面板和输入框组成。当前会话详情独立于会话列表；后台事件不得写入当前消息详情。权限请求使用全局 FIFO 队列展示，但 UI 必须显示来源 session。

页面入口与源码：

| 区域 | 源码 |
|---|---|
| 主页面 | `petclaw-desktop/src/renderer/src/views/chat/ChatView.tsx` |
| 输入框 | `petclaw-desktop/src/renderer/src/views/chat/ChatInputBox.tsx` |
| 会话标题 | `petclaw-desktop/src/renderer/src/views/chat/ChatTitleSlot.tsx` |
| 权限弹窗 | `petclaw-desktop/src/renderer/src/views/chat/CoworkPermissionModal.tsx` |
| 任务监控 | `petclaw-desktop/src/renderer/src/components/TaskMonitorPanel.tsx` |
| 会话 store | `petclaw-desktop/src/renderer/src/stores/chat-store.ts` |
| 权限 store | `petclaw-desktop/src/renderer/src/stores/permission-store.ts` |

主布局：

```text
AppShell
├── AppTopBar
│   ├── ChatTitleSlot
│   │   ├── 当前会话标题
│   │   ├── cwd 摘要
│   │   └── runtime / running 状态入口
│   └── TaskMonitor toggle
├── WorkspaceLayout
│   ├── Sidebar
│   │   ├── 当前目录入口
│   │   ├── 会话列表
│   │   ├── running / unread 状态
│   │   └── Settings / Skills / Cron / IM 导航
│   ├── MainPane
│   │   └── ChatView
│   │       ├── 空态 / 历史加载态
│   │       ├── MessageList
│   │       ├── streaming assistant message
│   │       ├── session error banner
│   │       └── ChatInputBox
│   └── RightPane
│       └── TaskMonitorPanel
│           ├── 待办任务
│           ├── 产物
│           └── 当前会话 skills / MCP
└── CoworkPermissionModal
    └── 全局 FIFO，不挂在 ChatView 内
```

ChatInputBox 布局：

```text
ChatInputBox
├── cwd selector
│   ├── 当前目录路径
│   └── 选择目录
├── attachment chips
│   ├── image preview chip
│   ├── file path chip
│   └── directory chip
├── input textarea
│   ├── IME Enter 保护
│   └── Shift+Enter 换行
├── selected skill chips
├── selected model indicator
└── action row
    ├── + menu
    │   ├── 添加文件
    │   ├── 选择技能
    │   ├── 连接器入口
    │   └── 管理技能 / MCP
    ├── model selector
    └── send / stop
```

状态来源：

| 状态 | 所有者 | 说明 |
|---|---|---|
| 当前 view / right pane | `App.tsx` | 控制 Chat、TaskMonitor、Settings 跳转 |
| 当前目录 | `App.tsx` 或 ChatInputBox 受控状态 | 必须只有一个事实源 |
| 当前 session 详情 | `useChatStore` | 消息、loading、error、streaming |
| 会话列表摘要 | `useChatStore` | running、unread、last message |
| 输入框草稿 | `ChatInputBox` 本地 state | prompt、attachments、skillIds、selectedModel |
| 权限队列 | `usePermissionStore` | 只管理 FIFO，不直接发 IPC |

权限 UI：

```text
main IPC push
→ usePermissionListener
→ usePermissionStore.enqueue()
→ App.tsx 全局 CoworkPermissionModal
→ 用户响应
→ cowork:permission:respond
```

`usePermissionStore` 只管理 FIFO 队列，不能发 IPC。IPC 副作用放在 listener、modal 或服务层。

交互状态：

| 状态 | UI 行为 |
|---|---|
| runtime 未就绪 | 输入框 disabled，显示恢复入口 |
| 无会话 | ChatView 显示空态，输入框可发起新会话 |
| 历史加载中 | 保留当前布局骨架，不显示可误点的旧消息 |
| streaming | assistant message 增量更新，send 变 stop |
| 后台 session 事件 | 只更新列表摘要、running、unread，不写当前详情 |
| 权限请求 | 全局 FIFO modal，显示 session、tool、命令上下文 |
| 切换 session | 重新加载历史，旧请求返回不得覆盖新 session |
| 发送失败 | 保留输入草稿或提供重试，错误落到当前 session |

空态与错误态：

- 空会话：展示可直接输入的工作区，不做营销式说明。
- 无 cwd：允许使用默认目录或提示选择目录，发送前必须固化 cwd。
- 附件读取失败：chip 显示错误并可移除。
- skill 列表加载失败：技能菜单显示错误，不影响纯文本发送。
- permission response 失败：modal 保持打开并展示错误。

## 9. Runtime / Gateway 集成

Cowork 依赖 Gateway `sessions.*`、流式事件和 exec approval 相关能力。runtime 未就绪时发送入口 disabled，并展示恢复状态。

流式事件映射：

| Cowork 事件 | 说明 |
|---|---|
| `message` | 新消息加入会话 |
| `messageUpdate` | 流式内容增量 |
| `permissionRequest` | 工具执行需要审批 |
| `complete` | 会话执行完毕 |
| `error` | 执行出错 |
| `sessionStopped` | 会话被停止 |

`messageUpdate` 优先按 messageId 合并；缺失 messageId 时才允许退化更新当前会话最后一条 assistant 消息。

## 10. 错误态、安全和权限

命令审批必须串行展示。用户拒绝或超时后，Cowork 事件要回写对应 session。错误只写入当前打开会话详情；后台错误进入列表摘要或未读提示。

Exec approval decision 协议：

| UI 行为 | Gateway decision |
|---|---|
| 允许并记住 | `allow-always` |
| 仅本次允许 | `allow-once` |
| 拒绝 | `deny` |

Command safety：

- 非删除命令可自动批准并记住。
- 删除、force push、hard reset、kill、chmod 等危险命令必须进入审批弹窗。
- pendingApprovals 以 `requestId` 为键，会话停止/删除时按 sessionId 清理。

## 11. 与其它模块的关系

Cowork 接收 IM/Cron 触发的 session，也向 PetEventBridge 发出 AI 状态。ConfigSync 提供 system prompt 和 runtime 配置，Models/Skills/MCP 提供执行能力。

跨模块关系：

```text
DirectoryManager
  → Cowork 固化 cwd / agentId

Models
  → Cowork 固化 selected_model_json

Skills
  → ChatInputBox 本轮选择 skillIds

MCP
  → OpenClaw tool 能力
  → Cowork approval 队列承接风险操作

IM / Cron
  → 创建或继续 Cowork session

PetEventBridge
  ← Cowork message / messageUpdate / complete / error / permissionRequest
```

## 12. 测试策略

- session 启动和继续会话测试。
- 流式事件 session 隔离测试。
- 权限队列 FIFO 测试。
- 会话切换旧请求防覆盖测试。
