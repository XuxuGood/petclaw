# IM 架构设计

## 1. 模块定位

IM 模块负责即时通讯实例、凭据、启停状态、频道绑定和消息触发 Cowork 的链路。

## 2. 核心概念

- `im_instances.id`：IM 配置和运行状态的唯一 ID。
- platform：创建入口、筛选和分组维度，不是实例 ID。
- binding：IM 实例/频道与 Cowork 会话或 agent 的绑定。
- accountId：OpenClaw route 使用的账号标识，由 `im_instances.id` 前 8 位派生。
- peer binding：特定群/私聊的目录覆盖绑定。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ Renderer                                                           │
│ IM 页面：平台筛选 / 实例列表 / 凭据表单 / 对话级绑定                │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ window.api.im
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Main Process                                                        │
│  ImStore                                                            │
│  ├── im_instances                                                   │
│  ├── im_conversation_bindings                                       │
│  └── im_session_mappings                                            │
│                                                                    │
│  ConfigSync                                                         │
│  ├── channels                                                       │
│  └── bindings                                                       │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ openclaw.json
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ OpenClaw Runtime                                                    │
│ channel adapters → resolve-route → agent/session                    │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Cowork / PetEventBridge                                             │
│ IM 消息触发 Cowork，运行状态汇聚到宠物事件                           │
└────────────────────────────────────────────────────────────────────┘
```

关键文件：

| 层 | 文件 |
|---|---|
| Gateway manager | `petclaw-desktop/src/main/im/im-gateway-manager.ts` |
| Types | `petclaw-desktop/src/main/im/types.ts` |
| Store | `petclaw-desktop/src/main/data/im-store.ts` |
| IPC | `petclaw-desktop/src/main/ipc/im-ipc.ts` |
| Renderer page | `petclaw-desktop/src/renderer/src/views/im/ImChannelsPage.tsx` |
| Config dialog | `petclaw-desktop/src/renderer/src/views/im/ImConfigDialog.tsx` |
| Icons | `petclaw-desktop/src/renderer/src/views/im/im-platform-icons.tsx` |

IM 消息时序图：

```text
IM 平台       OpenClaw Runtime       ImGateway/Main       Cowork        Pet
  │                 │                     │                │           │
  │ 用户消息         │                     │                │           │
  │────────────────▶│ resolve-route        │                │           │
  │                 │────────────────────▶│ 查 bindings     │           │
  │                 │                     │ 找/建 session   │           │
  │                 │                     │───────────────▶│ send      │
  │                 │                     │                │──────────▶│ state
  │                 │                     │ result          │           │
  │◀────────────────│◀────────────────────│◀───────────────│           │
```

## 4. 端到端数据流

用户创建 IM 实例并保存凭据；main 写入 `im_instances`；ConfigSync 生成 OpenClaw bindings；runtime 接收平台消息；ImGateway 解析 instance 和 channel；绑定到 Cowork session；Cowork 执行后将回复或状态返回对应 IM 通道。

OpenClaw route 负责实际匹配；PetClaw 只管理实例配置和 bindings：

```text
IM 用户发消息
→ OpenClaw runtime 收到 channel/accountId/peer
→ resolve-route 按优先级匹配 bindings
  → 对话级 peer match
  → 实例级 account match
  → main agent fallback
→ 路由到 agent
→ 启动或继续 Cowork
→ 回复 IM
→ PetClaw 更新 im_session_mappings
```

## 5. 状态机与生命周期

```text
created
→ configured
→ starting
→ running
→ paused | error
→ stopped
```

## 6. 数据模型

IM 前端、凭据、启停状态和绑定都必须指向 `im_instances.id`。platform 只能用于筛选、分组和创建。

核心表：

```sql
CREATE TABLE IF NOT EXISTS im_instances (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  name TEXT,
  directory_path TEXT,
  agent_id TEXT,
  credentials TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS im_conversation_bindings (
  conversation_id TEXT NOT NULL,
  instance_id TEXT NOT NULL REFERENCES im_instances(id) ON DELETE CASCADE,
  peer_kind TEXT NOT NULL,
  directory_path TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, instance_id)
);

