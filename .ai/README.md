# PetClaw — AI 开发指南

> 本文件是所有 AI 编码助手（Claude Code、Cursor、Copilot、Windsurf 等）的统一参考。
> 工具专属配置文件（AGENTS.md、CLAUDE.md、.cursorrules 等）引用本文件，避免重复维护。

---

## 1. 产品定位

AI 桌面宠物助手。黑猫驻留桌面，基于 Openclaw agent 运行时，连接 AI 工具链，陪伴用户工作。

### 核心架构
```
Electron (UI 壳)  ←GatewayClient→  Openclaw Runtime (utilityProcess)  ←API→  LLM
     ↓                                      ↓
  双窗口渲染                          workspace/（人格、记忆、技能）
```

- **Electron**：负责窗口、动画、系统集成（托盘、快捷键、hooks）
- **Openclaw Runtime**：捆绑在 app 内，通过 `utilityProcess.fork()` 启动，动态端口 + token 认证
- 通信：Electron 主进程动态加载 `GatewayClient`（ESM），与 Runtime 通信
- **架构详情**：见 `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md`

## 2. Monorepo 结构

```
petclaw/                           # pnpm monorepo 根目录
├── petclaw-desktop/               # Electron 桌面应用（当前焦点）
├── petclaw-web/                   # Next.js 营销官网（Phase 3，未启动）
├── petclaw-api/                   # 后端服务（Phase 3，未启动）
├── petclaw-shared/                # 共享 TypeScript 类型（未启动）
├── .ai/                           # AI 编码助手统一指南（本目录）
├── docs/                          # 设计文档 / 规格 / 计划
│   └── superpowers/
│       ├── specs/                 # 设计规格（v3 架构蓝图在此）
│       └── plans/                 # 实现计划
├── 设计/                           # 参考素材（视频、截图，不入 git）
├── package.json                   # Root：husky + commitlint + lint-staged
├── pnpm-workspace.yaml            # Monorepo workspace 声明
├── commitlint.config.mjs          # Commit message 格式校验
├── .editorconfig                  # 编辑器统一配置
├── .husky/                        # Git hooks（pre-commit + commit-msg）
├── AGENTS.md                      # Codex 入口（引用 .ai/）
├── CLAUDE.md                      # Claude Code 入口（引用 .ai/）
└── .cursorrules                   # Cursor 入口（引用 .ai/）
```

## 3. 技术栈

| 层       | 技术                   | 版本     |
| -------- | ---------------------- | -------- |
| 框架     | Electron               | 33       |
| 前端     | React + TypeScript     | 19 / 5.7 |
| 样式     | Tailwind CSS           | v4       |
| 状态管理 | Zustand                | 5        |
| 构建     | electron-vite + Vite   | 3 / 6    |
| 数据库   | better-sqlite3         | 11       |
| 图标     | lucide-react           | 1.8      |
| 动画     | WebM 视频（VP8+alpha） | —        |
| AI 运行时 | Openclaw              | —        |
| 包管理   | pnpm workspace         | 9        |

## 4. 常用命令

```bash
# 从 monorepo 根目录执行
pnpm --filter petclaw-desktop dev          # 启动开发服务器 + Electron
pnpm --filter petclaw-desktop dev:openclaw # 确保 Openclaw runtime + 启动开发
pnpm --filter petclaw-desktop test         # 运行单元测试（Vitest）
pnpm --filter petclaw-desktop test:watch   # 测试监听模式
pnpm --filter petclaw-desktop lint         # ESLint 检查
pnpm --filter petclaw-desktop lint:fix     # ESLint 自动修复
pnpm --filter petclaw-desktop typecheck    # TypeScript 类型检查（node + web）
pnpm --filter petclaw-desktop build        # 生产构建（仅编译）

# Openclaw Runtime 构建（首次或版本变更时）
pnpm --filter petclaw-desktop openclaw:ensure       # checkout 到锁定版本
pnpm --filter petclaw-desktop openclaw:runtime:host  # 检测当前平台并构建
pnpm --filter petclaw-desktop openclaw:plugins       # 下载安装 IM 插件
pnpm --filter petclaw-desktop openclaw:extensions:local  # 同步本地扩展

# 打包
pnpm --filter petclaw-desktop dist:mac:arm64   # macOS Apple Silicon
pnpm --filter petclaw-desktop dist:mac:x64     # macOS Intel
pnpm --filter petclaw-desktop dist:win         # Windows NSIS 安装包
pnpm --filter petclaw-desktop dist:linux       # Linux AppImage

# 也可以 cd petclaw-desktop 后直接 pnpm dev
```

## 5. 本地调试

1. `pnpm install` — 安装依赖（自动 `electron-rebuild` better-sqlite3）
2. `pnpm --filter petclaw-desktop dev` — 启动 HMR 开发模式
3. **主进程**改动需重启，**渲染进程**改动热更新
4. DevTools：在主进程代码中临时加 `win.webContents.openDevTools({ mode: 'detach' })`，**调试完务必删除**
5. 多进程残留：端口冲突时用 `pkill -9 -f electron` 清理

## 6. 构建 & 打包

