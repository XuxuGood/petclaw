# Renderer 架构设计

本文档是 `petclaw-desktop` renderer、Preload API 使用方式和桌面 UI/UX 架构事实源。desktop 总体边界见 `Desktop架构设计.md`；主进程、OpenClaw runtime、SQLite 数据模型、ConfigSync 和功能模块细节见本目录对应模块文档。本文只定义 desktop 前端如何承接这些能力，以及桌面 App 场景下必须守住的真实使用边界。

## 1. 设计目标

PetClaw 前端不是网页落地页，而是长期驻留的桌面效率工具。前端设计目标如下：

- 让用户在 Main Window 中完成高频工作流：选择目录、发起 Cowork、审批工具调用、查看任务状态、配置模型、管理 Skill、创建 Cron、配置 IM。
- 让 Pet Window 成为轻量状态反馈入口，只表现统一宠物事件，不承载业务配置。
- 让所有系统能力通过 preload 进入主进程，渲染进程不直接接触 Node/Electron 能力。
- 让多会话、多任务、流式输出和权限请求按 `sessionId` 隔离，避免后台任务污染当前视图。
- 让 runtime 未就绪、gateway 断开、离线、权限阻塞、长任务执行、窗口隐藏/恢复等桌面边界都有明确 UI 状态。

## 2. 渲染窗口边界

PetClaw 前端由两个渲染窗口组成：

```text
Main Window
├── App.tsx                       主工作台路由、全局弹窗宿主、双侧栏开关
├── WorkspaceFrame                主工作台布局、左右面板响应式降级
├── Sidebar                       目录、会话、定时任务运行、IM 频道入口
├── ChatView                      Cowork 会话消息、流式输出、发送入口
├── ChatInputBox                  cwd、模型、Skill、附件、本轮 prompt 输入
├── SettingsPage                  独占配置管理台
├── SkillsPage                    Skill 管理
├── CronPage                      定时任务管理和运行历史
├── ImChannelsPage                IM 实例和频道配置
├── BootCheckPanel                runtime 启动检查和失败恢复
└── TaskMonitorPanel              当前会话的工具、产物、审批和运行状态面板

Pet Window
└── pet/
    ├── PetApp                    IPC 事件订阅和暂停状态
    ├── PetCanvas                 动画播放、拖拽、点击、气泡
    └── state-machine             统一宠物状态机
```

Main Window 布局：

```text
┌────────────────────────────────────────────────────────────────────┐
│ AppTopBar / traffic light safe area / runtime 状态                  │
├───────────────┬────────────────────────────────────┬───────────────┤
│ Sidebar       │ Main Content                       │ Right Panel   │
│               │                                    │               │
│ - directories │ ChatView / Settings / Skills       │ TaskMonitor   │
│ - sessions    │ CronPage / ImChannelsPage / Boot   │ approvals     │
│ - cron runs   │                                    │ artifacts     │
│ - IM entries  │                                    │ tool status   │
├───────────────┴────────────────────────────────────┴───────────────┤
│ ChatInputBox 只在 Chat 工作流出现；设置/技能/IM/Cron 页面不复用发送框 │
└────────────────────────────────────────────────────────────────────┘
```

关键源码入口：

| 区域 | 文件 |
|---|---|
| 根路由和全局弹窗 | `petclaw-desktop/src/renderer/src/App.tsx` |
| 工作台框架 | `components/workspace/WorkspaceFrame.tsx` |
| 顶栏 | `components/workspace/AppTopBar.tsx` |
| 侧栏 | `components/Sidebar.tsx` |
| Chat | `views/chat/ChatView.tsx` |
| Chat 输入框 | `views/chat/ChatInputBox.tsx` |
| 权限弹窗 | `views/chat/CoworkPermissionModal.tsx` |
| AskUser 向导 | `views/chat/CoworkQuestionWizard.tsx` |
| Settings | `views/settings/SettingsPage.tsx` |
| Skills | `views/skills/SkillsPage.tsx` |
| Cron | `views/cron/CronPage.tsx` |
| IM | `views/im/ImChannelsPage.tsx` |
| Pet Window | `pet/PetApp.tsx`、`pet/PetCanvas.tsx`、`pet/state-machine.ts` |

### 2.1 Main Window

Main Window 是工作台。它必须直接进入可操作界面，不做营销式首页，不用大幅 hero 承载功能说明。全局路由、当前会话、当前目录、设置 tab、侧栏状态由 `App.tsx` 或其抽出的根级容器维护。深层组件不能私自维护全局 view，也不能通过隐式全局变量改变主路由。

