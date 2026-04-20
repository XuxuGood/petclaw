# PetClaw 产品设计规格

> 日期：2026-04-09（初稿）/ 2026-04-19（更新）
> 状态：Phase 1 开发中
> 目标：AI 桌面宠物助手（桌面宠物应用 + 营销官网 + 后端服务）

---

## 1. 产品概述

PetClaw 是一款 AI 桌面宠物助手，以猫咪形象常驻用户桌面，通过自然语言和语音与用户交互，帮助处理日常任务（提醒、总结、起草、研究、编程等）。

核心定位："一款 24/7 全天候运行的桌面宠物伴侣"。

产品由三个子项目组成：

1. **petclaw-desktop** — Electron 桌面宠物应用（核心产品）
2. **petclaw-web** — Next.js 营销官网
3. **petclaw-api** — 后端服务（认证/支付/订阅/邀请）

额外集成：
- **Openclaw** — 开源 AI Gateway 框架，提供 AI 引擎能力
- **CodeIsland** — Hook 系统和 AI 工具监控协议

---

## 2. 桌面宠物应用（petclaw-desktop）

### 2.1 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 框架 | Electron 33 | 桌面壳 |
| 前端 | React 19 + TypeScript | UI |
| 构建 | electron-vite + Vite 6 | 多入口构建 |
| 动画 | WebM 视频（VP8+alpha） | 9 个 3D 猫咪动画，双缓冲 `<video>` 播放 |
| 样式 | Tailwind CSS v4 | 原子化 CSS |
| 状态管理 | Zustand 5 | 轻量状态 |
| 本地存储 | better-sqlite3 | SQLite |
| 图标 | lucide-react | SVG 图标 |
| IPC | Electron contextBridge | 安全桥接 |
| Hook 通信 | Node.js net (Unix Socket) | AI 工具事件监控 |
| AI 运行时 | Openclaw | WebSocket Gateway 通信 |
| 打包 | electron-builder | macOS dmg + Windows nsis |

### 2.2 架构

```
┌──────────────────────────────────────────────────┐
│              Electron 应用（三窗口）               │
│                                                  │
│  ┌─── 主进程 (Main Process) ──────────────────┐  │
│  │                                            │  │
│  │  ┌──────────┐  ┌────────────────────────┐  │  │
│  │  │AI 通信层 │  │ Hook Server            │  │  │
│  │  │          │  │ (Unix Socket)          │  │  │
│  │  │• Openclaw│  │ 监控 Claude Code、     │  │  │
│  │  │  WebSocket│  │ Codex、Cursor 等       │  │  │
│  │  │  Gateway │  │ (复用 CodeIsland 协议) │  │  │
│  │  └──────────┘  └────────────────────────┘  │  │
│  │                                            │  │
│  │  ┌──────────┐  ┌────────────────────────┐  │  │
│  │  │系统集成  │  │ 数据层                 │  │  │
│  │  │• 系统托盘│  │ • SQLite 消息/会话存储 │  │  │
│  │  │• 全局快捷│  │ • 用户偏好/设置        │  │  │
│  │  │• 自动更新│  │ • 会话历史             │  │  │
│  │  └──────────┘  └────────────────────────┘  │  │
│  └────────────────────────────────────────────┘  │
│         ↕ IPC (contextBridge)                    │
│  ┌─── Pet Window (180×145) ──────────────────┐   │
│  │  React + WebM Video (VP8+alpha)           │   │
│  │  • 双缓冲 <video> 播放 9 种猫咪动画       │   │
│  │  • 状态机驱动动画切换（带过渡序列）       │   │
│  │  • 拖拽移动窗口                           │   │
│  │  • 2 分钟无互动自动睡眠                   │   │
│  │  • 点击 → 切换 Chat Window               │   │
│  └───────────────────────────────────────────┘   │
│  ┌─── Chat Window (900×650) ─────────────────┐   │
│  │  React + Tailwind + Lucide                │   │
│  │  ┌────────┬───────────────────────────┐   │   │
│  │  │Sidebar │ Chat / Monitor / Settings │   │   │
│  │  │ 深色   │ 视图                      │   │   │
│  │  │ 导航    │                          │   │   │
│  │  └────────┴───────────────────────────┘   │   │
│  └───────────────────────────────────────────┘   │
│  ┌─── Pet Bubble Window (TODO) ──────────────┐   │
│  │  透明窗口，工具动作气泡提示               │   │
│  └───────────────────────────────────────────┘   │
│         ↕ WebSocket (ws://127.0.0.1:29890)       │
│  ┌────────────────────────────────────────────┐  │
│  │   Openclaw (独立 AI agent 运行时)           │  │
│  │   ├── Gateway (WebSocket 网关)             │  │
│  │   ├── Workspace (SOUL.md/MEMORY.md/skills) │  │
│  │   ├── Sessions (会话管理)                  │  │
│  │   └── LLM Provider (API 对接)              │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### 2.3 Openclaw 集成

所有 AI 能力由 Openclaw 运行时提供（LLM、会话、记忆、技能、Channels、定时任务等），Electron 只做 UI 壳。

**自包含 Node.js 运行时**：

PetClaw 自带完整的 Node.js + Openclaw 包，与系统 Node.js 隔离：

```
~/.petclaw/
├── node/
│   ├── bin/
│   │   ├── node              # 独立 Node.js v22（~108MB）
│   │   └── petclaw           # CLI 入口（shell 脚本）
│   └── lib/node_modules/
│       ├── openclaw/         # Openclaw 核心运行时
│       ├── openai/           # LLM SDK
│       ├── @anthropic-ai/    # Claude SDK
│       ├── grammy/           # Telegram（Channels）
│       ├── @slack/           # Slack（Channels）
│       ├── @whiskeysockets/  # WhatsApp（Channels）
│       ├── playwright-core/  # 浏览器自动化（Skills）
│       └── ... 200+ 依赖
├── workspace/                # Agent 工作目录
│   ├── SOUL.md               # 猫咪人格
│   ├── USER.md               # 用户档案
│   ├── MEMORY.md             # 长期记忆
│   ├── skills/               # 50+ 技能插件
│   └── memory/               # 每日笔记
├── petclaw.db                # SQLite（消息 / 会话）
├── agents/main/sessions/     # 会话历史
├── openclaw.json             # Openclaw 配置（模型、网关、hooks）
├── petclaw-settings.json     # 应用设置
└── cron/                     # 定时任务
```

**petclaw CLI**：`~/.petclaw/node/bin/petclaw` 是一个 shell 脚本，设置 `OPENCLAW_HOME=~/.petclaw` 等环境变量后执行 `openclaw.mjs`。所以 `petclaw gateway start` 实际就是 `openclaw gateway start`。

**通信方式**：Electron 通过本地 WebSocket（`ws://127.0.0.1:29890`，Bearer token 认证）与 Openclaw Gateway 通信。