```bash
pnpm --filter petclaw-desktop dist:mac:arm64   # → release/PetClaw-x.y.z-arm64.dmg
pnpm --filter petclaw-desktop dist:win         # → release/PetClaw-x.y.z-Setup.exe
```

- 打包配置：`petclaw-desktop/electron-builder.json`（独立文件，优先于 package.json build 字段）
- macOS：`.dmg`，`hardenedRuntime: true` + 签名公证
- Windows：NSIS 安装包，Openclaw runtime 打 tar 加速安装
- App ID：`ai.petclaw.desktop`
- 详细打包设计见 v3 spec §24.7

## 7. CI/CD（GitHub Actions）

文件：`.github/workflows/ci.yml` + `build-platforms.yml` + `openclaw-check.yml`

| Workflow | 触发 | 内容 |
|----------|------|------|
| `ci.yml` | push main/develop, PR | lint + typecheck + test + build |
| `build-platforms.yml` | push tag `v*` | 三平台并行构建 + 创建 Release |
| `openclaw-check.yml` | 每周一 08:23 UTC | 检查 Openclaw 新版本 |

**Build 矩阵**：

| Runner | Platform | 产物 |
|--------|----------|------|
| macos-latest | darwin-arm64 | .dmg |
| macos-13 | darwin-x64 | .dmg |
| windows-latest | win-x64 | .exe (NSIS) |
| ubuntu-latest | linux-x64 | .AppImage |

流程：lint/test 通过 → 四平台并行构建 Openclaw Runtime（13 步流水线）→ `electron-vite build` → `electron-builder` 打包 → 上传 artifact → 创建 Release。

## 8. Git 规范

### Commit
Conventional Commits：`type(scope): subject`

- scope：`desktop`、`web`、`api`、`shared`、`ci`
- type：`feat`、`fix`、`refactor`、`chore`、`docs`、`test`
- 示例：`feat(desktop): add sleep animation for idle state`

### 分支
- `main` — 稳定版，保护分支
- `develop` — 开发分支
- `feature/*` — 功能分支，PR 合入 develop

## 9. 编码规范

> 所有代码必须遵守本节规范。Prettier + ESLint + lint-staged 自动执行格式化和 lint。

### 9.1 基本原则

- **不造轮子**：优先使用已有工具链（Zustand、lucide-react、Tailwind token），不引入同类库
- **最小改动**：只改需求相关代码，不做"顺手优化"、不加多余的 JSDoc / 注释 / 类型注解 / 错误处理
- **Token 驱动**：所有颜色、圆角、阴影必须使用 `chat.css` 中定义的 CSS token，禁止硬编码 hex 值
- **中文注释，英文代码**：注释和 UI 文案用中文，变量名、函数名、commit message 用英文
- **文档同步**：每次开发完功能后，必须将实现内容同步到 `.ai/README.md` 和 `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md` 对应章节

### 9.2 文件命名

| 位置 | 规则 | 示例 |
|---|---|---|
| `src/main/**` | `kebab-case.ts` | `app-settings.ts`, `database-path.ts` |
| `src/renderer/**/组件` | `PascalCase.tsx` | `ChatView.tsx`, `BootCheckPanel.tsx` |
| `src/renderer/**/非组件` | `kebab-case.ts` | `state-machine.ts`, `chat-store.ts` |
| `stores/` | `kebab-case-store.ts` | `chat-store.ts`, `hook-store.ts` |
| `panels/` | `PascalCase + Panel.tsx` | `BootCheckPanel.tsx` |
| `tests/` | 镜像 `src/` 结构，后缀 `.test.ts` | `chat-store.test.ts` |

### 9.3 组件规范（React）

```tsx
// ✅ 正确：函数声明，不标注返回类型（TS 自动推断）
export function ChatView() {
  return <div>...</div>
}

// ❌ 错误：箭头函数导出、标注 JSX.Element
export const ChatView = (): JSX.Element => { ... }
```

- **函数声明**：`export function ComponentName()` — 不用箭头函数导出组件
- **不标注返回类型**：React 19 移除了全局 `JSX` namespace，让 TS 自动推断
- **Props 内联**：简单 props 用 `{ prop }: { prop: Type }` 内联，3+ 个 props 才抽 interface
- **不用 forwardRef**：React 19 支持 ref 作为普通 prop
- **Hooks 顺序**：`useState` → `useRef` → `useEffect` → `useCallback` → `useMemo`

### 9.4 状态管理（Zustand）

```tsx
// ✅ 标准模式
interface ChatState {
  // 数据
  messages: Message[]
  isLoading: boolean
  // Actions
  addMessage: (msg: Message) => void
  setLoading: (v: boolean) => void
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  isLoading: false,
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setLoading: (v) => set({ isLoading: v })
}))
```

- **命名**：`use` + `PascalCase` + `Store`（如 `useChatStore`）
- **纯 set 驱动**：Actions 只做 `set()`，副作用（IPC、API）放组件 `useEffect` 中
- **类型同文件导出**：相关 interface / type / enum / const 与 store 放同一文件
- **不用 Redux / Context**：全局状态统一用 Zustand

### 9.5 CSS / Tailwind v4

