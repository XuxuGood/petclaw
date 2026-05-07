# PetClaw Shell-first Runtime 预热设计

## 1. 背景

当前 PetClaw 启动链路把 BootCheck、Gateway 启动和应用可见性绑在一起：

1. Main Process 创建 Main Window。
2. Main Window 显示 BootCheck。
3. BootCheck 执行 ConfigSync、EngineManager.startGateway 和健康检查。
4. 成功后注册 runtime IPC，Renderer 进入主 UI。
5. Renderer 发送 `app:pet-ready` 后创建 Pet Window 和事件桥。

这个模型的问题是：Gateway 是否 ready 被误当成应用是否 ready。结果是 Dock、
Application Menu、主窗口激活和 Pet 初始化容易互相影响，最终出现“启动后 Dock/Menu
消失或主窗口不激活，需要点击宠物才显示”的体验问题。

生产级目标不是修一个启动时序补丁，而是重新划清两个概念：

- **App Boot**：桌面壳、主窗口、系统菜单、Dock/托盘入口、Phase A IPC、基础状态可用。
- **Runtime Ready**：OpenClaw Gateway、配置同步、token、MCP Bridge、健康检查可用。

Main Window 是 App Boot 的一部分，不应该等待 Runtime Ready 才成立。

## 2. LobsterAI 参考

LobsterAI 没有 PetClaw 式的阻塞 BootCheck 页。它采用混合策略：

- 启动期如果当前协作引擎是 OpenClaw，则后台触发 `ensureOpenClawRunningForCowork()`。
- 这个触发是 fire-and-forget，不阻塞窗口创建。
- Chat/Cowork/IM 等业务入口仍会调用 ensure 兜底。
- Renderer 通过 preload 获取 OpenClaw 状态、进度和手动控制。

可参考的源码位置：

- `/Users/xiaoxuxuy/Desktop/工作/AI/开源项目/LobsterAI/src/main/main.ts:951`
  `ensureOpenClawRunningForCowork()` 检查 running/starting、等待 token refresh、启动 MCP
  Bridge、同步配置，再启动 Gateway。
- `/Users/xiaoxuxuy/Desktop/工作/AI/开源项目/LobsterAI/src/main/main.ts:5868`
  启动期按 `resolveCoworkAgentEngine() === 'openclaw'` 条件后台拉起 Gateway。
- `/Users/xiaoxuxuy/Desktop/工作/AI/开源项目/LobsterAI/src/main/preload.ts:146`
  Renderer 暴露 `openclaw.engine.getStatus/install/retryInstall/restartGateway/onProgress`。
- `/Users/xiaoxuxuy/Desktop/工作/AI/开源项目/LobsterAI/src/renderer/services/i18n.ts:367`
  UI 文案明确表达“启动任务时自动拉起网关”。

PetClaw 应参考这个方向，但不能照搬两点：

1. PetClaw 有桌面宠物、Dock、Application Menu、PetEventBridge 等系统集成入口，App Boot
   和 Pet Ready 必须拆得更清楚。
2. PetClaw 需要三端桌面行为一致，不能把 macOS 的 Dock/Menu 细节扩散成 Runtime 依赖。

## 3. 设计目标

1. App 启动后 Main Window 立即进入真实主 UI 或可交互 Shell，不再被 Gateway 阻塞。
2. Dock、Application Menu、托盘或系统入口在 Boot 期间安装完成，不依赖 `app:pet-ready`。
3. Gateway 支持后台预热，但预热不影响主窗口显示、菜单可用和宠物创建。
4. Chat、Cron、IM、Settings 等业务入口统一通过 runtime ensure 获取 Runtime Ready。
5. 所有 Runtime 启动路径并发去重、状态可订阅、失败可恢复、错误对用户可见。
6. BootCheck 不再作为启动门禁。若保留，只作为 Runtime Health/Diagnostics 页面或组件。
7. 实现必须是生产级，不引入 demo、MVP 分支或临时 tail-fix。

## 4. 非目标

- 不改变 Electron 安全边界：`nodeIntegration: false`、`contextIsolation: true` 保持不变。
- 不让 Renderer 直接访问 Node/Electron/OpenClaw 进程能力。
- 不把 Runtime 状态塞进 Pet Window 内部逻辑；Pet 只消费统一事件。
- 不让 Cron/IM/Chat 各自手写 Gateway 启动逻辑。
- 不在第一步重做完整 EngineManager 内部实现，除非现有边界无法支撑统一 ensure。

