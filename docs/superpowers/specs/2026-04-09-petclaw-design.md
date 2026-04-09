# PetClaw 产品设计规格

> 日期：2026-04-09
> 状态：待审阅
> 目标：完整复刻 petclaw.ai 产品（桌面宠物应用 + 营销官网 + 后端服务）

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

| 层 | 技术 |
|---|---|
| 框架 | Electron 33+ |
| 前端 | React 19 + TypeScript |
| 构建 | Vite (electron-vite) |
| 动画引擎 | PixiJS 8 (2D 猫咪渲染) |
| 样式 | Tailwind CSS |
| 状态管理 | Zustand |
| 本地存储 | better-sqlite3 |
| IPC | Electron contextBridge |
| Hook 通信 | Node.js net (Unix Socket) |
| AI 集成 | Openclaw WebSocket Gateway + CLI spawn |
| 语音 | Web Speech API + Whisper API (后续) |
| 打包 | electron-builder |

### 2.2 架构

```
┌──────────────────────────────────────────────────┐
│              Electron 应用                        │
│                                                  │
│  ┌─── 主进程 (Main Process) ──────────────────┐  │
│  │                                            │  │
│  │  ┌──────────┐  ┌────────────────────────┐  │  │
│  │  │AI 抽象层 │  │ Hook Server            │  │  │
│  │  │          │  │ (Unix Socket)          │  │  │
│  │  │• Openclaw│  │ 监控 Claude Code、     │  │  │
│  │  │  Provider│  │ Codex、Cursor 等       │  │  │
│  │  │• Claude  │  │ (复用 CodeIsland 协议) │  │  │
│  │  │  Provider│  │                        │  │  │
│  │  │• Direct  │  │                        │  │  │
│  │  │  API     │  │                        │  │  │
│  │  └──────────┘  └────────────────────────┘  │  │
│  │                                            │  │
│  │  ┌──────────┐  ┌────────────────────────┐  │  │
│  │  │系统集成  │  │ 数据层                 │  │  │
│  │  │• 系统托盘│  │ • SQLite 本地存储      │  │  │
│  │  │• 全局快捷│  │ • 用户偏好/记忆        │  │  │
│  │  │• 自动更新│  │ • 会话历史             │  │  │
│  │  └──────────┘  └────────────────────────┘  │  │
│  └────────────────────────────────────────────┘  │
│         ↕ IPC (contextBridge)                    │
│  ┌─── 渲染进程 (Renderer) ────────────────────┐  │
│  │  React + TypeScript                        │  │
│  │                                            │  │
│  │  ┌──────────┐  ┌────────────────────────┐  │  │
│  │  │宠物引擎  │  │ 交互面板               │  │  │
│  │  │• PixiJS  │  │ • 聊天界面             │  │  │
│  │  │• 猫咪动画│  │ • AI 工具状态监控      │  │  │
│  │  │• 状态机  │  │ • 设置面板             │  │  │
│  │  │• 物理模拟│  │ • 技能/记忆管理        │  │  │
│  │  └──────────┘  └────────────────────────┘  │  │
│  └────────────────────────────────────────────┘  │
│         ↕ spawn / WebSocket                      │
│  ┌────────────────────────────────────────────┐  │
│  │   Openclaw (独立 Node.js 进程)              │  │
│  │   Gateway: ws://127.0.0.1:18789            │  │
│  │   AI 模型 │ 语音 │ 技能 │ 记忆             │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### 2.3 AI 集成（抽象层设计）

AI 能力通过接口抽象，支持后续热替换：

```typescript
interface AIProvider {
  connect(): Promise<void>
  chat(message: string): AsyncGenerator<string>
  talkMode(audioStream: ReadableStream): AsyncGenerator<AudioBuffer>
  getSkills(): Promise<Skill[]>
  getMemory(): Promise<Memory[]>
  disconnect(): void
}
```

**初期**：`OpencLawProvider` 通过 WebSocket 连接 Openclaw Gateway（ws://127.0.0.1:18789）。

**后续可选**：
- `ClaudeCodeProvider` — 通过 CLI spawn 调用本地 Claude Code
- `DirectAPIProvider` — 直接调用 Claude/OpenAI REST API

**Openclaw 生命周期**：
1. PetClaw 启动时检测 Openclaw 是否已运行
2. 未运行则 spawn 启动 Openclaw 进程
3. 通过 WebSocket 建立持久连接
4. PetClaw 退出时可选择保持或关闭 Openclaw

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

```
启动 PetClaw
    ↓