```tsx
// ✅ 使用 token
<div className="bg-bg-root text-text-primary border-border rounded-[10px]">

// ❌ 硬编码颜色
<div className="bg-[#f5f5f5] text-[#18181b] border-[#e8e8ec] rounded-xl">
```

- **Token 优先**：在 `className` 中直接用 token 类名（如 `bg-bg-root`、`text-text-primary`、`border-border`）
- **内联 style 中**：用 `var(--color-*)` 引用 token（如 `color: 'var(--color-text-primary)'`）
- **禁止硬编码**：不使用 `bg-[#hexhex]` 写法，除非是不在 token 体系内的一次性装饰色
- **圆角只用两档**：`rounded-[10px]`（按钮/输入框/卡片）和 `rounded-[14px]`（气泡/模态框）
- **交互统一**：`active:scale-[0.96]` + `transition-all duration-[120ms]`
- **不抽 CSS 类**：样式写在 className 内，不单独创建 `.btn-primary` 等自定义类
- **Token 定义**：`chat.css` 的 `@theme` 块是唯一 token 来源，新增 token 在此添加

### 9.6 TypeScript

- **`strict: true`**：两个 tsconfig 均严格模式
- **不用 `any`**：用 `unknown` + 类型收窄，`any` 只允许在第三方库类型缺失时加 `// eslint-disable`
- **不标注可推断类型**：`const x = 'hello'` 而非 `const x: string = 'hello'`
- **组件不标注返回类型**：不写 `: JSX.Element` 或 `: ReactNode`
- **接口用 interface，联合用 type**：`interface Props { ... }` / `type Status = 'idle' | 'loading'`
- **枚举用 const enum 或字面量联合**：小集合用 `type Status = 'a' | 'b'`，需要值映射用 `enum`

### 9.7 IPC 通信

```typescript
// Channel 命名：模块:动作
'chat:send'       // ✅
'sendChatMessage'  // ❌
```

- **三处同步**：新增 channel 必须同时更新 `ipc.ts` + `preload/index.ts` + `preload/index.d.ts`
- **单向**：`ipcRenderer.send()` → `ipcMain.on()`（如 UI 事件通知）
- **双向**：`ipcRenderer.invoke()` → `ipcMain.handle()`（如获取数据）
- **推送**：`win.webContents.send()`（如进度更新）
- **进程隔离红线**：renderer 禁止 `require('electron')`，`nodeIntegration: false` + `contextIsolation: true` 永不改

### 9.8 导入顺序

```tsx
// 1. React / 框架
import { useState, useEffect } from 'react'
// 2. 第三方库
import { Send, PawPrint } from 'lucide-react'
// 3. 内部模块（store、utils、types）
import { useChatStore } from '../../stores/chat-store'
// 4. 资源文件
import catStaticSrc from '../assets/cat/static.webm'
```

各组之间空一行。同组内按字母序排列。

### 9.9 测试

> TDD 优先：新功能先写测试再实现，bug 修复先写复现测试再改代码。

#### 测试分层

| 层级 | 工具 | 位置 | 覆盖范围 | 运行频率 |
|------|------|------|----------|----------|
| **单元测试** | Vitest + jsdom | `tests/main/**`、`tests/renderer/**` | 纯逻辑：store、state-machine、utils、数据层 | 每次 commit（CI + husky） |
| **集成测试** | Vitest + ws | `tests/main/**` | IPC handler、WebSocket 通信、数据库读写 | 每次 commit |
| **组件测试** | Vitest + @testing-library/react（TODO） | `tests/renderer/**` | 关键交互组件的渲染和用户事件 | 每次 commit |
| **E2E 测试** | Playwright + Electron（TODO） | `tests/e2e/**` | 完整用户流程：启动→聊天→状态切换 | PR 合入前 |

#### TDD 工作流

```
1. 写失败的测试 → pnpm test:watch 红灯
2. 写最少实现代码 → 绿灯
3. 重构（仅在绿灯状态下） → 保持绿灯
4. 提交
```

- **新增功能**：先在 `tests/` 中写测试描述期望行为，再实现 `src/` 中的代码
- **修复 Bug**：先写一个能复现 bug 的测试（当前失败），修复后测试通过
- **重构**：确保现有测试全部通过，再动代码结构

#### 必须测试的模块

| 模块 | 测试重点 | 不 mock |
|------|----------|---------|
| `state-machine.ts` | 所有状态转换、无效事件忽略、回调触发 | — |
| `chat-store.ts` | 消息增删、加载历史、loading 状态 | — |
| `openclaw.ts` | 连接、断连、流式 chat、错误处理 | WebSocket（用真实 ws mock server） |
| `hooks/server.ts` | Socket 生命周期、事件接收、多客户端 | Unix socket |
| `hooks/installer.ts` | 安装幂等性、保留已有配置 | 文件系统（用 tmp 目录） |
| `data/db.ts` | 建表、消息存取、限制条数 | SQLite（用 `:memory:`） |
| `app-settings.ts` | 读写设置、合并 onboarding 数据 | 文件系统（用 tmp 目录） |
| `bootcheck.ts` | 正常启动 3 步 / 升级 5 步流程（TODO） | — |

