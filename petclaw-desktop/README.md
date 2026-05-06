# PetClaw — AI 桌面宠物助理

<p align="center">
  <strong>一款 24/7 全天候运行的 AI 桌面宠物伴侣</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-brightgreen?style=for-the-badge" alt="Platform">
  <br>
  <img src="https://img.shields.io/badge/Electron-41-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
</p>

---

**PetClaw** 是一款 AI 桌面宠物助理。它以桌面宠物为交互入口，内置 Cowork 协作模式，能够帮你完成日常办公中的各类事务 —— 数据分析、文档撰写、搜索信息、收发邮件、定时任务，以及更多。

PetClaw 的核心是 **Cowork 模式**，它能在本地环境中执行工具、操作文件、运行命令，一切都在你的监督下自主完成。此外，PetClaw 支持通过微信、企业微信、钉钉、飞书等 IM 平台远程触发，让你在手机上也能随时指挥 Agent 工作。

## 核心特性

- **桌面宠物伴侣** — 始终陪伴的桌面宠物，通过动画和气泡实时反馈 AI 工作状态
- **Cowork 协作模式** — 以 OpenClaw 为引擎的 AI 工作会话，自主完成数据分析、文档生成等复杂任务
- **目录驱动 Agent** — 选择工作目录即自动派生 Agent，每个项目独立配置模型和技能
- **多 Provider 多模型** — 11 个预设供应商 + 自定义提供商，API Key 安全隔离存储
- **内置技能** — 可扩展的技能系统，支持目录级技能白名单
- **定时任务** — 支持对话式发起或 GUI 界面添加定时任务，Cron 调度
- **持久记忆** — 基于文件的记忆系统（MEMORY.md），跨会话记住用户偏好
- **MCP 服务器** — 支持 stdio / sse / streamable-http 三种传输协议
- **IM 远程操控** — 通过微信、企业微信、钉钉、飞书等在手机端随时触发 Agent
- **权限门控** — 所有敏感工具调用需用户明确批准后执行
- **跨平台** — macOS（Intel + Apple Silicon）、Windows、Linux
- **数据本地化** — SQLite 本地存储，聊天记录和配置不离开你的设备

## 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Main Process                    │
│                                                             │
│  ┌─────────────── 基础层 ──────────────────────────────────┐ │
│  │ OpenclawEngineManager │ OpenclawGateway │ ConfigSync    │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌─────────────── 核心层 ──────────────────────────────────┐ │
│  │ DirectoryManager │ CoworkSessionManager │ CoworkController │
│  └────────────────────────────────────────────────────────┘ │
│  ┌─────────────── 功能层 ──────────────────────────────────┐ │
│  │ SkillManager │ ModelRegistry │ MemoryManager │ McpMgr   │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌─────────────── 集成层 ──────────────────────────────────┐ │
│  │ ImGateway │ SchedulerManager                            │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌─────────────── 工程层 ──────────────────────────────────┐ │
│  │ BootCheck │ Database │ IPC Router │ i18n                │ │
│  └────────────────────────────────────────────────────────┘ │
├──────────────── contextBridge (preload) ─────────────────────┤
│                     Renderer Process                         │
│  Pet Window (桌面宠物)  │  Main Window (聊天/设置/IM/Cron)    │
└─────────────────────────────────────────────────────────────┘
        ↕ utilityProcess.fork()
┌─────────────────────────────────────────────────────────────┐
│              Openclaw Runtime (动态端口 + token)              │
└─────────────────────────────────────────────────────────────┘
```

## 快速开始

### 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 24 < 25 | Electron 41 要求 |
| pnpm | >= 9 | Monorepo 包管理 |
| Git | >= 2.30 | Openclaw 源码管理 |

### 安装与开发

执行目录：仓库根目录 `petclaw/`。

```bash
# 克隆仓库
git clone https://github.com/XuxuGood/petclaw.git
cd petclaw

# 安装依赖
pnpm install

# 启动开发环境（Vite 开发服务器 + Electron 热重载）
pnpm --filter petclaw-desktop dev
```

PetClaw 使用 [OpenClaw](https://github.com/openclaw/openclaw) 作为 Agent 引擎。所依赖的 OpenClaw 版本在 `petclaw-desktop/package.json` 的 `openclaw.version` 字段中声明。

执行目录：仓库根目录 `petclaw/`。

```bash
# 首次运行：自动克隆并构建 OpenClaw（可能需要几分钟）
pnpm --filter petclaw-desktop dev:openclaw

