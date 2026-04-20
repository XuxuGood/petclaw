# PetClaw — AI 开发指南

> 本文件是所有 AI 编码助手（Claude Code、Cursor、Copilot、Windsurf 等）的统一参考。
> 工具专属配置文件（AGENTS.md、CLAUDE.md、.cursorrules 等）引用本文件，避免重复维护。

---

## 1. 产品定位

AI 桌面宠物助手。3D 黑猫驻留桌面，基于 Openclaw agent 运行时，连接 AI 工具链，陪伴用户工作。

### 核心架构
```
Electron (UI 壳)  ←WebSocket→  Openclaw (AI agent 运行时)  ←API→  LLM
     ↓                              ↓
  三窗口渲染                    workspace/（人格、记忆、技能）
```

- **Electron**：负责窗口、动画、系统集成（托盘、快捷键、hooks）
- **Openclaw**：AI agent 运行时，管理会话、记忆、工具调用、技能插件
- Electron 通过本地 WebSocket 网关（默认端口 29890）与 Openclaw 通信

## 2. Monorepo 结构

```
petclaw/
├── petclaw-desktop/     # Electron 桌面应用（当前焦点）
├── petclaw-web/         # Next.js 营销官网（Phase 3，未启动）
├── petclaw-api/         # 后端服务（Phase 3，未启动）
├── petclaw-shared/      # 共享 TypeScript 类型（未启动）
├── .ai/                 # AI 编码助手统一指南（本目录）
├── .github/workflows/   # CI/CD（GitHub Actions）
├── 设计/                # 参考素材（视频、截图，不入 git）
├── AGENTS.md            # Codex 入口（引用 .ai/）
├── CLAUDE.md            # Claude Code 入口（引用 .ai/）
└── .cursorrules         # Cursor 入口（引用 .ai/）
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
pnpm --filter petclaw-desktop test         # 运行单元测试（Vitest）
pnpm --filter petclaw-desktop test:watch   # 测试监听模式
pnpm --filter petclaw-desktop lint         # ESLint 检查
pnpm --filter petclaw-desktop lint:fix     # ESLint 自动修复
pnpm --filter petclaw-desktop typecheck    # TypeScript 类型检查（node + web）
pnpm --filter petclaw-desktop build        # 生产构建（仅编译）
pnpm --filter petclaw-desktop package      # 编译 + electron-builder 打包

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
pnpm --filter petclaw-desktop package    # 输出到 petclaw-desktop/dist/
```

- macOS：`.dmg` + `.zip`（`hardenedRuntime: true`）
- Windows：`.exe`（NSIS 安装包）
- electron-builder 配置在 `petclaw-desktop/package.json` → `"build"` 字段
- App ID：`ai.petclaw.desktop`

## 7. CI/CD（GitHub Actions）

文件：`.github/workflows/ci.yml`

触发：push 到 `main` / `develop`，或 PR 到 `main`

| Job                  | Runner                          | 内容                                       |
| -------------------- | ------------------------------- | ------------------------------------------ |
| `lint-and-typecheck` | ubuntu-latest                   | ESLint + TypeScript 检查                   |
| `test`               | ubuntu-latest                   | Vitest 单元测试                            |
| `build` (3 个并行)   | macos-latest / macos-13 / windows-latest | prepare-runtime → build → package → upload |

**Build 矩阵**：

| Runner          | Platform | Arch  | 产物       |
| --------------- | -------- | ----- | ---------- |
| macos-latest    | darwin   | arm64 | .dmg + .zip |
| macos-13        | darwin   | x64   | .dmg + .zip |
| windows-latest  | win      | x64   | .exe       |

**流程**：lint/test 通过 → 三平台并行运行 `prepare-runtime.sh` 打包运行时 → `electron-vite build` → `electron-builder` 打包 → 上传 artifact。

**TODO**：自动发布到 GitHub Releases（tag 触发）。

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

## 9. 代码风格

- 中文注释，英文变量名和 commit message
- 不加多余的 JSDoc / 类型注解 / 错误处理
- 改动最小化，不做"顺手优化"
- 2 空格缩进，LF 换行
- Prettier + ESLint 统一格式（`lint-staged` 自动运行）

---