#### Openclaw 升级回归策略

升级 Openclaw 运行时版本时，必须通过以下回归检查：

```bash
# 1. 全量单元测试
pnpm --filter petclaw-desktop test

# 2. 重点回归：WebSocket 通信
pnpm --filter petclaw-desktop test -- tests/main/ai/openclaw.test.ts

# 3. 重点回归：Hook 事件接收
pnpm --filter petclaw-desktop test -- tests/main/hooks/server.test.ts

# 4. 手动验证清单（E2E 自动化前）
# □ BootCheck 5 步升级流程完成
# □ Gateway 连接成功（StatusBar 显示绿色）
# □ 发送消息 → AI 流式响应 → 猫咪状态 Thinking→Working→Happy
# □ Hook 事件能触发猫咪 Working 状态
# □ 历史消息正常加载
```

#### 测试规范

- **框架**：Vitest，`globals: false`（显式 import `describe/it/expect`）
- **环境**：`tests/renderer/**` 用 jsdom，`tests/main/**` 用 node
- **Electron mock**：`tests/__mocks__/electron.ts` 统一 mock，vitest alias 自动替换
- **不 mock 数据库**：集成测试用 `:memory:` SQLite
- **不 mock WebSocket**：用 `ws` 库创建真实 mock server
- **文件操作**：用 `os.tmpdir()` + 随机目录，测试后清理
- **命名**：`describe('模块名')` → `it('should 行为描述')`，英文
- **覆盖率**：`pnpm test:coverage`（TODO：设置 CI 阈值 ≥70%）

### 9.10 格式化

由工具链自动处理，不需手动关注：
- **Prettier**：无分号、单引号、100 字符行宽、2 空格、LF 换行、无尾逗号
- **ESLint**：`@typescript-eslint` recommended + `react-hooks` + `react-refresh`
- **Husky + lint-staged**：commit 时自动格式化和 lint
- **commitlint**：`type(scope): subject`（type: feat/fix/refactor/chore/docs/test，scope: desktop/web/api/shared/ci）

### 9.11 禁止魔法值散落

- **配置默认值集中定义**：端口、URL、模型名等配置默认值必须集中定义在对应的配置模块中（如 `app-settings.ts` 的 `DEFAULT_GATEWAY_PORT`、`DEFAULT_GATEWAY_URL`、`createDefaultSettings()`），禁止在各文件中硬编码
- **Settings 单一维护点**：`PetclawSettings` 接口的类型定义、默认值工厂（`createDefaultSettings`）、合并逻辑（`mergeDefaults`）统一在 `app-settings.ts` 维护
- **新增配置字段只改一处**：新增配置字段只需修改 `app-settings.ts`，bootcheck 和其他消费方自动继承
- **parseSettingValue 布尔解析**：`autoLaunch`、`soundEnabled`、`notificationsEnabled` 等布尔字段通过 `parseSettingValue` 统一解析

---

## 10. petclaw-desktop 架构详解

> **完整架构设计**见 `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md`。
> 本节保留对日常编码直接有用的规范和约定，避免重复。

### 10.1 双窗口架构

```
Pet Window (180×145, 透明, alwaysOnTop)     Chat Window (动态尺寸, hiddenInset titleBar)
├── index.html → main.tsx → App.tsx          ├── chat.html → chat/main.tsx → ChatApp.tsx
├── PetCanvas.tsx  视频播放+拖拽              ├── Sidebar.tsx       深色侧边栏+会话列表
└── state-machine.ts 宠物状态机               ├── ChatView.tsx      聊天界面
                                              ├── MonitorView.tsx   Hook 事件监控
                                              ├── SettingsView.tsx  设置面板
                                              └── StatusBar.tsx     底部状态栏
```

#### 窗口尺寸规范

**规则**：所有窗口尺寸相关数值必须使用 `index.ts` 顶部定义的命名常量，禁止散落魔法数字。

**Chat Window（动态计算）**：

| 参数 | 公式 | 下限 | 上限 |
|------|------|------|------|
| 默认宽度 | `screenW × 0.55` | 800px | 1200px |
| 默认高度 | `screenH × 0.7` | 560px | 900px |
| 最小尺寸 | = 默认尺寸 | — | — |

**Pet Window（固定尺寸）**：180×145，与猫动画素材绑定。

**窗口交互行为**：
- 顶部拖拽防误触（`will-resize` 阻止 top-left/top-right 缩放）
- 生产环境禁用 DevTools（`webPreferences.devTools: is.dev`）
- 窗口位置/尺寸持久化到 SQLite kv 表

### 10.2 主进程模块化架构（v3）

```
Main Process
├── index.ts              入口+窗口创建+启动编排
├── bootcheck.ts          启动检查（调用各 Manager）
├── app-settings.ts       全局设置集中定义
├── ai/                   基础层
│   ├── engine-manager.ts   Runtime 生命周期（utilityProcess）
│   ├── gateway.ts          GatewayClient 动态加载
│   ├── session-manager.ts  会话 CRUD
│   ├── cowork-controller.ts  执行+审批+流式事件
│   └── config-sync.ts     openclaw.json 唯一写入者
├── agents/               核心层
├── skills/               功能层
├── models/               功能层
├── memory/               功能层
├── mcp/                  功能层
├── im/                   集成层
├── scheduler/            集成层
├── pet/                  宠物联动层
│   └── pet-event-bridge.ts  多源事件聚合 → Pet 窗口
├── ipc/                  模块化 IPC（chat-ipc、agent-ipc 等）
└── data/                 SQLite
```