# 后续运行：如果锁定版本未变，自动跳过构建
pnpm --filter petclaw-desktop dev:openclaw
```

默认 OpenClaw 源码会被克隆/管理在 `../openclaw`（相对于本仓库）。可通过环境变量覆盖：

执行目录：仓库根目录 `petclaw/`。

```bash
OPENCLAW_SRC=/path/to/openclaw pnpm --filter petclaw-desktop dev:openclaw
```

强制重新构建（即使版本未变）：

执行目录：仓库根目录 `petclaw/`。

```bash
OPENCLAW_FORCE_BUILD=1 pnpm --filter petclaw-desktop dev:openclaw
```

跳过自动版本切换（如需本地开发 OpenClaw 时）：

执行目录：仓库根目录 `petclaw/`。

```bash
OPENCLAW_SKIP_ENSURE=1 pnpm --filter petclaw-desktop dev:openclaw
```

### 代码质量

执行目录：仓库根目录 `petclaw/`。

```bash
npm run typecheck                              # workspace 全量类型检查
npm test                                       # workspace 全量测试
pnpm --filter petclaw-desktop lint             # ESLint 代码检查
pnpm --filter petclaw-desktop test -- config-sync   # 只跑指定模块的测试
```

git commit 时自动触发 lint-staged（prettier + eslint）、GitNexus 变更影响分析和 commitlint（conventional commits）。GitNexus 未安装时默认只提示并跳过，不阻断提交。

### AI 代码上下文工程

PetClaw 使用 GitNexus、Serena、项目级 `.mcp.json`、客户端 MCP 模板和 Husky hooks 组成 AI 代码上下文工具链。开发者首次拉取项目后初始化一次即可；日常切分支、merge、rebase 和提交由 Husky 自动处理索引刷新和变更影响分析。AI 改代码前会自动运行上下文准备脚本，通常不需要人工介入。

执行目录：仓库根目录 `petclaw/`。

开发者日常只需要关心两条命令：

```bash
pnpm ai:setup -- --client codex                # 首次接入执行一次
pnpm ai:doctor                                 # 工具链异常时深度诊断
```

下面这些命令一般不需要人工执行，由 AI 或 Husky 自动调用：

```bash
pnpm ai:prepare-change                         # AI 写文件前自动准备上下文
pnpm ai:impact                                 # pre-commit 自动分析 staged 影响面
pnpm ai:index                                  # checkout / merge / rewrite 后自动检查索引
```

只有排障或修复 MCP 接入时才使用：

```bash
pnpm ai:mcp:install -- --client codex          # 修复/重装 Codex MCP 配置
pnpm ai:mcp:guide -- --client claude-code      # 查看指定客户端接入说明
pnpm ai:tools:check                            # 快速状态检查
pnpm ai:serena:dashboard                       # 查看当前 Serena Dashboard 地址
```

完整设计见 [`docs/架构设计/engineering/AI代码上下文工程设计.md`](../docs/架构设计/engineering/AI代码上下文工程设计.md)。渲染进程、Preload API 和桌面 UI/UX 边界见 [`docs/架构设计/desktop/foundation/Renderer架构设计.md`](../docs/架构设计/desktop/foundation/Renderer架构设计.md)。

## 打包分发

使用 [electron-builder](https://www.electron.build/) 生成各平台安装包，输出到 `release/` 目录。
正式分发统一使用 `dist:*` 命令；本地只验证真实 Electron 应用壳时使用 `package:dir`。

执行目录：仓库根目录 `petclaw/`。

```bash
# 本地应用壳验收，不生成 dmg/zip/安装包
pnpm --filter petclaw-desktop run package:dir

# 生成后按当前平台启动 unpacked app：
# macOS: open -n petclaw-desktop/release/mac*/PetClaw.app
# Windows: petclaw-desktop/release/win-unpacked/PetClaw.exe
# Linux: petclaw-desktop/release/linux-unpacked/PetClaw

# macOS - Apple Silicon
pnpm --filter petclaw-desktop dist:mac:arm64

# macOS - Intel
pnpm --filter petclaw-desktop dist:mac:x64

# Windows (.exe NSIS 安装包)
pnpm --filter petclaw-desktop dist:win:x64