## 10. petclaw-desktop 架构详解

### 10.1 三窗口架构

```
Pet Window (180×145, 透明, alwaysOnTop)     Chat Window (900×650, hiddenInset titleBar)
├── index.html → main.tsx → App.tsx          ├── chat.html → chat/main.tsx → ChatApp.tsx
├── PetCanvas.tsx  视频播放+拖拽              ├── Sidebar.tsx       深色侧边栏+会话列表
└── state-machine.ts 宠物状态机               ├── ChatView.tsx      聊天界面
                                              ├── MonitorView.tsx   Hook 事件监控
Pet Bubble Window (动态尺寸, 透明)            ├── SettingsView.tsx  设置面板
├── pet-bubble.html（TODO，未实现）            └── StatusBar.tsx     底部状态栏
└── 工具动作气泡提示
```

### 10.2 进程架构

```
Main Process (Node.js)              Preload (Bridge)              Renderer (Browser)
├── index.ts     入口+窗口创建       ├── index.ts  contextBridge    ├── Pet Window
├── ipc.ts       IPC handler 注册   └── index.d.ts 类型声明         └── Chat Window
├── ai/
│   ├── openclaw.ts  WebSocket 客户端
│   └── provider.ts  AI 接口抽象
├── data/db.ts       SQLite 数据库
├── hooks/
│   ├── server.ts    Unix socket 服务器（接收 Claude Code hook 事件）
│   ├── installer.ts Hook 配置安装器
│   └── types.ts     Hook 事件类型
├── system/
│   ├── tray.ts      系统托盘
│   └── shortcuts.ts 全局快捷键
└── onboarding.ts    首次引导
```

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
- **新增 IPC channel 必须同步更新三处**：`ipc.ts`、`preload/index.ts`、`preload/index.d.ts`

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

状态机：`Idle → Thinking → Working → Happy`，任意状态可进入 `Dragging`。

视频播放器（`PetCanvas.tsx`）：双缓冲 `<video>` 元素避免切换闪烁，`playSequence()` 支持过渡动画链，2 分钟无互动自动睡眠。

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

### 10.9 测试

- 框架：Vitest + jsdom
- 位置：`tests/` 目录，镜像 `src/` 结构
- 运行：`pnpm test`（单次）、`pnpm test:watch`（监听）

---

## 11. Openclaw 集成架构

### 11.1 概述

Openclaw 是 AI agent 运行时，负责 LLM 调用、会话管理、记忆系统、工具/技能执行。Electron 只是 UI 壳，所有 AI 逻辑通过 WebSocket 网关与 Openclaw 通信。

### 11.2 自包含 Node.js 运行时（~/.petclaw/node/）

PetClaw 自带完整的 Node.js 环境，与系统 Node.js 完全隔离：

```
~/.petclaw/node/
├── bin/
│   ├── node              # 独立 Node.js 二进制（v22，~108MB）
│   ├── npm / npx         # 包管理
│   └── petclaw           # CLI 入口（shell 脚本）
├── lib/node_modules/
│   ├── openclaw/         # Openclaw 核心运行时
│   ├── openai/           # OpenAI SDK
│   ├── @anthropic-ai/    # Claude SDK
│   ├── grammy/           # Telegram Bot（Channels）
│   ├── @slack/           # Slack SDK（Channels）
│   ├── @whiskeysockets/  # WhatsApp（Channels）
│   ├── playwright-core/  # 浏览器自动化（Skills）
│   ├── node-llama-cpp/   # 本地 LLM
│   ├── express / ws      # Gateway 服务器
│   └── ... 200+ 依赖
└── include/node/         # native 模块编译头文件
```

**安装来源**：首次启动时从 app 自带的 tar.gz 资源解压到 `~/.petclaw/node/`（不联网）：
- `resources/node/<platform-arch>.tar.gz` — Node.js
- `resources/openclaw/<platform-arch>.tar.gz` — Openclaw + 全部依赖

**petclaw CLI**：BootCheck Step 4 自动生成 `~/.petclaw/node/bin/petclaw` shell 脚本，设置 `OPENCLAW_HOME` 等环境变量后执行 `openclaw.mjs`。