详见 v3 spec §2-§18。

### 10.3 进程隔离规则（红线）

- `renderer/` **禁止** `require('electron')` 或任何 Node.js 模块
- `nodeIntegration: false` — 永不开启
- `contextIsolation: true` — 永不关闭
- `sandbox: false` 仅因 better-sqlite3，后续迁移后恢复

### 10.4 IPC 通信规范

- Channel 命名：`模块:动作`（如 `chat:send`、`window:move`）
- 渲染→主（单向）：`ipcRenderer.send()` → `ipcMain.on()`
- 渲染→主（双向）：`ipcRenderer.invoke()` → `ipcMain.handle()`
- 主→渲染（推送）：`win.webContents.send()`
- **v3 IPC 模块化**：按模块拆分到 `ipc/*.ts`（chat-ipc、agent-ipc、skill-ipc 等）
- **新增 IPC channel 必须同步更新三处**：`ipc/*.ts` + `preload/index.ts` + `preload/index.d.ts`
- 完整 Channel 列表见 v3 spec §18.2

### 10.5 宠物动画系统

视频资源（`assets/cat/*.webm`），VP8+alpha 透明背景：

| 文件              | 用途         | 循环 |
| ----------------- | ------------ | ---- |
| `begin.webm`      | 启动出场     | ×    |
| `static.webm`     | 站立待机     | ✓    |
| `listening.webm`  | 竖耳聆听     | ✓    |
| `task-start.webm` | 开始工作过渡 | ×    |
| `task-loop.webm`  | 工作中循环   | ✓    |
| `task-leave.webm` | 结束工作过渡 | ×    |
| `sleep-start.webm`| 入睡过渡     | ×    |
| `sleep-loop.webm` | 睡觉循环     | ✓    |
| `sleep-leave.webm`| 醒来过渡     | ×    |

状态机：`Idle → Thinking → Working → Happy`，任意状态可进入 `Dragging`，`Idle` 闲置 2 分钟自动进入 `Sleep`。

```
状态转换表：
Idle:      ChatSent→Thinking | DragStart→Dragging | HookActive→Working | SleepStart→Sleep
Thinking:  AIResponding→Working | DragStart→Dragging | Timeout→Idle
Working:   AIDone→Happy | HookIdle→Idle | DragStart→Dragging | Timeout→Idle
Happy:     Timeout→Idle | ChatSent→Thinking | DragStart→Dragging
Dragging:  DragEnd→Idle
Sleep:     WakeUp→Idle | ChatSent→Thinking | DragStart→Dragging | HookActive→Working
```

事件触发时机：
- `ChatSent`：用户发送消息 / IM 消息到达 / 定时任务触发
- `AIResponding`：AI 第一个 messageUpdate 到来
- `AIDone`：所有活跃会话完成后触发（多会话计数器归零）
- `SleepStart`：Idle 状态持续 2 分钟且无活跃会话
- 从 `Sleep` 唤醒到任意状态时，`PetCanvas` 自动在动画序列前插入 `sleep-leave.webm` 过渡
- **v3 多源联动**：PetEventBridge 聚合 CoworkController、ImGateway、SchedulerManager、HookServer 事件，详见 v3 spec §22.4

视频播放器（`PetCanvas.tsx`）：双缓冲 `<video>` 元素避免切换闪烁，`playSequence()` 支持过渡动画链。睡眠由状态机统一管理（`PetState.Sleep`），不在 PetCanvas 内部维护。

### 10.6 CSP 安全策略

`media-src 'self' data: blob:` 必须存在以允许本地 WebM 播放。

### 10.7 electron-vite 多入口

```typescript
renderer.build.rollupOptions.input = {
  index: 'src/renderer/index.html',   // Pet Window
  chat:  'src/renderer/chat.html'     // Chat Window
}
```

### 10.8 常见问题

| 现象 | 原因 & 解决 |
| ---- | ----------- |
| `Unsupported pixel format: -1` | Chromium VP8+alpha 解码警告，可忽略 |
| 视频被 CSP 阻止 | 检查 `media-src` 是否包含 `'self'` |
| 猫咪不可见 | 透明窗口 + 资源加载失败 = 完全透明，开 DevTools |
| 进程残留 / 端口冲突 | `pkill -9 -f electron && pkill -9 -f "node.*vite"` |
| better-sqlite3 编译失败 | `pnpm --filter petclaw-desktop postinstall` |

### 10.9 测试架构