# Linux (.AppImage)
pnpm --filter petclaw-desktop dist:linux:x64
```

打包时会自动把预构建的 OpenClaw runtime 内置到 `Resources/petmind`。锁定的 OpenClaw 版本在打包时自动拉取并构建，无需手动操作。构建结果带缓存：如果本地已存在对应版本的 runtime，构建步骤会自动跳过。

也可以手动构建 OpenClaw runtime：

执行目录：仓库根目录 `petclaw/`。

```bash
# 按当前主机平台自动选择 target
pnpm --filter petclaw-desktop openclaw:runtime:host

# 显式指定目标平台
pnpm --filter petclaw-desktop openclaw:runtime:mac-arm64
pnpm --filter petclaw-desktop openclaw:runtime:win-x64
pnpm --filter petclaw-desktop openclaw:runtime:linux-x64
```

## 完整开发流程

执行目录：仓库根目录 `petclaw/`。下方所有命令都从该目录执行，除非注释明确说明切换目录。

```bash
# ═══════════════════════════════════════════════
# 阶段 1：首次环境搭建（只需执行一次）
# ═══════════════════════════════════════════════

git clone https://github.com/XuxuGood/petclaw.git
cd petclaw
pnpm install                                        # 安装 monorepo 全部依赖

pnpm --filter petclaw-desktop dev:openclaw          # 首次运行：自动 clone openclaw 源码 + 完整构建
                                                    # 内部执行顺序：
                                                    #   1. openclaw:ensure    — git clone ../openclaw && checkout 锁定版本
                                                    #   2. openclaw:patch     — 应用 scripts/patches/<version>/ 下的 patch
                                                    #   3. openclaw:runtime:host — 按当前主机平台构建，包含以下子步骤：
                                                    #      a. build-openclaw-runtime  — pnpm install → tsc → 打包 asar → 生成入口
                                                    #      b. sync-openclaw-current   — symlink current/ → 当前平台目录
                                                    #      c. bundle-openclaw-gateway — esbuild 打包 gateway
                                                    #      d. ensure-openclaw-plugins — 下载 IM 插件（飞书/钉钉等）
                                                    #      e. sync-local-extensions   — symlink 本地扩展
                                                    #      f. precompile-extensions   — esbuild 预编译 TS 扩展
                                                    #      g. install-channel-deps    — 修复 channel 缺失依赖
                                                    #      h. prune-openclaw-runtime  — 裁剪体积（删 .map/.d.ts, stub 未用包）
                                                    # 然后启动 Vite dev server + Electron

# ═══════════════════════════════════════════════
# 阶段 2：日常开发（每天重复）
# ═══════════════════════════════════════════════

pnpm --filter petclaw-desktop dev:openclaw          # 检测 runtime 版本匹配 → 跳过构建 → 直接启动
# 或
pnpm --filter petclaw-desktop dev                   # 只启动前端+Electron，不检查 Openclaw（纯 UI 开发时用）

# 特殊场景：
OPENCLAW_FORCE_BUILD=1 pnpm --filter petclaw-desktop dev:openclaw   # 强制重建（改了 openclaw 源码后）
OPENCLAW_SKIP_ENSURE=1 pnpm --filter petclaw-desktop dev:openclaw   # 跳过版本切换（本地调试 openclaw 时）
OPENCLAW_SRC=/other/path pnpm --filter petclaw-desktop dev:openclaw # 指定 openclaw 源码路径

# ═══════════════════════════════════════════════
# 阶段 3：提交前检查
# ═══════════════════════════════════════════════

npm run typecheck                                   # workspace 全量类型检查
npm test                                            # workspace 全量测试
pnpm --filter petclaw-desktop lint                  # ESLint 代码检查
pnpm --filter petclaw-desktop test -- config-sync   # 只跑指定模块的测试

# git commit 时自动触发 lint-staged（prettier + eslint）+ commitlint（conventional commits）
# git commit 时还会运行 GitNexus 暂存区变更影响分析；默认宽松降级，严格模式可设置 PETCLAW_AI_IMPACT_STRICT=1

# ═══════════════════════════════════════════════
# 阶段 4：升级 Openclaw 版本
# ═══════════════════════════════════════════════

vim petclaw-desktop/package.json                    # 修改 openclaw.version
pnpm --filter petclaw-desktop dev:openclaw          # 自动检测版本变更 → 重新 checkout + 完整构建

# ═══════════════════════════════════════════════
# 阶段 5：本地应用壳验收（可选）
# ═══════════════════════════════════════════════
# package:dir 命令内部流程：electron-vite build → electron-builder --dir
# 它用于验证 Dock/Finder/Application Menu、Info.plist 和资源拷贝，不生成 dmg/zip/安装包。