**运行时打包**：
- Node.js + Openclaw 预编译为 tar.gz，打包在 app 资源中（`resources/node/`、`resources/openclaw/`）
- 打包脚本：`scripts/prepare-runtime.sh`（支持 darwin-arm64 / darwin-x64 / win-x64）
- 首次启动时 BootCheck 解压到 `~/.petclaw/node/`，不联网
- 更新 Openclaw：改脚本中版本号 → 重新打包 → 发版
- electron-builder `asarUnpack` 确保资源不被压进 asar
- SQLite 数据库固定放在 `~/.petclaw/petclaw.db`，不会跟随 `.app` 安装包走；旧版若存放在 Electron `userData` 目录，首次启动自动迁移

**Openclaw 生命周期**：
1. PetClaw 首次启动 → BootCheck 从 app 资源解压 Node.js + Openclaw 到 `~/.petclaw/node/`
2. 生成 `petclaw` CLI 脚本 + `openclaw.json` + `petclaw-settings.json` 完整默认配置
3. 生成目录结构：`workspace/`、`agents/main/`、`logs/`
4. 启动时检测 Gateway 是否已运行（端口 29890）
5. 未运行则 `petclaw gateway run`（前台模式，日志写入 `~/.petclaw/logs/petclaw-gateway.log`）
6. 通过 WebSocket 建立持久连接

**配置文件生成策略**：
- **BootCheck 自动生成**：网关端口/token、deviceId、默认模型配置、运行时模式、语音快捷键默认值
- **Onboarding 用户填写后写入**：language、voiceShortcut、nickname（→ USER.md）、roles、onboardingComplete
- **登录后从服务端拉取**：apiKey、userEmail、userToken、userCredits、membershipTier
- **每次启动更新**：lastLaunchedVersion

### 2.4 Hook 系统（复用 CodeIsland 协议）

监听本地 AI 工具的工作状态，事件流：

```
AI 工具触发 Hook
  → petclaw-bridge (轻量 Node.js 二进制，约 86KB)
    → JSON 事件写入 Unix Socket (/tmp/petclaw-<uid>.sock)
      → 主进程 HookServer (net.createServer) 接收
        → 解析事件类型 (tool_use / permission / error / complete)
        → 更新 SessionStore (Zustand)
        → IPC 推送到渲染进程
          → AI 工具监控面板更新
          → 猫咪动画状态联动
```

支持的 AI 工具（同 CodeIsland）：
- Claude Code（13 个事件类型）
- Codex（3 个事件）
- Gemini CLI（6 个事件）
- Cursor（10 个事件）
- Copilot（6 个事件）
- Qoder、Factory、CodeBuddy、OpenCode

ConfigInstaller 自动向 AI 工具配置文件注入 Hook 命令。

### 2.5 应用启动与引导流程

