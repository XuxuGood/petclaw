# Pet 事件架构设计

## 1. 模块定位

Pet 事件模块把 Cowork、Chat、IM、Cron、HookServer 等业务事件统一映射为 Pet Window 可消费的状态、气泡和动画信号。

## 2. 核心概念

- PetEventBridge：主进程事件聚合层。
- Pet state event：宠物状态机输入。
- bubble：短文本气泡协议。
- pause：用户暂停宠物反馈的本地状态。
- priority：多会话、多来源事件同时出现时的优先级。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ Main Process Event Sources                                          │
│                                                                    │
│  CoworkController     ImGateway     SchedulerManager     HookServer │
│        │                 │                │                 │       │
└────────┼─────────────────┼────────────────┼─────────────────┼───────┘
         │                 │                │                 │
         ▼                 ▼                ▼                 ▼
┌────────────────────────────────────────────────────────────────────┐
│ PetEventBridge                                                      │
│  - event mapping                                                    │
│  - activeSessionCount                                               │
│  - priority                                                         │
│  - bubble text                                                      │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ pet:state-event / pet:bubble
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Pet Window                                                          │
│  PetApp                                                             │
│  ├── IPC subscriptions                                               │
│  ├── pause state                                                     │
│  └── PetCanvas                                                       │
│      ├── state-machine                                               │
│      ├── WebM animation                                               │
│      └── bubble layer                                                │
└────────────────────────────────────────────────────────────────────┘
```

关键文件：

| 层 | 文件 |
|---|---|
| Event bridge | `petclaw-desktop/src/main/pet/pet-event-bridge.ts` |
| Pet app | `petclaw-desktop/src/renderer/src/pet/PetApp.tsx` |
| Canvas | `petclaw-desktop/src/renderer/src/pet/PetCanvas.tsx` |
| State machine | `petclaw-desktop/src/renderer/src/pet/state-machine.ts` |
| Pet styles | `petclaw-desktop/src/renderer/src/pet/pet.css` |
| Window setup | `petclaw-desktop/src/main/windows.ts` |

多会话时序图：

```text
Session A      Session B      PetEventBridge        Pet Window
   │              │                 │                    │
   │ start         │                 │ count 0→1           │
   │─────────────▶│                 │ ChatSent            │
   │              │                 │───────────────────▶│ Thinking
   │ first output  │                 │ AIResponding        │
   │─────────────▶│                 │───────────────────▶│ Working
   │              │ start           │ count 1→2           │
   │              │────────────────▶│ keep Working        │
   │ complete      │                 │ count 2→1           │
   │─────────────▶│                 │ no AIDone           │
   │              │ complete        │ count 1→0           │
   │              │────────────────▶│ AIDone              │
   │              │                 │───────────────────▶│ Happy → Idle
```

## 4. 端到端数据流

业务模块发出运行、等待审批、完成、错误等事件；PetEventBridge 归一化优先级和 session 来源；主进程推送给 Pet Window；Pet Window 只根据统一事件更新状态机和气泡，不理解业务内部结构。

示例：

```text
Cowork streaming
→ PetEventBridge { source: 'cowork', type: 'thinking', sessionId }
→ pet:state-event
→ Pet Window state-machine thinking

Cron run failed
→ PetEventBridge { source: 'cron', type: 'error', taskId }
→ pet:bubble
→ Pet Window 展示短错误摘要
```

## 5. 状态机与生命周期

Pet 状态机需要覆盖 idle、thinking、working、happy、error、sleep、paused 等状态。拖拽是交互行为，不应成为长期业务状态。

多来源优先级建议：

```text
error / permission_waiting
→ active cowork streaming
→ cron/im activity
→ completed/happy
→ idle
```

paused 是用户偏好状态，优先级高于普通气泡；paused 下不展示业务气泡。

## 6. 数据模型

Pet 事件主要是内存态和 IPC 事件。持久化只保留用户偏好，例如暂停状态或窗口位置；业务状态不在 Pet Window 保存。

事件 payload 应包含：

- `type`
- `source`
- `sessionId` / `taskId` / `instanceId` 可选上下文
- `message` 或 `bubbleText` 可选展示文本
- `createdAt`

## 7. IPC / Preload 契约

Pet Window 订阅统一 `pet:*` 事件。事件 payload 必须稳定，包含 type、source、sessionId/taskId 可选上下文和显示文本。

新增业务模块想驱动宠物时，只能向 PetEventBridge 发领域事件，不能直接给 Pet Window 增加业务 IPC。

## 8. Renderer 布局、状态与交互

Pet Window 只承载宠物动画、气泡、点击、拖拽和暂停。它不展示业务配置表单。气泡不得遮挡核心交互，暂停后不能继续弹出普通业务气泡。

Pet Window 结构：

```text
┌──────────────────────────────────────────────┐
│ Transparent Pet BrowserWindow                 │
│ click-through transparent area                 │
│                                              │
│      ┌────────────────────────────┐          │
│      │ Bubble Layer                │          │
│      │ "正在等待工具审批..."        │          │
│      └──────────────┬─────────────┘          │
│                     │                        │
│              ┌──────▼──────┐                 │
│              │ PetCanvas   │                 │
│              │ animation   │                 │
│              │ idle/thinking│                 │
│              │ success/error                 │
│              └──────┬──────┘                 │
│                     │                        │
│      drag hit area / click area / context menu│
└──────────────────────────────────────────────┘
```

透明区域点击穿透由 Pet Window IPC 请求 main 设置，Pet renderer 不直接操作窗口句柄。

前端状态层：

```text
PetApp
├── IPC subscriptions
│   ├── pet:state-event
│   ├── pet:bubble
│   └── pet:toggle-pause
├── event reducer
│   ├── source priority
│   ├── session/task context
│   └── bubble ttl
├── visual state
│   ├── idle
│   ├── listening
│   ├── thinking
│   ├── waitingApproval
│   ├── success
│   ├── error
│   └── paused
└── window actions
    ├── click: toggle main window
    ├── drag: move pet window
    └── right click: pet context menu
```

事件显示优先级：

| 优先级 | 事件 | Pet 表现 |
|---|---|---|
| 1 | permission waiting | waitingApproval 动画 + 审批气泡 |
| 2 | error | error 动画 + 短错误摘要 |
| 3 | active cowork/cron/im running | thinking/listening |
| 4 | success/complete | success 短动画 |
| 5 | idle/background | idle |
| paused | any normal event | 保持 paused，不弹普通业务气泡 |

交互状态：

- paused：只响应恢复、打开主窗口、退出等系统动作。
- dragging：暂停点击触发，避免拖拽误打开主窗口。
- bubble visible：不遮挡拖拽热区，长文本截断或换行。
- transparent area：请求 main 设置 ignore mouse，不在 renderer 直接操作窗口。
- sensitive event：不显示 cwd、token、完整 tool args。

## 9. Runtime / Gateway 集成

Pet 不直接调用 Gateway。它通过 Cowork、IM、Cron 等模块的归一化事件间接反映 runtime 状态。

## 10. 错误态、安全和权限

Pet Window 不能暴露敏感 tool 参数、cwd 或 token。错误气泡只展示用户可理解的摘要，详细错误留在主窗口或日志。

## 11. 与其它模块的关系

PetEventBridge 是业务事件消费者，不反向控制 Cowork、IM、Cron。点击宠物可以唤醒窗口，但不能直接修改业务状态。

## 12. 测试策略

- 事件映射表测试。
- paused 状态抑制气泡测试。
- 多会话冲突优先级测试。
- Pet Window 订阅和取消订阅测试。