pnpm --filter petclaw-desktop run package:dir
# 本地验收启动：
#   macOS: open -n petclaw-desktop/release/mac*/PetClaw.app
#   Windows: petclaw-desktop/release/win-unpacked/PetClaw.exe
#   Linux: petclaw-desktop/release/linux-unpacked/PetClaw

# ═══════════════════════════════════════════════
# 阶段 6：生产打包
# ═══════════════════════════════════════════════
# dist:* 命令内部流程：electron-vite build → openclaw:runtime:<target> → openclaw:finalize → electron-builder
# openclaw:finalize 仅在生产打包时执行，将 gateway 打包为 asar 加速 Electron 加载

pnpm --filter petclaw-desktop dist:mac:arm64        # → release/PetClaw-x.y.z-arm64.dmg
pnpm --filter petclaw-desktop dist:mac:x64          # → release/PetClaw-x.y.z-x64.dmg
pnpm --filter petclaw-desktop dist:win:x64          # → release/PetClaw-x.y.z-Setup.exe
pnpm --filter petclaw-desktop dist:linux:x64        # → release/PetClaw-x.y.z.AppImage

# ═══════════════════════════════════════════════
# 阶段 7：发布（CI 自动 or 手动）
# ═══════════════════════════════════════════════

git tag v1.0.0
git push origin v1.0.0                              # 推送 tag → 触发 GitHub Actions
                                                    # CI：install → openclaw:runtime → dist → 上传 Release
                                                    # 用户端：electron-updater 检测新版本 → 后台下载 → 提示安装