#### 2.5.1 启动检查（BootCheck）

每次启动时，Pet Window 显示环境检查进度面板，依次执行 5 步检查：

```
┌─────────────────────────────────┐
│                                 │
│      🐱 PetClaw AI             │
│                                 │
│  ✅ 检测环境                    │
│  ✅ 准备 Node.js               │
│  ⏳ 更新 PetClaw 运行时...      │
│  ○  配置 AI 大模型              │
│  ○  启动并连接服务              │
│                                 │
│  ████████████░░░░ 60%          │
│                                 │
└─────────────────────────────────┘
```

| 步骤 | 检查内容 | 成功条件 | 失败处理 |
|---|---|---|---|
| 1. 检测环境 | OS 版本、CPU 架构、磁盘空间 | macOS 12+ / Win 10+，>500MB 空闲 | 错误提示 + 退出 |
| 2. 准备 Node.js | `~/.petclaw/node/bin/node` 是否存在 | `node --version` 返回 v22+ | 下载 Node.js 二进制包 |
| 3. 更新运行时 | Openclaw 版本检查 | 版本匹配或更新成功 | 重试 / 跳过 |
| 4. 配置大模型 | `openclaw.json` 中 LLM provider 是否有效 | provider + apiKey 配置完整 | 进入配置向导 |
| 5. 启动连接 | spawn Gateway + WebSocket 握手 | Gateway 响应 + WS 连接成功 | 指数退避重试（1s→2s→4s→30s max） |

#### 2.5.2 启动流程

```
app.whenReady()
    ↓
Pet Window 显示 BootCheck 进度面板
    ↓
Step 1: 检测环境 ──失败──→ 错误提示 + 退出
    ↓ 通过
Step 2: 准备 Node.js
    ├── ~/.petclaw/node/bin/node 已存在 → 跳过
    └── 不存在 → 下载 Node.js（显示下载进度）
    ↓
Step 3: 更新 PetClaw 运行时
    ├── Openclaw 版本一致 → 跳过
    └── 需要更新 → 下载更新到 ~/.petclaw/node/lib/node_modules/openclaw/
    ↓
Step 4: 配置 AI 大模型
    ├── openclaw.json 有效 → 跳过
    └── 无效/不存在 → 首次配置向导（选择模型、填写 API Key）
    ↓
Step 5: 启动并连接服务
    ├── Gateway 已运行（端口 29890 可达） → 直接 WebSocket 连接
    └── 未运行 → child_process.spawn('petclaw', ['gateway', 'start']) → 连接
    ↓
全部通过 → 隐藏进度面板 → 显示猫咪动画
```

**后续启动优化**：非首次启动时，Step 1/2/3 已有环境秒过（~100ms），直接到 Step 5。

#### 2.5.3 首次引导（Onboarding，5 步向导）

> 窗口：Chat Window（900×650）全屏覆盖，白色背景，macOS 红绿灯窗口控件。
> 布局：左右分栏（约 50/50），左侧为表单/内容区，右侧为猫咪形象展示区（浅灰背景，3D 黑猫居中偏右，带语音气泡）。
> 参考截图：`设计/安装引导/安装引导1~5.png`

##### 全局 UI 元素

| 元素 | 位置 | 说明 |
|---|---|---|
| 语言切换 | 顶部居中 | EN / **中文** / 日本語 / Español / Português，当前语言加粗，斜杠分隔 |
| 步骤进度条 | 左侧内容区顶部（语言切换下方） | 5 段粗短横线（约 40px 宽，3px 高），已完成+当前步骤为黑色实线（#18181b），未到达为浅灰色（#d4d4d8），间距 8px |
| 跳过 | 左下角 | 灰色文字按钮"跳过"，点击跳过全部引导直接进入主界面 |
| 上一步 | 右下角（Step 2-5） | 白色背景+黑色边框圆角按钮，Step 1 不显示 |
| 下一步 / 开始使用 | 右下角 | 黑色填充圆角按钮（#18181b），白色文字，Step 5 变为"开始使用" |
| 猫咪形象 | 右侧区域居中 | 3D 黑猫静态图（`static.webm` 截帧或独立 PNG），偏右下 |

##### Step 1：权限设置

- **标题**：在您的电脑上设置 PetClaw（黑色，24px，font-bold）
- **副标题**：PetClaw 需要以下权限才能正常工作。您的数据仅在本地处理，我们不会存储任何内容。（灰色 #71717a，14px）
- **权限列表**：两个权限卡片，纵向排列，圆角边框（1px #e4e4e7），内间距 16px
  - 「允许 PetClaw 使用辅助功能」— 右侧圆形 ✓ 图标（黑色填充 #18181b）
  - 「允许 PetClaw 使用您的麦克风」— 右侧圆形 ✓ 图标