### 2.2 Pet Window

Pet Window 只消费主进程 `PetEventBridge` 聚合后的 `pet:state-event` 和 `pet:bubble`。它不能理解 Chat、IM、Cron、HookServer、CoworkController 的内部状态，也不能直接请求业务数据。点击宠物只允许触发窗口级行为，例如切换 Main Window 或唤醒 Sleep 状态。

### 2.3 BootCheck

BootCheck 是 Main Window 的启动阶段界面。BootCheck 阶段只允许调用 Phase A IPC：`boot:*`、`i18n:*`、`settings:*`、`app:version`。完整业务 IPC 只能在 boot 成功、runtime services 就绪、`app:pet-ready` 后注册。Boot 失败时 UI 必须停留在可恢复状态，禁止展示可发送 Cowork 的入口。

## 3. Preload 与 IPC 契约

渲染进程不能直接访问 Node/Electron 能力。所有系统能力必须通过 `src/preload/index.ts` 暴露的 `window.api` 进入主进程。

新增或修改能力必须同步维护四处：

- `src/main/ipc/*.ts`：通过 `safeHandle` / `safeOn` 注册 channel。
- `src/preload/index.ts`：暴露最小受控 API，不透传 `ipcRenderer`。
- `src/preload/index.d.ts`：同步精确类型声明。
- renderer 调用点：只消费 preload API，不导入 main 模块。

IPC 契约规则：

- Channel 使用 `模块:动作`，禁止驼峰。
- renderer 侧必须把 `unknown` 返回值收窄为本地 UI 类型后再使用。
- 对列表类 API，主进程返回结构必须稳定。例如 IM 若返回 `{ instances }`，renderer 不得假设存在 `{ platforms }`。
- 对实例类 API，renderer 必须明确传递实例 ID；若 UI 以平台为入口，应先解析或创建实例，再进行更新。
- 对状态类 API，必须同时提供 snapshot 和 push。页面打开时先查询当前状态，再订阅后续事件，避免只靠增量事件导致空白或 loading 卡住。
- 对长任务类 API，必须有 pending、success、error、cancelled 四类 UI 状态。

## 4. 状态模型

前端状态分为五类：

| 类型 | 归属 | 规则 |
|---|---|---|
| App 路由状态 | `App.tsx` 或根级容器 | `activeView`、`settingsTab`、侧栏开关、当前会话 ID、当前目录入口状态 |
| 会话消息状态 | `useChatStore` | 只缓存当前打开会话的消息详情；后台会话事件只更新运行状态、未读或列表摘要；历史加载必须有 loading/error 和旧请求保护 |
| 会话列表状态 | Sidebar 服务层或专用 store | 新建、删除、运行中、完成、错误都必须刷新或增量同步 |
| 全局权限请求 | `usePermissionStore` | Exec Approval 和 AskUserQuestion 共用 FIFO 队列，但必须保留 `sessionId` 和 source |
| 页面表单状态 | 页面组件本地 state | 表单草稿只在当前弹窗/页面内存在，保存后通过 IPC 刷新事实数据 |

Zustand actions 只更新内存状态，不发 IPC、不做异步副作用。IPC 读取、事件订阅、错误展示放在组件 `useEffect`、事件处理函数或服务层。

## 5. Cowork 会话状态

Cowork 是前端最核心的交互链路，必须按以下状态机处理：

```text
draft
  └─ startSession success(sessionId)
      └─ running
          ├─ permission_waiting
          ├─ streaming
          ├─ completed
          ├─ error
          └─ stopped
```

### 5.1 当前会话详情

- 新建会话返回 `sessionId` 前，用户首条消息保留在当前草稿详情中。
- 主进程返回 `sessionId` 后，将当前详情绑定到该 `sessionId`，继续承接本轮流式事件。
- 后续 `cowork:*` 流式事件必须先比对事件携带的 `sessionId`；只有当前打开会话可以写入消息详情。
- 切换会话时先切 `activeSessionId`，展示会话详情 loading/error 状态，再从主进程加载历史消息覆盖当前详情；禁止继续显示上一个会话的消息。
- 会话历史加载必须使用 request id、abort flag 或等价机制，旧请求返回后不能覆盖当前会话。
- 运行中的会话必须支持 snapshot + stream 合并；历史快照返回晚于流式事件时，不能丢失已经展示的实时消息。
- 流式更新优先按后端 `messageId` 合并，缺失 `messageId` 时才退化为更新最后一条 assistant 消息。
- 后台会话流式更新不得污染当前正在查看的会话；只能更新运行状态、未读或列表摘要。
- 错误事件只在当前打开会话写入消息详情；后台错误进入会话列表状态或未读提示。