**Electron 集成方式**：
1. 首次启动 → BootCheck 解压 tar.gz 到 `~/.petclaw/node/`
2. 生成 `petclaw` CLI 脚本 + `openclaw.json` 默认配置
3. 通过 `child_process.spawn` 启动 Gateway
4. 通过 WebSocket 连接 Gateway 通信

### 11.2.1 运行时打包流程

运行时资源通过脚本自动打包，**不入 git**（`.gitignore` 中排除）。

**打包脚本**：`petclaw-desktop/scripts/prepare-runtime.sh`

```bash
# 当前平台
./scripts/prepare-runtime.sh

# 指定平台
./scripts/prepare-runtime.sh darwin arm64   # macOS Apple Silicon
./scripts/prepare-runtime.sh darwin x64     # macOS Intel
./scripts/prepare-runtime.sh win x64        # Windows
```

**版本管理**：脚本头部配置：
```bash
NODE_VERSION="v22.13.1"
OPENCLAW_VERSION="latest"   # npm tag 或具体版本号
```

**更新 Openclaw**：改 `OPENCLAW_VERSION` → 重新运行脚本 → 测试 → 发版。

**CI/CD 多架构**：GitHub Actions 并行运行三个平台的 prepare-runtime，再分别 electron-builder 打包。

**electron-builder**：`asarUnpack` 确保 resources 不被压进 asar：
```json
"asarUnpack": ["resources/node/**", "resources/openclaw/**"]
```

### 11.3 通信架构

```
Electron Main Process
├── ai/openclaw.ts    WebSocket 客户端，连接本地网关
│                     ws://127.0.0.1:{gatewayPort}
│                     认证：Bearer token（gatewayToken）
│
Openclaw Runtime（独立进程）
├── 内嵌 Node.js（~/.petclaw/node/）
├── Gateway          本地 WebSocket 服务器（默认端口 29890）
├── Agent Sessions   会话管理（~/.petclaw/agents/main/sessions/）
└── LLM Provider     对接后端 API（petclaw.ai/api/v1 或自定义）
```

### 11.4 Workspace 目录（~/.petclaw/workspace/）

Openclaw agent 的工作目录，包含人格、记忆和技能：

| 文件 | 用途 |
| ---- | ---- |
| `SOUL.md` | 猫咪人格定义（温暖、偶尔傲娇、有主见） |
| `USER.md` | 用户档案（姓名、职业、偏好） |
| `IDENTITY.md` | agent 身份（名字、形象、性格标签） |
| `MEMORY.md` | 长期记忆（跨会话持久化） |
| `AGENTS.md` | agent 工作规范（会话启动流程、记忆规则、红线） |
| `AGENTS_CHAT.md` | 聊天模式指令 |
| `AGENTS_WORK.md` | 工作模式指令（Think-Plan-Execute-Deliver） |
| `TOOLS.md` | 环境特定工具笔记 |
| `BOOTSTRAP.md` | 首次启动引导（完成后删除） |
| `memory/YYYY-MM-DD.md` | 每日笔记 |
| `skills/` | 50+ 技能插件（浏览器、日历、GitHub、邮件等） |

### 11.5 配置文件（~/.petclaw/）

#### openclaw.json（Openclaw 运行时配置）

| 字段 | 来源 | 说明 |
| ---- | ---- | ---- |
| `models.providers.llm.baseUrl` | BootCheck 生成 | 默认 `https://petclaw.ai/api/v1` |
| `models.providers.llm.apiKey` | Onboarding 登录后 | 用户认证后从服务端获取 |
| `models.providers.llm.models[]` | BootCheck 生成 | petclaw-fast 模型 |
| `agents.defaults.workspace` | BootCheck 生成 | `~/.petclaw/workspace` |
| `agents.defaults.model.primary` | BootCheck 生成 | `llm/petclaw-fast` |
| `agents.defaults.compaction` | BootCheck 生成 | 内存刷新策略 |
| `hooks.internal.entries` | BootCheck 生成 | session-memory 等 |
| `gateway.port` | BootCheck 生成 | 默认 29890 |
| `gateway.auth.token` | BootCheck 生成 | 随机 token |
| `gateway.remote.token` | BootCheck 生成 | 同 auth.token |