```

## 架构概览

PetClaw 采用 Electron 严格进程隔离架构（`nodeIntegration: false`、`contextIsolation: true`），六层分层设计。

### 进程模型

**Main Process**（`src/main/index.ts`）：
- Pet / Main 双窗口生命周期管理
- SQLite 数据持久化（better-sqlite3）
- OpenClaw Agent 引擎（utilityProcess.fork 启动，动态端口 + token 认证）
- ConfigSync 配置同步（openclaw.json、AGENTS.md、exec-approvals.json）
- IM 网关 — 微信、企业微信、钉钉、飞书远程接入
- 76 个 IPC 通道处理（safeHandle/safeOn 防重复注册）

**Preload Script**（`src/preload/index.ts`）：
- 通过 `contextBridge` 暴露 `window.api` 命名空间
- 包含 `cowork` 命名空间用于会话管理和流式事件

**Renderer Process**（`src/renderer/`）：
- React 19 + Zustand + Tailwind CSS 4
- Pet Window（桌面宠物 PixiJS 动画 + 状态机）
- Main Window（聊天 / 设置 / 技能 / IM / 定时任务 / 引导）

### 目录结构

```
petclaw/
├── petclaw-desktop/                    # Electron 桌面应用
│   ├── src/
│   │   ├── main/                       # Electron 主进程
│   │   │   ├── index.ts                #   启动编排、BootCheck、IPC 注册时机
│   │   │   ├── windows.ts              #   Pet/Main 双窗口创建与管理
│   │   │   ├── runtime-services.ts     #   Gateway / Cowork / Cron 服务组装
│   │   │   ├── ai/                     #   AI 核心（引擎、网关、配置同步、协作控制）
│   │   │   ├── ipc/                    #   模块化 IPC handlers（76 个 channel）
│   │   │   │   ├── ipc-registry.ts     #     safeHandle/safeOn 防重复注册守卫
│   │   │   │   ├── chat-ipc.ts         #     Cowork 会话 IPC
│   │   │   │   ├── models-ipc.ts       #     模型供应商 IPC
│   │   │   │   └── ...                 #     directory/skills/mcp/memory/scheduler/im/...
│   │   │   ├── data/                   #   SQLite Repository 层
│   │   │   ├── models/                 #   模型供应商注册表
│   │   │   ├── skills/                 #   技能扫描与管理
│   │   │   ├── mcp/                    #   MCP 服务器管理
│   │   │   ├── memory/                 #   记忆文件读写
│   │   │   ├── scheduler/              #   定时任务调度
│   │   │   ├── im/                     #   IM 平台配置与会话路由
│   │   │   ├── pet/                    #   PetEventBridge 多源事件聚合
│   │   │   └── hooks/                  #   HookServer（外部事件接入）
│   │   ├── renderer/src/               # React 前端
│   │   │   ├── views/chat/             #   Cowork 对话主界面
│   │   │   ├── views/settings/         #   设置面板
│   │   │   ├── views/cron/             #   定时任务管理
│   │   │   ├── views/im/              #   IM 频道配置
│   │   │   ├── pet/                    #   宠物窗口（PixiJS + 状态机）
│   │   │   ├── stores/                 #   Zustand 状态管理
│   │   │   └── components/             #   共享组件
│   │   └── preload/                    # contextBridge 安全桥接
│   ├── resources/                      # 应用资源
│   └── tests/                          # 镜像源码结构的测试
├── petclaw-shared/                     # 共享类型、常量、i18n 翻译资源
├── petclaw-web/                        # Next.js 营销官网
├── petclaw-api/                        # 后端服务
├── docs/                               # 文档
│   ├── 架构设计/                         #   总体架构与模块设计
│   ├── superpowers/                    #   阶段性 specs / plans
│   └── 设计/                            #   UI 设计稿与素材
├── CLAUDE.md                           # Claude Code 工作指南
└── AGENTS.md                           # Codex 工作指南
```

## Cowork 系统

Cowork 是 PetClaw 的核心功能 —— 以 OpenClaw 为引擎的 AI 工作会话系统。

### 流式事件

Cowork 通过 IPC 事件实现实时双向通信：

- `cowork:stream:message` — 新消息加入会话
- `cowork:stream:message-update` — 流式内容增量更新
- `cowork:stream:permission` — 工具执行需要用户审批
- `cowork:stream:complete` — 会话执行完毕
- `cowork:stream:error` — 执行出错

### 权限控制

所有涉及文件系统、终端命令、网络请求的工具调用都需要用户明确批准。支持单次批准和会话级批准。

## 定时任务

PetClaw 支持创建定时任务，让 Agent 按计划自动执行重复性工作。

- **对话式创建** — 直接用自然语言告诉 Agent（如「每天早上 9 点帮我收集科技新闻」）
- **GUI 界面创建** — 在定时任务管理面板中手动添加，可视化配置执行时间和任务内容

定时任务基于 Cron 表达式调度，支持分钟、小时、日、周、月等多种周期粒度。任务执行时会自动启动 Cowork 会话，结果可通过桌面端查看或经 IM 推送到手机。

## IM 集成

PetClaw 支持将 Agent 桥接到多种 IM 平台。在手机上通过 IM 发送消息即可远程触发桌面端的 Agent 执行任务。

| 平台 | 协议 | 说明 |
|------|------|------|
| 微信 | OpenClaw 网关 | 微信账号接入，支持私聊与群聊 |
| 企业微信 | OpenClaw 网关 | 企业微信应用机器人 |
| 钉钉 | DingTalk Stream | 企业机器人双向通信，支持多实例 |
| 飞书 | Lark SDK | 飞书/Lark 应用机器人，支持多实例 |

在设置面板中配置对应平台的 Token/密钥即可启用。

## 数据存储

所有数据存储在本地 SQLite 数据库，位于用户数据目录。

| 表 | 用途 |
|----|------|
| `app_config` | 全局配置键值对 |
| `directories` | 工作区目录（Agent 自动派生） |
| `model_providers` | 模型供应商配置 |
| `model_provider_secrets` | 供应商 API Key（隔离存储） |
| `cowork_sessions` | AI 协作会话元数据 |
| `cowork_messages` | 会话消息历史 |
| `mcp_servers` | MCP 服务器配置 |
| `im_instances` | IM 平台实例 |
| `im_conversation_bindings` | IM 对话级目录绑定 |
| `im_session_mappings` | IM 对话→Cowork 会话映射 |
| `scheduled_task_meta` | 定时任务元数据 |

## 安全模型

- **进程隔离** — `nodeIntegration: false`、`contextIsolation: true`、sandbox 启用
- **权限门控** — 敏感工具调用需用户明确审批
- **工作区边界** — 文件操作限制在指定工作目录内
- **API Key 隔离** — 密钥单独存表，不随普通配置读取带出
- **IPC 防重复** — safeHandle/safeOn 注册守卫，两阶段注册架构

## 技术栈

| 层 | 技术 |
|----|------|
| 框架 | Electron 41 |
| 前端 | React 19 + TypeScript |
| 构建 | electron-vite + Vite 6 |
| 样式 | Tailwind CSS 4 |
| 状态 | Zustand 5 |
| AI 引擎 | OpenClaw（随应用捆绑） |
| 存储 | better-sqlite3 |
| 宠物动画 | PixiJS 8 |
| Markdown | react-markdown + remark-gfm + rehype-katex |
| 安全 | DOMPurify |
| 日志 | electron-log |
| IM | @larksuiteoapi/node-sdk、OpenClaw 网关 |

## 国际化

支持中文（默认）和英文，通过设置面板切换。翻译资源集中在 `petclaw-shared/src/i18n/locales/`，供 desktop、web、api 复用。

## OpenClaw 版本管理

PetClaw 将 OpenClaw 依赖锁定到指定的 release 版本：

```jsonc
// petclaw-desktop/package.json
{
  "openclaw": {
    "version": "v2026.4.26",
    "repo": "https://github.com/openclaw/openclaw.git"
  }
}
```

### Patch 机制

PetClaw 通过 `scripts/patches/<version>/` 目录维护对 OpenClaw 源码的定制补丁。每次构建 runtime 时，`apply-openclaw-patches.cjs` 会自动将当前锁定版本对应的 patch 应用到 OpenClaw 源码树：

```
scripts/patches/
├── v2026.4.14/                         # 旧版本 patch（回退时使用）
│   ├── openclaw-cron-skip-missed-jobs.patch
│   └── ...
└── v2026.4.26/                         # 当前版本 patch
    ├── openclaw-cron-skip-missed-jobs.patch       # 重启时跳过已错过的 cron 任务
    ├── openclaw-deepseek-v4-thinking-mode.patch   # DeepSeek V4 thinking 模式控制
    ├── openclaw-disable-model-pricing-bootstrap.patch  # 跳过 model pricing 加载
    ├── openclaw-facade-runtime-static-import.patch     # 静态导入支持 esbuild bundling
    ├── openclaw-llm-request-debug-log.patch            # LLM 请求调试日志
    └── openclaw-memory-atomic-reindex-ebusy-retry.patch  # Windows EBUSY 重试