### 5.2 会话列表

会话列表不是消息列表的派生状态。Sidebar 必须从主进程 `cowork:session:list` 或后续事件维护：

- 新建会话后立刻出现。
- running/completed/error/stopped 状态实时更新。
- 删除会话后从列表移除；如果删除的是当前打开会话，必须清空当前详情。
- IM 和 scheduler origin 的会话不进入用户主动任务列表，但要在对应 IM/Cron 区域可追踪。

### 5.3 目录选择

目录驱动 Agent 是产品核心，前端必须只有一个“当前目录”的事实源。允许两种实现，二选一：

- 根层维护当前目录路径，`ChatInputBox` 作为受控组件显示并发送该 cwd。
- `ChatInputBox` 独立维护 cwd，侧栏不再表达当前目录选择，只展示历史和配置入口。

禁止侧栏显示当前目录状态但发送链路使用另一个隐式 cwd。renderer 不能只传 `agentId` 给 Chat，需要在发送前解析为目录路径，或由主进程提供明确的 `agentId -> cwd` startSession 入口。

## 6. 权限请求队列

权限弹窗由 `App.tsx` 在全局根层统一渲染，底层通过 `usePermissionStore` FIFO 队列驱动。队列数据必须包含：

```typescript
interface PermissionRequest {
  requestId: string
  sessionId: string
  source: 'cowork' | 'ask-user'
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId?: string | null
}
```

规则：

- `requestId` 用于去重和响应。
- `sessionId` 用于清理、标注来源和避免停止会话后残留弹窗。
- AskUserQuestion 可使用独立 source，但仍要标明来源。
- 停止、删除、完成或超时的会话必须 dismiss 对应权限请求。
- 多问题向导必须支持 Escape 拒绝、超时关闭、恢复已有答案。
- 危险命令展示必须解释原因，用户拒绝时要把拒绝信息返回主进程。

## 7. 核心页面边界

### 7.1 Chat

Chat 页面负责消息展示、发送、附件、cwd、模型选择和本轮 Skill 选择。它不负责写全局配置，不负责扫描 Skill，不负责解释 main process 的业务数据模型。

Chat 页面布局：

```text
┌──────────────────────────────────────────────────────────────┐
│ ChatTitleSlot / 当前会话标题 / cwd 摘要 / 模型状态             │
├──────────────────────────────────────────────────────────────┤
│ 消息列表                                                       │
│ - user / assistant / tool_use / tool_result / system           │
│ - streaming assistant message                                  │
│ - session loading / empty / error                              │
├──────────────────────────────────────────────────────────────┤
│ ChatInputBox                                                   │
│ - attachments preview                                           │
│ - textarea                                                      │
│ - cwd tag / model selector / skill badges / connector menu      │
│ - send button + shortcut mode                                   │
└──────────────────────────────────────────────────────────────┘
```

Chat 输入框的附件分两类：

- 图片附件：renderer 可读 base64，发送到 `imageAttachments`。
- 文件/目录引用：只传绝对路径到 `pathReferences`，不在 renderer 预读内容。

拖放或粘贴拿不到可靠绝对路径时，不能伪装成可读本地路径。非图片文件如果没有 path，只能作为 UI 提示或禁用发送引用。

ChatInputBox 详细结构：

```text
┌──────────────────────────────────────────────────────────────┐
│ 附件预览区                                                     │
│  ├─ 图片：64×64 缩略图 + 文件名遮罩 + 删除按钮                  │
│  └─ 文件：横向卡片 + 类型图标 + 文件名 + 删除按钮                │
├──────────────────────────────────────────────────────────────┤
│ 多行文本输入区                                                  │
│  - 支持 Enter/Shift/Ctrl/Alt 发送快捷键                         │
│  - 支持拖拽文件高亮                                             │
│  - 支持粘贴图片                                                 │
├──────────────────────────────────────────────────────────────┤
│ 底部工具栏                                                     │
│  cwd tag ×  │ 附件 │ + 菜单 │ skill badges × │ 全部清除 │ 发送⌄ │
└──────────────────────────────────────────────────────────────┘
```

`+` 菜单结构：