## 5. 核心决策

采用 **Shell-first + visible 后后台预热 + 业务入口按需 ensure**。

### 5.1 App Boot 边界

App Boot 完成的条件：

- Electron `app.whenReady()` 完成。
- SQLite/配置底座可用。
- Phase A IPC 注册完成。
- Main Window 已创建并可显示主 UI。
- Dock/Application Menu/托盘或平台等价入口已安装。
- 主窗口恢复入口可用：Dock 点击、菜单打开、托盘点击、第二实例唤醒。

App Boot 不等待：

- Gateway 端口监听。
- OpenClaw health check 成功。
- MCP Bridge 全量 ready。
- Skill/Cron/IM 后台初始化完全结束。

### 5.2 Runtime Ready 边界

Runtime Ready 完成的条件：

- ConfigSync 成功写入 runtime 需要的配置。
- Gateway 进程启动并有有效端口/token。
- Gateway health check 通过。
- 必要的 MCP Bridge 配置已纳入 OpenClaw 配置。
- EngineManager 状态为 `running`。

Runtime Ready 是业务能力条件，不是应用窗口条件。

### 5.3 预热策略

默认采用后台预热，但触发点必须晚于 Main Window 可见：

1. Main Window ready-to-show 或首屏 mounted。
2. Shell 状态稳定后，Main Process 调度 runtime prewarm。
3. 如果满足预热条件，则调用统一 `RuntimeLifecycle.ensureReady('startup-prewarm')`。
4. 预热失败只更新 Runtime 状态，不关闭窗口、不隐藏 Dock/Menu、不阻塞 Pet。

预热条件：

- 普通用户手动启动：默认预热，因为 AI 协作是核心功能。
- 开机自启且隐藏启动：默认不预热，除非 Cron/IM 有自动任务需要 runtime。
- Cron 有启用的自动任务：需要预热或由 Cron 启动前 ensure。
- IM 有启用的自动接入或自动响应实例：需要预热或由 IM 启动前 ensure。
- 用户在设置中关闭启动预热：不做 startup prewarm，但业务入口仍按需 ensure。

这个策略兼顾首轮响应速度和后台资源消耗。

## 6. 组件边界

### 6.1 RuntimeLifecycleService

新增或收敛一个 Main Process 服务，统一管理 Runtime 生命周期。

职责：

- 暴露 `getSnapshot()`，返回当前 Runtime 状态。
- 暴露 `ensureReady(reason)`，供 Chat/Cron/IM/Settings 调用。
- 暴露 `prewarm(reason)`，语义上是低优先级 ensure。
- 暴露 `restart(reason)`、`stop(reason)`，供设置页和诊断页调用。
- 合并并发启动请求，避免重复 ConfigSync 或重复拉起 Gateway。
- 转发 EngineManager 状态到 Renderer 和 PetEventBridge。

不负责：

- 渲染 UI。
- 决定 Chat/Cron/IM 的业务流程。
- 直接创建 Pet Window 或 Main Window。

### 6.2 BootCoordinator

Main Process 启动协调层负责 App Boot，不负责 Gateway ready。

职责：

- 初始化 SQLite 和基础配置。
- 注册 Phase A IPC。
- 创建 Main Window。
- 安装 SystemIntegration：Dock、Application Menu、托盘、第二实例唤醒。
- 触发 Renderer shell ready 事件。
- 在合适时机调度 runtime prewarm。

不负责：

- 阻塞等待 Runtime Ready。
- 在 Boot 失败时把用户困在 BootCheck 页面。
- 依赖 Pet Ready 才恢复主窗口。

### 6.3 Renderer Shell

Renderer 首屏应直接进入主应用 Shell。

职责：

- 显示 Runtime 状态徽标或局部 loading。
- Chat 发送、Cron 启停、IM 自动接入等操作进入业务前调用对应 API。
- 对 Runtime 启动中、失败、可重试状态展示明确错误态和按钮。

不负责：

- 自己拼装 Gateway URL/token。
- 自己判断 OpenClaw 进程状态。
- 直接访问 Node 或主进程内部服务。