```
tests/
├── __mocks__/
│   └── electron.ts          # Electron API 统一 mock（vitest alias 自动替换）
├── main/                    # 主进程测试（node 环境）
│   ├── ai/openclaw.test.ts  # WebSocket 客户端（真实 ws mock server）
│   ├── hooks/server.test.ts # Unix socket 生命周期
│   ├── hooks/installer.test.ts
│   ├── data/db.test.ts      # SQLite（:memory:）
│   ├── app-settings.test.ts
│   ├── database-path.test.ts
│   └── onboarding.test.ts
└── renderer/                # 渲染进程测试（jsdom 环境）
    ├── pet/state-machine.test.ts
    └── stores/
        ├── chat-store.test.ts
        └── onboarding-store.test.ts
```

- 配置：`vitest.config.ts`，`environmentMatchGlobs` 路由 jsdom/node
- CI：`.github/workflows/ci.yml` → `test` job 门控 build
- 详细测试规范见 §9.9

---

## 10.10 Phase 3 集成功能层模块

### CronJobService (`src/main/scheduler/`)

- `cron-job-service.ts` — Gateway RPC 代理，所有定时任务 CRUD 委托给 OpenClaw `cron.*` RPC
- `types.ts` — Schedule/ScheduledTask/TaskState/ScheduledTaskRun 类型定义
- 15s 轮询同步任务状态，检测变更后推送到 renderer

### ImGatewayManager (`src/main/im/`)

- `im-gateway-manager.ts` — IM 平台配置管理 + 会话路由映射
- `types.ts` — Platform(4个)/IMMessage/IMSettings/IMPlatformConfig 类型定义
- PetClaw 不直接处理 IM 消息，所有平台通过 OpenClaw 插件运行

### PetEventBridge 多源扩展 (`src/main/pet/`)

- 扩展接受 ImGateway/CronService/HookServer 多源事件
- `notifyImSessionCreated()` / `notifySchedulerTaskFired()` 新方法
- `sendBubble(text, source)` 携带 `source` 字段区分消息来源（chat/approval/im/scheduler/system）

### IPC 模块化扩展 (`src/main/ipc/`)

- `scheduler-ipc.ts` — 定时任务 IPC handlers（`scheduler:list`、`scheduler:create`、`scheduler:update`、`scheduler:delete`、`scheduler:run`）
- `im-ipc.ts` — IM 配置 IPC handlers（`im:get-settings`、`im:update-settings`、`im:test-connection`）

### UI 组件 (`src/renderer/src/chat/components/`)

- `CoworkPermissionModal.tsx` — 三种模式：标准工具审批 / 确认 / 多选
- `AgentConfigDialog.tsx` — 三 Tab（基础信息/技能/IM渠道），底部 4 按钮
- `AgentSkillSelector.tsx` — Agent 技能多选子组件
- `CronPage.tsx` — 两栏卡片网格 + 两 Tab（任务/执行记录）
- `CronEditDialog.tsx` — 频率+时间+星期选择器+Prompt
- `ImChannelsPage.tsx` — IM 频道主视图（ViewType `'im-channels'`）
- `ImConfigDialog.tsx` — 两栏配置弹窗（左平台列表+右配置面板）

## 10.11 Phase 4 工程化模块

### 自动更新 (`src/main/auto-updater.ts`)

- `electron-updater` + `electron-log`，通过 GitHub Releases 分发更新
- `autoDownload: false`（用户确认后手动下载）、`autoInstallOnAppQuit: true`
- 生产环境启动后延迟 10 秒静默检查更新
- IPC channels: `updater:check` / `updater:download` / `updater:install` / `updater:status`（6 种状态推送）

### 构建脚本 (`scripts/`)

- 13 个 CJS 构建脚本 + 1 个 shell 脚本，完整覆盖 Openclaw runtime 从源码到产物的流水线
- `electron-builder-hooks.cjs` — beforePack/afterPack 生命周期钩子
- `notarize.js` — macOS 公证（`@electron/notarize`）
- `nsis-installer.nsh` — Windows NSIS 自定义安装/卸载脚本

### CI/CD (`.github/workflows/`)

- `ci.yml` — lint + typecheck + test + build（push/PR 触发）
- `build-platforms.yml` — 三平台并行构建 + 创建 GitHub Release（tag 触发）
- `openclaw-check.yml` — 每周检查 Openclaw 新版本

---

## 11. Openclaw 集成架构

> 详细设计见 v3 spec §4（EngineManager）、§5（Gateway）、§6（ConfigSync）、§20（版本管理）。

### 11.1 概述

Openclaw 是 AI agent 运行时。v3 中 **捆绑在 app 内**，通过 `utilityProcess.fork()` 启动（非独立 Node.js 进程），动态端口 + token 认证。

```
petclaw-desktop/
├── vendor/openclaw-runtime/        # 构建产物（git 忽略）
│   ├── current/ → darwin-arm64/    # symlink 到当前平台
│   ├── darwin-arm64/               # 完整 runtime
│   └── ...
├── openclaw-extensions/            # 本地扩展（ask-user-question + mcp-bridge）
├── SKILLs/                         # 28 个内置技能（源码）
└── scripts/                        # 13 个构建脚本
```

### 11.2 Runtime 管理