- **交互**：
  - 点击权限卡片 → 调用系统权限弹窗（macOS `tcc` / Windows UAC）
  - 已授权显示黑色实心 ✓，未授权显示灰色空心圆圈
  - 两个权限都授权后"下一步"按钮高亮可点
- **进度条**：第 1 段黑色，其余灰色

##### Step 2：个人信息

- **标题**：告诉我们关于您（黑色，24px，font-bold）
- **副标题**：帮助 PetClaw 为您打造个性化体验（灰色 #a1a1aa，14px）
- **表单**：
  - **怎么称呼您？**（小标题，16px，font-semibold）
    - 文本输入框，圆角 12px，浅灰背景（#f4f4f5），placeholder 无，直接输入
  - **选择您的身份角色**（小标题，16px，font-semibold）
    - 下拉多选框，圆角 12px，浅灰背景
    - 已选中项显示为 Tag（紫色背景 #e0e7ff，深色文字 #3730a3，带 × 关闭）
    - 下拉选项列表（白色面板，圆角，阴影）：
      - ☐ 学生
      - ☐ 创业者 / 自由职业者
      - ☑ 程序员 / 开发者（选中：蓝色复选框 #6366f1，浅蓝背景行 #eef2ff）
      - ☐ 设计师
      - ☐ 内容创作者 / 博主
      - ☐ 研究员 / 学者
    - 支持多选，选中后 Tag 显示在输入框内
- **交互（提交后）**：
  - 表单下方出现黑色全宽按钮"重新提交"（圆角 12px，#18181b 背景）
  - 右侧猫咪头顶出现**对话气泡**（深色背景 #27272a，白色文字，圆角 12px，底部三角指向猫咪）：
    - 「记录完成！已为您推荐了合适的技能，点击下一步查看吧~」
  - "下一步"按钮可点击
- **进度条**：第 1、2 段黑色，其余灰色

##### Step 3：技能推荐

- **标题**：PetClaw 拥有的技能（黑色，24px，font-bold）
- **副标题**：我们为您默认安装好用且安全的 Skill（灰色斜体 #a1a1aa，14px）
- **技能列表**：单列卡片列表（白色背景，圆角 16px，1px 边框 #e4e4e7），可滚动
  - 每行结构：`[图标 40×40] [名称 + 标签] [描述] [右侧勾选圆圈]`
  - 技能名称 16px font-semibold，描述 13px 灰色 #71717a，单行截断
  - **标签类型**：
    - 🟣 `PetClaw` — 紫色标签（背景 #ede9fe，文字 #7c3aed），表示官方内置
    - 🔴 `需配置` — 红色标签（背景 #fee2e2，文字 #dc2626），表示需要额外设置
    - 无标签 — 开源社区技能
  - **勾选状态**：
    - ✅ 绿色实心圆圈勾选（#16a34a）— 已推荐/已选中
    - ⭕ 灰色空心圆圈（#d4d4d8）— 未选中（如需配置的 Apple 提醒事项）
  - **默认推荐的技能**（根据 Step 2 身份角色推荐）：
    - 技能创建器 — 通过引导式流程设计并生成新的 Claude Skill（SKILL.md 文件） ✅
    - 安全浏览器 — 操控真实浏览器浏览网页、填写表单、截图和提取内容 ✅
    - 技能安全审计 — 安装外部技能前自动扫描安全风险，给出 A-F 安全评级 ✅
    - Apple 提醒事项 🔴需配置 — 管理 Apple 提醒事项，设置待办和截止日期 ⭕
    - Calendar `PetClaw` — Create calendar events on macOS automatically via AppleScr... ✅
    - AI News `PetClaw` — Fetch and summarise today's latest AI news ✅
    - Deep Research `PetClaw` — Conduct deep research with structured plans, broad searche... ✅
- **交互**：点击勾选圆圈可切换选中/未选中状态
- **进度条**：第 1、2、3 段黑色

##### Step 4：语音快捷键

- **标题**：语音快捷键（黑色，24px，font-bold）
- **副标题**：按下快捷键开始说话，再按一次确认发送。（灰色 #71717a，14px）
- **快捷键设置**：
  - 卡片行（圆角 12px，1px 边框 #e4e4e7，内间距 16px）：
    - 左侧：⌨️ 图标 + "键盘快捷键"（14px）
    - 右侧：快捷键显示 `Command + D`（等宽字体，灰色背景圆角标签）
  - 点击可修改快捷键（录入新快捷键组合）
- **麦克风测试**：
  - **小标题**：口述以测试您的麦克风（16px，font-semibold）
  - **说明**：点击下方按钮或按快捷键开始说话，介绍一下自己，顺便给我取个名字吧。（灰色 #71717a，14px）
  - **录音按钮卡片**（圆角 12px，1px 边框 #e4e4e7）：
    - 🎙️ 麦克风图标 + "点击开始说话"（灰色 placeholder 文字）
    - 点击后：变为录音状态（红色脉冲动画），再次点击或按快捷键停止