```text
+ 菜单
├─ 技能
│  ├─ 自定义技能：用户安装的 SKILLs
│  ├─ 内置技能：docx / pdf / web-search 等
│  └─ 管理技能：跳转 SkillsPage
├─ 连接器
│  ├─ MCP servers enabled toggle
│  └─ 管理连接器：跳转 Settings/MCP
└─ 添加文件
```

本轮 skill 选择只保存在 ChatInputBox draft state，发送时附带 `skillIds[]`，发送后清空；MCP 连接器是全局 enabled 状态，不显示为本轮 badge。

### 7.2 Sidebar

Sidebar 是工作台索引，不是全局状态仓库。它展示：

- 用户主动发起的 Cowork session。
- 定时任务及最近运行。
- IM 实例和频道入口。
- 设置入口。

Sidebar 必须订阅或响应会话、scheduler、IM 的刷新事件。只在 mount 时加载一次不满足桌面长期驻留场景。

### 7.3 Settings

Settings 是独占管理台。内部 tab 由 `SettingsPage` 管理，深层卡片只能请求目标 tab，例如通过根层 props 或 `app:navigate-settings` 事件，不得直接写全局 view。

设置页保存失败必须在当前表单附近展示错误。模型 API Key、Provider、MCP、IM 凭据等敏感配置不得静默失败。

### 7.4 Skills

Skills 页面负责启用、禁用、安装或管理 Skill。Chat 的本轮 Skill 选择只引用 enabled skills，不负责修改全局 Skill 状态。目录级 Skill 白名单属于 Directory 设置，不属于 Chat 本轮选择。

### 7.5 Cron

Cron 页面负责定时任务 CRUD、运行历史、手动运行。前端必须明确区分：

- 任务配置：name、schedule、payload、绑定目录、IM 推送目标。
- 运行记录：status、startedAt、duration、error、sessionId。
- 当前运行中：可跳转到对应 Cowork session 或显示无法跳转原因。

删除任务和手动运行属于有副作用操作，必须有 loading/error 状态。删除任务应有确认。

### 7.6 IM

IM 前端必须围绕 `im_instances` 建模。平台只是筛选和创建入口，实例才是 CRUD 主体。

规则：

- `listInstances()` 返回实例列表，renderer 以实例 id 更新、删除、启用。
- 平台卡片若展示聚合状态，必须由实例列表聚合得出。
- 配置弹窗若从平台打开，应先选择已有实例或创建新实例，不能把平台 key 当实例 id。
- 微信单实例、钉钉/飞书/企微多实例等约束应由主进程兜底，UI 同步提示。
- IM 凭据字段必须明确哪些写入 credentials，哪些写入 config。

### 7.7 TaskMonitorPanel

TaskMonitorPanel 只能展示已接入的真实状态。未接入工具、产物、Todo 或 MCP 活动时，应隐藏面板或展示“当前会话暂无可监控数据”。禁止把骨架区长期作为默认生产界面。

### 7.8 Onboarding / Boot

首次引导和 BootCheck 都属于启动恢复链路。它们必须回答三个问题：

- 当前缺什么：runtime、模型、目录、权限、网络还是配置。
- 用户能做什么：重试、去设置、选择目录、配置模型、查看日志。
- 当前是否可以继续：可以进入主界面、只读进入、还是必须阻断。

## 8. 桌面 App 边界

### 8.1 窗口生命周期

Main Window 和 Pet Window 必须支持：

- Main Window 关闭即隐藏，退出走 tray 或 app quit。
- Pet Window 可隐藏和恢复，不影响 Main Window 会话状态。
- 窗口位置和大小持久化，恢复时必须落在可见屏幕区域。
- 失焦、最小化、隐藏后，流式事件和权限请求仍要进入状态队列。
- Main Window 从隐藏恢复时，应展示最新会话、任务和权限状态。

### 8.2 托盘和快捷键

托盘和全局快捷键触发的是窗口行为或明确 view 行为。主进程发送的 `panel:open` 值必须被 renderer 识别。若 tray 菜单项没有真实目标，应隐藏或禁用。

### 8.3 Runtime 和 Gateway 状态

前端必须区分：

- runtime 未安装或缺失。
- runtime 正在启动。
- gateway 已连接。
- gateway 断开但可重试。
- gateway 重启排队中。
- 当前有活跃任务，重启被延迟。

这些状态需要 snapshot API 和 push 事件共同支撑。只订阅事件不足以覆盖页面后打开、窗口恢复和 renderer reload。

### 8.4 跨平台差异

