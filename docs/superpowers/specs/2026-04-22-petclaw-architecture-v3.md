# PetClaw 架构设计 v3 — 全功能蓝图

**日期**: 2026-04-22
**状态**: 设计完成，待实现
**范围**: 运行时管理、多 Agent、Cowork 模式、模型配置、持久记忆、MCP 服务器、IM 机器人、定时任务、聊天输入框、Openclaw 版本管理、开发到上线流程

---

## 目录

1. [设计目标](#1-设计目标)
2. [总体架构](#2-总体架构)
3. [核心概念](#3-核心概念)
4. [基础层 — OpenclawEngineManager](#4-基础层--openclawenginemanager)
5. [基础层 — OpenclawGateway](#5-基础层--openclawgateway)
6. [基础层 — ConfigSync](#6-基础层--configsync)
7. [核心层 — AgentManager](#7-核心层--agentmanager)
8. [核心层 — SessionManager](#8-核心层--sessionmanager)
9. [核心层 — CoworkController](#9-核心层--coworkcontroller)
10. [功能层 — SkillManager](#10-功能层--skillmanager)
11. [功能层 — ModelRegistry](#11-功能层--modelregistry)
12. [功能层 — MemoryManager](#12-功能层--memorymanager)
13. [功能层 — McpManager](#13-功能层--mcpmanager)
14. [集成层 — ImGateway](#14-集成层--imgateway)
15. [集成层 — SchedulerManager](#15-集成层--schedulermanager)
16. [工程层 — BootCheck 初始化](#16-工程层--bootcheck-初始化)
17. [工程层 — Database](#17-工程层--database)
18. [工程层 — IPC Router](#18-工程层--ipc-router)
19. [前端层 — ChatInputBox](#19-前端层--chatinputbox)
20. [Openclaw 版本管理](#20-openclaw-版本管理)
21. [启动流程](#21-启动流程)
22. [数据流](#22-数据流)
  - 22.1 用户发送消息
  - 22.2 IM 消息流
  - 22.3 定时任务触发
  - 22.4 宠物动画联动
23. [文件结构](#23-文件结构)
24. [开发到上线流程](#24-开发到上线流程)
25. [实现分期](#25-实现分期)
26. [验证标准](#26-验证标准)

---

## 1. 设计目标

将 PetClaw 从"简化 WebSocket 客户端 + 硬编码单模型"升级为**功能完备的 AI 桌面助理**，对标 LobsterAI 全功能集：

1. **运行时管理** — 捆绑 Openclaw runtime，`utilityProcess.fork()` 启动，动态端口、健康检查、自动重启
2. **多 Agent** — DB 持久化，预设 + 自定义 Agent，每个 Agent 独立 system_prompt / model / skills / IM 渠道
3. **Cowork 模式** — 执行模式（auto/local）、Exec Approval 权限审批、流式事件协议
4. **多 Provider 多 Model** — 11 个预设 + 自定义提供商，API Key 安全存储，测试连接
5. **持久记忆** — 纯文件驱动（MEMORY.md + daily notes），Agent 自主读写
6. **MCP 服务器** — stdio/sse/streamable-http 三种传输，DB 持久化，ConfigSync 集成
7. **IM 机器人** — 10 个平台（微信/企微/钉钉/飞书/QQ/Telegram/Discord/云信/POPO/邮件），多实例
8. **定时任务** — Cron 调度，对话式 + GUI 创建，IM 推送
9. **聊天输入框** — 工作目录选择、文件附件预览、多技能选择、发送快捷键
10. **Openclaw 版本管理** — package.json 锁定版本，自动构建缓存
11. **完整工程链** — 开发 → 打包 → 分发 → 自动更新

### 参考来源

- LobsterAI 源码（sqliteStore.ts、imStore.ts、im/types.ts、coworkStore.ts、FolderSelectorPopover.tsx、AttachmentCard.tsx、CoworkPromptInput.tsx）
- Openclaw Gateway 协议（129 RPC + 22 事件）
- PetClaw 设计稿（模型配置、IM 机器人、多 Agent、Agent 配置）

---

## 2. 总体架构

六层分层架构：基础层 → 核心层 → 功能层 → 集成层 → 工程层 → 前端层。

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Main Process                    │
│                                                             │
│  ┌─────────────── 基础层 ──────────────────────────────────┐ │
│  │ OpenclawEngineManager │ OpenclawGateway │ ConfigSync    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─────────────── 核心层 ──────────────────────────────────┐ │
│  │ AgentManager │ SessionManager │ CoworkController        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─────────────── 功能层 ──────────────────────────────────┐ │
│  │ SkillManager │ ModelRegistry │ MemoryManager │ McpMgr   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─────────────── 集成层 ──────────────────────────────────┐ │
│  │ ImGateway │ SchedulerManager                            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─────────────── 工程层 ──────────────────────────────────┐ │
│  │ BootCheck │ Database │ IPC Router                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
├──────────────── contextBridge (preload) ─────────────────────┤
│                                                             │
│  ┌─────────────── 前端层 ──────────────────────────────────┐ │
│  │ ChatInputBox │ Settings │ AgentSidebar │ PetCanvas      │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         ↕ WebSocket (GatewayClient)
┌─────────────────────────────────────────────────────────────┐
│     Openclaw Runtime (utilityProcess / bundled)               │
│  · LLM 调用 · Tool 执行 · Skill prompt 注入 · Session 管理   │
└─────────────────────────────────────────────────────────────┘
```

### 模块职责总览

| 层 | 模块 | 职责 |
|----|------|------|
| 基础 | **OpenclawEngineManager** | Runtime 生命周期（resolve/start/stop/restart/health） |
| 基础 | **OpenclawGateway** | 动态加载 GatewayClient，RPC + 事件分发 |
| 基础 | **ConfigSync** | 唯一写入 openclaw.json 的模块 |
| 核心 | **AgentManager** | 多 Agent CRUD，预设 + 自定义，DB 持久化 |
| 核心 | **SessionManager** | 会话生命周期，绑定 Agent + workspace + model |
| 核心 | **CoworkController** | 执行模式、Exec Approval、流式事件协议 |
| 功能 | **SkillManager** | Skill 扫描/安装/卸载/启用/禁用 |
| 功能 | **ModelRegistry** | Provider/Model CRUD，预设 + 自定义提供商 |
| 功能 | **MemoryManager** | 纯文件记忆（MEMORY.md），读写接口 |
| 功能 | **McpManager** | MCP 服务器配置，三种传输协议 |
| 集成 | **ImGateway** | 10 平台 IM 接入，多实例，会话路由 |
| 集成 | **SchedulerManager** | Cron 定时任务调度 |
| 工程 | **BootCheck** | 目录创建、内置 skills 初始化 |
| 工程 | **Database** | SQLite 持久化（better-sqlite3） |
| 工程 | **IPC Router** | 模块化 IPC handler 注册 |
| 前端 | **ChatInputBox** | 输入框 + cwd + 附件 + 技能选择 + 发送 |
| 前端 | **PetEventBridge** | 多源事件聚合 → 统一驱动宠物状态机（§22.4） |

---

## 3. 核心概念

### 3.1 Workspace vs 工作目录

- **Openclaw Workspace** = Agent 的"人格和工具"所在地（SOUL.md、AGENTS.md 等）
- **工作目录** = 用户选择的项目路径
- 在 Openclaw 中，workspace = 用户选择的工作目录

### 3.2 Skills 与 Workspace 的关系

Skills **不跟着 workspace 走**，全局统一管理：

```
Skills 存放: {userData}/SKILLs/
注入方式:    openclaw.json → skills.load.extraDirs = ["{userData}/SKILLs"]
```

### 3.3 Session Key 格式

```
agent:{agentId}:petclaw:{sessionId}
```

### 3.4 多 Agent 模型

```
默认 → main agent（workspace = {userData}/openclaw/state/workspace）
自定义 Agent A → 独立 system_prompt / model / skills
自定义 Agent B → 独立配置
```

每个 Agent 可绑定不同的 IM 渠道，IM 消息按 platform → Agent 路由。

---

## 4. 基础层 — OpenclawEngineManager

管理 Openclaw runtime 的完整生命周期：解析 → 启动 → 健康检查 → 运行 → 重启/停止。

**文件**: `src/main/ai/engine-manager.ts`

### 4.1 状态机

```
not_installed ──(bundled runtime 缺失)──→ error
not_installed ──(发现 runtime)──→ ready
ready ──(startGateway)──→ starting
starting ──(健康检查通过)──→ running
starting ──(超时/失败)──→ error
running ──(进程意外退出)──→ error ──(自动重启)──→ starting
running ──(stopGateway)──→ ready
error ──(手动 restartGateway)──→ starting
```

```typescript
type EnginePhase = 'not_installed' | 'installing' | 'ready' | 'starting' | 'running' | 'error'

interface EngineStatus {
  phase: EnginePhase
  version: string | null
  progressPercent?: number    // starting 阶段 10→90 渐进
  message?: string            // 最长 500 字符
  canRetry: boolean           // 前端据此显示"重试"按钮
}
```

前端通过 IPC channel `engine:status` 订阅状态变化，状态变更时 `emit('status', engineStatus)`。

### 4.2 文件系统路径总览

PetClaw 的文件分布在两个独立位置，**职责和读写权限完全隔离**：

> **`{userData}` 约定**：本文档中 `{userData}` 代表 `app.getPath('userData')`，即各平台的标准应用数据目录：
> - macOS: `~/Library/Application Support/PetClaw/`
> - Windows: `%APPDATA%/PetClaw/`
> - Linux: `~/.config/PetClaw/`

```
┌─── App 安装目录（只读，macOS 签名后不可修改）───────────────────────┐
│                                                                    │
│  Resources/                                                        │
│  ├── petmind/                  ← Openclaw 引擎（utilityProcess 入口）│
│  │   ├── gateway-bundle.mjs    ← 引擎可执行文件（~28MB）            │
│  │   ├── skills/               ← 引擎内置 52 skills（引擎自动加载） │
│  │   └── ...                                                       │
│  ├── SKILLs/                   ← PetClaw 定制 28 skills（待同步）   │
│  └── openclaw-extensions/      ← 本地扩展（ask-user-question 等）   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
         │ fork()          │ syncBuiltinSkills()
         ▼                 ▼
┌─── {userData}（可写，用户数据目录）───────────────────────────────────┐
│                                                                    │
│  ├── petclaw.db                ← SQLite 数据库                     │
│  ├── openclaw/state/           ← 引擎运行时状态                    │
│  │   ├── openclaw.json         ← 运行时配置（ConfigSync 写入）      │
│  │   ├── gateway-port.json     ← 端口信息                          │
│  │   ├── gateway-token         ← 认证 token                        │
│  │   ├── agents/               ← Agent 配置                        │
│  │   ├── workspace/            ← Agent 工作目录（USER.md, memory/） │
│  │   ├── logs/                 ← 引擎日志                          │
│  │   └── bin/                  ← CLI shim（petclaw/openclaw/claw）  │
│  ├── SKILLs/                   ← PetClaw 定制 skills（从 Resources 同步）│
│  │                               + 用户自定义 skills                │
│  ├── cowork/bin/               ← node/npm/npx shim                 │
│  └── logs/                     ← Electron 应用日志                  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

| 位置 | 权限 | 内容 | 谁读 |
|------|------|------|------|
| `Resources/petmind/` | 只读 | Openclaw 引擎 + 引擎内置 skills | `utilityProcess.fork()` 加载引擎；引擎自动发现 `skills/` |
| `Resources/SKILLs/` | 只读 | PetClaw 定制 skills 模板 | BootCheck 首次启动时同步到 `{userData}/SKILLs/` |
| `Resources/openclaw-extensions/` | 只读 | 本地扩展（ask-user-question, mcp-bridge） | ConfigSync 写入 `extensions.thirdPartyDirs` 指向此路径 |
| `{userData}/` | 读写 | 数据库、引擎状态、会话、日志 | 引擎通过环境变量指向；ConfigSync 通过 `skills.load.extraDirs` 让引擎加载此处 skills |

**关键设计**：引擎内置 skills（petmind/skills/）**不拷贝**到用户目录，引擎自己知道怎么找它们。只有 PetClaw 额外定制的 skills 才从 `Resources/SKILLs/` 同步到 `{userData}/SKILLs/`，因为引擎不知道这些额外目录的存在，需要通过 `openclaw.json` 的 `skills.load.extraDirs` 配置来告知。

### 4.3 运行时分发策略

App 捆绑 Openclaw runtime（不再 npm install），通过 electron-builder `extraResources` 打包。

| 环境 | 候选路径（按优先级） | 说明 |
|------|---------------------|------|
| 生产 | `process.resourcesPath/petmind/` | electron-builder extraResources 打包 |
| 开发 | `app.getAppPath()/vendor/openclaw-runtime/current/` | 符号链接指向具体平台目录 |
| 开发备选 | `process.cwd()/vendor/openclaw-runtime/current/` | 当 appPath 找不到时的后备 |

**为什么分两个路径？**
- 生产包通过 `extraResources` 将 `vendor/openclaw-runtime/current/` 复制到 `resources/petmind/`
- 开发时直接读 vendor 目录，避免每次改动都重新打包
- `current/` 是符号链接（如 `current → darwin-arm64`），`resolveRuntimeMetadata()` 用 `fs.realpathSync()` 解析真实路径

**runtime 目录结构**：
```
petmind/                               ← 或 vendor/openclaw-runtime/current/
├── gateway-bundle.mjs                ← esbuild 单文件打包（主入口，~28MB）
├── openclaw.mjs                      ← 多文件模式入口（bundle 不存在时的后备）
├── gateway.asar                      ← Electron asar 归档（openclaw.mjs + dist/ 打包）
├── gateway-launcher.cjs              ← Windows 专用 CJS 包装器（自动生成）
├── dist/
│   ├── entry.js                      ← 多文件模式入口
│   ├── gateway/server.js             ← Gateway HTTP 服务
│   ├── plugin-sdk/gateway-runtime.js ← GatewayClient 导出（v2026.4.5+）
│   ├── extensions/                   ← runtime 内置插件
│   └── control-ui/                   ← Gateway 管理 UI 静态资源
├── skills/                           ← bundled skills（52 个）
├── package.json                      ← 读取 version 字段
├── runtime-build-info.json           ← 备用版本信息
└── node_modules/
```

**版本读取链**：`package.json.version` → `node_modules/openclaw/package.json.version` → `runtime-build-info.json.version` → 默认值 `2026.2.23`

### 4.4 Gateway 入口解析

Gateway 入口是传给 `utilityProcess.fork()` 或 `spawn()` 的 JS 文件。macOS/Linux 与 Windows 的解析策略不同：

**macOS / Linux**（直接加载 ESM）：
```
候选链（按优先级）:
1. openclaw.mjs
2. dist/entry.js
3. dist/entry.mjs
4. gateway.asar/openclaw.mjs
```

**Windows**（需要 CJS 包装器）：

Windows 的 `utilityProcess.fork()` 无法直接加载 ESM（盘符如 `D:` 被误认为 URL scheme），必须通过 CJS 包装器间接 `import()`：

```
有 gateway-bundle.mjs 时:
  → 生成 gateway-launcher.cjs (bundle-only 模式)
  → gateway-launcher.cjs 内部 import(gateway-bundle.mjs)

无 bundle 时:
  → 生成 gateway-launcher.cjs (含 fallback)
  → 优先 import(gateway-bundle.mjs)
  → 失败则 require(dist/entry.js)
  → 再失败则 import(dist/entry.js)
```

`gateway-launcher.cjs` 自动生成在 `runtimeRoot/` 下，内容变化时才重写。它还负责：
- V8 compile cache 初始化（`enableCompileCache()`）
- `process.argv` 修补（让 openclaw 的 `isMainModule()` 正确识别）
- 事件循环保活（`setInterval(() => {}, 30000)`）

### 4.5 gateway.asar 提取

当 `gateway-bundle.mjs` 不存在时（旧版 runtime），需要从 `gateway.asar` 提取入口文件：

```
if bundle 存在 → 跳过提取，只提取 dist/control-ui/（Gateway 管理 UI 需要裸文件）
if openclaw.mjs + dist/entry.js 存在 → 已提取，跳过
else → 从 gateway.asar 提取 openclaw.mjs + dist/ 整个目录
```

`control-ui/` 始终需要提取为裸文件（静态 HTML/CSS/JS，asar 内无法直接 serve）。

### 4.6 GatewayClient 入口解析

`OpenclawGateway`（§5）需要动态加载 `GatewayClient` 构造函数，入口路径由 EngineManager 解析：

```
候选链（按优先级，每个 distRoot = [runtimeRoot/dist, runtimeRoot/gateway.asar/dist]）:
1. dist/plugin-sdk/gateway-runtime.js  ← v2026.4.5+ 稳定导出
2. dist/gateway/client.js              ← 旧版专用文件
3. dist/client.js                      ← 更早版本
4. dist/client-*.js (glob)             ← 最后手段，旧版 chunk
```

> 为什么优先 `plugin-sdk/gateway-runtime.js`？v2026.4.5 起 GatewayClient 被合并到共享 chunk 中，导出名被压缩（`n, r, t`），无法通过 duck-type 检测。`plugin-sdk` 子路径重新导出命名的 `GatewayClient` 符号。

### 4.7 平台 Fork 策略

```typescript
// macOS / Linux: utilityProcess.fork()
// 使用 Electron 内置 Node.js 运行时，无需独立安装 Node.js
child = utilityProcess.fork(openclawEntry, forkArgs, {
  cwd: runtimeRoot,
  env,
  stdio: 'pipe',
  serviceName: 'PetClaw Gateway',
})

// Windows: child_process.spawn() + ELECTRON_RUN_AS_NODE=1
// 因为 utilityProcess 在 Windows 上冷启动 ESM 编译有 ~5x 性能开销（163s vs 34s）
child = spawn(process.execPath, [openclawEntry, ...forkArgs], {
  cwd: runtimeRoot,
  env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
```

Fork 参数：`['gateway', '--bind', 'loopback', '--port', String(port), '--token', token, '--verbose']`

### 4.8 端口扫描

```
1. 优先候选（去重）: DEFAULT_PORT(18789) → 内存缓存端口 → 持久化端口(gateway-port.json)
2. 逐个检测 isPortAvailable()（net.createServer listen 测试）
3. 全部占用 → 批量扫描 18790~18869，每批 10 个并行检测
4. 80 个端口都占用 → 抛异常

端口持久化: gateway-port.json = { port: number, updatedAt: number }
```

### 4.9 Token 管理

```
读取 {userData}/openclaw/state/gateway-token
  → 文件存在且非空 → 复用
  → 文件不存在 → crypto.randomBytes(24).toString('hex') → 写入

Token 用途: Gateway HTTP API 认证 + WebSocket 连接认证
生命周期: 跨重启持久化（不是每次启动重新生成），确保热重启时客户端连接不中断
```

### 4.10 健康检查

```typescript
// 并行探测（不再串行，避免 4×1200ms 延迟）
async isGatewayHealthy(port: number): Promise<boolean> {
  const httpProbes = ['/health', '/healthz', '/ready', '/'].map(path =>
    fetchWithTimeout(`http://127.0.0.1:${port}${path}`, 1500)
      .then(r => r.status < 500)
      .catch(() => false)
  )
  const tcpProbe = isPortReachable('127.0.0.1', port, 1500)
  const results = await Promise.all([...httpProbes, tcpProbe])
  return results.some(Boolean)  // 任一成功即健康
}
```

**启动等待轮询**：
- 每 600ms 轮询一次 `isGatewayHealthy()`
- 超时上限 300 秒（`GATEWAY_BOOT_TIMEOUT_MS`）
- 轮询期间更新 `progressPercent` 从 10→90（线性映射）
- 每 10 次轮询输出详细探测结果（verbose 模式）
- 进程退出或 shutdown 请求时立即放弃

### 4.11 自动重启

```
意外退出 → scheduleGatewayRestart()
  → 检查重启次数 < 5（GATEWAY_MAX_RESTART_ATTEMPTS）
  → 指数退避延迟: [3s, 5s, 10s, 20s, 30s]
  → 超时后调用 startGateway()
  → 启动成功 → gatewayRestartAttempt 归零
  → 连续 5 次失败 → 停留 error 状态，message 提示"检查模型配置或手动重启"

手动 restartGateway():
  → stopGateway() + gatewayRestartAttempt 归零 + startGateway()
  → 无论之前失败几次都可以重试
```

### 4.12 环境变量

Gateway 进程注入的完整环境变量列表：

| 变量 | 值 | 说明 |
|------|-----|------|
| `PETCLAW_SKILLS_ROOT` | skills 目录路径 | PetClaw 专属 skills |
| `OPENCLAW_HOME` | `{userData}/openclaw/` | runtime 数据根目录 |
| `OPENCLAW_STATE_DIR` | `{userData}/openclaw/state/` | 状态文件目录 |
| `OPENCLAW_CONFIG_PATH` | `{userData}/openclaw/state/openclaw.json` | 运行时配置文件 |
| `OPENCLAW_GATEWAY_TOKEN` | 48 字符 hex | Gateway 认证令牌 |
| `OPENCLAW_GATEWAY_PORT` | 端口号 | Gateway 监听端口 |
| `OPENCLAW_NO_RESPAWN` | `1` | 禁止 runtime 自身重启（由 App 管理） |
| `OPENCLAW_ENGINE_VERSION` | 版本号 | 当前 runtime 版本 |
| `OPENCLAW_BUNDLED_PLUGINS_DIR` | `runtimeRoot/dist/extensions` | 内置插件目录 |
| `OPENCLAW_SKIP_MODEL_PRICING` | `1` | 跳过 openrouter.ai 价格拉取（避免启动超时） |
| `OPENCLAW_DISABLE_BONJOUR` | `1` | 禁用 mDNS 局域网广播 |
| `OPENCLAW_LOG_LEVEL` | `debug` | 启动阶段详细日志 |
| `NODE_COMPILE_CACHE` | `{userData}/openclaw/state/.compile-cache` | V8 编译缓存（加速 30-50%） |
| `PETCLAW_ELECTRON_PATH` | Electron 可执行文件路径 | CLI shim 使用 |
| `PETCLAW_OPENCLAW_ENTRY` | Gateway 入口文件路径 | CLI shim 使用 |
| `TZ` | 系统时区（如 `Asia/Shanghai`） | macOS 不默认设置 TZ |
| `http_proxy` / `https_proxy` | 系统代理 URL | 系统代理启用时注入 |
| Secret vars（`${VAR}` 占位符） | API Key 明文 | 对应 openclaw.json 中的 `${PROVIDER_API_KEY}` |

### 4.13 CLI Shim 生成

在 `{userData}/openclaw/state/bin/` 下生成 `petclaw`、`openclaw`、`claw` 三个命令的 shell 脚本，注入到 Gateway 进程的 `PATH` 中。`petclaw` 是面向用户的命令名，底层代理到 openclaw runtime。

```bash
# Unix shim（petclaw / openclaw / claw）:
# 设置 OPENCLAW_HOME 等环境变量，代理到 openclaw runtime
# 优先用 PETCLAW_ELECTRON_PATH + ELECTRON_RUN_AS_NODE=1
# 后备用系统 node
export OPENCLAW_HOME="{userData}/openclaw"
export OPENCLAW_STATE_DIR="{userData}/openclaw/state"
export OPENCLAW_CONFIG_PATH="{userData}/openclaw/state/openclaw.json"
exec env ELECTRON_RUN_AS_NODE=1 "${PETCLAW_ELECTRON_PATH}" "${PETCLAW_OPENCLAW_ENTRY}" "$@"
```

```bat
@rem Windows shim（petclaw.cmd / openclaw.cmd / claw.cmd）:
set OPENCLAW_HOME=%USERPROFILE%\.petclaw
set ELECTRON_RUN_AS_NODE=1
"%PETCLAW_ELECTRON_PATH%" "%PETCLAW_OPENCLAW_ENTRY%" %*
```

Shim 内容变化时才重写（幂等），写入后 `chmod 755`（Unix）。

> 当前实现（bootcheck.ts `ensurePetclawCli()`）已有 `petclaw` shim 生成，v3 统一到 EngineManager 管理，新增 `openclaw` / `claw` 别名。

### 4.14 Node/NPM Shim

Gateway 执行 exec 命令时可能需要 `node` / `npm` / `npx`。Electron 本身内嵌 Node.js 运行时，通过 shim 暴露：

```
ensureElectronNodeShim(electronNodePath, npmBinDir):
  → 在临时目录生成 node shim（ELECTRON_RUN_AS_NODE=1 包装器）
  → 生产模式下同时包含 npm/npx shim（指向 app.asar.unpacked/node_modules/npm/bin/）
  → shim 目录注入 PATH
```

### 4.15 日志管理

```
Gateway 日志写入: {userData}/openclaw/state/logs/gateway.log
格式: [ISO时间] [stdout/stderr] 内容

stdout/stderr 分别监听 data 事件:
  → 追加写入 gateway.log（best-effort，不阻塞）
  → 同步输出到主进程 console（带 UTC→本地时区转换）
  → 检测 [gateway] 关键字记录启动里程碑时间

启动里程碑追踪:
  gatewaySpawnedAt = Date.now()
  每次检测到 [gateway] 日志 → 输出 "startup milestone (Xms since spawn): ..."

Gateway 日常滚动日志: /tmp/openclaw/openclaw-YYYY-MM-DD.log（runtime 自？身管理）
  macOS: /tmp/openclaw/
  Windows: {drive}/tmp/openclaw/ 或 os.tmpdir()/openclaw/
```

### 4.16 openclaw.json 配置文件

首次启动时自动创建 `{userData}/openclaw/state/openclaw.json`，初始内容：

```json
{ "gateway": { "mode": "local" } }
```

后续由 `ConfigSync`（§6）负责写入模型配置、skills 路径等。EngineManager 只负责确保文件存在且有 `gateway.mode`。

### 4.17 完整启动序列

```
startGateway()
  │
  ├─ 防重入: 如果 startGatewayPromise 存在则复用
  │
  ├─ 1. ensureReady()
  │     ├─ resolveRuntimeMetadata() → 查找 runtime 目录
  │     ├─ 同步本地扩展到 runtime（syncLocalExtensions）
  │     ├─ 清理过期第三方插件
  │     └─ 已 running → 直接返回
  │
  ├─ 2. 检查已有进程
  │     ├─ 进程存活 + 健康 → 复用，返回 running
  │     └─ 进程存活但不健康 → stopGatewayProcess → 继续
  │
  ├─ 3. 解析 runtime
  │     ├─ resolveRuntimeMetadata() → root 路径
  │     ├─ ensureBareEntryFiles() → 从 asar 提取（如需要）
  │     └─ resolveOpenClawEntry() → 平台特定入口文件
  │
  ├─ 4. 准备连接参数
  │     ├─ ensureGatewayToken() → 读或生成 token
  │     ├─ resolveGatewayPort() → 端口扫描
  │     ├─ writeGatewayPort() → 持久化端口
  │     └─ ensureConfigFile() → 确保 openclaw.json 存在
  │
  ├─ 5. 设置 status = starting (progressPercent: 10)
  │
  ├─ 6. 构建环境变量（§4.12 全部变量）
  │
  ├─ 7. 生成 CLI shims + Node shims → 注入 PATH
  │
  ├─ 8. Fork/Spawn 进程（§4.7 平台策略）
  │     ├─ 记录 gatewaySpawnedAt
  │     ├─ attachGatewayProcessLogs()
  │     └─ attachGatewayExitHandlers()
  │
  ├─ 9. waitForGatewayReady(port, 300s)
  │     ├─ 每 600ms 轮询 isGatewayHealthy()
  │     ├─ 更新 progressPercent 10→90
  │     └─ 超时/进程退出/shutdown → 放弃
  │
  └─ 10. 成功 → status = running, restartAttempt 归零
         失败 → status = error, stopGatewayProcess()
```

### 4.18 停止与优雅退出

```typescript
stopGateway():
  shutdownRequested = true
  清除 restartTimer
  stopGatewayProcess(child):
    → expectedGatewayExits.add(child)  // 标记为预期退出，不触发重启
    → child.kill()                      // 优雅终止
    → 1.2s 后 force-kill
    → 5s 硬超时兜底 resolve

restartGateway():
  → stopGateway()
  → gatewayRestartAttempt = 0  // 重置计数器
  → startGateway()
```

### 4.19 公开接口汇总

```typescript
export class OpenclawEngineManager extends EventEmitter {
  // 状态
  getStatus(): EngineStatus
  setExternalError(message: string): EngineStatus  // 外部模块报错时设置

  // 版本与路径
  getDesiredVersion(): string
  getBaseDir(): string           // {userData}/openclaw/
  getStateDir(): string          // {userData}/openclaw/state/
  getConfigPath(): string        // {userData}/openclaw/state/openclaw.json
  getGatewayLogPath(): string    // {userData}/openclaw/state/logs/gateway.log
  getOpenClawDailyLogDir(): string | null  // /tmp/openclaw/

  // 连接信息
  getGatewayConnectionInfo(): {
    version: string | null
    port: number | null
    token: string | null
    url: string | null           // ws://127.0.0.1:{port}
    clientEntryPath: string | null
  }

  // 密钥注入
  setSecretEnvVars(vars: Record<string, string>): void
  getSecretEnvVars(): Record<string, string>

  // 生命周期
  ensureReady(): Promise<EngineStatus>
  startGateway(): Promise<EngineStatus>
  stopGateway(): Promise<void>
  restartGateway(): Promise<EngineStatus>

  // 事件
  on('status', (status: EngineStatus) => void): this
}
```

### 4.20 目录布局

```
{userData}/                              ← app.getPath('userData')
├── petclaw.db                          ← SQLite 数据库
├── openclaw/                           ← Openclaw runtime 数据根（OPENCLAW_HOME）
│   └── state/                          ← OPENCLAW_STATE_DIR
│       ├── openclaw.json               ← runtime 配置（ConfigSync 写入）
│       ├── gateway-token               ← 48 字符 hex 认证令牌
│       ├── gateway-port.json           ← { port, updatedAt }
│       ├── .compile-cache/             ← V8 编译缓存
│       ├── bin/
│       │   ├── petclaw                 ← Unix CLI shim（面向用户）
│       │   ├── openclaw               ← Unix CLI shim（runtime 别名）
│       │   ├── claw                   ← Unix CLI shim（简写别名）
│       │   ├── petclaw.cmd            ← Windows CLI shim
│       │   ├── openclaw.cmd           ← Windows CLI shim
│       │   └── claw.cmd              ← Windows CLI shim
│       ├── logs/
│       │   └── gateway.log            ← Gateway 进程日志
│       ├── workspace/                 ← Openclaw workspace（§16）
│       └── agents/main/               ← 默认 Agent 目录
├── SKILLs/                             ← PetClaw 定制 skills（从 Resources 同步）
├── cowork/bin/                         ← node/npm/npx shim
└── logs/                               ← Electron 应用日志
```

### 4.21 替换现有代码

| 现有代码 | 处置 | 说明 |
|----------|------|------|
| `bootcheck.ts` → `installNode()` | **删除** | v3 使用 utilityProcess.fork()，不需要独立 Node.js |
| `bootcheck.ts` → `installOpenclaw()` | **删除** | runtime 随 App 捆绑，不再 npm install |
| `bootcheck.ts` → `ensurePetclawCli()` | **删除** | 由 EngineManager §4.13 CLI shim 生成替代 |
| `bootcheck.ts` → `ensureGatewayProcess()` | **删除** | 由 EngineManager.startGateway() 替代 |
| `bootcheck.ts` → `waitForGateway()` | **删除** | 由 EngineManager.waitForGatewayReady() 替代 |
| `bootcheck.ts` → `stopExistingGateway()` | **删除** | 由 EngineManager.stopGateway() 替代 |
| `bootcheck.ts` → `checkModelConfig()` | **迁移到 ConfigSync** | openclaw.json 生成逻辑移到 §6 |
| `bootcheck.ts` → `syncWorkspaceMd()` | **迁移到 ConfigSync** | §6.2 workspace 文件同步 |
| `bootcheck.ts` → `runNormalBoot()`/`runUpgradeBoot()` | **重写** | 简化为：EngineManager.startGateway() + Gateway.connect() |
| v1 `~/.petclaw/node/` 目录 | **移除** | v3 不再需要独立 Node.js 环境 |
| `scripts/prepare-runtime.sh` | **重写** | 改为构建捆绑 runtime 到 `resources/petmind/` |

**BootCheck 流程精简**：

```
当前 正常启动 3 步:              v3 正常启动:
1. 检查环境(OS/Node/Runtime)    → EngineManager.ensureReady()
2. 启动 Gateway(spawn CLI)      → EngineManager.startGateway()
3. 连接服务(WS 轮询)            → OpenclawGateway.connect()

当前 升级启动 5 步:              v3 升级启动（App 升级 = runtime 升级）:
1. 检测环境                     → EngineManager.ensureReady()
2. 准备 Node.js ← 废弃         （utilityProcess 用 Electron Node.js）
3. 更新运行时 ← 废弃            （runtime 随 App 捆绑）
4. 配置大模型                   → ConfigSync.sync('upgrade')
5. 启动连接                     → EngineManager.startGateway() + Gateway.connect()
```

---

## 5. 基础层 — OpenclawGateway

动态加载 Openclaw npm 包自带的 GatewayClient，替代手写 WebSocket。

```typescript
// src/main/ai/gateway.ts

export class OpenclawGateway extends EventEmitter {
  private client: GatewayClientLike | null = null

  // 动态加载 GatewayClient 构造函数
  private async loadGatewayClientCtor(clientEntryPath: string): Promise<Function>

  // 连接参数: url=ws://127.0.0.1:{port}, token, role='operator', scopes=['operator.admin']
  async connect(opts: { url: string; token: string; clientEntryPath: string }): Promise<void>

  // 通用 RPC
  async request<T>(method: string, params?: unknown): Promise<T>

  // 便捷方法
  async chatSend(params: ChatSendParams): Promise<ChatSendResult>
  async chatAbort(sessionKey: string, runId: string): Promise<void>
  async sessionsPatch(key: string, patch: SessionPatch): Promise<void>

  disconnect(): void
  isConnected(): boolean
}
```

事件分发：GatewayClient `onEvent` 回调 → Node.js EventEmitter emit（chat.reply, chat.done, exec.approval.requested 等）。

### 5.2 替换现有代码

| 现有代码 | 处置 | 说明 |
|----------|------|------|
| `ai/openclaw.ts` | **整体替换** | 手写 WebSocket 客户端 → GatewayClient 动态加载 |
| `ai/provider.ts` (`AIProvider` 接口) | **删除** | 不再需要抽象层，统一走 GatewayClient |
| `ws` npm 依赖 | **移除** | GatewayClient 内置 WebSocket 管理 |
| `ipc.ts` 中 WebSocket 重连逻辑 | **删除** | GatewayClient 内置重连 |

---

## 6. 基础层 — ConfigSync

**唯一写入 openclaw.json 的模块**，聚合所有 Manager 状态。同时负责同步 workspace 文件（AGENTS.md / SOUL.md / IDENTITY.md）。

### 6.1 openclaw.json 生成

```typescript
// src/main/ai/config-sync.ts

export class ConfigSync {
  constructor(
    private engineManager: OpenclawEngineManager,
    private skillManager: SkillManager,
    private modelRegistry: ModelRegistry,
    private mcpManager: McpManager,
    private agentManager: AgentManager,
    private configPath: string,  // {userData}/openclaw/state/openclaw.json
  ) {}

  // 聚合所有配置 → 原子写入 openclaw.json
  sync(reason: string): SyncResult {
    const config = {
      models: this.modelRegistry.toOpenclawConfig(),
      agents: this.agentManager.toOpenclawConfig(),
      skills: {
        entries: this.skillManager.toOpenclawConfig().entries,
        load: {
          extraDirs: this.skillManager.getExtraDirs(),  // Skills 加载目录
          watch: true,                                    // 热加载
        },
      },
      mcp: this.mcpManager.toOpenclawConfig(),
      hooks: { internal: { entries: { 'session-memory': { enabled: false } } } },
      gateway: this.preserveGatewayConfig(),
    }
    this.writeConfig(config)  // tmp + rename 原子写入

    // 同步 workspace 文件（每次 sync 都执行，因为 skills/agent 可能变更）
    this.syncWorkspaceFiles()

    return { ok: true, changed: true, configPath: this.configPath }
  }
}
```

**Skills 加载机制**：通过 `openclaw.json` 的 `skills.load.extraDirs` 配置，Openclaw runtime **原生扫描并加载** SKILL.md。用户发送消息时通过 `activeSkillIds` 选择本次对话使用的 skills，Openclaw 只把选中的 skill prompt 注入本次对话的 system prompt。**不通过 AGENTS.md 告知 skills 列表**。

### 6.2 Workspace 文件同步

ConfigSync 在每次 `sync()` 时同步 workspace 目录下的 .md 文件。这些文件是 Openclaw runtime 的 system prompt 来源。

#### Main Agent

workspace = 用户配置的工作目录（默认 `{userData}/openclaw/state/workspace/`）

只写 **AGENTS.md**（不写 SOUL.md / IDENTITY.md / USER.md / MEMORY.md）：

```typescript
private syncAgentsMd(workspaceDir: string, systemPrompt: string): void {
  const MARKER = '<!-- PetClaw managed: do not edit below this line -->'
  const agentsMdPath = path.join(workspaceDir, 'AGENTS.md')

  // 读取现有文件，保留用户手写内容（MARKER 之前的部分）
  // 首次创建时使用 openclaw runtime 自带模板或内置 fallback
  const userContent = readUserContent(agentsMdPath, MARKER)
    || readBundledTemplate()   // vendor/openclaw-runtime/current/docs/reference/templates/AGENTS.md
    || FALLBACK_AGENTS_TEMPLATE

  // Managed section（MARKER 之后）
  const sections = [
    systemPrompt && `## System Prompt\n\n${systemPrompt}`,
    MANAGED_WEB_SEARCH_POLICY,     // 禁用内置搜索，使用 skill 的
    MANAGED_EXEC_SAFETY,           // 执行安全规则
    MANAGED_MEMORY_POLICY,         // 记忆写入规则（先 write 再回复"记住了"）
    buildSkillCreationPrompt(),    // 新建 skill 的目录路径
    buildScheduledTaskPrompt(),    // 定时任务处理规则
  ].filter(Boolean)

  const content = `${userContent}\n\n${MARKER}\n\n${sections.join('\n\n')}\n`
  atomicWriteIfChanged(agentsMdPath, content)
}
```

#### 非 Main Agent

每个 agent 的 workspace = `{STATE_DIR}/workspace-{agentId}/`（不和用户工作目录耦合）

```typescript
private syncPerAgentWorkspaces(): void {
  const stateDir = this.engineManager.getStateDir()
  for (const agent of this.agentManager.list()) {
    if (agent.id === 'main' || !agent.enabled) continue

    const agentWorkspace = path.join(stateDir, `workspace-${agent.id}`)
    ensureDir(agentWorkspace)

    // SOUL.md — agent 的 system prompt
    syncFileIfChanged(path.join(agentWorkspace, 'SOUL.md'), agent.systemPrompt)

    // IDENTITY.md — agent 的身份描述
    syncFileIfChanged(path.join(agentWorkspace, 'IDENTITY.md'), agent.identity)

    // AGENTS.md — 复用同一逻辑（skills/policy prompt 注入）
    this.syncAgentsMd(agentWorkspace, agent.systemPrompt)

    // MEMORY.md + memory/ — 只确保存在（内容由 Agent 对话时自主写入）
    ensureDir(path.join(agentWorkspace, 'memory'))
    ensureFileExists(path.join(agentWorkspace, 'MEMORY.md'))
  }
}
```

#### Workspace 文件职责总览

| 文件 | Main Agent | 非 Main Agent | 谁写内容 |
|------|-----------|--------------|---------|
| AGENTS.md | ConfigSync 写（模板 + managed section） | ConfigSync 写（同上） | ConfigSync |
| SOUL.md | **不写**（Openclaw runtime 管理） | ConfigSync 写（= agent.systemPrompt） | ConfigSync / Runtime |
| IDENTITY.md | **不写** | ConfigSync 写（= agent.identity） | ConfigSync |
| USER.md | **不写** | **不写** | Agent 对话时自动创建 |
| MEMORY.md | **不写** | 只确保文件存在 | Agent 对话时写入 |
| memory/*.md | **不写** | 只确保目录存在 | Agent 对话时写入 |

### 6.3 替换现有代码

| 现有代码 | 处置 | 说明 |
|----------|------|------|
| `bootcheck.ts` → `checkModelConfig()` | **迁移** | openclaw.json 生成逻辑移到 ConfigSync.sync() |
| `petclaw-settings.json` 的模型配置字段 | **迁移到 DB** | API Keys 存 SQLite kv 表，模型列表迁移到 ModelRegistry |
| `bootcheck.ts` 中 openclaw.json 合并逻辑 | **删除** | ConfigSync 统一管理，不需要手动合并 |
| `bootcheck.ts` → `syncWorkspaceMd()` | **迁移** | 移到 ConfigSync.syncAgentsMd() + syncPerAgentWorkspaces() |
| `ipc.ts` 中 USER.md 写入逻辑 | **删除** | 由 Agent 运行时自主管理 |

---

## 7. 核心层 — AgentManager

### 7.1 工作原理

多 Agent 管理：预设 Agent（内置模板）+ 自定义 Agent，DB 持久化。每个 Agent 拥有独立的 system_prompt、model、skills、IM 渠道绑定。

默认 `main` Agent 在首次启动时自动创建，不可删除。

### 7.2 数据表设计

```sql
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  identity TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',           -- 'llm/provider/model' 格式
  icon TEXT NOT NULL DEFAULT '',            -- emoji 或图标标识
  skill_ids TEXT NOT NULL DEFAULT '[]',     -- JSON 数组
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,    -- main agent = 1
  source TEXT NOT NULL DEFAULT 'custom',    -- 'preset' | 'custom'
  preset_id TEXT NOT NULL DEFAULT '',       -- 预设来源 ID
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 7.3 接口设计

```typescript
// src/main/agents/agent-manager.ts

export interface Agent {
  id: string
  name: string
  description: string
  systemPrompt: string
  identity: string
  model: string             // 'llm/openai/gpt-4o'
  icon: string
  skillIds: string[]
  enabled: boolean
  isDefault: boolean
  source: 'preset' | 'custom'
  presetId: string
}

export class AgentManager extends EventEmitter {
  // CRUD
  create(agent: Omit<Agent, 'id'>): Agent
  update(id: string, patch: Partial<Agent>): Agent
  delete(id: string): void            // main agent 不可删除
  list(): Agent[]
  get(id: string): Agent | undefined

  // 预设 Agent 初始化（首次启动安装）
  ensurePresetAgents(): void

  // 序列化为 openclaw.json agents 配置
  toOpenclawConfig(): OpenclawAgentsConfig

  // Agent 切换 → 触发 ConfigSync + workspace 同步
  activate(id: string): void
}
```

### 7.4 Agent 配置对话框（三个 Tab）

| Tab | 内容 |
|-----|------|
| **基础信息** | 名称、描述、图标、System Prompt、身份（Identity）、模型选择 |
| **技能** | 该 Agent 可用的 Skills 列表（勾选） |
| **IM 渠道** | 绑定到哪些 IM 平台（详见 §14 ImGateway） |

---

## 8. 核心层 — SessionManager

```typescript
// src/main/ai/session-manager.ts

export interface Session {
  id: string
  agentId: string
  sessionKey: string          // 'agent:{agentId}:petclaw:{sessionId}'
  workspace: string
  modelOverride?: string      // 本次会话的模型覆盖
  activeSkillIds?: string[]   // 本次会话激活的技能
  status: 'idle' | 'running' | 'error'
  title: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export class SessionManager extends EventEmitter {
  // 会话 CRUD
  create(opts: { workspace?: string; agentId?: string; modelOverride?: string }): Session
  send(sessionId: string, message: string, opts?: SendOptions): Promise<void>
  abort(sessionId: string): void
  patchWorkspace(sessionId: string, workspace: string): Promise<void>

  // 最近工作目录（从 sessions 表查询）
  listRecentCwds(limit?: number): string[]

  // 构建 outbound prompt
  private buildOutboundPrompt(session: Session, message: string, systemPrompt?: string): string
}
```

**最近工作目录查询**（和 LobsterAI 一致）：

```sql
SELECT cwd, updated_at FROM cowork_sessions
WHERE cwd IS NOT NULL AND TRIM(cwd) != ''
ORDER BY updated_at DESC
LIMIT ?
```

去重 + 路径归一化后返回，不需要额外表。

---

## 9. 核心层 — CoworkController

### 9.1 工作原理

CoworkController 是会话执行的控制中枢，管理执行模式、权限审批、流式事件协议。对应 LobsterAI 的 `openclawRuntimeAdapter.ts` + `coworkStore.ts`。

### 9.2 执行模式

```typescript
type CoworkExecutionMode = 'auto' | 'local' | 'sandbox'
```

| 模式 | 说明 |
|------|------|
| `auto` | 自动根据上下文选择执行方式 |
| `local` | 本地直接执行，全速运行 |
| `sandbox` | 沙箱隔离执行，限制系统访问 |

每个 CoworkSession 持久化 `executionMode` 字段到 SQLite。

### 9.3 Exec Approval（权限审批）

```
Openclaw Agent 调用工具
  → Gateway SSE 事件 exec.approval.requested
  → CoworkController 接收，emit('permissionRequest', sessionId, request)
  → IPC 推送到 Renderer → 弹出审批弹窗（CoworkPermissionModal）
  → 用户批准/拒绝
  → CoworkController.respondToPermission(requestId, result)
  → Gateway RPC exec.approval.resolve
  → Openclaw 继续/中止执行
```

**PermissionResult 结构**（参考 LobsterAI `agentEngine/types.ts`）：

```typescript
type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: Record<string, unknown>[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean }

interface PermissionRequest {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId?: string | null
}
```

**自动批准策略**：Channel 来源会话自动批准；本地会话中非删除类命令自动批准；其余弹窗确认。`confirmationMode` 支持 `'modal'`（弹窗）和 `'text'`（文本确认）两种模式。

### 9.4 流式事件协议

CoworkController 作为 EventEmitter，emit 以下事件（对应 LobsterAI `CoworkRuntimeEvents`）：

| 事件 | 说明 | payload |
|------|------|---------|
| `message` | 新消息加入会话 | `(sessionId, message: CoworkMessage)` |
| `messageUpdate` | 流式内容增量更新 | `(sessionId, messageId, content)` |
| `permissionRequest` | 工具执行需要审批 | `(sessionId, request: PermissionRequest)` |
| `complete` | 会话执行完毕 | `(sessionId, claudeSessionId)` |
| `error` | 执行出错 | `(sessionId, error: string)` |
| `sessionStopped` | 会话被停止 | `(sessionId)` |

```typescript
// src/main/ai/cowork-controller.ts

export class CoworkController extends EventEmitter {
  constructor(
    private gateway: OpenclawGateway,
    private coworkStore: CoworkStore,
  ) {
    // 监听 Gateway SSE 事件
    // exec.approval.requested → emit('permissionRequest')
    // exec.approval.resolved → 内部处理
    // chat 相关事件 → emit('message'/'messageUpdate'/'complete'/'error')
  }

  // 执行模式
  setExecutionMode(mode: CoworkExecutionMode): void

  // 审批响应 → Gateway RPC exec.approval.resolve
  respondToPermission(requestId: string, result: PermissionResult): void

  // 会话管理
  startSession(sessionId: string, prompt: string, options?: CoworkStartOptions): Promise<void>
  continueSession(sessionId: string, prompt: string, options?: CoworkContinueOptions): Promise<void>
  stopSession(sessionId: string): void
  isSessionActive(sessionId: string): boolean
}
```

---

## 10. 功能层 — SkillManager

```typescript
// src/main/skills/skill-manager.ts

export interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
  isBuiltIn: boolean
  skillPath: string
  version?: string
  source: 'official' | 'custom'
  requires?: { bins?: string[]; env?: string[]; config?: string[] }
}

export class SkillManager extends EventEmitter {
  getSkillsRoot(): string  // {userData}/SKILLs/
  async scan(): Promise<Skill[]>
  setEnabled(id: string, enabled: boolean): void
  async install(source: string): Promise<Skill>  // URL / zip / 本地目录
  async uninstall(id: string): Promise<void>     // 内置不可卸载
  list(): Skill[]
  getEnabled(): Skill[]
  toOpenclawConfig(): { entries: Record<string, { enabled: boolean }>; load: { extraDirs: string[] } }
}
```

安装来源：本地目录 / zip / GitHub URL / ClawHub。

---

## 11. 功能层 — ModelRegistry

### 11.1 工作原理

管理多 LLM Provider 和 Model，支持 11 个预设提供商 + 自定义提供商。配置持久化到 SQLite kv 表，API Key 不写入 openclaw.json。

### 11.2 预设提供商

| 提供商 | API 格式 | Base URL |
|--------|---------|----------|
| PetClaw | openai-completions | https://petclaw.ai/api/v1 |
| OpenAI | openai-completions | https://api.openai.com/v1 |
| Anthropic | anthropic | https://api.anthropic.com |
| Google Gemini | openai-completions | https://generativelanguage.googleapis.com/v1beta |
| 深度求索 DeepSeek | openai-completions | https://api.deepseek.com |
| 阿里百炼 | openai-completions | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| 字节豆包 | openai-completions | https://ark.cn-beijing.volces.com/api/v3 |
| 智谱 GLM | openai-completions | https://open.bigmodel.cn/api/paas/v4 |
| 零一万物 | openai-completions | https://api.lingyiwanwu.com/v1 |
| Mistral | openai-completions | https://api.mistral.ai/v1 |
| Groq | openai-completions | https://api.groq.com/openai/v1 |

### 11.3 接口设计

```typescript
// src/main/models/model-registry.ts

export interface ModelProvider {
  id: string                     // 'petclaw', 'openai', 'custom-1'
  name: string
  baseUrl: string
  apiKey: string                 // 持久化在 settings，不写 openclaw.json
  apiFormat: 'openai-completions' | 'anthropic'
  isPreset: boolean
  models: ModelDefinition[]
}

export interface ModelDefinition {
  id: string                     // 'gpt-4o', 'claude-sonnet-4-20250514'
  name: string
  reasoning: boolean
  supportsImage: boolean
  contextWindow: number
  maxTokens: number
}

export class ModelRegistry extends EventEmitter {
  // Provider CRUD
  addProvider(provider: ModelProvider): void
  updateProvider(id: string, patch: Partial<ModelProvider>): void
  removeProvider(id: string): void  // 预设不可删除

  // Model CRUD（per provider）
  addModel(providerId: string, model: ModelDefinition): void
  removeModel(providerId: string, modelId: string): void

  // 活跃模型
  setActiveModel(providerModelId: string): void  // 'openai/gpt-4o'
  getActiveModel(): { provider: ModelProvider; model: ModelDefinition }

  // 测试连接
  async testConnection(providerId: string): Promise<{ ok: boolean; error?: string }>

  // 序列化
  toOpenclawConfig(): OpenclawModelsConfig
  save(): void   // → SQLite kv 表
  load(): void   // ← SQLite kv 表
}
```

### 11.4 设置页 UI

**左栏**：提供商列表（预设 + 自定义），点击选中。

**右栏配置面板**：
- API Key（密码框）
- Base URL
- API 格式（下拉）
- 测试连接按钮
- 模型列表（可增删）

**自定义提供商**：点击"添加自定义提供商"弹窗填入名称/URL/格式。

---

## 12. 功能层 — MemoryManager

### 12.1 工作原理

**纯文件驱动**，不使用 DB 表。Openclaw runtime 在每次会话启动时自动加载记忆文件注入上下文。

### 12.2 记忆文件结构

| 文件 | 位置 | 用途 |
|------|------|------|
| `MEMORY.md` | workspace 根目录 | 持久化事实、偏好与决策 |
| `memory/YYYY-MM-DD.md` | workspace/memory/ | 每日临时笔记 |
| `USER.md` | workspace 根目录 | 用户档案（长期） |
| `SOUL.md` | workspace 根目录 | Agent 个性与行为准则 |

### 12.3 读写流程

```
写入记忆：
  用户说"记住 xxx" → Agent 调用 write 工具 → 写入 MEMORY.md → 回复"记住了"

自动记录：
  Agent 执行任务 → 发现重要信息 → 主动写入 memory/YYYY-MM-DD.md

会话加载：
  Openclaw 启动会话 → 读取 SOUL.md + USER.md + 今日/昨日 daily notes + MEMORY.md → 注入 system prompt
```

### 12.4 接口设计

```typescript
// src/main/memory/memory-manager.ts

export class MemoryManager {
  // 读取 MEMORY.md
  readMemory(workspace: string): string

  // 追加条目到 MEMORY.md
  appendMemory(workspace: string, entry: string): void

  // 删除条目
  removeMemory(workspace: string, entryText: string): void

  // 搜索
  searchMemory(workspace: string, keyword: string): string[]

  // GUI 管理（设置面板用）
  listEntries(workspace: string): MemoryEntry[]
  updateEntry(workspace: string, oldText: string, newText: string): void
}
```

---

## 13. 功能层 — McpManager

### 13.1 工作原理

管理 MCP（Model Context Protocol）服务器配置，支持三种传输协议。配置 DB 持久化，通过 ConfigSync 同步到 openclaw.json。

### 13.2 数据表设计

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  transport_type TEXT NOT NULL DEFAULT 'stdio',  -- 'stdio' | 'sse' | 'streamable-http'
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

`config_json` 按 transport_type 存储不同配置：

**stdio**:
```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem"],
  "env": { "HOME": "/Users/xx" }
}
```

**sse / streamable-http**:
```json
{
  "url": "http://localhost:3001/mcp",
  "headers": { "Authorization": "Bearer xxx" }
}
```

### 13.3 接口设计

```typescript
// src/main/mcp/mcp-manager.ts

export interface McpServer {
  id: string
  name: string
  description: string
  enabled: boolean
  transportType: 'stdio' | 'sse' | 'streamable-http'
  config: StdioConfig | HttpConfig
}

export class McpManager extends EventEmitter {
  create(server: Omit<McpServer, 'id'>): McpServer
  update(id: string, patch: Partial<McpServer>): McpServer
  delete(id: string): void
  list(): McpServer[]
  setEnabled(id: string, enabled: boolean): void
  toOpenclawConfig(): OpenclawMcpConfig
}
```

---

## 14. 集成层 — ImGateway

### 14.1 工作原理

IM Gateway 将 10 个 IM 平台桥接到 Cowork 系统。用户在手机 IM 发消息 → ImGateway 接收 → 路由到对应 Agent → 启动 Cowork 会话 → 返回结果到 IM。

### 14.2 支持平台

| 平台 | 协议 | 多实例 |
|------|------|--------|
| 微信 | OpenClaw 网关 | 否 |
| 企业微信 | OpenClaw 网关 / SDK | 最多 3 |
| 钉钉 | DingTalk Stream | 最多 3 |
| 飞书 | Lark SDK | 最多 3 |
| QQ | OpenClaw 网关 | 最多 3 |
| Telegram | grammY Bot API | 否 |
| Discord | discord.js | 否 |
| 云信 IM | node-nim V2 SDK | 最多 5 |
| 网易 POPO | OpenClaw 网关 | 否 |
| 邮件 | IMAP/SMTP | 最多 3 |

### 14.3 数据表设计

**im_config**（KV 表，和 LobsterAI 一致）：

```sql
CREATE TABLE IF NOT EXISTS im_config (
  key TEXT PRIMARY KEY,       -- 'telegram' 或 'dingtalk:uuid-1'（多实例）
  value TEXT NOT NULL,        -- JSON 配置
  updated_at INTEGER NOT NULL
);
```

单实例 key = 平台名（`telegram`、`wechat`）。
多实例 key = `平台:实例ID`（`dingtalk:550e8400-...`、`feishu:a1b2c3-...`）。

**im_session_mappings**（IM 会话 → Cowork 会话路由）：

```sql
CREATE TABLE IF NOT EXISTS im_session_mappings (
  im_conversation_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  cowork_session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'main',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (im_conversation_id, platform)
);
```

### 14.4 IM Settings

```typescript
interface IMSettings {
  systemPrompt: string          // IM 专用 system prompt
  skillsEnabled: boolean        // IM 是否启用 skills
  platformAgentBindings: Record<string, string>  // platform → agentId
}
```

`platformAgentBindings` 配置哪个 IM 平台绑定到哪个 Agent。例：
```json
{
  "telegram": "main",
  "dingtalk:uuid-1": "work-agent",
  "feishu:uuid-2": "main"
}
```

### 14.5 消息流

```
IM 用户发消息 → ImGateway 接收
  → 查 platformAgentBindings → 确定 agentId
  → 查 im_session_mappings → 找到或创建 cowork_session
  → CoworkController.send(sessionId, message)
  → Agent 执行 → 返回结果
  → ImGateway 推送结果到 IM
```

---

## 15. 集成层 — SchedulerManager

### 15.1 工作原理

基于 Cron 表达式的定时任务调度。支持对话式创建（用户自然语言 → Agent 解析 → 创建任务）和 GUI 创建。

### 15.2 数据表设计

```sql
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  cron_expression TEXT NOT NULL,       -- '0 9 * * 1-5'
  prompt TEXT NOT NULL,                -- 要执行的 prompt
  agent_id TEXT NOT NULL DEFAULT 'main',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_task_meta (
  task_id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'gui',  -- 'gui' | 'conversation' | 'im'
  im_platform TEXT,                    -- 来源 IM 平台
  im_push_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
);
```

### 15.3 接口设计

```typescript
// src/main/scheduler/scheduler-manager.ts

export interface ScheduledTask {
  id: string
  title: string
  cronExpression: string
  prompt: string
  agentId: string
  enabled: boolean
  lastRunAt?: number
  nextRunAt?: number
}

export class SchedulerManager extends EventEmitter {
  // CRUD
  create(task: Omit<ScheduledTask, 'id'>): ScheduledTask
  update(id: string, patch: Partial<ScheduledTask>): ScheduledTask
  delete(id: string): void
  list(): ScheduledTask[]
  setEnabled(id: string, enabled: boolean): void

  // 调度引擎
  start(): void   // 启动 Cron 调度循环
  stop(): void

  // 执行：触发 Cowork 会话
  private async executeTask(task: ScheduledTask): Promise<void> {
    // 创建 Cowork 会话 → send prompt → 结果可选推送到 IM
  }
}
```

### 15.4 典型场景

| 场景 | Cron | Prompt |
|------|------|--------|
| 每日新闻 | `0 9 * * *` | "收集今日 AI/科技新闻并生成摘要" |
| 邮箱整理 | `0 8,18 * * 1-5` | "检查收件箱，分类整理重要邮件" |
| 周报生成 | `0 17 * * 5` | "生成本周工作汇报" |

---

## 16. 工程层 — BootCheck 初始化

> **注意**：原 WorkspaceManager 已合并到 ConfigSync（§6.2）。Workspace .md 文件由 ConfigSync.sync() 在每次同步时写入，不需要单独的 WorkspaceManager。

BootCheck 负责启动时的目录创建和内置 Skills 同步：

```typescript
// bootcheck.ts（精简后的启动检查）

function runBootCheck() {
  // 1. 创建目录结构
  ensureDir('{userData}/openclaw/state/workspace')
  ensureDir('{userData}/openclaw/state/workspace/memory')
  ensureDir('{userData}/SKILLs')
  ensureDir('{userData}/openclaw/state')
  ensureDir('{userData}/openclaw/state/bin')
  ensureDir('{userData}/openclaw/state/logs')
  ensureDir('{userData}/openclaw/state/agents/main')

  // 2. 同步内置 Skills 到 {userData}/SKILLs/（首次创建不覆盖）
  syncBuiltinSkills()

  // 3. ConfigSync.sync('boot') — 生成 openclaw.json + 同步 workspace 文件
  // 4. EngineManager.startGateway() — 启动 Openclaw 进程
}
```

内置 Skills（28 个，从 LobsterAI 全量迁移）：web-search、docx、xlsx、pptx、pdf、remotion、seedance、seedream、playwright、canvas-design、frontend-design、develop-web-game、stock-analyzer、stock-announcements、stock-explorer、content-planner、article-writer、daily-trending、films-search、music-search、technology-news-search、weather、local-tools、imap-smtp-email、create-plan、skill-vetter、skill-creator、youdaonote。源码在 `petclaw-desktop/SKILLs/`，打包时通过 electron-builder extraResources 复制到 app 内 `Resources/SKILLs/`，运行时通过 `skills.load.extraDirs` 指向 `app.getPath('userData')/SKILLs`。

### 16.2 替换现有代码

| 现有代码 | 处置 | 说明 |
|----------|------|------|
| `bootcheck.ts` → `syncWorkspaceMd()` | **迁移** | 移到 ConfigSync.syncAgentsMd()（§6.2） |
| `bootcheck.ts` 中 `mkdirSync(workspace/agents/logs)` | **保留** | BootCheck 仍负责目录创建 |
| `ipc.ts` 中 USER.md 写入逻辑 | **删除** | 由 Agent 对话时自动创建 |
| `managedWorkspaceMd` 指纹机制 | **删除** | ConfigSync 用 atomicWriteIfChanged 替代 |

---

## 17. 工程层 — Database

### 17.1 表设计总览

```sql
-- KV 配置
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);

-- Cowork 会话
CREATE TABLE cowork_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'idle',
  pinned INTEGER NOT NULL DEFAULT 0,
  cwd TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  model_override TEXT NOT NULL DEFAULT '',
  execution_mode TEXT,
  active_skill_ids TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Cowork 消息
CREATE TABLE cowork_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  sequence INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
);

-- Cowork 配置
CREATE TABLE cowork_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);

-- Agent
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  identity TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  skill_ids TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'custom',
  preset_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- MCP 服务器
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  transport_type TEXT NOT NULL DEFAULT 'stdio',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- IM 配置
CREATE TABLE im_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);

-- IM 会话映射
CREATE TABLE im_session_mappings (
  im_conversation_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  cowork_session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'main',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (im_conversation_id, platform)
);

-- 定时任务
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  prompt TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'main',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE scheduled_task_meta (
  task_id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'gui',
  im_platform TEXT,
  im_push_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
);
```

### 17.2 索引

```sql
CREATE INDEX idx_cowork_messages_session_id ON cowork_messages(session_id);
CREATE INDEX idx_im_session_mappings_cowork ON im_session_mappings(cowork_session_id);
CREATE INDEX idx_scheduled_tasks_enabled ON scheduled_tasks(enabled, next_run_at);
```

---

## 18. 工程层 — IPC Router

### 18.1 命名规范

`模块:动作` 格式，禁止驼峰。

### 18.2 完整 Channel 列表

**Chat**:

| Channel | 方向 | 说明 |
|---------|------|------|
| `chat:send` | invoke | 发送消息（含 cwd/files/skills/agentId） |
| `chat:abort` | invoke | 中止当前会话 |
| `chat:history` | invoke | 查询历史消息 |
| `chat:chunk` | main→renderer | 流式文本增量 |
| `chat:done` | main→renderer | 会话完成 |
| `chat:error` | main→renderer | 执行出错 |

**Session**:

| Channel | 方向 | 说明 |
|---------|------|------|
| `session:create` | invoke | 创建会话 |
| `session:list` | invoke | 列表 |
| `session:get` | invoke | 获取详情 |
| `session:list-recent-cwds` | invoke | 最近工作目录 |
| `session:patch` | invoke | 更新会话属性 |

**Agent**:

| Channel | 方向 | 说明 |
|---------|------|------|
| `agent:list` | invoke | Agent 列表 |
| `agent:create` | invoke | 创建 Agent |
| `agent:update` | invoke | 更新 Agent |
| `agent:delete` | invoke | 删除 Agent |
| `agent:activate` | invoke | 切换活跃 Agent |

**Skill**:

| Channel | 方向 | 说明 |
|---------|------|------|
| `skill:list` | invoke | 技能列表 |
| `skill:install` | invoke | 安装 |
| `skill:uninstall` | invoke | 卸载 |
| `skill:enable` | invoke | 启用/禁用 |
| `skill:changed` | main→renderer | 技能变更通知 |

**Model**:

| Channel | 方向 | 说明 |
|---------|------|------|
| `model:list-providers` | invoke | 提供商列表 |
| `model:add-provider` | invoke | 添加提供商 |
| `model:update-provider` | invoke | 更新提供商 |
| `model:remove-provider` | invoke | 删除提供商 |
| `model:set-active` | invoke | 设置活跃模型 |
| `model:test-connection` | invoke | 测试连接 |

**MCP**:

| Channel | 方向 | 说明 |
|---------|------|------|
| `mcp:list` | invoke | MCP 服务器列表 |
| `mcp:create` | invoke | 添加 |
| `mcp:update` | invoke | 更新 |
| `mcp:delete` | invoke | 删除 |
| `mcp:enable` | invoke | 启用/禁用 |

**IM**:

| Channel | 方向 | 说明 |
|---------|------|------|
| `im:get-config` | invoke | 获取平台配置 |
| `im:set-config` | invoke | 保存平台配置 |
| `im:enable` | invoke | 启用/禁用平台 |
| `im:status` | invoke | 平台连接状态 |

**Scheduler**:

| Channel | 方向 | 说明 |
|---------|------|------|
| `scheduler:list` | invoke | 任务列表 |
| `scheduler:create` | invoke | 创建任务 |
| `scheduler:update` | invoke | 更新任务 |
| `scheduler:delete` | invoke | 删除任务 |
| `scheduler:enable` | invoke | 启用/禁用 |

**Exec Approval**:

| Channel | 方向 | 说明 |
|---------|------|------|
| `approval:request` | main→renderer | 审批请求推送 |
| `approval:resolve` | invoke | 审批响应 |
| `approval:set-auto-scopes` | invoke | 设置自动批准范围 |

**Dialog / Workspace / System**:

| Channel | 方向 | 说明 |
|---------|------|------|
| `dialog:open-directory` | invoke | 系统目录选择器 |
| `dialog:open-files` | invoke | 系统文件选择器（多选） |
| `dialog:read-file-as-data-url` | invoke | 读取文件为 base64 dataUrl |
| `boot:status` / `boot:complete` | main→renderer | 启动状态 |
| `gateway:status` / `gateway:restarting` | main→renderer | Gateway 状态 |

**Pet（宠物联动）**:

| Channel | 方向 | 说明 |
|---------|------|------|
| `pet:state-event` | main→pet | 统一状态事件 `{ event: PetEvent }` |
| `pet:bubble` | main→pet | 气泡文本 `{ text: string, source: string }` |
| `pet:toggle-pause` | main→pet | 暂停/恢复宠物动画 |
| `pet:context-menu` | pet→main | 右键菜单请求 |
| `pet:set-ignore-mouse` | pet→main | 透明区域点击穿透 `boolean`（§22.4.8） |
| `hook:event` | main→pet+chat | Hook 事件透传 |

> **v1 → v3 变更**：`pet:chat-sent`、`chat:ai-responding`（pet）、`chat:done`（pet）、`chat:error`（pet）、`chat:chunk`（pet）合并为 `pet:state-event` + `pet:bubble`。详见 §22.4.5。

### 18.3 替换现有代码

| 现有代码 | 处置 | 说明 |
|----------|------|------|
| `ipc.ts`（单文件 ~800 行） | **拆分重构** | 按模块拆分到 `ipc/*.ts`（chat-ipc、agent-ipc 等） |
| `preload/index.ts` + `preload/index.d.ts` | **扩展** | 新增所有 v3 IPC channel 的类型声明 |
| `ipc.ts` 中 chat 相关 handler | **迁移** | 移到 `ipc/chat-ipc.ts`，调用 CoworkController |
| `ipc.ts` 中 settings 相关 handler | **迁移** | 移到 `ipc/settings-ipc.ts` |

---

## 19. 前端层 — ChatInputBox

### 19.1 整体布局

```
┌───────────────────────────────────────────────────────┐
│ 📎 report.xlsx ×   📷[图片缩略图] ×                      │ ← 附件预览区
├───────────────────────────────────────────────────────┤
│  [多行文本输入区]                                        │
├───────────────────────────────────────────────────────┤
│ 📁cwd× │ 📎 │ 🔧 │ 🔧pptx× 🔧xlsx× │ 全部清除 │ ▶⌄    │ ← 底部工具栏
└───────────────────────────────────────────────────────┘
```

### 19.2 工作目录选择

点击 📁 弹出 Popover（两个选项）：

```
┌──────────────────┐
│ ➕ 添加文件夹      │ → dialog.showOpenDialog
├──────────────────┤
│ 🕐 最近使用    ▸  │ → 子菜单
└──────────────────┘
        ┌──────────────────────┐
        │ 📁 coagent           │
        │ 📁 my-project        │
        └──────────────────────┘
```

**最近目录来源**：直接从 `cowork_sessions` 表查询（`SELECT DISTINCT cwd ... ORDER BY updated_at DESC`），去重 + 路径归一化，默认 8 个。

**展示逻辑**：
- 新会话/首页：显示 cwd tag（可选择、可 × 清除）
- 历史会话：不显示 cwd tag（已绑定在 session 中）

### 19.3 文件附件

展示在**输入框上方**，两种卡片样式：

**图片文件**（64×64 缩略图）：
- IPC `dialog:read-file-as-data-url` 读取为 base64
- `<img src={dataUrl}>` 渲染真实内容
- 底部半透明遮罩 + 文件名
- hover 显示 × 删除按钮

**非图片文件**（160×64 横向卡片）：
- 文件类型图标（FileTypeIcon 根据扩展名匹配）
- 文件名 + 类型标签（xlsx→Excel 表格 等）
- hover 显示 × 删除按钮

**三种输入方式**：
1. 点击 📎 → 系统文件选择器（多选）
2. 拖拽文件到输入框 → 高亮提示区
3. 粘贴 Ctrl+V → 剪贴板图片

**数据结构**：
```typescript
interface DraftAttachment {
  path: string        // 文件路径（剪贴板图片为 "inline:name:timestamp"）
  name: string
  isImage?: boolean
  dataUrl?: string    // 图片 base64（预览 + 发送）
}
```

附件状态按 draftKey（sessionId 或 `__home__`）分组存储在 Zustand，切换会话时保留。

### 19.4 技能选择器

点击 🔧 弹出多选 Popover：

```
┌─────────────────────────┐
│ 🔍 搜索技能              │
├─────────────────────────┤
│ ☐ docx        官方       │
│   Word 文档生成           │
│ ☑ web-search  官方       │
│   Web 搜索               │
│ ☑ xlsx        官方       │
│   Excel 表格生成          │
├─────────────────────────┤
│ ⚙ 管理技能               │
└─────────────────────────┘
```

- 搜索框实时过滤（name + description 模糊匹配）
- Checkbox 多选，勾选后底部工具栏生成 `🔧 skillName ×` tag
- "全部清除"一键清空所有 skill tags
- "管理技能"跳转设置页

### 19.5 发送按钮

- `▶` 发送：携带 text + cwd + files + activeSkillIds + agentId
- `⌄` 下拉：切换发送快捷键（Enter / Shift+Enter / Ctrl+Enter / Alt+Enter）

**消息发送 payload**：
```typescript
interface ChatSendPayload {
  text: string
  cwd?: string
  files?: string[]
  activeSkillIds?: string[]
  imageAttachments?: { name: string; mimeType: string; base64Data: string }[]
  agentId: string
}
```

---

## 20. Openclaw 版本管理

### 20.1 版本锁定

在 `package.json` 中声明 Openclaw 版本和插件列表：

```json
{
  "openclaw": {
    "version": "v2026.3.2",
    "repo": "https://github.com/openclaw/openclaw.git",
    "plugins": [
      { "id": "dingtalk-connector", "npm": "@dingtalk-real-ai/dingtalk-connector", "version": "0.8.16" },
      { "id": "openclaw-lark", "npm": "@larksuite/openclaw-lark", "version": "2026.4.7" },
      { "id": "wecom-openclaw-plugin", "npm": "@wecom/wecom-openclaw-plugin", "version": "2026.4.3" },
      { "id": "openclaw-weixin", "npm": "@tencent-weixin/openclaw-weixin", "version": "2.1.7" },
      { "id": "openclaw-nim-channel", "npm": "openclaw-nim-channel", "version": "1.1.1" },
      { "id": "clawemail-email", "npm": "@clawemail/email", "version": "0.9.12" }
    ]
  }
}
```

### 20.2 构建流水线（13 个脚本）

完整流水线：`ensure → build → sync-current → bundle → plugins → extensions → precompile → channel-deps → prune`

| # | 脚本 | 作用 | 产物 |
|---|------|------|------|
| 1 | `ensure-openclaw-version.cjs` | git checkout 到锁定版本 tag，不存在则 clone | `../openclaw` 源码目录 |
| 2 | `run-build-openclaw-runtime.cjs` | 跨平台 bash 启动器（Windows 用 Git Bash） | — |
| 3 | `build-openclaw-runtime.sh` | **核心构建**：pnpm install → tsc → 打包 asar → 生成入口 | `vendor/openclaw-runtime/{platform}/` |
| 4 | `sync-openclaw-runtime-current.cjs` | symlink/junction 到 `vendor/openclaw-runtime/current/` | current → 实际产物 |
| 5 | `bundle-openclaw-gateway.cjs` | esbuild 单文件 bundle（~27MB, ~1100 ESM → 1 文件） | `gateway-bundle.mjs` |
| 6 | `openclaw-runtime-host.cjs` | 检测平台架构（darwin-arm64 等） | 平台标识字符串 |
| 7 | `ensure-openclaw-plugins.cjs` | 从 npm registry 下载安装第三方插件 | `extensions/` 目录 |
| 8 | `sync-local-openclaw-extensions.cjs` | symlink 本地 extension 到 runtime | extensions/ 内 symlink |
| 9 | `precompile-openclaw-extensions.cjs` | esbuild 预编译 TS 扩展（消除 135s jiti 开销） | `*.js` 编译产物 |
| 10 | `install-openclaw-channel-deps.cjs` | 修复 channel 缺失依赖 | channels/*/node_modules |
| 11 | `prune-openclaw-runtime.cjs` | 裁剪体积（stub 未用包、删 .map/.d.ts） | 精简后的 runtime |
| 12 | `pack-openclaw-tar.cjs` | Windows NSIS 优化：打 tar 包加速安装 | `openclaw-runtime.tar` |
| 13 | `finalize-openclaw-runtime.cjs` | 开发模式下重新打包 gateway.asar | 刷新后的 asar |

**构建缓存**：`runtime-build-info.json` 存储版本号 + hash，版本未变则跳过整个流水线。

### 20.3 npm scripts

```json
{
  "scripts": {
    "openclaw:ensure": "node scripts/ensure-openclaw-version.cjs",
    "openclaw:runtime:host": "node scripts/openclaw-runtime-host.cjs",
    "openclaw:runtime:mac-arm64": "node scripts/run-build-openclaw-runtime.cjs --target=mac-arm64",
    "openclaw:runtime:mac-x64": "node scripts/run-build-openclaw-runtime.cjs --target=mac-x64",
    "openclaw:runtime:win-x64": "node scripts/run-build-openclaw-runtime.cjs --target=win-x64",
    "openclaw:runtime:linux-x64": "node scripts/run-build-openclaw-runtime.cjs --target=linux-x64",
    "openclaw:bundle": "node scripts/bundle-openclaw-gateway.cjs",
    "openclaw:plugins": "node scripts/ensure-openclaw-plugins.cjs",
    "openclaw:extensions": "node scripts/sync-local-openclaw-extensions.cjs",
    "openclaw:precompile": "node scripts/precompile-openclaw-extensions.cjs",
    "openclaw:channel-deps": "node scripts/install-openclaw-channel-deps.cjs",
    "openclaw:prune": "node scripts/prune-openclaw-runtime.cjs",
    "openclaw:finalize": "node scripts/finalize-openclaw-runtime.cjs",
    "electron:dev": "electron-vite dev",
    "electron:dev:openclaw": "npm run openclaw:ensure && npm run openclaw:runtime:host && electron-vite dev"
  }
}
```

### 20.4 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENCLAW_SRC` | Openclaw 源码目录路径 | `../openclaw` |
| `OPENCLAW_FORCE_BUILD` | 设为 `1` 强制重建（即使版本匹配） | — |
| `OPENCLAW_SKIP_ENSURE` | 设为 `1` 跳过自动版本切换（本地开发 Openclaw 时用） | — |

### 20.5 Runtime 目录结构

```
vendor/openclaw-runtime/
├── current/              → symlink → darwin-arm64/ (或当前平台)
├── darwin-arm64/
│   ├── openclaw.mjs              # ESM 入口
│   ├── gateway-bundle.mjs        # esbuild 单文件 bundle
│   ├── gateway-launcher.cjs      # Windows CJS 启动器
│   ├── gateway.asar              # openclaw dist 打包
│   ├── runtime-build-info.json   # 版本 + hash（构建缓存）
│   ├── node_modules/
│   ├── extensions/               # 插件 + 本地扩展
│   └── channels/                 # IM channel 实现
├── win-x64/
└── linux-x64/
```

### 20.6 更新 Openclaw 版本

```bash
# 1. 修改版本号
vim package.json  # 改 openclaw.version 为新 tag

# 2. 重建（自动检测版本变更）
npm run electron:dev:openclaw

# 3. 提交
git add package.json
git commit -m "chore: bump openclaw to vX.Y.Z"
```

### 20.7 本地 Openclaw 扩展（openclaw-extensions/）

PetClaw 维护 2 个**本地扩展**，它们是 Openclaw 插件（遵循 `openclaw/plugin-sdk` 接口），但源码在 PetClaw 仓库内，不从 npm 安装：

#### ask-user-question

**职责**：让 Agent 在执行危险操作前弹出结构化确认弹窗。

**工作原理**：
1. Agent 调用 `AskUserQuestion` 工具，传入问题 + 选项（2-4 个）
2. 插件通过 HTTP POST 回调 App（`callbackUrl`），携带 `x-ask-user-secret` 头
3. App 在 Renderer 显示审批弹窗，用户选择后返回 `{ behavior: 'allow'|'deny', answers }`
4. 120s 超时自动 deny

**启用条件**：
- `callbackUrl` + `secret` 由 ConfigSync 写入 `openclaw.json` 的插件配置
- 仅桌面端会话（`sessionKey.startsWith('agent:main:petclaw:')`）启用，IM 渠道会话不注册此工具

#### mcp-bridge

**职责**：将 App 管理的 MCP 服务器工具暴露为 Openclaw 原生工具。

**工作原理**：
1. ConfigSync 将 McpManager 中所有已启用 MCP 服务器的工具列表写入 `openclaw.json` 插件配置
2. 插件为每个 MCP 工具注册一个代理 tool（名称格式 `mcp_{server}_{tool}`）
3. Agent 调用代理 tool → 插件 HTTP POST 回调 App → App 调用实际 MCP 服务器 → 返回结果

**配置字段**：`callbackUrl`、`secret`、`requestTimeoutMs`（默认 120s）、`tools`（工具描述数组）

#### 构建流程

```
开发阶段：
  sync-local-openclaw-extensions.cjs
    → 将 openclaw-extensions/*/ 复制到 vendor/openclaw-runtime/current/third-party-extensions/

打包阶段：
  electron-builder-hooks.cjs → ensureBundledLocalExtensions()
    → 检测 mcp-bridge + ask-user-question 是否已编译
    → 未编译 → sync + precompile（esbuild TS→JS）
    → 已编译 → 跳过
```

---

## 21. 启动流程

> **对照现有代码**：当前 `index.ts` → `runBootCheck()` → `bootcheck.ts` 的 `runNormalBoot()`/`runUpgradeBoot()`。
> v3 将 bootcheck 中的运行时安装/Gateway 启动/配置生成逻辑拆分到 EngineManager + ConfigSync，
> bootcheck.ts 退化为薄编排层（调用各 Manager），BootCheckPanel UI 保留但步骤精简。

```
app.whenReady()
  → initDatabase()
  → createChatWindow()                          // 显示 BootCheckPanel
  → runBootCheck(chatWindow)
      ├── OpenclawEngineManager.resolveRuntimeMetadata()
      ├── 创建目录（{userData}/openclaw/state/{workspace,agents,logs,bin} + {userData}/SKILLs）
      ├── syncBuiltinSkills()                       // 内置 skills 同步
      ├── AgentManager.ensurePresetAgents()       // ★ 确保 main agent
      ├── ModelRegistry.load()
      ├── McpManager.load()                       // ★
      ├── ConfigSync.sync('boot')                 // 生成 openclaw.json
      ├── OpenclawEngineManager.startGateway()    // utilityProcess.fork
      └── 返回 GatewayConnection
  → boot:complete → ChatApp:
      ├── Onboarding → OnboardingPanel
      └── main → app:pet-ready
  → createPetWindow()
  → registerAllIpc(ctx)
  → OpenclawGateway.connect()
  → PetEventBridge(petWindow, coworkCtrl, imGw, scheduler, hookSvr) // ★ 宠物联动
  → SkillManager.scan() + startWatching()
  → ImGateway.startAll()                         // ★ 启动 IM 连接
  → SchedulerManager.start()                     // ★ 启动定时任务
```

---

## 22. 数据流

### 22.1 用户发送消息

```
Renderer ChatInputBox → IPC chat:send { text, cwd, files, activeSkillIds, agentId }
  → CoworkController.handleSend()
    → SessionManager.create/get(session)
    → buildOutboundPrompt(session, text, skillPrompt)
    → gateway.chatSend({ sessionKey, message, attachments })
  → Gateway 事件流:
    chat.reply → IPC chat:chunk → Renderer 渲染
    exec.approval.requested → IPC approval:request → 审批弹窗
    chat.done → IPC chat:done → 完成
```

### 22.2 IM 消息流

```
手机 IM 发消息 → ImGateway 接收
  → platformAgentBindings 查 agentId
  → im_session_mappings 查/创 cowork_session
  → CoworkController.send(sessionId, message)
  → Agent 执行 → 结果
  → ImGateway 推送到 IM
```

### 22.3 定时任务触发

```
SchedulerManager Cron 触发
  → 创建 Cowork 会话
  → CoworkController.send(sessionId, task.prompt)
  → Agent 执行 → 结果
  → 如果 im_push_enabled → ImGateway 推送
```

### 22.4 宠物动画联动

v3 新增多个事件源（CoworkController、ImGateway、SchedulerManager、Exec Approval），需要统一驱动宠物状态机。

#### 22.4.1 PetEventBridge（主进程事件聚合层）

新增 `src/main/pet/pet-event-bridge.ts`，订阅所有事件源，统一转换为 IPC 推送到 Pet 窗口：

```
事件源（主进程）            PetEventBridge               Pet 窗口（渲染进程）
┌──────────────────┐                                  ┌─────────────────────┐
│ CoworkController │─message──────┐                   │                     │
│                  │─messageUpdate┤                    │  PetStateMachine    │
│                  │─complete─────┤  ┌──────────────┐  │  （6 状态不变）      │
│                  │─error────────┤  │              │  │                     │
│                  │─permission───┤─▶│PetEventBridge│─▶│  PetCanvas          │
│ ImGateway        │─im:received──┤  │              │  │  （9 视频不变）      │
│ SchedulerManager │─task:fired───┤  └──────────────┘  │                     │
│ HookServer       │─hook:event───┤        IPC         │  气泡文本           │
└──────────────────┘              │                    └─────────────────────┘
```

```typescript
// src/main/pet/pet-event-bridge.ts

export class PetEventBridge {
  private activeSessionCount = 0

  constructor(
    private petWindow: BrowserWindow,
    private coworkController: CoworkController,
    private imGateway: ImGateway,
    private schedulerManager: SchedulerManager,
    private hookServer: HookServer,
  ) {
    this.subscribe()
  }

  private subscribe(): void {
    // CoworkController 事件
    this.coworkController.on('message', (sessionId, msg) => {
      if (msg.type === 'user') {
        this.sessionStarted(sessionId, 'chat')
        this.sendEvent('ChatSent')
        this.sendBubble(`发送: ${truncate(msg.content, 30)}`, 'chat')
      }
    })
    this.coworkController.on('messageUpdate', (sessionId, _msgId, content) => {
      // 首次 update → AIResponding
      if (this.isFirstUpdate(sessionId)) {
        this.sendEvent('AIResponding')
      }
      this.sendBubble(truncate(content, 30), 'chat')
    })
    this.coworkController.on('complete', (sessionId) => {
      this.sessionEnded(sessionId)
      this.sendBubble('任务完成', 'system')
    })
    this.coworkController.on('error', (sessionId) => {
      this.sessionEnded(sessionId)
    })
    this.coworkController.on('permissionRequest', (_sessionId, req) => {
      // 不切换状态，保持 Working，气泡提示审批
      this.sendBubble(`等待审批: ${req.tool}`, 'approval')
    })

    // IM 消息触发
    this.imGateway.on('session:created', (sessionId, platform) => {
      this.sessionStarted(sessionId, 'im')
      this.sendEvent('ChatSent')
      this.sendBubble(`[${platform}] 收到新任务`, 'im')
    })

    // 定时任务触发
    this.schedulerManager.on('task:fired', (sessionId, taskName) => {
      this.sessionStarted(sessionId, 'scheduler')
      this.sendEvent('ChatSent')
      this.sendBubble(`[定时] ${taskName}`, 'scheduler')
    })

    // Hook 事件
    this.hookServer.onEvent((event) => {
      if (event.type === 'session_end') {
        this.sendEvent('HookIdle')
      } else {
        this.sendEvent('HookActive')
      }
      this.petWindow.webContents.send('hook:event', event)
    })
  }

  // 多会话计数：全部完成才触发 AIDone
  private sessionStarted(sessionId: string, _source: string): void {
    this.activeSessionCount++
  }

  private sessionEnded(sessionId: string): void {
    this.activeSessionCount = Math.max(0, this.activeSessionCount - 1)
    if (this.activeSessionCount === 0) {
      this.sendEvent('AIDone')
    }
  }

  private sendEvent(event: string): void {
    this.petWindow.webContents.send('pet:state-event', { event })
  }

  private sendBubble(text: string, source: string): void {
    this.petWindow.webContents.send('pet:bubble', { text, source })
  }
}
```

#### 22.4.2 事件映射表

| 事件源 | 触发条件 | PetEvent | 宠物动画 |
|--------|----------|----------|----------|
| CoworkController | user message | `ChatSent` | Idle → Thinking（listening） |
| CoworkController | 首次 messageUpdate | `AIResponding` | Thinking → Working（task-start → task-loop） |
| CoworkController | complete（且无其他活跃会话） | `AIDone` | Working → Happy（task-leave） → 3s Idle |
| CoworkController | error（且无其他活跃会话） | `AIDone` | 同上 |
| CoworkController | permissionRequest | —（不切换） | 保持 Working，气泡显示审批内容 |
| ImGateway | 收到 IM 消息创建会话 | `ChatSent` | Idle → Thinking |
| SchedulerManager | 定时任务触发 | `ChatSent` | Idle → Thinking |
| HookServer | tool 活跃 | `HookActive` | Idle → Working |
| HookServer | session 结束 | `HookIdle` | Working → Idle |
| 用户交互 | 拖拽 | `DragStart`/`DragEnd` | → Dragging → Idle |
| 用户交互 | 2 分钟无活动 | `SleepStart` | Idle → Sleep |
| 用户交互 | 有新活动 | `WakeUp` | Sleep → Idle（sleep-leave 过渡） |

#### 22.4.3 多会话冲突策略

v3 支持多会话并行（用户本地聊天 + IM 转发 + 定时任务），PetEventBridge 维护 `activeSessionCount`：

```
会话 A 开始 → count 0→1 → ChatSent → Thinking
会话 A 首次输出 → AIResponding → Working
会话 B（IM）开始 → count 1→2 → 已在 Working，不切换
会话 A 完成 → count 2→1 → 不触发 AIDone，继续 Working
会话 B 完成 → count 1→0 → AIDone → Happy → 3s → Idle
```

**关键规则**：
- `ChatSent` / `AIResponding`：任何会话触发都推送（状态机内部幂等，Working → Working 无效）
- `AIDone`：仅当 `activeSessionCount` 降为 0 时触发
- `SleepStart`：仅当 `activeSessionCount === 0` 且 Idle 持续 2 分钟

#### 22.4.4 气泡文本协议

Pet 窗口气泡（speech bubble）从显示 AI 文本 chunk 扩展为多源信息：

| source | 触发 | 气泡内容示例 |
|--------|------|-------------|
| `chat` | AI 流式输出 | "正在分析数据..." |
| `im` | IM 消息到达 | "[飞书] 收到新任务" |
| `scheduler` | 定时任务执行 | "[定时] 每日科技新闻" |
| `approval` | 权限审批等待 | "等待审批: rm -rf build/" |
| `system` | 任务完成 | "任务完成" |

气泡逻辑：显示 3 秒后自动消失，新消息覆盖旧消息。

#### 22.4.5 IPC Channel 变更

**v1 → v3 Pet 窗口 IPC 变更**：

| v1 Channel | v3 替代 | 说明 |
|------------|---------|------|
| `pet:chat-sent` | `pet:state-event` | 合并到统一事件 |
| `chat:ai-responding`（pet） | `pet:state-event` | 合并到统一事件 |
| `chat:done`（pet） | `pet:state-event` | 合并到统一事件 |
| `chat:error`（pet） | `pet:state-event` | 合并到统一事件 |
| `chat:chunk`（pet） | `pet:bubble` | 气泡专用 channel |
| — | `pet:state-event` | **新增**：`{ event: PetEvent }` |
| — | `pet:bubble` | **新增**：`{ text: string, source: string }` |
| `hook:event` | `hook:event` | 不变，PetEventBridge 透传 |
| `pet:toggle-pause` | `pet:toggle-pause` | 不变 |
| `pet:context-menu` | `pet:context-menu` | 不变 |

**渲染进程消费方式变更**：

```typescript
// v1 App.tsx — 多个独立监听
window.api.onChatSent(() => machine.send(PetEvent.ChatSent))
window.api.onAIResponding(() => machine.send(PetEvent.AIResponding))
window.api.onChatDone(() => { machine.send(PetEvent.AIDone); ... })

// v3 App.tsx — 统一事件入口
window.api.onPetStateEvent(({ event }) => {
  machine.send(PetEvent[event])
  if (event === 'AIDone') setTimeout(() => machine.send(PetEvent.Timeout), 3000)
})
window.api.onPetBubble(({ text, source }) => {
  setBubbleText(text)
  setBubbleVisible(true)
})
```

#### 22.4.6 PetEventBridge 初始化时机

在 §21 启动流程中，PetEventBridge 在所有事件源就绪后创建：

```
→ boot:complete
→ createPetWindow()
→ registerAllIpc(ctx)
→ OpenclawGateway.connect()
→ PetEventBridge(petWindow, coworkController, imGateway, schedulerManager, hookServer)  // ★
→ SkillManager.scan()
→ ImGateway.startAll()
→ SchedulerManager.start()
```

#### 22.4.7 不变的部分

| 模块 | 文件 | 说明 |
|------|------|------|
| 状态机 | `pet/state-machine.ts` | 6 状态 + 10 事件 + 转换表完全不变 |
| 视频播放 | `pet/PetCanvas.tsx` | 双缓冲播放器 + 9 个 WebM 素材不变 |
| 睡眠机制 | `PetCanvas.tsx` onSleepTimeout | 2 分钟 Idle 自动入睡不变 |
| 拖拽交互 | `App.tsx` handleDragMove/End | 拖拽逻辑不变 |

#### 22.4.8 透明区域点击穿透

**问题**：Pet 窗口 180×145 透明矩形中，猫咪只占一小部分，但整个矩形都拦截鼠标事件，导致点击猫周围的桌面空白区域也会触发拖拽/打开聊天。

**方案**：`setIgnoreMouseEvents` + offscreen canvas 逐帧 alpha 检测。

```
┌─────────────────────┐
│  透明区域（穿透）     │   鼠标在此 → 事件穿透到桌面
│    ┌───────────┐     │
│    │  猫咪像素  │     │   鼠标在此 → 可点击/拖拽
│    │ (alpha>0) │     │
│    └───────────┘     │
│  透明区域（穿透）     │
└─────────────────────┘
```

**工作原理**：

```
1. 主进程：petWindow.setIgnoreMouseEvents(true, { forward: true })
   → 窗口默认穿透点击，但仍然接收 mousemove 事件

2. 渲染进程：requestAnimationFrame 循环（~15fps）
   → 将当前 <video> 活跃帧绘制到 offscreen canvas
   → 缓存 ImageData（alpha 通道数据）

3. 渲染进程：mousemove 事件
   → 从缓存 ImageData 读取 (x, y) 处 alpha 值   O(1)
   → alpha > 10?
       是 → IPC pet:set-ignore-mouse(false)   → 捕获点击
       否 → IPC pet:set-ignore-mouse(true)    → 穿透到桌面

4. 主进程：收到 IPC
   → petWindow.setIgnoreMouseEvents(value, { forward: true })
```

**实现要点**：

```typescript
// PetCanvas.tsx — alpha 采样逻辑

const ALPHA_THRESHOLD = 10
const SAMPLE_FPS = 15

class AlphaHitTester {
  private canvas: OffscreenCanvas
  private ctx: OffscreenCanvasRenderingContext2D
  private imageData: ImageData | null = null
  private frameTimer = 0

  constructor(width: number, height: number) {
    this.canvas = new OffscreenCanvas(width, height)
    this.ctx = this.canvas.getContext('2d')!
  }

  // 定期从活跃 video 元素刷新 alpha 缓存
  startSampling(getActiveVideo: () => HTMLVideoElement): void {
    const sample = (): void => {
      const video = getActiveVideo()
      if (video.readyState >= 2) {
        this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height)
        this.imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
      }
      this.frameTimer = setTimeout(sample, 1000 / SAMPLE_FPS) as unknown as number
    }
    sample()
  }

  // mousemove 时调用，O(1) 查表
  isOpaque(x: number, y: number): boolean {
    if (!this.imageData) return true  // 无数据时默认不穿透
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) return false
    const idx = (py * this.canvas.width + px) * 4
    return this.imageData.data[idx + 3] > ALPHA_THRESHOLD  // alpha 通道
  }

  stop(): void {
    clearTimeout(this.frameTimer)
  }
}
```

```typescript
// App.tsx（Pet 窗口）— mousemove 处理

const lastIgnored = useRef<boolean | null>(null)

const handleMouseMove = useCallback((e: React.MouseEvent) => {
  const rect = e.currentTarget.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const opaque = alphaHitTester.isOpaque(x, y)
  const shouldIgnore = !opaque

  // 防抖：状态不变时不发 IPC
  if (shouldIgnore !== lastIgnored.current) {
    lastIgnored.current = shouldIgnore
    window.api.setPetIgnoreMouse(shouldIgnore)
  }

  // 只在不穿透时处理拖拽
  if (!shouldIgnore && isMouseDown.current) {
    // 原有拖拽逻辑...
  }
}, [])
```

**IPC 新增**：

| Channel | 方向 | 说明 |
|---------|------|------|
| `pet:set-ignore-mouse` | pet→main | `boolean`，true=穿透 false=捕获 |

```typescript
// index.ts（主进程）
ipcMain.on('pet:set-ignore-mouse', (_event, ignore: boolean) => {
  petWindow?.setIgnoreMouseEvents(ignore, { forward: true })
})
```

**性能特性**：
- alpha 缓存刷新：~15fps，每帧 drawImage + getImageData（180×145 = 26K 像素，~0.1ms）
- mousemove 查表：O(1) 数组下标访问，无 GC 压力
- IPC 调用：防抖后每次穿透/非穿透切换才发送，通常每秒 0-2 次

---

## 23. 文件结构

### 23.1 Monorepo 根目录

```
petclaw/                               # pnpm monorepo 根目录
├── petclaw-desktop/                   # Electron 桌面应用（Phase 1-2，当前重点）
├── petclaw-web/                       # Next.js 营销官网（Phase 3）
├── petclaw-api/                       # 后端服务：认证/支付/订阅（Phase 3）
├── petclaw-shared/                    # 共享类型/常量（按需创建）
│
├── .ai/                               # AI 协作文档主入口（README.md）
├── docs/                              # 设计文档 / 规格 / 计划
│   └── superpowers/
│       ├── specs/                     # 设计规格
│       └── plans/                     # 实现计划
├── 设计/                               # UI 设计稿（Figma 导出）
│
├── package.json                       # Root：husky + commitlint + lint-staged（不装业务依赖）
├── pnpm-workspace.yaml                # Monorepo workspace 声明
├── pnpm-lock.yaml                     # 全局依赖锁定（所有子包共享一份）
├── commitlint.config.mjs             # Commit message 格式校验（feat:/fix:/chore: 等）
├── .editorconfig                      # 编辑器统一配置（2 空格缩进、UTF-8、末尾换行）
├── .husky/                            # Git hooks
│   ├── pre-commit                     # → lint-staged（prettier + eslint 自动修复）
│   └── commit-msg                     # → commitlint（校验 commit message 格式）
├── .gitignore
├── .github/                           # GitHub Actions CI/CD
│   └── workflows/
│       ├── build-platforms.yml        # 多平台构建 + Release
│       └── openclaw-check.yml         # PR 验证（lint + typecheck + test）
├── CLAUDE.md                          # Claude Code 项目指令
├── AGENTS.md                          # AI Agent 协作指令
└── README.md
```

### 23.2 petclaw-desktop 子包

```
petclaw-desktop/
├── src/
│   ├── main/                          # ═══ Electron 主进程 ═══
│   │   ├── index.ts                   # 入口：窗口创建 + 启动编排
│   │   ├── bootcheck.ts              # 启动检查（调用各 Manager）
│   │   ├── app-settings.ts           # 全局设置 + 默认值集中定义
│   │   ├── database-path.ts          # SQLite 路径解析 + 迁移
│   │   │
│   │   ├── ai/                        # 基础层：运行时 + 通信 + 配置
│   │   │   ├── engine-manager.ts      #   OpenclawEngineManager（进程生命周期）
│   │   │   ├── gateway.ts             #   OpenclawGateway（GatewayClient 动态加载）
│   │   │   ├── session-manager.ts     #   SessionManager（会话 CRUD）
│   │   │   ├── cowork-controller.ts   #   CoworkController（执行 + 审批 + 流式事件）
│   │   │   └── config-sync.ts         #   ConfigSync（openclaw.json 生成）
│   │   │
│   │   ├── agents/                    # 核心层：多 Agent
│   │   │   └── agent-manager.ts       #   AgentManager（CRUD + 预设 + 激活）
│   │   │
│   │   ├── skills/                    # 功能层：技能管理
│   │   │   ├── skill-manager.ts       #   SkillManager（扫描/安装/启用）
│   │   │   └── skill-scanner.ts       #   技能目录扫描器
│   │   │
│   │   ├── models/                    # 功能层：模型配置
│   │   │   └── model-registry.ts      #   ModelRegistry（多 Provider + 测试连接）
│   │   │
│   │   ├── memory/                    # 功能层：持久记忆
│   │   │   └── memory-manager.ts      #   MemoryManager（MEMORY.md 读写）
│   │   │
│   │   ├── mcp/                       # 功能层：MCP 服务器
│   │   │   └── mcp-manager.ts         #   McpManager（CRUD + ConfigSync）
│   │   │
│   │   ├── im/                        # 集成层：IM 网关
│   │   │   ├── im-gateway.ts          #   ImGateway（统一入口）
│   │   │   ├── im-store.ts            #   IM 数据存取（im_config + session_mappings）
│   │   │   ├── platforms/             #   各平台适配器
│   │   │   │   ├── telegram.ts
│   │   │   │   ├── dingtalk.ts
│   │   │   │   ├── feishu.ts
│   │   │   │   ├── discord.ts
│   │   │   │   ├── wechat.ts
│   │   │   │   ├── wecom.ts
│   │   │   │   └── yunxin.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── scheduler/                 # 集成层：定时任务
│   │   │   └── scheduler-manager.ts   #   SchedulerManager（Cron 调度）
│   │   │
│   │   ├── workspace/                 # 工程层：（已合并到 ConfigSync）
│   │   │   └── (空，workspace 文件由 ConfigSync 管理)
│   │   │
│   │   ├── pet/                       # 宠物联动层
│   │   │   └── pet-event-bridge.ts    #   PetEventBridge（事件聚合 → Pet 窗口）
│   │   │
│   │   ├── ipc/                       # 工程层：IPC 路由（模块化）
│   │   │   ├── index.ts               #   注册入口（registerAllIpc）
│   │   │   ├── chat-ipc.ts
│   │   │   ├── agent-ipc.ts
│   │   │   ├── skill-ipc.ts
│   │   │   ├── model-ipc.ts
│   │   │   ├── mcp-ipc.ts
│   │   │   ├── im-ipc.ts
│   │   │   ├── scheduler-ipc.ts
│   │   │   └── settings-ipc.ts
│   │   │
│   │   └── data/                      # 工程层：数据库
│   │       └── database.ts            #   SQLite 初始化 + 表创建 + 迁移
│   │
│   ├── preload/                       # ═══ Preload 安全桥接 ═══
│   │   ├── index.ts                   # contextBridge 暴露 API
│   │   └── index.d.ts                 # 类型声明（IPC channel 全覆盖）
│   │
│   └── renderer/src/                  # ═══ React 前端 ═══
│       ├── App.tsx                    # 根组件
│       ├── chat/                      # 聊天模块
│       │   ├── ChatApp.tsx
│       │   └── components/
│       │       ├── ChatView.tsx
│       │       ├── ChatInputBox.tsx   # 输入框（cwd + 附件 + 技能）
│       │       ├── MonitorView.tsx
│       │       ├── SettingsView.tsx
│       │       ├── Sidebar.tsx
│       │       ├── StatusBar.tsx
│       │       └── TitleBar.tsx
│       ├── panels/                    # 启动/引导面板
│       │   ├── BootCheckPanel.tsx
│       │   └── OnboardingPanel.tsx
│       ├── pet/                       # 宠物动画
│       │   ├── PetCanvas.tsx
│       │   └── state-machine.ts
│       └── stores/                    # Zustand 状态
│
├── scripts/                           # ═══ 构建脚本（13 个） ═══
│   ├── ensure-openclaw-version.cjs    # git checkout 锁定版本
│   ├── run-build-openclaw-runtime.cjs # 跨平台 bash 启动器
│   ├── build-openclaw-runtime.sh      # 核心构建（7 步）
│   ├── sync-openclaw-runtime-current.cjs  # symlink current/
│   ├── bundle-openclaw-gateway.cjs    # esbuild 单文件 bundle
│   ├── openclaw-runtime-host.cjs      # 检测平台架构
│   ├── ensure-openclaw-plugins.cjs    # 下载安装 IM 插件
│   ├── sync-local-openclaw-extensions.cjs  # symlink 本地扩展
│   ├── precompile-openclaw-extensions.cjs  # 预编译 TS 扩展
│   ├── install-openclaw-channel-deps.cjs   # 修复 channel 依赖
│   ├── prune-openclaw-runtime.cjs     # 裁剪 runtime 体积
│   ├── pack-openclaw-tar.cjs          # Windows tar 打包
│   ├── finalize-openclaw-runtime.cjs  # 开发模式 asar 刷新
│   └── notarize.js                    # macOS 公证脚本
│
├── openclaw-extensions/                # ═══ 本地 Openclaw 扩展（2 个） ═══
│   ├── ask-user-question/             #   结构化用户确认工具
│   │   ├── openclaw.plugin.json       #     插件元数据（id + configSchema）
│   │   ├── package.json               #     私有包声明
│   │   └── index.ts                   #     实现：HTTP 回调 → App 审批弹窗
│   └── mcp-bridge/                    #   MCP 服务器桥接工具
│       ├── openclaw.plugin.json
│       ├── package.json
│       └── index.ts                   #     实现：代理调用 App 管理的 MCP 工具
│
├── vendor/                            # ═══ Openclaw Runtime 构建产物 ═══
│   └── openclaw-runtime/
│       ├── current/                   # → symlink → darwin-arm64/（或当前平台）
│       ├── darwin-arm64/
│       ├── darwin-x64/
│       ├── win-x64/
│       └── linux-x64/
│
├── resources/                         # ═══ 打包资源 ═══
│   └── tray/                          # 托盘图标
│
├── SKILLs/                            # ═══ 内置技能（28 个，源码） ═══
│   ├── skills.config.json             # 技能启停与排序配置
│   ├── web-search/                    # Web 搜索
│   ├── docx/                          # Word 文档生成
│   ├── xlsx/                          # Excel 表格
│   ├── pptx/                          # PowerPoint 演示
│   ├── pdf/                           # PDF 处理
│   ├── remotion/                      # 视频生成（Remotion）
│   ├── seedance/                      # AI 视频生成（Seedance）
│   ├── seedream/                      # AI 图片生成（Seedream）
│   ├── playwright/                    # Web 自动化
│   ├── canvas-design/                 # Canvas 绘图设计
│   ├── frontend-design/               # 前端 UI 设计
│   ├── develop-web-game/              # Web 游戏开发
│   ├── stock-analyzer/                # 股票深度分析
│   ├── stock-announcements/           # 股票公告获取
│   ├── stock-explorer/                # 股票信息探索
│   ├── content-planner/               # 内容规划
│   ├── article-writer/                # 文章撰写
│   ├── daily-trending/                # 每日热榜
│   ├── films-search/                  # 影视资源搜索
│   ├── music-search/                  # 音乐资源搜索
│   ├── technology-news-search/        # 科技资讯搜索
│   ├── weather/                       # 天气查询
│   ├── local-tools/                   # 本地系统工具
│   ├── imap-smtp-email/               # 邮件收发
│   ├── create-plan/                   # 计划编排
│   ├── skill-vetter/                  # 技能安全审查
│   ├── skill-creator/                 # 自定义技能创建
│   └── youdaonote/                    # 有道云笔记（可选）
│
├── build/                             # ═══ 签名 / 图标 ═══
│   ├── icons/
│   │   ├── mac/icon.icns
│   │   ├── win/icon.ico
│   │   └── png/                       # Linux 多尺寸
│   ├── entitlements.mac.plist         # macOS 权限声明
│   └── entitlements.mac.inherit.plist
│
├── electron-builder.json              # 打包配置（独立文件）
├── electron.vite.config.ts            # electron-vite 配置
├── tsconfig.node.json                 # 主进程 TS 配置
├── tsconfig.web.json                  # 渲染进程 TS 配置
└── package.json                       # 子包：依赖 + scripts + openclaw 版本锁定
```

### 23.3 用户数据目录（{userData}）

> `{userData}` = `app.getPath('userData')`，详见 §4.2。

```
{userData}/                              # app.getPath('userData')
├── petclaw.db                           # SQLite 数据库
├── openclaw/                            # OPENCLAW_HOME
│   └── state/                           # OPENCLAW_STATE_DIR
│       ├── openclaw.json                # ConfigSync 唯一写入（运行时配置）
│       ├── gateway-token                # 每次启动重新生成
│       ├── gateway-port.json            # { port, updatedAt }
│       ├── .compile-cache/              # V8 编译缓存
│       ├── bin/                         # CLI shims（petclaw, openclaw, claw）
│       ├── logs/
│       │   └── gateway.log              # Gateway 进程日志
│       ├── workspace/                   # 默认 workspace（main agent）
│       │   ├── SOUL.md
│       │   ├── AGENTS_CHAT.md / AGENTS_WORK.md
│       │   ├── MEMORY.md
│       │   ├── USER.md
│       │   └── memory/
│       └── agents/main/                 # Openclaw agent 数据
│           ├── agent/
│           └── sessions/
├── SKILLs/                              # Skills 集中管理目录（从 Resources 同步）
├── cowork/bin/                          # node/npm/npx shim
└── logs/                                # Electron 应用日志

# 注意：v3 使用 utilityProcess.fork()（Electron 自带 Node.js 运行时），
# 不再需要独立 Node.js。Openclaw runtime 捆绑在 App 内：
#   生产: Resources/petmind/
#   开发: vendor/openclaw-runtime/current/
# v1 的 ~/.petclaw/node/ 目录在 v3 迁移后移除。
```

---

## 24. 开发到上线流程

### 24.1 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 24 < 25 | Electron 40 要求 |
| npm | >= 10 | 包管理 |
| Git | >= 2.30 | Openclaw 源码管理 |
| pnpm | >= 9 | Openclaw runtime 构建时需要 |

### 24.2 首次开发设置

```bash
# 1. 克隆仓库
git clone https://github.com/xxx/petclaw.git
cd petclaw/petclaw-desktop

# 2. 安装依赖
npm install

# 3. 首次运行：自动克隆并构建 Openclaw（可能需要几分钟）
npm run electron:dev:openclaw
```

首次执行 `electron:dev:openclaw` 时会：
1. 克隆 `../openclaw` 仓库并切换到锁定版本
2. 执行完整构建流水线（§20.2 的 13 个步骤）
3. 启动 Vite dev server + Electron 热重载

### 24.3 日常开发

```bash
# 常规开发（Openclaw 版本未变，自动跳过构建）
npm run electron:dev:openclaw

# 仅前端开发（不需要 Openclaw 变更时）
npm run electron:dev

# 强制重建 Openclaw（即使版本未变）
OPENCLAW_FORCE_BUILD=1 npm run electron:dev:openclaw

# 本地开发 Openclaw 源码时（跳过版本切换，使用本地修改）
OPENCLAW_SKIP_ENSURE=1 npm run electron:dev:openclaw

# 覆盖 Openclaw 源码路径
OPENCLAW_SRC=/path/to/openclaw npm run electron:dev:openclaw
```

开发服务器默认运行在 `http://localhost:5173`。

### 24.4 手动构建 Openclaw Runtime

```bash
# 按当前主机平台自动选择 target
npm run openclaw:runtime:host

# 显式指定目标平台
npm run openclaw:runtime:mac-arm64
npm run openclaw:runtime:mac-x64
npm run openclaw:runtime:win-x64
npm run openclaw:runtime:linux-x64
```

构建结果带缓存：如果本地已存在对应版本的 runtime（`runtime-build-info.json` 匹配），构建步骤自动跳过。

### 24.5 代码质量

```bash
# 类型检查
npm run typecheck

# ESLint 代码检查
npm run lint

# 运行全部测试
npm test

# 指定模块测试
npm test -- engine-manager
npm test -- config-sync
```

测试文件与源文件同目录，使用 `.test.ts` 扩展名：
```
src/main/ai/
├── engine-manager.ts
└── engine-manager.test.ts
```

### 24.6 package.json 完整设计

v3 的 package.json 变化：移除 `build` 字段（迁到 `electron-builder.json`）、新增 `openclaw` 配置和完整构建脚本、移除 `ws` 依赖、新增 IM/Cron/MCP 相关依赖。

```jsonc
{
  "name": "petclaw-desktop",
  "private": true,
  "version": "0.1.0",
  "description": "AI Desktop Pet Assistant",
  "main": "./out/main/index.js",
  "author": {
    "name": "PetClaw"
  },
  "license": "MIT",

  // ─── Openclaw 版本锁定 + 插件声明 ───
  "openclaw": {
    "version": "v2026.3.2",
    "repo": "https://github.com/openclaw/openclaw.git",
    "plugins": [
      // IM 平台插件
      { "id": "dingtalk-connector", "npm": "@dingtalk-real-ai/dingtalk-connector", "version": "0.8.16" },   // 钉钉
      { "id": "openclaw-lark", "npm": "@larksuite/openclaw-lark", "version": "2026.4.7" },                  // 飞书
      { "id": "wecom-openclaw-plugin", "npm": "@wecom/wecom-openclaw-plugin", "version": "2026.4.3" },      // 企业微信
      { "id": "openclaw-weixin", "npm": "@tencent-weixin/openclaw-weixin", "version": "2.1.7" },            // 微信
      { "id": "openclaw-nim-channel", "npm": "openclaw-nim-channel", "version": "1.1.1" },                  // 云信 IM
      { "id": "clawemail-email", "npm": "@clawemail/email", "version": "0.9.12" }                           // 邮件 IMAP/SMTP
      // 不包含：moltbot-popo（网易内部）、openclaw-netease-bee（网易内部）
    ]
  },

  // ─── Node.js 版本约束 ───
  "engines": {
    "node": ">=24 <25"
  },

  // ─── Scripts ───
  "scripts": {
    // == 开发 ==
    "dev": "electron-vite dev",                          // 纯前端+Electron（不管 Openclaw）
    "dev:openclaw": "npm run openclaw:runtime:host && npm run dev",  // 带 Openclaw 构建的完整开发
    "build": "electron-vite build",                      // 编译 TypeScript + Vite 打包
    "preview": "electron-vite preview",

    // == 代码质量 ==
    "typecheck": "npm run typecheck:node && npm run typecheck:web",
    "typecheck:node": "tsc --noEmit -p tsconfig.node.json",
    "typecheck:web": "tsc --noEmit -p tsconfig.web.json",
    "lint": "eslint . --max-warnings 0",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",

    // == Openclaw Runtime 构建 ==
    "openclaw:ensure": "node scripts/ensure-openclaw-version.cjs",
    "openclaw:runtime:host": "node scripts/openclaw-runtime-host.cjs",        // 自动检测平台
    "openclaw:runtime:mac-arm64": "npm run openclaw:ensure && node scripts/run-build-openclaw-runtime.cjs mac-arm64 && node scripts/sync-openclaw-runtime-current.cjs mac-arm64 && npm run openclaw:bundle && npm run openclaw:plugins && npm run openclaw:extensions:local && npm run openclaw:precompile && npm run openclaw:channel-deps && npm run openclaw:prune",
    "openclaw:runtime:mac-x64":   "npm run openclaw:ensure && node scripts/run-build-openclaw-runtime.cjs mac-x64   && node scripts/sync-openclaw-runtime-current.cjs mac-x64   && npm run openclaw:bundle && npm run openclaw:plugins && npm run openclaw:extensions:local && npm run openclaw:precompile && npm run openclaw:channel-deps && npm run openclaw:prune",
    "openclaw:runtime:win-x64":   "npm run openclaw:ensure && node scripts/run-build-openclaw-runtime.cjs win-x64   && node scripts/sync-openclaw-runtime-current.cjs win-x64   && npm run openclaw:bundle && npm run openclaw:plugins && npm run openclaw:extensions:local && npm run openclaw:precompile && npm run openclaw:channel-deps && npm run openclaw:prune",
    "openclaw:runtime:linux-x64": "npm run openclaw:ensure && node scripts/run-build-openclaw-runtime.cjs linux-x64 && node scripts/sync-openclaw-runtime-current.cjs linux-x64 && npm run openclaw:bundle && npm run openclaw:plugins && npm run openclaw:extensions:local && npm run openclaw:precompile && npm run openclaw:channel-deps && npm run openclaw:prune",
    "openclaw:bundle": "node scripts/bundle-openclaw-gateway.cjs",
    "openclaw:plugins": "node scripts/ensure-openclaw-plugins.cjs",
    "openclaw:extensions:local": "node scripts/sync-local-openclaw-extensions.cjs",
    "openclaw:precompile": "node scripts/precompile-openclaw-extensions.cjs",
    "openclaw:channel-deps": "node scripts/install-openclaw-channel-deps.cjs",
    "openclaw:prune": "node scripts/prune-openclaw-runtime.cjs",
    "openclaw:finalize": "node scripts/finalize-openclaw-runtime.cjs",

    // == 打包分发 ==
    "predist:mac": "npm run build && npm run openclaw:runtime:mac-arm64",
    "dist:mac": "electron-builder --mac --config electron-builder.json",
    "dist:mac:arm64": "npm run build && npm run openclaw:runtime:mac-arm64 && electron-builder --mac --arm64",
    "dist:mac:x64": "npm run build && npm run openclaw:runtime:mac-x64 && electron-builder --mac --x64",
    "dist:mac:universal": "npm run build && electron-builder --mac --universal",
    "predist:win": "npm run openclaw:runtime:win-x64",
    "dist:win": "npm run build && electron-builder --win --x64",
    "predist:linux": "npm run openclaw:runtime:linux-x64",
    "dist:linux": "npm run build && electron-builder --linux",
    "clean:release": "rimraf release",

    // == 安装钩子 ==
    "postinstall": "electron-rebuild -f -w better-sqlite3"
  },

  // ─── 生产依赖 ───
  "dependencies": {
    // Electron
    "@electron-toolkit/utils": "^3.0.0",

    // UI
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "lucide-react": "^1.8.0",
    "pixi.js": "^8.0.0",

    // 状态管理
    "zustand": "^5.0.0",

    // 数据库
    "better-sqlite3": "^11.0.0",

    // Markdown 渲染（Cowork 消息展示）
    "react-markdown": "^10.0.0",
    "remark-gfm": "^4.0.1",
    "remark-math": "^6.0.0",
    "rehype-katex": "^7.0.1",
    "react-syntax-highlighter": "^15.6.1",

    // Cron 定时任务
    "cron-parser": "^5.5.0",
    "cronstrue": "^3.14.0",           // Cron 表达式可读化（"每天早上9点"）

    // IM SDK
    "@larksuiteoapi/node-sdk": "^1.58.0",        // 飞书
    "nim-web-sdk-ng": "10.9.77-alpha.4",          // 网易云信

    // 安全
    "dompurify": "^3.3.1",            // HTML sanitize（Markdown 渲染）

    // 工具
    "uuid": "^11.1.0",
    "zod": "^4.3.6",                  // 运行时类型校验（IPC payload 等）
    "electron-log": "^5.4.3",
    "tar": "^7.5.11"                  // Windows tar 解压
  },

  // ─── 开发依赖 ───
  "devDependencies": {
    // Electron 工具链
    "electron": "^40.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^3.0.0",
    "@electron/rebuild": "^3.0.0",

    // TypeScript
    "typescript": "^5.7.0",
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/better-sqlite3": "^7.0.0",
    "@types/dompurify": "^3.0.5",
    "@types/react-syntax-highlighter": "^15.5.13",
    "@types/uuid": "^10.0.0",

    // 构建
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^6.0.0",
    "esbuild": "^0.21.5",             // Openclaw gateway bundle

    // 样式
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0",

    // 代码质量
    "eslint": "^9.0.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "eslint-plugin-react-refresh": "^0.4.0",
    "eslint-plugin-simple-import-sort": "^12.1.1",
    "typescript-eslint": "^8.0.0",
    "globals": "^15.0.0",
    "prettier": "^3.0.0",
    "husky": "^9.1.7",
    "lint-staged": "^16.0.0",

    // 测试
    "vitest": "^3.0.0",
    "jsdom": "^25.0.0",

    // 工具
    "rimraf": "^5.0.5",
    "cross-env": "^7.0.3"
  },

  // ─── Lint Staged ───
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix --max-warnings 0", "prettier --write"],
    "*.{json,css}": ["prettier --write"]
  }

  // 注意：build 字段已迁移到独立的 electron-builder.json
}
```

**对比现有 package.json 的变化**：

| 变化 | 旧 | 新 |
|------|-----|-----|
| `openclaw` 字段 | 无 | 版本锁定 + plugins 列表 |
| `engines` | 无 | `node >=24 <25` |
| `build` 字段 | 在 package.json 内 | 迁到 `electron-builder.json` |
| `ws` 依赖 | 有（WebSocket 客户端） | **删除**（utilityProcess 不需要） |
| `@types/ws` | 有 | **删除** |
| `scripts` | 12 个 | 35+ 个（新增 openclaw 构建链 + dist 平台打包） |
| Markdown 渲染 | 无 | 新增 react-markdown + remark-gfm + rehype-katex |
| IM SDK | 无 | 新增 @larksuiteoapi/node-sdk + nim-web-sdk-ng |
| Cron | 无 | 新增 cron-parser + cronstrue |
| HTML sanitize | 无 | 新增 dompurify |
| 日志 | 无 | 新增 electron-log |
| 类型校验 | 无 | 新增 zod |
| tar 解压 | 无 | 新增 tar（Windows 安装解压） |
| esbuild | 无 | 新增（Openclaw gateway bundle） |
| husky | 无 | 新增（git hooks） |

### 24.7 生产打包

使用 [electron-builder](https://www.electron.build/) 生成各平台安装包，输出到 `release/` 目录。

```bash
# macOS (.dmg)
npm run dist:mac

# macOS - Apple Silicon
npm run dist:mac:arm64

# macOS - Intel
npm run dist:mac:x64

# macOS - Universal (双架构)
npm run dist:mac:universal

# Windows (.exe NSIS 安装包)
npm run dist:win

# Linux (.AppImage)
npm run dist:linux
```

打包时自动执行 Openclaw runtime 构建（如果本地没有缓存）。Runtime 捆绑到 `Resources/petmind`。

使用独立的 `electron-builder.json` 文件（从 `package.json` 的 `build` 字段迁出）：

```jsonc
// electron-builder.json
{
  "appId": "ai.petclaw.desktop",
  "productName": "PetClaw",
  "executableName": "PetClaw",
  "directories": {
    "output": "release"
  },

  // ─── 打包进 asar 的源文件 ───
  "files": [
    "package.json",
    { "from": "dist", "to": "dist", "filter": ["**/*"] },           // Vite 构建产物
    { "from": "dist-electron", "to": "dist-electron", "filter": ["**/*"] },  // electron-vite 构建产物
    "!**/*.map",           // 排除 source map
    "!**/*.d.ts",          // 排除类型声明
    "!**/*.d.cts",
    "!**/*.d.mts",
    "!**/README.md",
    "!**/CHANGELOG.md",
    "!**/LICENSE",
    "!**/LICENSE.md",
    "!**/*.test.*",        // 排除测试文件
    "!**/*.spec.*",
    "!**/tests/**",
    "!**/test/**",
    "!**/__tests__/**"
  ],

  // ─── 所有平台共享的 extraResources ───
  "extraResources": [
    { "from": "resources/tray", "to": "tray", "filter": ["**/*"] }
  ],

  // ─── URL Scheme 注册 ───
  "protocols": [
    { "name": "PetClaw", "schemes": ["petclaw"] }
  ],

  // ─── asar 解包（native 模块必须在 asar 外才能加载） ───
  "asar": true,
  "asarUnpack": [
    "node_modules/better-sqlite3/**"
  ],

  // ═══════════════════════════════════════
  //  macOS
  // ═══════════════════════════════════════
  "mac": {
    "target": ["dmg", "zip"],                    // zip 用于 electron-updater 增量更新
    "icon": "build/icons/mac/icon.icns",
    "category": "public.app-category.productivity",
    "hardenedRuntime": true,                     // macOS 公证要求
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist",
    "extendInfo": {
      "CFBundleIconName": "icon"
    },
    "extraResources": [
      {
        "from": "SKILLs",                             // 内置技能
        "to": "SKILLs",
        "filter": [
          "**/*",
          "!**/.env", "!**/.env.*", "!**/.venv", "!**/.venv/**",
          "!**/*.map", "!**/*.d.ts", "!**/*.d.cts", "!**/*.d.mts",
          "!**/README.md", "!**/CHANGELOG.md", "!**/LICENSE", "!**/LICENSE.md",
          "!**/*.test.*", "!**/*.spec.*", "!**/tests/**", "!**/test/**"
        ]
      },
      {
        "from": "vendor/openclaw-runtime/current",  // Openclaw runtime
        "to": "petmind",
        "filter": [
          "**/*",
          "!**/*.map", "!**/*.d.ts", "!**/*.d.cts", "!**/*.d.mts",
          "!**/README.md", "!**/CHANGELOG.md", "!**/LICENSE", "!**/LICENSE.md",
          "!**/*.test.*", "!**/*.spec.*", "!**/tests/**", "!**/test/**"
        ]
      }
    ]
  },
  "dmg": {
    "sign": false                                // DMG 不签名（app 本身已签名）
  },
  "afterSign": "scripts/notarize.js",            // macOS 公证脚本

  // ═══════════════════════════════════════
  //  Windows
  // ═══════════════════════════════════════
  "win": {
    "target": ["nsis"],
    "icon": "build/icons/win/icon.ico",
    "requestedExecutionLevel": "asInvoker",      // 不请求管理员权限
    "extraResources": [
      {
        "from": "build-tar/win-resources.tar",   // runtime 打成 tar（NSIS 复制万级小文件极慢）
        "to": "win-resources.tar"
      },
      {
        "from": "scripts/unpack-petmind.cjs",     // 首次启动时解压 tar → petmind/
        "to": "unpack-petmind.cjs"
      }
    ]
  },
  "nsis": {
    "oneClick": false,                           // 非一键安装，显示向导
    "allowToChangeInstallationDirectory": true,   // 可选安装路径
    "runAfterFinish": true,                      // 安装完自动启动
    "deleteAppDataOnUninstall": true,            // 卸载时清理用户数据
    "include": "scripts/nsis-installer.nsh"      // 自定义 NSIS 脚本（解压 tar 等）
  },

  // ═══════════════════════════════════════
  //  Linux
  // ═══════════════════════════════════════
  "linux": {
    "target": ["AppImage", "deb"],
    "icon": "build/icons/png",
    "category": "Utility",
    "extraResources": [
      {
        "from": "SKILLs",
        "to": "SKILLs",
        "filter": [
          "**/*",
          "!**/.env", "!**/.env.*", "!**/.venv", "!**/.venv/**",
          "!**/*.map", "!**/*.d.ts", "!**/*.d.cts", "!**/*.d.mts",
          "!**/README.md", "!**/CHANGELOG.md", "!**/LICENSE", "!**/LICENSE.md",
          "!**/*.test.*", "!**/*.spec.*", "!**/tests/**", "!**/test/**"
        ]
      },
      {
        "from": "vendor/openclaw-runtime/current",
        "to": "petmind",
        "filter": [
          "**/*",
          "!**/*.map", "!**/*.d.ts", "!**/*.d.cts", "!**/*.d.mts",
          "!**/README.md", "!**/CHANGELOG.md", "!**/LICENSE", "!**/LICENSE.md",
          "!**/*.test.*", "!**/*.spec.*", "!**/tests/**", "!**/test/**"
        ]
      }
    ],
    "desktop": {
      "Name": "PetClaw",
      "Comment": "AI desktop assistant with pet companion",
      "Terminal": "false"
    }
  },

  "npmRebuild": true,
  "nativeRebuilder": "sequential"
}
```

**关键设计决策**：

| 决策 | 原因 |
|------|------|
| 独立 `electron-builder.json` 而非 package.json build 字段 | 配置量大，独立文件更清晰 |
| Mac/Linux 直接复制 runtime，Windows 用 tar | NSIS 复制上万小文件需要几分钟，tar 解压只需几秒 |
| `better-sqlite3` asarUnpack | Native addon 必须在 asar 外才能加载 |
| Mac hardenedRuntime + afterSign notarize | macOS 分发必须签名+公证，否则用户无法打开 |
| NSIS 非一键安装 | 允许用户选择安装路径，体验更好 |
| `petclaw://` URL Scheme | 支持从浏览器/IM 链接唤起 App |
| 文件排除列表 | 去掉 .map/.d.ts/README/测试，减小安装包体积 |

**Windows tar 机制**：
1. 构建时：`pack-openclaw-tar.cjs` 把 runtime + skills 打成 `win-resources.tar`
2. 安装时：NSIS 自定义脚本（`nsis-installer.nsh`）调用 `unpack-petmind.cjs` 解压
3. 首次启动：检测 petmind 目录是否存在，不存在则解压

### 24.8 自动更新

使用 `electron-updater`，发布到 GitHub Releases / S3 / 自建服务器。App 启动时检查更新，后台下载，用户确认后安装重启。

### 24.9 CI/CD（GitHub Actions）

```yaml
# .github/workflows/build-platforms.yml
name: Build & Release
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: mac-arm64
          - os: macos-13
            target: mac-x64
          - os: windows-latest
            target: win-x64
          - os: ubuntu-latest
            target: linux-x64
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm install
      - name: Build Openclaw Runtime (cached)
        run: npm run openclaw:runtime:${{ matrix.target }}
      - name: Package
        run: npm run dist:${{ matrix.target }}
      - uses: actions/upload-artifact@v4
        with:
          name: release-${{ matrix.target }}
          path: release/*
```

```yaml
# .github/workflows/openclaw-check.yml — PR 验证
name: Openclaw Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm install
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
```

### 24.10 完整开发流程（带命令）

```bash
# ═══════════════════════════════════════════════
# 阶段 1：首次环境搭建（只需执行一次）
# ═══════════════════════════════════════════════

git clone https://github.com/xxx/petclaw.git
cd petclaw/petclaw-desktop
npm install                          # 安装 Electron + React + 所有 npm 依赖
npm run electron:dev:openclaw        # 首次运行：自动 clone openclaw 源码 + 完整构建
                                     # 内部执行顺序：
                                     #   1. ensure-openclaw-version   — git clone ../openclaw && checkout v2026.3.2
                                     #   2. build-openclaw-runtime    — pnpm install → tsc → 打包 asar → 生成入口
                                     #   3. sync-openclaw-current     — symlink current/ → darwin-arm64/
                                     #   4. bundle-openclaw-gateway   — esbuild 1100个ESM → 1个文件(27MB)
                                     #   5. ensure-openclaw-plugins   — 下载 IM 插件(飞书/钉钉等)
                                     #   6. sync-local-extensions     — symlink 本地扩展
                                     #   7. precompile-extensions     — esbuild 预编译 TS 扩展
                                     #   8. install-channel-deps      — 修复 channel 缺失依赖
                                     #   9. prune-openclaw-runtime    — 裁剪体积(删 .map/.d.ts, stub 未用包)
                                     # 然后启动 Vite dev server + Electron

# ═══════════════════════════════════════════════
# 阶段 2：日常开发（每天重复）
# ═══════════════════════════════════════════════

npm run electron:dev:openclaw        # 后续运行：检测 runtime-build-info.json 版本匹配 → 跳过构建 → 直接启动
# 或
npm run electron:dev                 # 只启动前端+Electron，不检查 Openclaw（纯 UI 开发时用）

# 特殊场景：
OPENCLAW_FORCE_BUILD=1 npm run electron:dev:openclaw   # 强制重建（改了 openclaw 源码后）
OPENCLAW_SKIP_ENSURE=1 npm run electron:dev:openclaw   # 跳过版本切换（本地调试 openclaw 时）
OPENCLAW_SRC=/other/path npm run electron:dev:openclaw  # 指定 openclaw 源码路径

# ═══════════════════════════════════════════════
# 阶段 3：提交前检查 
# ═══════════════════════════════════════════════

# 手动检查（CI 也会跑，但建议提交前先本地过一遍）
npm run typecheck                    # tsc --noEmit 类型检查
npm run lint                         # ESLint 代码检查
npm test                             # Vitest 单元测试
npm test -- engine-manager           # 只跑指定模块的测试

# 自动检查（git commit 时自动触发，无需手动执行）
# ┌─ .husky/pre-commit ──────────────────────────────────────────┐
# │  lint-staged（根 package.json 配置）                           │
# │    *.{ts,tsx} → prettier --write + eslint --fix              │
# │    *.{json,css} → prettier --write                           │
# └──────────────────────────────────────────────────────────────┘
# ┌─ .husky/commit-msg ─────────────────────────────────────────┐
# │  commitlint（commitlint.config.mjs）                         │
# │    强制 conventional commits 格式：                            │
# │    feat: / fix: / chore: / refactor: / docs: / test:        │
# │    示例：feat(desktop): add model registry                   │
# └──────────────────────────────────────────────────────────────┘
# ┌─ .editorconfig ─────────────────────────────────────────────┐
# │  编辑器自动应用（不是 hook，保存时生效）：                        │
# │    缩进 2 空格、UTF-8、末尾换行、去除行尾空格                     │
# └──────────────────────────────────────────────────────────────┘
#
# 完整流程：
#   编码 → 保存（.editorconfig 格式化）
#     → git commit
#       → pre-commit hook → lint-staged（prettier + eslint 自动修复）
#       → commit-msg hook → commitlint（校验消息格式）
#       → 全部通过 → 提交成功

# ═══════════════════════════════════════════════
# 阶段 4：升级 Openclaw 版本
# ═══════════════════════════════════════════════

vim package.json                     # 修改 openclaw.version: "v2026.3.2" → "v2026.4.0"
npm run electron:dev:openclaw        # 自动检测版本变更 → 重新 checkout + 完整构建
git add package.json
git commit -m "chore: bump openclaw to v2026.4.0"

# ═══════════════════════════════════════════════
# 阶段 5：生产打包
# ═══════════════════════════════════════════════

npm run dist:mac:arm64               # → release/PetClaw-x.y.z-arm64.dmg
npm run dist:mac:x64                 # → release/PetClaw-x.y.z-x64.dmg
npm run dist:mac:universal           # → release/PetClaw-x.y.z-universal.dmg（双架构）
npm run dist:win                     # → release/PetClaw-x.y.z-Setup.exe（NSIS 安装包）
npm run dist:linux                   # → release/PetClaw-x.y.z.AppImage
                                     # 打包时自动构建 Openclaw runtime（有缓存则跳过）
                                     # runtime 捆绑到 app 内的 Resources/petmind/

# ═══════════════════════════════════════════════
# 阶段 6：发布（CI 自动 or 手动）
# ═══════════════════════════════════════════════

git tag v1.0.0                       # 打版本 tag
git push origin v1.0.0               # 推送 tag → 触发 GitHub Actions
                                     # CI 自动：npm install → openclaw:runtime → dist → 上传 Release
                                     # 用户端：electron-updater 检测新版本 → 后台下载 → 提示安装
```

---

## 25. 实现分期

### Phase 1: 基础架构重构（替换运行时管理）

**新建文件**：
- `ai/engine-manager.ts` — OpenclawEngineManager
- `ai/gateway.ts` — OpenclawGateway（GatewayClient 动态加载）
- `ai/config-sync.ts` — ConfigSync
- `ai/session-manager.ts` — SessionManager
- `ai/cowork-controller.ts` — CoworkController
- `ai/cowork-store.ts` — CoworkStore（会话/消息持久化，对应 LobsterAI coworkStore.ts）
- （WorkspaceManager 已合并到 ConfigSync，不再单独创建）

**重构文件**：
- `bootcheck.ts` — 删除 installNode/installOpenclaw/ensurePetclawCli/ensureGatewayProcess/waitForGateway/stopExistingGateway/checkModelConfig/syncWorkspaceMd，重写为调用 EngineManager + ConfigSync
- `index.ts` — 启动流程改为 v3 §21 时序
- `ipc.ts` — 拆分到 `ipc/*.ts` 模块化
- `preload/index.ts` + `preload/index.d.ts` — 同步新增/删除的 IPC channel
- `database-path.ts` — 迁移路径从 `~/.petclaw/data/` 调整为 `{userData}/petclaw.db`
- `App.tsx`（Pet 窗口） — 从多个 IPC 监听改为 `pet:state-event` + `pet:bubble` 统一入口

**删除文件/代码**：
- `ai/openclaw.ts` — 整体替换为 OpenclawGateway
- `ai/provider.ts` — 删除 AIProvider 抽象层
- `ws` npm 依赖 — 移除
- v1 `~/.petclaw/node/` 目录逻辑 — 清理
- v1 `petclaw-settings.json` 读写逻辑 — 配置迁移到 SQLite kv 表

**不动的文件**：
- `state-machine.ts` / `PetCanvas.tsx` — 宠物动画系统（状态机 + 视频播放器不变）
- `hooks/` — Hook 系统
- `BootCheckPanel.tsx` — UI 保留，步骤数量精简
- `OnboardingPanel.tsx` — UI 保留，配置写入目标调整
- `app-settings.ts` — 保留默认值定义（端口、URL 等），不再管理 JSON 文件读写

### Phase 2: 核心功能

**新建文件**：
- `agents/agent-manager.ts` — AgentManager
- `models/model-registry.ts` — ModelRegistry（配置持久化到 DB kv 表）
- `skills/skill-manager.ts` — SkillManager
- `memory/memory-manager.ts` — MemoryManager
- `mcp/mcp-manager.ts` — McpManager
- `data/database.ts` — 新建统一 DB 访问层（kv/agents/mcp_servers/im_config 等表）
- 前端：ChatInputBox 组件（cwd + 附件 + 技能选择）
- 前端：Settings 子页面（模型配置 + Agent 配置 + MCP）

**重构文件**：
- `ChatView.tsx` — 集成新 ChatInputBox

### Phase 3: 集成功能 ✅ 已实现

**新增文件（实际路径）**：

主进程：
- `src/main/scheduler/types.ts` — Schedule/ScheduledTask/TaskState/ScheduledTaskRun 类型定义
- `src/main/scheduler/cron-job-service.ts` — Gateway RPC 代理，所有定时任务 CRUD 委托给 OpenClaw `cron.*` RPC
- `src/main/im/types.ts` — Platform(4个)/IMMessage/IMSettings/IMPlatformConfig 类型定义
- `src/main/im/im-gateway-manager.ts` — IM 平台配置管理 + 会话路由映射
- `src/main/ipc/scheduler-ipc.ts` — 定时任务 IPC handlers（`scheduler:*` 前缀）
- `src/main/ipc/im-ipc.ts` — IM 配置 IPC handlers（`im:*` 前缀）
- `src/main/pet/pet-event-bridge.ts` — PetEventBridge 多源事件聚合（已扩展支持 IM/Cron/Hook）

渲染层：
- `src/renderer/src/chat/components/CoworkPermissionModal.tsx` — Exec Approval 审批弹窗（三种模式）
- `src/renderer/src/chat/components/AgentConfigDialog.tsx` — Agent 三 Tab 配置对话框（基础/技能/IM）
- `src/renderer/src/chat/components/AgentSkillSelector.tsx` — Agent 技能多选子组件
- `src/renderer/src/chat/components/ImChannelsPage.tsx` — IM 频道主视图（ViewType `'im-channels'`）
- `src/renderer/src/chat/components/ImConfigDialog.tsx` — IM 配置弹窗（左平台列表+右配置面板）
- `src/renderer/src/chat/components/CronPage.tsx` — 定时任务管理 UI（两栏卡片+两 Tab）
- `src/renderer/src/chat/components/CronEditDialog.tsx` — 定时任务编辑弹窗

**扩展**：
- OnboardingPanel — 已重构为 5 步（permissions/profile/skills/shortcut/first-chat）

### Phase 4: 工程化 ✅

- electron-builder 全平台打包配置（`electron-builder.json` + `build/entitlements.mac.plist`）
- electron-updater 自动更新（`src/main/auto-updater.ts`）
- CI/CD pipeline（`.github/workflows/ci.yml` + `build-platforms.yml` + `openclaw-check.yml`）
- Openclaw 版本管理 13 个构建脚本（`scripts/*.cjs` + `scripts/build-openclaw-runtime.sh`）
- electron-builder hooks（`scripts/electron-builder-hooks.cjs` + `scripts/notarize.js` + `scripts/nsis-installer.nsh`）
- 本地扩展（`openclaw-extensions/ask-user-question/` + `openclaw-extensions/mcp-bridge/`）

### 现有代码保留清单

以下模块在 v3 全阶段**不涉及重构**，直接保留：

| 模块 | 文件 | 说明 |
|------|------|------|
| 宠物状态机 | `pet/state-machine.ts` | 6 状态 + 转换表不变 |
| 宠物视频 | `pet/PetCanvas.tsx` | 双缓冲播放器 + 9 个 WebM 不变 |
| Hook 系统 | `hooks/server.ts` / `installer.ts` / `bridge` | Unix socket 监控 |
| 窗口管理 | `index.ts` 窗口创建部分 | Pet + Chat 双窗口架构 |
| UI 设计系统 | `chat.css` token / Tailwind 配置 | 色彩、圆角、动效规范 |
| 系统集成 | `system/tray.ts` / `shortcuts.ts` | 托盘 + 全局快捷键 |
| DB 路径 | `database-path.ts` | SQLite 路径解析 + 迁移 |
| BootCheck UI | `BootCheckPanel.tsx` | 进度动画（步骤数量精简） |
| Onboarding UI | `OnboardingPanel.tsx` | 5 步向导（配置写入目标调整） |

---

## 26. 验证标准

### Phase 1 验证
- `npx tsc --noEmit` 类型检查通过
- `{userData}/` 跨平台路径正确解析（macOS/Windows/Linux）
- BootCheck 首次启动：目录创建 + Skills 同步 + Gateway 启动完整流程
- OpenclawEngineManager 检测捆绑 runtime（petmind/），Gateway 通过 utilityProcess 启动
- 健康检查 + 自动重启（指数退避）工作正常
- GatewayClient 动态加载，chat.send 消息正常流转
- ConfigSync.sync() → `{userData}/openclaw/state/openclaw.json` 生成正确 → Gateway 热加载
- ConfigSync 聚合逻辑：Skills 路径、MCP 配置、Agent workspace、本地扩展回调均正确写入 openclaw.json
- ConfigSync 安全性：API Key 不出现在 openclaw.json（仅写入 provider ID + model ID）
- CoworkStore 会话/消息 CRUD → SQLite 持久化
- CoworkController 流式事件完整（message → messageUpdate → complete/error）
- executionMode 切换正常（auto/local/sandbox）
- v1 → v3 数据迁移：`petclaw-settings.json` → DB kv 表
- IPC channel 三处同步（ipc/*.ts + preload/index.ts + preload/index.d.ts）
- Pet 窗口适配：`pet:state-event` + `pet:bubble` 统一入口工作正常
- 删除 `{userData}/` → 重启 → 自动初始化

### Phase 2 验证
- AgentManager CRUD → DB 持久化 → ConfigSync 同步
- ModelRegistry 多 Provider 配置，API Key 不出现在 openclaw.json
- SkillManager 扫描返回正确列表，安装/卸载/启用/禁用触发 ConfigSync
- McpManager CRUD → DB 持久化 → ConfigSync 同步
- MemoryManager 读写 MEMORY.md 正常
- ChatInputBox: cwd 选择（添加文件夹 + 最近使用）、文件附件预览（图片缩略图 + 文件图标）、多技能选择
- Settings 前端：模型配置页面正确展示 Provider 列表 + 添加/编辑/删除 Provider + 测试连接反馈
- Settings 前端：Agent 配置页面正确展示 Agent 列表 + 创建/编辑/删除 Agent + 绑定 model/skills
- Settings 前端：MCP 配置页面正确展示服务器列表 + 添加/编辑/删除 + 传输协议选择

### Phase 3 验证
- Exec Approval 审批流程完整（permissionRequest → CoworkPermissionModal → respondToPermission → 继续/中止）
- ImGateway 各平台连接/断开/消息路由正常
- SchedulerManager Cron 调度触发正常
- SchedulerManager 前端：GUI 创建/编辑/删除定时任务 + Cron 表达式可视化输入 + 绑定 Agent 和 IM 推送目标
- PetEventBridge: 本地聊天 → Thinking → Working → Happy → Idle 动画完整
- PetEventBridge: IM 消息触发 → 宠物 Working + 气泡显示来源平台
- PetEventBridge: 定时任务触发 → 宠物 Working + 气泡显示任务名
- PetEventBridge: 多会话并行 → 持续 Working，全部完成才 Happy
- PetEventBridge: Exec Approval → 保持 Working + 气泡提示审批工具
- PetEventBridge: 2 分钟无活跃会话 → Sleep
- Pet 窗口: 透明区域点击穿透到桌面，猫咪像素区域可拖拽/点击（alpha 检测）
- Onboarding 扩展：AI 对话引导正常完成 → 推荐 skills 列表展示 → StarterCards 可点击触发首次对话

### Phase 4 验证
- electron-builder 全平台打包（macOS dmg/zip + Windows NSIS/portable + Linux AppImage/deb）
- 自动更新：发布 → 检测 → 下载 → 安装 流程正常
- CI/CD: push → build → test → package 全链路通过
- Openclaw 版本管理：`package.json` 中 `openclaw.version` 变更后 `openclaw:ensure` 自动 checkout 到锁定版本
- Openclaw 版本管理：`runtime-build-info.json` 缓存命中时跳过构建，版本变更时触发重新构建
- Openclaw 版本管理：升级后运行回归测试（WebSocket 通信 + Hook 事件 + 手动验证清单）通过