- **进度条**：第 1、2、3、4 段黑色

##### Step 5：首次对话体验

- **标题**：获取今日资讯（黑色，24px，font-bold）
- **副标题**：再来一次，让小猫帮您搜集整理信息。（灰色 #71717a，14px）
- **示例对话**：
  - AI 消息气泡（圆角 12px，浅灰背景 #f4f4f5）：
    - 左侧小图标（灰色占位图） + 「"请整理今日最新 AI 资讯"」
  - 分割线 + 居中灰色文字"现在轮到您了"
- **语音输入**：
  - 输入卡片（圆角 12px，1px 边框 #e4e4e7）：
    - 🎙️ 麦克风图标 + "点击开始说话"
    - 右侧显示快捷键提示 `Command` `D`（两个独立的灰色标签）
- **底部按钮**：
  - "上一步" + **"开始使用"**（替代"下一步"，黑色填充按钮）
- **进度条**：全部 5 段黑色

##### 引导流程

```
BootCheck 全部通过
    ↓
检测 Onboarding 是否完成
    ↓ 未完成
打开 Chat Window → 全屏引导覆盖层
    ↓
Step 1: 权限设置
  → 请求辅助功能权限 + 麦克风权限
    ↓ 下一步
Step 2: 个人信息
  → 输入昵称 + 选择身份角色 → 提交
  → 猫咪气泡反馈 + 根据角色预计算推荐技能
    ↓ 下一步
Step 3: 技能推荐
  → 展示推荐技能列表，用户可调整勾选
    ↓ 下一步
Step 4: 语音快捷键
  → 设置/确认快捷键（默认 Command+D）
  → 可选：麦克风测试录音
    ↓ 下一步
Step 5: 首次对话
  → 展示示例对话，引导用户语音输入
    ↓ 开始使用
标记 onboardingCompleted = true
  → 保存用户信息（昵称、角色、选中技能、快捷键）
  → 安装选中的技能
  → 关闭引导 → 进入主界面
```

任何步骤均可点击"跳过"直接完成引导进入主界面（使用默认配置）。

### 2.6 桌面宠物核心功能

| 功能 | 说明 |
|---|---|
| 透明窗口 | 180×145，无边框、透明背景，猫咪浮在桌面上 |
| 猫咪动画 | 9 个 WebM 视频（VP8+alpha 透明背景），双缓冲 `<video>` 播放：begin、static、listening、task-start/loop/leave、sleep-start/loop/leave |
| 状态机 | 5 种状态（Idle/Thinking/Working/Happy/Dragging），带过渡动画序列 |
| 自动睡眠 | 2 分钟无互动自动 sleep-start → sleep-loop，有活动时 sleep-leave 醒来 |
| 拖拽移动 | 鼠标拖拽宠物到桌面任意位置 |
| 屏幕边缘吸附 | 靠近边缘自动吸附（Phase 4） |
| 右键菜单 | 快捷操作：设置、静音、退出等 |
| 物理模拟 | 猫咪有重力感，可"站"在窗口边缘（Phase 4） |

### 2.7 交互面板

点击宠物或使用快捷键弹出交互面板：

| 组件 | 功能 |
|---|---|
| 聊天界面 | 文字/语音输入，AI 流式回复展示，Markdown 渲染 |
| AI 工具监控 | CodeIsland 风格，显示各 AI 工具实时工作状态 |
| 权限审批卡 | AI 工具请求权限时弹出审批界面 |
| 技能管理 | 查看/安装/卸载技能，自定义技能教学 |
| 定时任务 | Cron 任务列表、创建/编辑/删除、运行日志 |
| 频道管理 | 已连接消息渠道列表、添加/登录/登出、未读消息 |
| 记忆管理 | 查看/编辑 AI 记住的信息 |
| 价格/订阅 | 当前套餐、积分用量、升级入口 |
| 设置面板 | 语音快捷键、外观（亮/暗主题）、AI 模型选择、Hook 配置 |

### 2.8 数据流

**聊天数据流**：
```
用户输入 (文字/语音)
  → 渲染进程: IPC send('chat', msg)
    → 主进程: AIService.chat(msg)
      → OpencLawProvider: WebSocket → Gateway
        → 流式响应 (AsyncGenerator)
          → IPC reply(chunk)
            → 渲染进程: 更新聊天 UI + 猫咪状态
          → SQLite: 保存会话记录
```

**Hook 事件数据流**：
```
AI 工具触发 Hook
  → petclaw-bridge → Unix Socket → 主进程 HookServer
    → 解析事件 → 更新 SessionStore → IPC 推送渲染进程
      → AI 工具监控面板更新 + 猫咪动画联动
```

### 2.9 错误处理