```

Patch 脚本可安全重复运行——已应用的 patch 会自动跳过。升级 OpenClaw 版本时，需要在新版本目录下重新生成或适配 patch。

手动应用 patch：

```bash
pnpm --filter petclaw-desktop openclaw:patch
```

| 环境变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENCLAW_SRC` | OpenClaw 源码目录路径 | `../openclaw` |
| `OPENCLAW_FORCE_BUILD` | 设为 `1` 强制重新构建 | — |
| `OPENCLAW_SKIP_ENSURE` | 设为 `1` 跳过自动版本切换 | — |

## 测试

单元测试使用 [Vitest](https://vitest.dev/)，测试文件镜像源码目录结构。

```bash
# 运行全部测试
npm test

# 只运行指定模块的测试
pnpm --filter petclaw-desktop test -- config-sync
pnpm --filter petclaw-desktop test -- bootcheck
```

测试文件放在 `tests/` 目录，镜像 `src/` 结构：

```
tests/main/
├── ai/
│   └── config-sync.test.ts
├── ipc/
│   └── chat-ipc.test.ts
├── bootcheck.test.ts
└── windows.test.ts
```

## 开发规范

- TypeScript 严格模式，禁止 `any`，使用 `unknown` + 类型收窄
- React 函数声明组件，Hooks 顺序：useState → useRef → useEffect → useCallback → useMemo
- Zustand 状态管理，Actions 只做 `set()`，副作用放组件或服务层
- Tailwind CSS 优先，禁止硬编码 hex，圆角只用 `rounded-[10px]` / `rounded-[14px]`
- 文件命名：主进程 `kebab-case.ts`，组件 `PascalCase.tsx`
- 提交信息遵循 conventional commits 格式（`feat:` / `fix:` / `chore:` / `refactor:`）
- 中文注释，说明"为什么这样做"

## 文档

| 文档 | 说明 |
|------|------|
| `CLAUDE.md` | Claude Code 工作指南（执行规则 + 项目上下文） |
| `AGENTS.md` | Codex 工作指南 |
| `docs/架构设计/PetClaw架构总览.md` | 总体架构地图 |
| `docs/架构设计/desktop/README.md` | desktop 分层架构入口 |
| `docs/superpowers/specs/` | 阶段性设计规格 |
| `docs/superpowers/plans/` | 实施计划 |
