# PetClaw 前端架构设计

本文档是 PetClaw 渲染进程、Preload API 和桌面 UI/UX 的架构事实源。后端、主进程、Openclaw runtime 和数据模型仍以 `PetClaw总体架构设计.md` 为准。

## 1. 架构边界

PetClaw 前端由两个渲染窗口组成：

```text
Main Window
├── App.tsx                       主工作台路由和全局弹窗宿主
├── Sidebar                       目录、会话、频道入口
├── ChatView                      Cowork 会话 UI
├── SettingsPage                  配置管理台
├── SkillsPage / CronPage / IM    工作台功能页
└── TaskMonitorPanel              当前会话的右侧监控面板

Pet Window
└── pet/                          桌面宠物表现层和事件状态机
```

渲染进程不能直接访问 Node/Electron 能力，所有系统能力必须通过 `preload/index.ts` 暴露的 `window.api` 进入主进程。新增能力必须同时维护：

- `src/main/ipc/*.ts`：通过 `safeHandle` / `safeOn` 注册 channel。
- `src/preload/index.ts`：暴露受控 API。
- `src/preload/index.d.ts`：同步类型声明。
- 渲染端调用点：只消费 preload API，不直接导入主进程模块。

## 2. 状态模型

前端状态分三类：

| 类型 | 归属 | 规则 |
|---|---|---|
| App 路由状态 | `App.tsx` | `activeView`、`settingsTab`、当前目录、当前会话 ID 在根层维护 |
| 会话 UI 状态 | `useChatStore` | 消息、loading 必须按 `sessionId` 分桶，禁止全局单数组承载多会话消息 |
| 全局权限请求 | `usePermissionStore` | Exec Approval 和 AskUserQuestion 共用 FIFO 队列，由 `App.tsx` 根层渲染 |

Zustand actions 只更新内存状态，不发 IPC、不做异步副作用。IPC 读取、事件订阅、错误展示放在组件 `useEffect`、事件处理函数或专门服务层。

Cowork 会话消息必须遵守以下规则：

- 新建会话返回 `sessionId` 前，用户首条消息进入 draft bucket。
- 主进程返回 `sessionId` 后，draft bucket 迁移到真实 session bucket。
- 后续 `cowork:*` 流式事件必须使用事件携带的 `sessionId` 更新对应 bucket。
- 切换会话时先切 `activeSessionId`，再从主进程加载历史消息覆盖该会话 bucket。
- 后台会话流式更新不得污染当前正在查看的会话。

## 3. 页面与交互

Main Window 是工作台，不做营销式首页。每个可见控件必须满足以下条件之一：

- 已接入真实行为。
- 明确 disabled，并有可理解的状态或文案。
- 是只读信息展示，不伪装成可点击命令。

禁止保留空 `onClick={() => {}}`、纯占位页、未连接数据的“即将推出”主入口。阶段性未完成的能力应降级为 disabled 控件或从主路径隐藏。

桌面 App 边界：

- 小窗宽度下侧栏、右侧监控面板和设置导航必须可折叠或降级。
- 顶栏按钮只承载当前 view 的高频操作，跨页跳转使用 `app:navigate` / `app:navigate-settings` 自定义事件或根层 props。
- 设置页是独占管理台，内部 tab 由 `SettingsPage` 管理，深层卡片只发目标 tab，不直接改全局 view。
- Pet Window 只消费统一宠物事件，不理解 Chat、IM、Cron 内部业务状态。

## 4. UI/UX 规范

- 优先复用 `index.css` token 和现有 `ui-*` / `topbar-*` / `workspace-*` 样式。
- 用户可见文案全部走 `useI18n()`，翻译资源在 `petclaw-shared/src/i18n/locales/{zh,en}.ts`。
- 图标按钮使用 lucide 图标，并提供 `aria-label` / `title`。
- 交互控件统一使用 `duration-[120ms]` 和必要的 `active:scale-[0.96]`。
- 复杂管理页保持信息密度，不使用大幅营销 hero、装饰性渐变和无信息卡片。
- 空状态要说明当前真实状态，不承诺未接入的功能。

## 5. 验证要求

前端相关改动至少运行：

```bash
pnpm --filter petclaw-desktop typecheck
pnpm --filter petclaw-desktop exec eslint src --max-warnings 0
```

涉及 store、IPC 或会话状态时增加针对性测试，例如：

```bash
pnpm --filter petclaw-desktop test -- tests/renderer/stores/chat-store.test.ts
```

`petclaw-desktop lint` 必须排除 `vendor/`、`node_modules/`、`dist/`、`out/`、`release/` 等生成或第三方目录，避免 ESLint 扫描大体积 vendor 导致 OOM。