### 6.4 BootCheck / Diagnostics

BootCheck 不再作为启动页。

处理方式：

- 重命名或重定位为 Runtime Diagnostics。
- 作为 Settings/Engine 内的健康检查视图。
- 展示 ConfigSync、Gateway、MCP Bridge、health check、日志路径、重试按钮。
- 可以被 Runtime 错误态 deep-link 打开。

如果现有 BootCheck 组件仍保留，必须去掉“启动门禁”的语义和 Main Window 阻塞关系。

## 7. Runtime 状态机

RuntimeLifecycleService 对外暴露稳定状态：

| 状态 | 含义 | 用户行为 |
|---|---|---|
| `idle` | Runtime 尚未启动 | 可进入主 UI，业务入口会触发 ensure |
| `prewarming` | 后台预热中 | 主 UI 可用，AI 功能显示启动中 |
| `starting` | 用户业务入口触发启动 | 当前操作等待或显示队列态 |
| `connecting` | Gateway 已启动，等待 health | 显示连接中，可取消非关键操作 |
| `running` | Runtime 可用 | 正常使用 |
| `degraded` | 部分能力失败但 Gateway 可用 | 展示降级说明，允许继续可用功能 |
| `error` | Runtime 无法使用 | 展示错误、重试、打开诊断 |
| `stopping` | 用户或系统正在停止 | 暂停新请求或排队 |

状态必须包含：

- `phase`
- `reason`
- `updatedAt`
- `attempt`
- `message`
- `errorCode`
- `gatewayPort`，仅 main/preload 允许按安全策略暴露必要信息
- `canRetry`
- `canOpenDiagnostics`

## 8. 数据流

### 8.1 启动

1. Main Process ready。
2. 初始化 SQLite/基础配置。
3. 注册 Phase A IPC。
4. 创建 Main Window 并显示 Shell。
5. 安装 Dock/Menu/Tray/second-instance 行为。
6. Renderer mounted 后订阅 Runtime snapshot。
7. Main Process 判断是否需要 startup prewarm。
8. 若需要，后台调用 `RuntimeLifecycleService.prewarm('startup-prewarm')`。
9. 状态通过 push 事件更新 Renderer。

### 8.2 Chat 发送

1. Renderer 点击发送。
2. Renderer 调用 Cowork start/send IPC。
3. Main Process Cowork 服务调用 `ensureReady('cowork-send')`。
4. 若 Runtime 正在启动，复用同一个启动 promise。
5. Ready 后继续发送到 Gateway。
6. 失败时返回结构化错误，Renderer 写入当前 session 错误消息。

### 8.3 Cron/IM 自动任务

1. Cron/IM 服务启动前检查是否有启用任务。
2. 有任务时调用 `ensureReady('cron-autostart')` 或 `ensureReady('im-autostart')`。
3. 失败时只标记对应任务/实例为等待 runtime 或错误，不影响应用 Shell。
4. Runtime 后续 ready 时，Cron/IM 可通过订阅恢复。

## 9. 并发与幂等

必须避免以下坑：

- Chat、Cron、IM 同时触发三个 Gateway 启动。
- Startup prewarm 和用户发送消息互相覆盖状态。
- ConfigSync 被多次并发写入，导致 OpenClaw 配置抖动。
- 启动失败后 promise 不释放，后续重试永远复用失败状态。

规则：

- 同一时间只允许一个 `ensureReady` 主任务。
- 后来的 `ensureReady(reason)` 复用 in-flight promise，但记录 reason 列表用于日志。
- `prewarm` 优先级低于用户操作；如果用户操作到来，状态 reason 升级为用户操作。
- 失败后清理 in-flight promise，保留最后错误 snapshot。
- `restart` 必须显式取消或等待当前 ensure，再进入 stop/start。
- ConfigSync 必须由 RuntimeLifecycleService 串行调用。

## 10. 错误处理

Runtime 错误分层：

1. 配置错误：ConfigSync 失败、workspace 写入失败、权限问题。
2. 安装/资源错误：runtime 缺失、不可执行、签名或隔离属性问题。
3. 端口错误：端口占用、监听失败、token 不一致。
4. 健康检查错误：Gateway 进程存在但 health 超时。
5. 业务错误：Gateway ready，但某个请求失败。