- **版本锁定**：`package.json` → `openclaw.version` + `openclaw.plugins`
- **构建流水线**：ensure → build → sync-current → bundle → plugins → extensions → precompile → channel-deps → prune（13 步）
- **构建缓存**：`runtime-build-info.json`，版本未变则跳过
- **启动**：`OpenclawEngineManager.startGateway()` → `utilityProcess.fork()` → 健康检查 → 就绪

### 11.3 通信架构

```
Electron Main Process
├── ai/gateway.ts     动态加载 GatewayClient（ESM import）
│                     连接 http://127.0.0.1:{dynamicPort}
│                     认证：Bearer token
│
├── ai/cowork-controller.ts   监听 Gateway 事件
│   ├── message / messageUpdate  → 消息流
│   ├── complete / error         → 会话完成
│   └── permissionRequest        → Exec Approval 弹窗
│
Openclaw Runtime（utilityProcess）
├── Gateway 服务器（动态端口）
├── Agent Sessions
└── LLM Provider 对接
```

### 11.4 ConfigSync — 配置唯一写入者

`ConfigSync` 是唯一写入 `{userData}/openclaw/state/openclaw.json` 的模块，聚合所有 Manager 的配置：

- 模型配置（ModelRegistry → providers/models，API Key 不写入）
- Skills 路径（SkillManager → skills.load.extraDirs + skills.entries）
- MCP 服务器（McpManager → mcp-bridge 插件配置）
- Agent 工作区（AgentManager → agents.defaults.workspace）
- 本地扩展回调（ask-user-question + mcp-bridge 的 callbackUrl/secret）

**设置变更流程**：UI 修改 → SQLite kv 表 → ConfigSync.sync() → `openclaw.json` → Gateway 热加载

### 11.5 用户数据目录（{userData}）

> `{userData}` = `app.getPath('userData')`（macOS: `~/Library/Application Support/PetClaw/`）

```
{userData}/
├── petclaw.db               # SQLite 数据库
├── openclaw/                # OPENCLAW_HOME
│   └── state/               # OPENCLAW_STATE_DIR
│       ├── openclaw.json    # ConfigSync 生成（Runtime 消费）
│       ├── gateway-token    # 认证 token
│       ├── gateway-port.json
│       ├── bin/             # CLI shims（petclaw, openclaw, claw）
│       ├── workspace/       # 默认 workspace（main agent）
│       ├── agents/main/     # Agent 数据
│       └── logs/            # 引擎日志
├── SKILLs/                  # Skills 集中管理目录（从 Resources 同步）
├── cowork/bin/              # node/npm/npx shim
└── logs/                    # Electron 应用日志
```

### 11.6 当前集成状态（v1 → v3 迁移中）

**v1 已实现（待重构）**：
- ✅ WebSocket 客户端（`ai/openclaw.ts`）→ v3 替换为 GatewayClient
- ✅ Hook 事件接收（`hooks/server.ts`）→ v3 保留
- ✅ Workspace MD 同步（`syncWorkspaceMd()`）→ v3 由 ConfigSync 接管
- ✅ 宠物状态机 + 动画系统 → v3 保留，新增 PetEventBridge

**v3 待实现**：
- OpenclawEngineManager（utilityProcess 启动 Runtime）
- OpenclawGateway（GatewayClient 动态加载）
- ConfigSync（openclaw.json 唯一写入）
- AgentManager / SessionManager / CoworkController
- SkillManager / ModelRegistry / MemoryManager / McpManager
- ImGateway / SchedulerManager
- PetEventBridge（宠物多源联动）
- 透明区域点击穿透（alpha 检测）

---

## 12. 官方产品参考

官方 PetClaw app（`/Applications/PetClaw.app`）的实现可作为参考：

### 12.1 资源提取

```bash
# 提取 asar 包内容
npx asar extract "/Applications/PetClaw.app/Contents/Resources/app.asar" /tmp/petclaw-extracted
# 查看 dist 目录结构
ls /tmp/petclaw-extracted/dist/
```

### 12.2 官方三窗口

| HTML | JS Bundle | 用途 |
| ---- | --------- | ---- |
| `index.html` | `pet-*.js` + `voice-*.js` | Pet Window（动画+语音） |
| `chat.html` | `chat-*.js` + `voice-*.js` + `toolAction-*.js` | Chat Window |
| `pet-bubble.html` | `petBubble-*.js` + `toolAction-*.js` | 工具动作气泡 |

### 12.3 官方资源文件

- 9 个 WebM 动画（VP8+alpha）— 已提取到 `assets/cat/`
- 2 个音效：`wake.MP3`（唤醒）、`down.MP3`（关闭）
- Logo SVG：`logo-dark.svg`、`logo-light.svg`、`logo-text-dark.svg`、`logo-text-light.svg`

### 12.4 官方生成的配置

在目录/Users/xiaoxuxuy/Desktop/.petclaw

---

## 13. UI/UX 设计规范

> 所有 Chat Window UI 开发必须遵守本节规范。设计基调：**冷灰极简**（zinc 色系），克制、专业、不花哨。

### 13.1 配色系统（亮色 / 暗色）