检测是否已登录 ──否──→ 登录页面 (Google OAuth / 邮箱验证码)
    ↓ 是                      ↓ 登录成功
检测环境是否就绪 ←────────────┘
    ↓ 未就绪
环境准备（进度展示）
  • 检查 Node.js
  • 安装 Openclaw 运行时
  • AI 模型配置
  • 启动 Gateway 连接
    ↓ 就绪
检测权限
  • 辅助功能权限 (macOS: Accessibility)
  • 麦克风权限
    ↓ 已授权
首次引导（仅新用户）
  • 昵称设置
  • 使用场景选择
  • 推荐技能展示
  • 语音测试 + 首次对话
    ↓
主界面：桌面宠物常驻
```

### 2.6 桌面宠物核心功能

| 功能 | 说明 |
|---|---|
| 透明窗口 | 无边框、透明背景，宠物浮在桌面上 |
| 猫咪动画 | PixiJS 渲染序列帧/Spine 动画：空闲、行走、睡觉、工作、思考、高兴、困惑、敲键盘 |
| 拖拽移动 | 鼠标拖拽宠物到桌面任意位置 |
| 屏幕边缘吸附 | 靠近边缘自动吸附（Phase 4） |
| 右键菜单 | 快捷操作：设置、静音、退出等 |
| 状态机 | 根据 AI 工作状态、时间、用户行为自动切换动画 |
| 物理模拟 | 猫咪有重力感，可"站"在窗口边缘（Phase 4） |

### 2.7 交互面板

点击宠物或使用快捷键弹出交互面板：

| 组件 | 功能 |
|---|---|
| 聊天界面 | 文字/语音输入，AI 流式回复展示，Markdown 渲染 |
| AI 工具监控 | CodeIsland 风格，显示各 AI 工具实时工作状态 |
| 权限审批卡 | AI 工具请求权限时弹出审批界面 |
| 技能管理 | 查看/安装/卸载技能，自定义技能教学 |
| 记忆管理 | 查看/编辑 AI 记住的信息 |
| 设置面板 | 语音快捷键、外观、AI 模型选择、Hook 配置 |

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

### Phase 1：MVP（桌面应用核心）

**包含**：
- Electron 透明窗口 + 猫咪基础动画（空闲、拖拽、工作中、思考中）
- 文字聊天（通过 Openclaw Gateway WebSocket）
- 系统托盘 + 全局快捷键
- 基础设置面板
- Hook 系统（监控 Claude Code）
- 登录 + 环境准备引导流程

**不包含**：语音交互、完整技能系统、记忆管理、多 AI 工具监控、Windows、官网、后端

### Phase 2：语音交互 + 技能系统

- 语音输入：Openclaw Talk Mode（WebSocket 音频流）/ Whisper API
- 语音输出：Openclaw 内置 TTS / 系统原生 API
- 语音唤醒：全局快捷键（如 Option+Space）
- 实时对话：流式 STT → AI → 流式 TTS，猫咪嘴巴动画同步
- 技能市场：展示 Openclaw ClawHub 可用技能
- 技能安装/卸载
- 自定义技能：用户通过自然语言"教"宠物新技能
- 猫咪动画增强：歪头思考、嘴巴说话、敲键盘、跳跃、困惑

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
| electron-vite | latest | 构建工具 |
| electron-builder | latest | 打包分发 |
| react | ^19 | UI |
| pixi.js | ^8 | 2D 动画渲染 |
| zustand | ^5 | 状态管理 |
| better-sqlite3 | latest | 本地数据库 |
| tailwindcss | ^4 | 样式 |

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