用户可见规则：

- Shell 不因为 Runtime 错误关闭或隐藏。
- Chat 当前操作失败要写入当前 session，不污染其他 session。
- Settings/Engine 展示结构化错误、重试和诊断入口。
- Cron/IM 后台失败要写入对应实例/任务状态，不弹全局阻塞弹窗。
- 日志保留 reason、attempt、duration、platform、runtime path、gateway port，但不记录 token。

## 11. 平台边界

macOS：

- Dock 和 Application Menu 必须在 Boot 阶段安装。
- Pet Window 使用非激活展示，不能抢主窗口焦点。
- 第二实例唤醒必须恢复并聚焦 Main Window。

Windows/Linux：

- 使用托盘或任务栏入口作为 Dock 等价恢复入口。
- 没有 Application Menu 的平台不应依赖该能力。
- Runtime 预热策略一致，但窗口激活 API 必须走 Electron 平台分支。

通用：

- 不硬编码 `/tmp`、`~`、盘符或反斜杠。
- Runtime 路径、日志路径、端口文件使用 `path`、`os` 和 Electron API。

## 12. IPC 和 Preload 契约

需要统一 Runtime IPC：

- `runtime:get-snapshot`
- `runtime:on-status`
- `runtime:ensure-ready`
- `runtime:prewarm`
- `runtime:restart`
- `runtime:stop`
- `runtime:open-diagnostics`

规则：

- IPC 注册通过 `safeHandle` / `safeOn`。
- Phase A 只暴露不依赖 runtimeServices 的 snapshot 或基础状态。
- Phase B 暴露 RuntimeLifecycleService 的完整控制。
- preload 只暴露受控 API，不暴露 ipcRenderer 或 Gateway token。
- Renderer 必须用 snapshot 查询 + push 订阅，不能只靠一次事件。

## 13. 迁移策略

实现时应按边界切换，而不是继续叠补丁：

1. 先建立 RuntimeLifecycleService 和状态契约。
2. 把 EngineManager.startGateway、ConfigSync.sync、health check 收敛到 ensure/prewarm。
3. 改 Main Process 启动链路：Boot 不 await Gateway。
4. 把 BootCheck 从启动页移到 Diagnostics/Settings。
5. 改 Chat/Cron/IM 调用点，统一走 ensure。
6. 移除启动末尾的主窗口 re-activate tail-fix。
7. 补齐测试和文档。

## 14. 测试与验证

需要覆盖：

- App Boot 不等待 Gateway 也能显示 Main Window。
- Dock/Application Menu/Tray 在 runtime error 时仍可用。
- Pet Window 创建不改变 Main Window 激活状态。
- startup prewarm 失败不阻塞 Shell。
- Chat 发送在 idle 状态会触发 ensure 并继续执行。
- Chat、Cron、IM 并发 ensure 只启动一次 Gateway。
- `starting` 状态下新请求复用 in-flight promise。
- ensure 失败后可以重试。
- 开机自启隐藏模式不默认预热，除非 Cron/IM 需要。
- macOS packaged app `open -n PetClaw.app` 只保留单实例并激活 Main Window。

建议验证命令：

```bash
pnpm --filter petclaw-desktop typecheck
pnpm --filter petclaw-desktop test
pnpm --filter petclaw-desktop package:dir
pnpm --filter petclaw-desktop dist:mac:arm64
```

打包后手工验证：

```bash
open -n petclaw-desktop/release/mac-arm64/PetClaw.app
```

验证点：

- 主窗口立即显示。
- Dock 图标存在且点击可恢复窗口。
- Application Menu 存在。
- Pet 出现后不抢焦点。
- Gateway 启动中或失败时 UI 有明确状态。
- 点击 Chat 发送能触发 ensure，而不是要求用户先点宠物或打开诊断。

## 15. 文档同步要求

实现后必须同步：

- `docs/架构设计/desktop/overview/Desktop架构设计.md`
- `docs/架构设计/desktop/runtime/RuntimeGateway架构设计.md`
- `docs/架构设计/desktop/runtime/SystemIntegration架构设计.md`
- 如 IPC/preload 契约变化，补充对应 Renderer/Preload 架构文档。

如果 BootCheck 被重命名或职责变化，相关文档必须删除“启动门禁”表述。