| 场景 | 处理方式 |
|---|---|
| Openclaw 进程崩溃 | 自动重启 + 重连 WebSocket，猫咪显示"困惑"动画 |
| Gateway 连接断开 | 指数退避重试（1s → 2s → 4s → 最大 30s） |
| 权限被撤销 | 检测后弹窗提示重新授权 |
| 磁盘空间不足 | 提示清理 + 自动清理旧日志 |
| AI 响应超时 | 30s 超时，显示提示并可重试 |

### 2.10 测试策略

| 层级 | 工具 | 覆盖范围 |
|---|---|---|
| 单元测试 | Vitest | AI 抽象层、状态机、Hook 解析器 |
| 组件测试 | React Testing Library | 交互面板组件 |
| E2E 测试 | Playwright + Electron | 完整用户流程 |
| 集成测试 | Mock WebSocket Server | Openclaw 通信 |

---

## 3. 营销官网（petclaw-web）

### 3.1 技术栈

| 技术 | 用途 |
|---|---|
| Next.js 15 (App Router) | 框架 |
| React 19 + TypeScript | UI |
| Tailwind CSS v4 | 样式 |
| next-intl | 国际化（中/英/日/西/葡） |
| Lucide React | 图标 |
| Noto Serif SC | 中文衬线字体 |
| Vercel | 部署 |

### 3.2 设计风格

- **色调**：暖色系，CTA 按钮橙棕色（#d97757, #e49b7b）
- **字体**：Noto Serif SC（思源宋体），营造亲和感
- **圆角**：大圆角（rounded-3xl），柔和阴影
- **动画**：价格数字翻滚、FAQ 手风琴、视频播放按钮缩放、hover 过渡
- **背景**：浅暖灰色（rgb(247,247,244)）

### 3.3 页面结构

```
petclaw-web/
├── app/
│   └── [locale]/
│       ├── page.tsx              # 首页
│       ├── pricing/page.tsx      # 定价页
│       ├── tutorial/page.tsx     # 教程页（动态 slug）
│       ├── login/page.tsx        # 登录页
│       ├── dashboard/page.tsx    # 用户仪表板
│       ├── invite/page.tsx       # 邀请系统
│       ├── privacy/page.tsx      # 隐私政策
│       ├── terms/page.tsx        # 服务条款
│       └── install-guide/page.tsx # 安装指南
```

### 3.4 首页布局（6 个区块）

1. **Hero**：标题 + 副标题 + 双 CTA（Mac/Windows 下载）+ 演示视频（WebM）
2. **Feature Demo**：4 个功能展示块，交替左右排列（35%/65%），每块 800-920px 高
   - 轻松设置、语音交互、无限技能、持久记忆
3. **隐私保护**：左文右图（盾牌），3 个特性图标卡片（本地运行/数据掌控/安全加密）
4. **FAQ**：6 个手风琴式问答
5. **底部 CTA**：左文 + CTA 按钮 + 右侧猫咪循环视频
6. **页脚**：版权 + 链接 + 社交媒体图标

### 3.5 定价页

- 月/年切换（年付节省 20%）
- 三档套餐卡片网格：

| | Basic | Standard（最受欢迎） | Pro |
|---|---|---|---|
| 年付月均 | $16/月 | $32/月 | $160/月 |
| 月积分 | 2,500 | 6,000（可选额度等级） | 30,000 |
| 每日刷新 | 100 | 100 | 100 |

- Standard 卡片边框突出（橙色 #e49b7b, 2px）
- 所有卡片支持微信支付入口

### 3.6 响应式设计

| 断点 | 适配 |
|---|---|
| 默认（移动端） | 单列布局 |
| md (768px) | 两列布局 |
| lg (1024px) | 三列定价卡片 |
| 1078px（自定义） | 导航栏从汉堡菜单切换为完整菜单 |

---

## 4. 后端服务（petclaw-api）

### 4.1 技术栈

| 技术 | 用途 |
|---|---|
| Node.js | 运行时 |
| Next.js API Routes | 框架（与官网共用 Next.js 项目，减少部署复杂度） |
| PostgreSQL | 数据库 |
| Prisma | ORM |
| Redis | 缓存/会话 |
| Stripe SDK | 订阅支付 |
| 微信支付 SDK | 国内支付 |
| Rewardful | 联盟计划 |
| Vercel / Railway | 部署 |

### 4.2 功能模块

**认证模块**：
- Google OAuth 2.0 登录
- 邮箱验证码登录（6 位数字）
- JWT Token 管理（access + refresh）
- 设备绑定

**支付模块**：
- Stripe 订阅管理（3 档套餐 × 月/年）
- 微信支付集成
- Webhook 处理（支付成功/失败/退订）
- 发票生成

**积分系统**：
- 月度配额：Basic 2,500 / Standard 6,000 / Pro 30,000
- 每日免费刷新 100 积分
- 消耗记录和统计
- Beta 期间下载赠送免费积分