- macOS 使用 hiddenInset 和 traffic lights，左上区域需要保留拖拽/点击安全区。
- Windows/Linux 没有原生 traffic lights 时，需要自定义窗口控制或明确系统 frame 策略。
- 全局快捷键可能注册失败，失败必须记录日志并在设置或状态页可见。
- 托盘图标和菜单文本需要平台适配，不能只依赖 macOS title emoji。
- 文件路径展示必须兼容 `/` 和 `\`，路径截断要保留头尾识别信息。

## 9. UI/UX 规范

- 优先复用 `index.css` token 和现有 `ui-*` / `topbar-*` / `workspace-*` 样式。
- 用户可见文案全部走 `useI18n()`，翻译资源在 `petclaw-shared/src/i18n/locales/{zh,en}.ts`。
- 图标按钮使用 lucide 图标，并提供 `aria-label` / `title`。
- 交互控件统一使用 `duration-[120ms]` 和必要的 `active:scale-[0.96]`。
- 复杂管理页保持信息密度，不使用大幅营销 hero、装饰性渐变和无信息卡片。
- 空状态要说明当前真实状态，不承诺未接入的功能。
- 禁用态必须说明原因；若空间不足，使用 tooltip 或邻近状态文案。
- 长文本、路径、命令、JSON、错误堆栈必须可滚动、可复制、不中断布局。
- 小窗宽度下侧栏、右侧监控面板和设置导航必须可折叠或降级。
- Pet Window 可使用独立 `pet.css`，但颜色、圆角、字体等偏离主 token 时必须是有意的表现层例外。

## 10. 错误态和离线态

前端所有核心操作必须至少覆盖以下状态：

| 状态 | UI 要求 |
|---|---|
| loading | 按钮禁用或显示 spinner，避免重复提交 |
| empty | 说明真实空状态和下一步动作 |
| error | 展示可理解错误，保留重试入口 |
| disabled | 说明禁用原因，不伪装成可点击 |
| offline/runtime down | 阻止发送新任务，允许查看历史和进入设置 |
| permission waiting | 明确当前任务被哪个审批阻塞 |
| long running | 展示任务仍在运行，可停止或切换到后台 |

禁止把错误只写 `console.warn/error` 后静默吞掉。console 日志用于诊断，不是用户反馈。

## 11. i18n 与文案

- 所有用户可见 UI 文案、状态消息、错误提示、aria-label、title、placeholder 都必须走 `useI18n()`。
- 主进程用户可见文本用主进程 `t()`；renderer 用户可见文本用 `useI18n()`。
- 日期、相对时间、持续时间、估时文案要基于当前语言格式化。
- AI system prompt、AGENTS 模板、开发日志、代码注释不纳入 i18n。
- 品牌名、Provider 名、平台官方字段名可以保留原文，但周围解释文案仍需 i18n。

## 12. 测试矩阵

前端相关改动至少运行：

```bash
pnpm --filter petclaw-desktop typecheck
pnpm --filter petclaw-desktop exec eslint src --max-warnings 0
```

涉及 store、IPC 或会话状态时增加针对性测试：

```bash
pnpm --filter petclaw-desktop test -- tests/renderer/stores/chat-store.test.ts
pnpm --filter petclaw-desktop test -- tests/renderer/stores/permission-store.test.ts
```

建议测试矩阵：

| 改动范围 | 必测内容 |
|---|---|
| `useChatStore` | draft 迁移、后台 session 更新、切换历史覆盖、错误落桶 |
| 权限队列 | FIFO、requestId 去重、sessionId 清理、AskUser 多问题 |
| Chat 输入框 | cwd 受控、附件分类、无 path 文件、IME Enter、禁用态 |
| Sidebar | 新建会话刷新、运行状态刷新、Cron/IM 分组 |
| IM | 实例 CRUD、平台聚合、启用状态、凭据保存错误 |
| Cron | 创建、编辑、删除确认、手动运行、运行历史跳转 |
| Preload/IPC | main/preload/d.ts/renderer 四处契约一致 |
| Pet Window | 状态机转移、暂停、气泡、窗口切换 |

`petclaw-desktop lint` 必须排除 `vendor/`、`node_modules/`、`dist/`、`out/`、`release/` 等生成或第三方目录，避免 ESLint 扫描大体积 vendor 导致 OOM。

沙箱环境可能禁止监听本地端口或 Unix socket，表现为 `listen EPERM` 或端口测试超时。遇到这种情况应说明环境限制，并在允许监听的环境重跑，不得误判为业务失败。