#### petclaw-settings.json（应用设置）

| 字段 | 来源 | 说明 |
| ---- | ---- | ---- |
| `language` | BootCheck / Onboarding | 默认 zh |
| `brainApiUrl` / `brainModel` / `brainApiKey` | BootCheck / 登录后 | AI 模型配置 |
| `runtimeMode` | BootCheck 生成 | "chat" |
| `gatewayPort` / `gatewayUrl` / `gatewayToken` | BootCheck 生成 | 网关连接 |
| `deviceId` | BootCheck 生成 | 设备唯一 ID（随机 hex） |
| `userEmail` / `userToken` | Onboarding 登录 | 用户认证 |
| `inviteCode` | Onboarding | 邀请码 |
| `voiceShortcut` | Onboarding Step 4 | 默认 ["Meta","d"] |
| `voiceInputDevice` | Onboarding / 设置 | 默认 "default" |
| `theme` | BootCheck / 设置页 | 默认 "light" |
| `sopComplete` / `onboardingComplete` | Onboarding 完成后 | |
| `lastLaunchedVersion` | 每次启动更新 | app 版本号 |
| `userCredits` / `modelTier` / `membershipTier` | 登录后从服务端拉取 | 积分/会员 |

#### 其他运行时文件

| 文件 | 来源 | 说明 |
| ---- | ---- | ---- |
| `cron/jobs.json` | Openclaw 运行时 | 定时任务 |
| `session-history.json` | Openclaw 运行时 | 会话文件路径映射 |
| `session-previews.json` | Openclaw 运行时 | 会话摘要 |
| `update-check.json` | Openclaw 运行时 | 自动更新检查记录 |
| `cron-history.json` | Openclaw 运行时 | 定时任务执行历史 |
| `logs/petclaw-gateway.log` | Electron 主进程 | Gateway stdout 重定向 |
| `logs/startup-diagnostics.log` | Electron 主进程 | 启动诊断日志 |
| `devices/` | Openclaw 运行时 | 设备信息 |

### 11.6 Agent 运行模式

| 模式 | 配置文件 | 特点 |
| ---- | -------- | ---- |
| Chat | `AGENTS_CHAT.md` | 闲聊陪伴，自动更新记忆，不主动确认琐事 |
| Work | `AGENTS_WORK.md` | 任务执行，Think-Plan-Execute-Deliver 闭环，静默高效 |

### 11.7 应用启动检查（BootCheck）

每次启动依次执行 5 步检查，Pet Window 显示进度：

1. **检测环境** — OS 版本、架构、磁盘空间
2. **准备 Node.js** — 检查 `~/.petclaw/node/bin/node`，不存在则下载
3. **更新运行时** — 检查 Openclaw 版本，需要则更新
4. **配置大模型** — 检查 `openclaw.json`，无效则进入配置向导
5. **启动连接** — spawn Gateway + WebSocket 握手

非首次启动：1/2/3 秒过，直接到 5。

### 11.8 当前集成状态

- ✅ WebSocket 客户端（`ai/openclaw.ts`）
- ✅ Gateway 连接（端口 29890，token 认证）
- ✅ Hook 事件接收（`hooks/server.ts`，Unix socket）
- ❌ Workspace 管理（SOUL.md/MEMORY.md 读写）— TODO
- ❌ Pet Bubble 窗口（工具动作气泡）— TODO
- ❌ 语音系统（TTS + 语音输入）— TODO
- ❌ Skills 插件系统 — TODO
- ❌ Cron 定时任务 — TODO

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

```css
--transition-fast: 120ms ease;      /* 按钮悬停、图标旋转 */
--transition-default: 180ms ease;   /* 面板切换、颜色变化 */
--transition-slow: 300ms ease-out;  /* 模态框、侧边栏展开 */
```

- 按钮点击：`active:scale(0.96)`
- Toast 弹出：从上方滑入 + fade（160ms）
- 避免过度使用动效

### 13.6 可访问性

- 文字对比度：WCAG AA（4.5:1 正文，3:1 大字）
- 焦点环：2px solid `--accent`，offset 2px
- 触点最小尺寸：28×28px
- 键盘导航：所有交互元素可 Tab 聚焦