**用户仪表板**：
- 当前订阅状态
- 积分使用量可视化
- 充值记录/发票
- 设备管理

**邀请系统**：
- 生成唯一邀请码
- 邀请码激活获得 Lite 会员
- 邀请双方各得 200 积分
- 每月邀请上限 10 人

**联盟计划**：
- Rewardful 集成
- 前 3 笔订阅 20% 持续佣金
- 最低提款 $100

---

## 5. 迭代路线图

### Phase 1：MVP（桌面应用核心）✅ 基本完成

**架构**：三窗口（Pet Bubble 待实现）
- **Pet Window**（180×145，透明，always on top）— 3D 猫咪 WebM 动画 + 气泡
- **Chat Window**（900×650，独立窗口）— 深色侧边栏 + 聊天/工具/设置视图
- **Pet Bubble Window**（TODO）— 工具动作气泡提示

**已完成**：
- ✅ 三窗口架构（Pet + Chat，Bubble 待做）
- ✅ 3D 猫咪 WebM 动画（9 个状态视频，双缓冲播放，过渡序列）
- ✅ 5 状态状态机（Idle/Thinking/Working/Happy/Dragging）+ 2 分钟自动睡眠
- ✅ Chat Window：深色侧边栏 + 对话历史 + 聊天视图 + 工具监控 + 设置
- ✅ 文字聊天（通过 Openclaw Gateway WebSocket）
- ✅ 系统托盘 + 全局快捷键（⌘⇧P 宠物 / ⌘⇧C 聊天）
- ✅ Hook 系统（监控 Claude Code，驱动猫咪状态动画）
- ✅ Onboarding 引导流程
- ✅ SQLite 本地存储（消息 / 会话）
- ✅ 应用配置文件（`petclaw-settings.json`）与 Openclaw 运行时配置（`openclaw.json`）分离
- ✅ macOS 构建配置（electron-builder）
- ✅ UI 设计系统：Lucide 图标、语义色彩 token、Tailwind v4

**设计系统**：Zinc 冷灰极简（#18181b 强调色 / #f8f8fa 根背景 / #f1f1f4 侧边栏）

**未完成**：BootCheck 启动检查、首次引导（5 步 Onboarding）、Pet Bubble 窗口、语音交互、Channels、定时任务、技能系统、记忆管理、多 AI 工具监控、Windows

### Phase 1.5：启动检查 + 首次引导

**BootCheck（每次启动）**：
- 5 步进度 UI（检测环境 → Node.js → 运行时 → 大模型配置 → Gateway 连接）
- 首次安装：自动下载 Node.js + Openclaw 到 `~/.petclaw/node/`
- 后续启动：秒过已有环境，直连 Gateway
- 失败处理：错误提示 + 重试按钮
- 运行时自动更新检测

**Onboarding 首次引导（仅新用户，BootCheck 之后）**：
- 5 步向导：权限设置 → 个人信息 → 技能推荐 → 语音快捷键 → 首次对话
- 左右分栏布局（左侧表单，右侧猫咪形象 + 对话气泡）
- 顶部语言切换 + 步骤进度条
- 底部跳过 / 上一步 / 下一步导航
- 详见 2.5.3 节

### Phase 2：语音交互 + 技能系统

- 语音输入：Openclaw Talk Mode（WebSocket 音频流）/ Whisper API
- 语音输出：Openclaw 内置 TTS / 系统原生 API
- 语音唤醒：全局快捷键（如 ⌘+D）
- 实时对话：流式 STT → AI → 流式 TTS，猫咪嘴巴动画同步
- 技能市场：展示 Openclaw ClawHub 可用技能
- 技能安装/卸载
- 自定义技能：用户通过自然语言"教"宠物新技能
- 猫咪动画增强：歪头思考、嘴巴说话、敲键盘、跳跃、困惑

### Phase 2.5：Openclaw 功能面板

> Channels、定时任务、技能、知识管理等能力由 Openclaw 运行时提供，Electron 侧只做 UI 面板对接。

- 技能面板：展示/安装/卸载 Openclaw skills
- 定时任务面板：展示/创建/管理 Openclaw cron jobs
- 频道面板：展示/连接/管理 Openclaw channels（WhatsApp/Telegram/Discord 等）
- 价格/订阅面板：当前套餐、积分用量、升级入口

### Phase 3：营销官网 + 后端服务

- Next.js 营销官网完整复刻（首页、定价、教程、登录等）
- 5 语言国际化
- 后端 API（认证、支付、积分、邀请）
- 用户仪表板
- Stripe + 微信支付集成
- 部署上线

### Phase 4：完整产品

