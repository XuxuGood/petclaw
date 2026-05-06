# IPCPreload 架构设计

## 1. 模块定位

IPCPreload 是 Electron 主进程能力进入 renderer 的唯一通道。它保护 `contextIsolation` 边界，避免 renderer 直接访问 Node、Electron 或主进程内部对象。

当前 channel inventory 见 `IPCChannel契约.md`。本文只定义架构边界、注册规则和安全约束。

## 2. 核心概念

- IPC channel：使用 `模块:动作` 命名。
- Phase A IPC：boot 前可用，只依赖数据库和基础能力。
- Phase B IPC：boot 成功、runtimeServices 就绪后注册，必须早于 `boot:complete`。
- Preload API：`window.api` 的最小受控能力集合。
- snapshot + push：状态类能力必须先查当前快照，再订阅增量事件。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ Renderer Component                                                  │
│  - calls typed window.api namespace                                  │
│  - handles loading / empty / error / disabled states                 │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Preload                                                            │
│  contextBridge exposes minimal APIs                                 │
│  no raw ipcRenderer passthrough                                     │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ invoke/on fixed channel
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Main IPC Registry                                                   │
│  safeHandle / safeOn                                                 │
│  duplicate channel guard                                             │
│  centralized error wrapping                                          │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Domain Service                                                      │
│  db / gateway / config / system capability                           │
└────────────────────────────────────────────────────────────────────┘
```

关键文件：

| 层 | 文件 |
|---|---|
| Registry | `petclaw-desktop/src/main/ipc/ipc-registry.ts` |
| IPC index | `petclaw-desktop/src/main/ipc/index.ts` |
| Boot IPC | `petclaw-desktop/src/main/ipc/boot-ipc.ts` |
| Chat/Cowork IPC | `petclaw-desktop/src/main/ipc/chat-ipc.ts` |
| Directory IPC | `petclaw-desktop/src/main/ipc/directory-ipc.ts` |
| Models IPC | `petclaw-desktop/src/main/ipc/models-ipc.ts` |
| Skills IPC | `petclaw-desktop/src/main/ipc/skills-ipc.ts` |
| MCP IPC | `petclaw-desktop/src/main/ipc/mcp-ipc.ts` |
| Memory IPC | `petclaw-desktop/src/main/ipc/memory-ipc.ts` |
| Scheduler IPC | `petclaw-desktop/src/main/ipc/scheduler-ipc.ts` |
| IM IPC | `petclaw-desktop/src/main/ipc/im-ipc.ts` |
| Window IPC | `petclaw-desktop/src/main/ipc/window-ipc.ts` |
| Logging IPC | `petclaw-desktop/src/main/ipc/logging-ipc.ts` |
| Preload implementation | `petclaw-desktop/src/preload/index.ts` |
| Preload types | `petclaw-desktop/src/preload/index.d.ts` |

## 4. 端到端数据流

用户点击 UI 后，renderer 调用 preload API；preload 将参数传给固定 channel；main 侧 `safeHandle` 统一捕获错误并调用服务；服务返回结构化结果；renderer 收窄类型并更新 UI 状态。订阅类事件必须返回取消订阅函数，页面卸载时释放。

状态订阅标准流：

```text
component mount
→ window.api.module.getStatus()
→ set local/store snapshot
→ window.api.module.onStatusChange(handler)
→ merge push events
→ component unmount unsubscribe
```

只依赖 push 会导致首次渲染空白；只依赖 snapshot 会导致运行中状态漂移。

窗口布局类 send-only channel 也必须通过 preload 的命名 API 暴露。例如
`window.api.updateComposerBounds(bounds)` 只能发送 `ChatInputBox` 的布局矩形给
`window:composer-bounds:update`，不得把 `ipcRenderer` 或任意窗口控制能力透传给 renderer。

## 5. 状态机与生命周期

```text
boot phase
→ register Phase A
→ runtime ready
→ register Phase B
→ boot:complete
→ pet-ready
→ create Pet Window / PetEventBridge
→ renderer subscribe
→ unsubscribe on unmount
```

## 6. 数据模型

IPC 不拥有持久化数据，只传输请求、响应和事件类型。数据所有权属于对应 domain store 或 service。

响应 shape 必须稳定。新增字段可以兼容，删除或改名字段必须先扫描 renderer 调用方。列表返回不应在不同状态下切换 shape，例如不能有时返回数组、有时返回 `{ items }`。

## 7. IPC / Preload 契约

新增/修改 IPC 必须同步：

- `petclaw-desktop/src/main/ipc/*.ts`
- `petclaw-desktop/src/preload/index.ts`
- `petclaw-desktop/src/preload/index.d.ts`
- renderer 调用点

禁止裸 `ipcMain.handle/on`；必须使用 `safeHandle` / `safeOn`。

Phase 边界：

| Phase | 可依赖 | 示例 |
|---|---|---|
| Phase A | db、基础 settings、boot 检查、日志平台 | `boot:*`、`i18n:*`、`app:version`、`logging:*` |
| Phase B | runtimeServices、Gateway、业务 manager | `cowork:*`、`mcp:*`、`cron:*`、`im:*` |

## 8. Renderer 布局、状态与交互

IPC 错误必须转成用户可见错误态。长任务 API 必须提供 pending、success、error、cancelled 状态；状态类能力必须使用 snapshot + push。

Renderer 不得导入 main 模块或复用 main 类型中的运行时对象。需要类型共享时，应使用 preload 声明或 shared 纯类型。

## 9. Runtime / Gateway 集成

IPC 本身不直接拥有 Gateway 连接。需要 Gateway 的 channel 只能在 Phase B 注册，并从 runtimeServices 获取客户端或状态。

## 10. 错误态、安全和权限

preload 不暴露通用 `ipcRenderer`。敏感能力必须在 main 校验参数、权限和 runtime 状态。错误日志由 main 记录，renderer 展示本地化文案。

安全规则：

- 不透传任意 channel 名。
- 不暴露 token、进程句柄、文件系统通用读写能力。
- renderer 传入路径、ID、JSON 配置都必须在 main 收窄和校验。
- 用户可见错误文案走 i18n；日志消息英文并保留 error 对象。

## 11. 与其它模块的关系

所有功能模块都经过 IPCPreload 进入 renderer。IPCPreload 不应了解业务内部状态，只维护边界和契约。

## 12. 测试策略

- IPC 注册测试。
- preload 类型声明检查。
- renderer 调用点的错误态测试。
- channel 命名和 Phase A/B 边界回归检查。