```css
/* ── 亮色主题（默认） ── */
--bg-root: #f8f8fa;           /* 页面根背景 */
--bg-sidebar: #f1f1f4;        /* 侧边栏背景 */
--bg-card: #ffffff;            /* 卡片/模态框 */
--bg-input: #f6f6f8;           /* 输入框背景 */
--bg-hover: rgba(0,0,0,0.025); /* 悬停态 */
--bg-active: rgba(0,0,0,0.05); /* 激活态 */
--bg-bubble-ai: #ffffff;       /* AI 消息气泡 */
--bg-bubble-user: #18181b;     /* 用户消息气泡 */

--text-primary: #18181b;       /* 标题/重要文字 */
--text-secondary: #52525b;     /* 正文 */
--text-tertiary: #a1a1aa;      /* 辅助/占位符 */
--text-bubble-ai: #27272a;     /* AI 气泡文字 */
--text-bubble-user: #ffffff;   /* 用户气泡文字 */

--accent: #18181b;             /* 强调色（按钮、链接） */
--accent-hover: #27272a;       /* 强调色悬停 */

--border: #e8e8ec;             /* 分割线/边框 */
--border-input: #e4e4e7;       /* 输入框边框 */

--success: #16a34a;
--error: #dc2626;
--warning: #d97706;

--shadow-card: 0 1px 2px rgba(0,0,0,0.04), 0 1px 4px rgba(0,0,0,0.02);
--shadow-dropdown: 0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04);

/* ── 暗色主题 [data-theme="dark"] ── */
--bg-root: #09090b;
--bg-sidebar: #0f0f12;
--bg-card: #18181b;
--bg-input: #1e1e22;
--bg-hover: rgba(255,255,255,0.04);
--bg-active: rgba(255,255,255,0.07);
--bg-bubble-ai: #1e1e22;
--bg-bubble-user: #fafafa;

--text-primary: #fafafa;
--text-secondary: #a1a1aa;
--text-tertiary: #52525b;
--text-bubble-ai: #e4e4e7;
--text-bubble-user: #09090b;

--accent: #fafafa;
--accent-hover: #e4e4e7;

--border: #27272a;
--border-input: #2e2e33;
```

### 13.2 字体

```css
--font-sans: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", system-ui, sans-serif;
--font-mono: "SF Mono", "Fira Code", "Cascadia Code", Menlo, monospace;
```

- 基础字号：14px
- 消息文字：13.5px / line-height 1.65
- 辅助文字：12px
- 标题：17px / font-weight 600 / letter-spacing -0.025em

### 13.3 圆角 & 间距

```css
--radius: 10px;       /* 默认圆角（按钮、输入框、卡片） */
--radius-lg: 14px;    /* 大圆角（气泡、模态框） */
```

间距基于 **4px 网格**：4, 8, 12, 16, 20, 24, 32, 48

### 13.4 组件规范

**消息气泡**：
- AI：白底（`--bg-bubble-ai`），左侧猫头像（24px 圆形），`shadow-card`
- 用户：深色底（`--bg-bubble-user`），右对齐，无头像
- 最大宽度：75%
- 圆角：14px，发送方角缩小到 6px

**侧边栏**：
- 宽度：220px
- 背景：`--bg-sidebar`
- 导航项：13px，激活态加 `--bg-active` + font-weight 500
- 顶部：logo + 用户名 + macOS 红绿灯拖拽区（52px 高）
- 底部：应用版本信息

**输入框**：
- 背景：`--bg-input`
- 边框：`--border-input`，聚焦时 `--accent`
- 圆角：`--radius-lg`（14px）
- 发送按钮：深色圆形（`--accent`），28px

**按钮**：
- 主按钮：`--accent` 背景，白色文字
- 幽灵按钮：透明背景，悬停 `--bg-hover`
- 圆角：`--radius`（10px）
- 过渡：150ms ease

**卡片**：
- 背景：`--bg-card`
- 阴影：`--shadow-card`
- 圆角：`--radius`（10px）

### 13.5 动效

#### 微交互（单元素状态变化）
```css
--transition-fast: 120ms ease;      /* 按钮悬停、图标旋转 */
--transition-default: 180ms ease;   /* 面板切换、颜色变化 */
--transition-slow: 300ms ease-out;  /* 模态框、侧边栏展开 */
```

#### 编排过渡（多元素协调动画）
```css
--transition-choreography: 400–500ms ease-out;  /* 状态机切换、crossfade 编排 */
--transition-sequence-gap: 300–400ms;           /* 编排中元素间的错开延迟 */
```

适用场景：BootCheck 成功动画（进度环缩小 + 成功图标放大 + 标题切换）、Onboarding 步骤切换等多元素同时过渡的场景。编排动画需要足够时长让用户感知状态变化，强行压到 300ms 以内会显得仓促。

#### 通用规则
- 按钮点击：`active:scale(0.96)`
- Toast 弹出：从上方滑入 + fade（160ms）
- 进度条：`duration-700 ease-out`（缓慢填充，传达"正在工作"）
- 避免过度使用动效

### 13.6 可访问性

- 文字对比度：WCAG AA（4.5:1 正文，3:1 大字）
- 焦点环：2px solid `--accent`，offset 2px
- 触点最小尺寸：28×28px
- 键盘导航：所有交互元素可 Tab 聚焦