- 持久记忆系统（本地 SQLite，AI 自动提取/回忆）
- 完整 9 种 AI 工具监控（Claude Code、Codex、Gemini CLI、Cursor、Copilot 等）
- 权限审批面板（CodeIsland 风格）
- CLI 命令体系：由 Openclaw 提供（`petclaw gateway/sessions/models/skills/channels` 等）
- 知识管理面板：对接 Openclaw 的 Obsidian/Notion 技能
- Windows 支持
- 自动更新（electron-updater + GitHub Releases）
- 屏幕边缘吸附 + 物理模拟

### Phase 5：扩展

- AI Provider 热切换（Openclaw ↔ Claude Code ↔ 直接 API）
- 多宠物皮肤/配饰
- Live Canvas（Openclaw A2UI 可视化工作区）
- Linux 支持
- 移动端伴侣应用（React Native）
- 插件系统（开放第三方开发者）

---

## 6. 项目结构

```
petclaw/
├── petclaw-desktop/           # Electron 桌面应用
│   ├── src/
│   │   ├── main/              # Electron 主进程
│   │   │   ├── index.ts       # 入口
│   │   │   ├── ai/            # AI 抽象层
│   │   │   │   ├── provider.ts      # AIProvider 接口
│   │   │   │   ├── openclaw.ts      # OpencLawProvider
│   │   │   │   ├── claude-code.ts   # ClaudeCodeProvider (后续)
│   │   │   │   └── direct-api.ts    # DirectAPIProvider (后续)
│   │   │   ├── hooks/         # Hook 系统
│   │   │   │   ├── server.ts        # HookServer (Unix Socket)
│   │   │   │   ├── installer.ts     # ConfigInstaller
│   │   │   │   └── bridge.ts        # petclaw-bridge
│   │   │   ├── system/        # 系统集成
│   │   │   │   ├── tray.ts          # 系统托盘
│   │   │   │   ├── shortcuts.ts     # 全局快捷键
│   │   │   │   └── updater.ts       # 自动更新
│   │   │   └── data/          # 数据层
│   │   │       ├── db.ts            # SQLite
│   │   │       └── store.ts         # 会话/记忆存储
│   │   └── renderer/          # React 渲染进程
│   │       ├── App.tsx
│   │       ├── pet/           # 宠物引擎
│   │       │   ├── PetCanvas.tsx    # PixiJS 画布
│   │       │   ├── animations/      # 动画资源/控制器
│   │       │   └── state-machine.ts # 宠物状态机
│   │       ├── panels/        # 交互面板
│   │       │   ├── ChatPanel.tsx
│   │       │   ├── MonitorPanel.tsx  # AI 工具监控
│   │       │   ├── SettingsPanel.tsx
│   │       │   ├── SkillsPanel.tsx
│   │       │   └── MemoryPanel.tsx
│   │       ├── onboarding/    # 引导流程
│   │       │   ├── LoginStep.tsx
│   │       │   ├── SetupStep.tsx
│   │       │   ├── PermissionStep.tsx
│   │       │   └── WelcomeStep.tsx
│   │       └── stores/        # Zustand 状态
│   ├── electron.vite.config.ts
│   └── package.json
│
├── petclaw-web/               # Next.js 营销官网 (Phase 3)
│   ├── app/[locale]/
│   ├── components/
│   ├── i18n/
│   └── package.json
│
├── petclaw-api/               # 后端服务 (Phase 3, 可与 web 合并)
│   ├── prisma/
│   ├── src/
│   └── package.json
│
├── .ai/                       # AI 协作文档主入口
│   └── README.md              # 所有 agent 共享规范
├── AGENTS.md                  # Codex 入口（薄入口，引用 .ai/README.md）
├── CLAUDE.md                  # Claude Code 入口（薄入口，引用 .ai/README.md）
├── .cursorrules               # Cursor 入口（引用 .ai/README.md）
│
└── petclaw-shared/            # 共享类型和工具
    ├── types/
    └── package.json
```

---

## 7. 关键依赖

### 桌面应用

| 包 | 版本 | 用途 |
|---|---|---|
| electron | ^33 | 桌面框架 |
| electron-vite | ^3 | 构建工具 |
| electron-builder | ^25 | 打包分发 |
| react | ^19 | UI |
| zustand | ^5 | 状态管理 |
| better-sqlite3 | ^11 | 本地数据库 |
| tailwindcss | ^4 | 样式 |
| lucide-react | ^1.8 | SVG 图标 |
| ws | ^8 | WebSocket 客户端（Openclaw 通信） |

### 营销官网

| 包 | 版本 | 用途 |
|---|---|---|
| next | ^15 | 框架 |
| react | ^19 | UI |
| next-intl | latest | 国际化 |
| tailwindcss | ^4 | 样式 |
| lucide-react | latest | 图标 |

### 后端

| 包 | 版本 | 用途 |
|---|---|---|
| prisma | latest | ORM |
| stripe | latest | 支付 |
| jsonwebtoken | latest | JWT |
| nodemailer | latest | 邮件验证码 |