CREATE TABLE IF NOT EXISTS im_session_mappings (
  conversation_id TEXT NOT NULL,
  instance_id TEXT NOT NULL REFERENCES im_instances(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES cowork_sessions(id),
  agent_id TEXT NOT NULL DEFAULT 'main',
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, instance_id)
);
```

## 7. IPC / Preload 契约

实例 CRUD、启停、凭据更新和绑定编辑都必须传具体 instance id。返回结构应围绕 `{ instances }`，不要让 renderer 假设 platform 就是事实源。

## 8. Renderer 布局、状态与交互

IM 页面包含平台筛选、实例列表、实例详情、凭据配置、启停状态、绑定入口和错误提示。未配置凭据时启动按钮 disabled；保存失败不关闭编辑面板。

页面入口与源码：

| 区域 | 源码 |
|---|---|
| IM 页面 | `petclaw-desktop/src/renderer/src/views/im/ImChannelsPage.tsx` |
| 配置弹窗 | `petclaw-desktop/src/renderer/src/views/im/ImConfigDialog.tsx` |
| 平台图标 | `petclaw-desktop/src/renderer/src/views/im/im-platform-icons.tsx` |
| 连接器设置入口 | `petclaw-desktop/src/renderer/src/views/settings/ConnectorSettings.tsx` |

页面结构：

```text
AppShell
└── MainPane / ImChannelsPage
    ├── Header
    │   ├── title
    │   ├── platform filter
    │   └── create instance
    ├── InstanceList
    │   ├── platform icon
    │   ├── instance name
    │   ├── enabled/running status
    │   ├── credential configured badge
    │   └── last error badge
    ├── InstanceDetail
    │   ├── platform / name
    │   ├── credentials summary
    │   ├── enable / disable
    │   ├── edit credentials
    │   ├── delete
    │   └── directory binding entry
    └── ImConfigDialog
```

实例列表的 key 必须是 `im_instances.id`，不是 platform。

配置弹窗布局：

```text
ImConfigDialog
├── Header
│   ├── platform icon
│   ├── create/edit title
│   └── close
├── Form
│   ├── display name
│   ├── credential fields by platform
│   ├── optional default directory
│   └── validation errors
└── Footer
    ├── cancel
    └── save
```

对话绑定布局：

```text
Conversation Binding
├── instance selector
├── conversation id / peer kind
├── directory selector
├── resolved agentId preview
└── save binding
```

绑定必须包含 `conversationId`、`instanceId`、`peerKind`、`directoryPath`、`agentId`。缺任一字段都不能保存。

状态来源：

| 状态 | 所有者 | 说明 |
|---|---|---|
| instance list | `ImChannelsPage` 本地 state | 来自 `im:load-config` |
| selected platform | 页面本地 state | 仅筛选或创建默认值 |
| selected instance | 页面本地 state | key 为 `im_instances.id` |
| status snapshot | 页面本地 state | 来自 `im:get-status` |
| status push | 页面订阅 | `im:status-update` |
| dialog draft | `ImConfigDialog` 本地 state | 保存前不写主状态 |

交互状态：

| 状态 | UI 行为 |
|---|---|
| no instances | 显示创建入口 |
| credentials missing | 启动/启用按钮 disabled |
| status loading | 显示 snapshot loading，不隐藏实例列表 |
| connecting/running/error | 实例行和详情页同步显示状态 |
| save failed | 弹窗保持打开，显示字段或顶部错误 |
| delete instance | 删除前确认，并清理选中实例 |
| runtime 未就绪 | 可编辑本地配置，不展示已连接承诺 |

## 9. Runtime / Gateway 集成

IM 通过 ConfigSync 写入 runtime bindings，并依赖 runtime 通道状态。runtime 未就绪时展示“等待 runtime”状态。

bindings 示例：

```json
[
  {
    "agentId": "ws-a1b2c3d4e5f6",
    "match": { "channel": "feishu", "accountId": "a1b2c3d4" }
  },
  {
    "agentId": "ws-7890abcdef12",
    "match": {
      "channel": "feishu",
      "accountId": "a1b2c3d4",
      "peer": "group:oc_xxxx"
    }
  }
]
```

## 10. 错误态、安全和权限

凭据不得写入明文 runtime 配置。日志不能输出 token。平台连接失败需要展示实例级错误，不能影响其它实例。

两层绑定边界：

- 实例级默认：该 bot 实例所有消息默认路由到目录 agent；未设置目录时走 main。
- 对话级覆盖：特定群/私聊走指定目录 agent，优先级高于实例默认。
- platform 不作为绑定 key。

## 11. 与其它模块的关系

IM 触发 Cowork，并向 PetEventBridge 发出消息活动事件。ConfigSync 负责同步 bindings，DataStorage 持久化实例。

## 12. 测试策略

- platform 与 instance id 边界测试。
- 实例 CRUD 和启停测试。
- 凭据不泄漏测试。
- IM 触发 Cowork 的绑定测试。
