# PetClaw 架构设计 v3 — 完整蓝图

**日期**: 2026-04-22
**状态**: 设计完成，待实现
**范围**: 全功能架构（运行时管理、多 Agent、Cowork 执行、模型配置、技能系统、持久记忆、IM 机器人、定时任务、MCP 服务器、聊天输入框、权限审批、开发到上线流程）
**取代**: v2 规格（2026-04-22-petclaw-architecture-v2.md）

---

## 1. 设计目标

将 PetClaw 从"简化 WebSocket 客户端 + 硬编码单模型"升级为**对标 LobsterAI 的全功能 AI 桌面应用**：

1. **运行时管理** — 捆绑 Openclaw runtime，utilityProcess.fork() 启动，动态端口、健康检查、自动重启
2. **多 Agent 管理** — DB 持久化 agents 表，预设 + 自定义 Agent，per-agent 模型/技能/IM 绑定
3. **Cowork 执行模式** — auto/local 两种模式，流式事件协议，Exec Approval 权限审批
4. **模型配置** — 11 个预设厂商 + 自定义提供商，API Key 安全注入，测试连接
5. **技能系统** — 完整 skill 生命周期（扫描/安装/卸载/启用/禁用）
6. **持久记忆** — 纯文件驱动（MEMORY.md），Agent 自主读写
7. **IM 机器人** — 9 大平台接入，多实例，KV 配置，Agent 绑定
8. **定时任务** — Cron 调度，对话式 + GUI 创建，IM 推送
9. **MCP 服务器** — stdio/sse/streamable-http 三种传输，DB 持久化
10. **聊天输入框** — 工作目录选择、文件附件预览、技能多选弹窗、发送快捷键
11. **Openclaw 版本管理** — package.json 锁定版本，自动构建 + 缓存
12. **开发到上线流程** — 完整的构建、打包、分发流水线

### 参考来源

- LobsterAI 源码（sqliteStore.ts、imStore.ts、im/types.ts、coworkStore.ts、FolderSelectorPopover.tsx、AttachmentCard.tsx、CoworkPromptInput.tsx）
- Openclaw Gateway 协议（129 RPC 方法 + 22 事件）
- PetClaw 设计稿（模型配置.png、自定义模型配置.png、IM机器人.png、agent内置.png、多agent.png、agent配置.png）

---

## 2. 总体架构

### 六层架构

```
┌─────────────────── 前端层 (Renderer) ──────────────────┐
│  ChatView · SettingsView · AgentSelector · PetCanvas   │
│  ChatInputBox · SkillPopover · AttachmentCard          │
├──────────────── contextBridge (preload) ────────────────┤
│                                                         │
│  ┌─────────────── 集成层 ───────────────┐              │
│  │  ImGateway · SchedulerManager        │              │
│  └─────────────────────────────────────┘              │
│                                                         │
│  ┌─────────────── 功能层 ───────────────┐              │
│  │  SkillManager · ModelRegistry         │              │
│  │  MemoryManager · McpManager           │              │
│  └─────────────────────────────────────┘              │
│                                                         │
│  ┌─────────────── 核心层 ───────────────┐              │
│  │  AgentManager · SessionManager        │              │
│  │  CoworkController                     │              │
│  └─────────────────────────────────────┘              │
│                                                         │
│  ┌─────────────── 基础层 ───────────────┐              │
│  │  OpenclawEngineManager · OpenclawGW   │              │
│  │  ConfigSync                           │              │
│  └─────────────────────────────────────┘              │
│                                                         │
│  ┌─────────────── 工程层 ───────────────┐              │
│  │  WorkspaceManager · IPC Router        │              │
│  │  Database (SQLite) · BootCheck        │              │
│  └─────────────────────────────────────┘              │
│                                                         │
│                Electron Main Process                    │
└─────────────────────────────────────────────────────────┘
         ↕ WebSocket (GatewayClient)
┌─────────────────────────────────────────────────────────┐
│     Openclaw Runtime (utilityProcess / bundled)           │
│  · LLM 调用 · Tool 执行 · Skill prompt 注入              │
│  · Session 管理 · Exec Approvals                         │
└─────────────────────────────────────────────────────────┘
```

### 模块职责总表

| 层 | 模块 | 职责 |
|---|------|------|
| **基础层** | OpenclawEngineManager | Runtime 生命周期（resolve/start/stop/restart/health） |
| | OpenclawGateway | GatewayClient 动态加载，连接管理，事件分发 |
| | ConfigSync | 唯一写入 openclaw.json，同步所有 Manager 状态 |
| **核心层** | AgentManager | Agent CRUD（预设+自定义），DB 持久化 |
| | SessionManager | 会话生命周期（创建/发送/中止），cwd + model 绑定 |
| | CoworkController | 执行模式（auto/local），流式事件，Exec Approval |
| **功能层** | SkillManager | Skill 扫描/安装/卸载/启用/禁用 |
| | ModelRegistry | Provider/Model CRUD，测试连接，API Key 安全 |
| | MemoryManager | 纯文件 MEMORY.md 读写 |
| | McpManager | MCP 服务器配置 CRUD，DB 持久化 |
| **集成层** | ImGateway | 9 大 IM 平台接入，消息路由，Agent 绑定 |
| | SchedulerManager | Cron 定时任务调度 |
| **工程层** | WorkspaceManager | 模板同步、内置 skills 初始化 |
| | IPC Router | 模块化 IPC handler 注册 |
| | Database | SQLite 表管理（kv/sessions/messages/agents/mcp/im） |
| | BootCheck | 启动检查（runtime 检测 + 目录初始化） |
| **前端层** | ChatInputBox | 输入框 + cwd + 附件 + 技能选择 + 发送 |
| | AgentSelector | 侧边栏 Agent 切换 |
| | SettingsView | 设置面板（模型/IM/Agent/MCP） |

---

## 3. 基础层

### 3.1 OpenclawEngineManager — 运行时生命周期

管理 Openclaw runtime 的解析、启动、停止、重启和健康检查。

#### 运行时分发策略

App 捆绑 Openclaw runtime（不 npm install）：

| 环境 | runtime 路径 | 说明 |
|------|-------------|------|
| 开发 | `vendor/openclaw-runtime/current/` | 手动放置或脚本下载 |
| 生产 | `resources/cfmind/` (electron-builder extraResources) | 打包时复制 |

runtime 目录结构：
```
cfmind/
├── gateway-bundle.mjs          ← esbuild 单文件打包（~28MB）
├── dist/
│   ├── gateway/
│   │   ├── server.js           ← Gateway 入口
│   │   └── client.js           ← GatewayClient 模块
│   ├── plugin-sdk/
│   │   └── gateway-runtime.js  ← GatewayClient 备选入口
│   └── client.js               ← GatewayClient 备选入口
├── skills/                     ← bundled skills（52 个）
├── package.json
└── node_modules/
```

#### 核心接口

```typescript
// src/main/ai/engine-manager.ts

interface RuntimeMetadata {
  runtimeRoot: string
  openclawEntry: string       // Gateway 入口 JS
  clientEntryPath: string     // GatewayClient JS 模块
  version: string
}

interface GatewayConnection {
  port: number
  token: string
  clientEntryPath: string
}

export class OpenclawEngineManager extends EventEmitter {
  private process: Electron.UtilityProcess | null = null

  resolveRuntimeMetadata(): RuntimeMetadata
  async startGateway(): Promise<GatewayConnection>
  stopGateway(): void
}
```

#### Gateway 启动方式

**macOS**: `utilityProcess.fork(openclawEntry, args, options)`
**Windows**: `spawn(process.execPath, [openclawEntry, ...args], { env: { ELECTRON_RUN_AS_NODE: '1' } })`

#### 启动流程

1. 动态端口扫描（默认 18789，并行批量检测 10 个一组，上限 80 个）
2. 生成 Gateway token（`crypto.randomUUID()`，存 `STATE_DIR/gateway-token`）
3. 构建环境变量（含 Secret API Keys）
4. `utilityProcess.fork()` 启动 Gateway
5. 健康检查轮询（HTTP /health + TCP 可达性）
6. 生成 CLI shims（`STATE_DIR/bin/openclaw`、`STATE_DIR/bin/claw`）

#### 自动重启

指数退避: `[3s, 5s, 10s, 20s, 30s]`，最多 5 次。超过后 emit `fatal` 事件。

#### Secret 环境变量

API Keys **不写入 openclaw.json 明文**，通过环境变量注入 Gateway 进程：

```
petclaw-settings.json            Gateway env:
modelProviders[0].apiKey  ──→   OPENAI_API_KEY=sk-xxx
modelProviders[1].apiKey  ──→   ANTHROPIC_API_KEY=sk-xxx
```

#### V8 编译缓存

`NODE_COMPILE_CACHE=STATE_DIR/v8-compile-cache/`，加速后续启动 30-50%。

### 3.2 OpenclawGateway — 连接层

动态加载 Openclaw npm 包自带的 GatewayClient，替代手写 WebSocket。

```typescript
// src/main/ai/gateway.ts

export class OpenclawGateway extends EventEmitter {
  private client: GatewayClientLike | null = null

  async connect(opts: { url: string; token: string; clientEntryPath: string }): Promise<void>
  async request<T>(method: string, params?: unknown): Promise<T>
  async chatSend(params: ChatSendParams): Promise<ChatSendResult>
  async chatAbort(sessionKey: string, runId: string): Promise<void>
  async sessionsPatch(key: string, patch: SessionPatch): Promise<void>
  disconnect(): void
  isConnected(): boolean
}
```

**连接参数**：url=`ws://127.0.0.1:{port}`，role=`operator`，scopes=`['operator.admin']`，caps=`['tool-events']`

**事件分发**：通过 EventEmitter，按 Gateway event name 发射（`chat.reply`、`chat.done`、`exec.approval.requested` 等）。

### 3.3 ConfigSync — 配置同步

**唯一写入 openclaw.json 的模块**，汇总所有 Manager 状态。

```typescript
// src/main/ai/config-sync.ts

export class ConfigSync {
  constructor(
    private agentManager: AgentManager,
    private skillManager: SkillManager,
    private modelRegistry: ModelRegistry,
    private mcpManager: McpManager,
    private configPath: string,  // ~/.petclaw/openclaw.json
  ) {}

  sync(reason: string): SyncResult    // 全量重建 + 原子写入（tmp + rename）
  setCurrentWorkspace(workspace: string): void
  syncAgentsMd(workspaceDir: string, opts: AgentsMdOptions): void
}
```

**buildConfig 输出结构**：
```json
{
  "models": { "mode": "merge", "providers": { ... } },
  "agents": { "defaults": { "workspace": "...", "model": { "primary": "llm/xxx" } }, "list": [...] },
  "skills": { "entries": { ... }, "load": { "extraDirs": ["~/.petclaw/skills"], "watch": true } },
  "mcpServers": { ... },
  "gateway": { ... },
  "hooks": { "internal": { "entries": { "session-memory": { "enabled": false } } } }
}
```

---

## 4. 核心层

### 4.1 AgentManager — 多 Agent 管理

#### 工作原理

Agent 是用户与 AI 交互的"人格实例"。每个 Agent 有独立的系统提示词、绑定模型、启用技能、IM 渠道。系统预设一个 `main` Agent（不可删除），用户可创建自定义 Agent。

Agent 激活时，AgentManager 通知 ConfigSync 更新 openclaw.json 的 agents 配置，同时同步 workspace 目录下的 AGENTS.md。

#### 数据库表设计

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,             -- UUID 或 'main'
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  identity TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',   -- 'llm/provider/model' 格式
  icon TEXT NOT NULL DEFAULT '',    -- emoji 或图标标识
  skill_ids TEXT NOT NULL DEFAULT '[]',  -- JSON 数组
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default Integer NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'custom', -- 'preset' | 'custom'
  preset_id TEXT NOT NULL DEFAULT '',    -- 预设来源 ID
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**字段说明**：
- `source`: `preset`=系统预设（可重置），`custom`=用户创建
- `preset_id`: 预设 Agent 的来源标识（如 `coding-assistant`）
- `skill_ids`: Agent 可用的技能 ID 列表（JSON 数组）
- `model`: Openclaw 模型引用格式，如 `llm/openai/gpt-4o`

#### 核心接口

```typescript
export class AgentManager extends EventEmitter {
  create(opts: CreateAgentOpts): Agent
  update(id: string, patch: Partial<Agent>): Agent
  delete(id: string): void          // main Agent 不可删除
  list(): Agent[]
  get(id: string): Agent | null
  setActive(id: string): void       // 切换当前 Agent → 触发 ConfigSync
  resetPreset(id: string): void     // 重置预设 Agent 到出厂设置
}
```

#### 前端交互

**侧边栏 Agent 菜单**（参考设计图 `多agent.png`）：
- "我的 Agent" 菜单入口在侧边栏
- 下拉展示 Agent 列表（main + 自定义）
- 每个 Agent 显示 icon + name
- 底部 "+" 创建新 Agent
- 点击 Agent 切换当前激活 Agent

**Agent 配置弹窗**（参考 `agent配置.png`，3 个 Tab）：
- **基础信息**: name、icon、description、system_prompt、identity、model 选择
- **技能**: 勾选该 Agent 可用的技能列表
- **IM 渠道**: 绑定该 Agent 到哪些 IM 平台

#### 数据流

```
用户切换 Agent → AgentManager.setActive(id)
  → ConfigSync.sync('agent-changed')
    → openclaw.json agents.list 更新
    → AGENTS.md managed section 更新
  → SessionManager 创建新 session（绑定 agentId）
  → IPC agent:changed → Renderer 更新 UI
```

### 4.2 SessionManager — 会话管理

```typescript
export interface Session {
  id: string
  agentId: string
  sessionKey: string         // 'agent:{agentId}:petclaw:{sessionId}'
  workspace: string
  modelOverride?: string
  activeSkillIds?: string[]
  status: 'idle' | 'running' | 'error'
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export class SessionManager extends EventEmitter {
  create(opts: { workspace?: string; modelOverride?: string; agentId?: string; activeSkillIds?: string[] }): Session
  async send(sessionId: string, message: string, opts?: SendOptions): Promise<void>
  abort(sessionId: string): void
  async patchWorkspace(sessionId: string, workspace: string): Promise<void>
  listRecentCwds(limit?: number): string[]  // 从 sessions 表查询去重
}
```

**会话数据库表**：
```sql
CREATE TABLE cowork_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'main',
  session_key TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  pinned INTEGER NOT NULL DEFAULT 0,
  cwd TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  model_override TEXT NOT NULL DEFAULT '',
  active_skill_ids TEXT,           -- JSON 数组
  execution_mode TEXT,             -- 'auto' | 'local'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE cowork_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,               -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  metadata TEXT,                    -- JSON（tool calls, attachments 等）
  sequence INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_cowork_messages_session_id ON cowork_messages(session_id);
```

**最近工作目录查询**（和 LobsterAI 一致）：
```sql
SELECT cwd, updated_at FROM cowork_sessions
WHERE cwd IS NOT NULL AND TRIM(cwd) != ''
ORDER BY updated_at DESC
LIMIT ?
```
查询后在内存中去重 + 路径归一化，返回最近 8 个。

### 4.3 CoworkController — 执行控制

#### 工作原理

CoworkController 是会话执行的中枢。它协调 SessionManager（会话状态）和 OpenclawGateway（通信），管理执行模式和权限审批。

#### 执行模式

| 模式 | 说明 |
|------|------|
| `auto` | 自动根据上下文选择执行方式（默认） |
| `local` | 本地直接执行，全速运行 |

#### 流式事件协议

Cowork 通过 IPC 实现 Renderer 实时双向通信：

| 事件 | 方向 | 说明 |
|------|------|------|
| `message` | main→renderer | 新消息加入会话 |
| `messageUpdate` | main→renderer | 流式内容增量更新（delta） |
| `permissionRequest` | main→renderer | 工具执行需要用户审批 |
| `permissionResponse` | renderer→main | 用户审批结果 |
| `complete` | main→renderer | 会话执行完毕 |
| `error` | main→renderer | 执行出错 |

#### Exec Approval — 权限审批

所有涉及文件系统、终端命令、网络请求的工具调用需用户审批：

```typescript
interface ExecApproval {
  id: string
  sessionKey: string
  toolName: string            // 'bash', 'write', 'http' 等
  args: Record<string, unknown>
  description: string         // 人类可读的操作描述
  riskLevel: 'low' | 'medium' | 'high'
}

interface ApprovalResponse {
  approvalId: string
  decision: 'allow' | 'deny' | 'allow-session'  // 单次/拒绝/本会话自动批准
}
```

**自动批准规则**：
- `allow-session`: 本会话内同类工具自动批准（如批准了 bash 后，后续 bash 调用自动放行）
- 会话结束后自动批准失效

#### 数据流

```
用户发送消息 → CoworkController.send()
  → SessionManager.send() → Gateway.chatSend()
  → Gateway 事件流:
    chat.reply → IPC chat:chunk → Renderer 渲染
    exec.approval.requested → IPC approval:request → Renderer 弹窗
      → 用户审批 → IPC approval:respond → Gateway.request('exec.approval.respond')
    chat.done → IPC chat:done → Renderer
```

---

## 5. 功能层

### 5.1 SkillManager — 技能管理

```typescript
export interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
  isBuiltIn: boolean
  skillPath: string
  source: 'official' | 'custom'
  version?: string
  requires?: { bins?: string[]; env?: string[]; config?: string[] }
}

export class SkillManager extends EventEmitter {
  scan(): Promise<Skill[]>
  setEnabled(id: string, enabled: boolean): void
  install(source: string): Promise<Skill>
  uninstall(id: string): Promise<void>
  list(): Skill[]
  getEnabled(): Skill[]
  startWatching(): void
  stopWatching(): void
}
```

**Skills 存放位置**：`~/.petclaw/skills/`（App 统一管理目录），通过 `openclaw.json → skills.load.extraDirs` 注入。

**安装来源**：本地目录/zip、GitHub URL、ClawHub（`npx clawhub@latest install {id}`）。

### 5.2 ModelRegistry — 模型配置

#### 工作原理

ModelRegistry 管理 LLM 提供商和模型配置。预设 11 个主流厂商，用户可添加自定义提供商。API Key 存储在 `petclaw-settings.json`（本地），通过环境变量注入 Gateway 进程，不写入 openclaw.json 明文。

#### 预设提供商

| 提供商 | API 格式 | Base URL |
|--------|---------|----------|
| PetClaw | openai-completions | https://petclaw.ai/api/v1 |
| OpenAI | openai-completions | https://api.openai.com/v1 |
| Anthropic | anthropic | https://api.anthropic.com |
| Google Gemini | openai-completions | https://generativelanguage.googleapis.com/v1beta |
| DeepSeek | openai-completions | https://api.deepseek.com |
| 阿里通义 | openai-completions | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| 字节豆包 | openai-completions | https://ark.cn-beijing.volces.com/api/v3 |
| 智谱 GLM | openai-completions | https://open.bigmodel.cn/api/paas/v4 |
| 百度文心 | openai-completions | https://aip.baidubce.com/rpc/2.0 |
| Mistral | openai-completions | https://api.mistral.ai/v1 |
| Groq | openai-completions | https://api.groq.com/openai/v1 |

#### 数据结构

```typescript
export interface ModelProvider {
  id: string                // 'petclaw', 'openai', 'custom-1'
  name: string              // 显示名
  baseUrl: string
  apiKey: string            // 加密存储在 settings，不进 openclaw.json
  apiFormat: 'openai-completions' | 'anthropic'
  isPreset: boolean         // 预设厂商 vs 用户自定义
  models: ModelDefinition[]
}

export interface ModelDefinition {
  id: string                // 'gpt-4o', 'claude-sonnet-4-20250514'
  name: string              // 显示名
  reasoning: boolean
  supportsImage: boolean
  contextWindow: number
  maxTokens: number
}
```

#### 核心接口

```typescript
export class ModelRegistry extends EventEmitter {
  addProvider(provider: ModelProvider): void
  updateProvider(id: string, patch: Partial<ModelProvider>): void
  removeProvider(id: string): void        // 预设厂商不可删除
  addModel(providerId: string, model: ModelDefinition): void
  removeModel(providerId: string, modelId: string): void

  setActiveModel(ref: string): void       // 'llm/openai/gpt-4o'
  getActiveModel(): { provider: ModelProvider; model: ModelDefinition }

  testConnection(providerId: string): Promise<{ ok: boolean; error?: string }>  // 发送测试请求

  toOpenclawConfig(): object              // 序列化为 openclaw.json models 段
  save(): void                            // → petclaw-settings.json
  load(): void                            // ← petclaw-settings.json
}
```

#### 前端 UI（参考设计图 `模型配置.png` + `自定义模型配置.png`）

**设置页模型配置面板**：
- 左侧：Provider 列表（图标 + 名称 + 开关），底部 "自定义提供商" 按钮
- 右侧：选中 Provider 的配置面板
  - API Key 输入（密文显示，可复制）
  - Base URL 输入
  - API 格式选择（OpenAI / Anthropic）
  - "测试" 按钮（调用 `testConnection`）
  - 模型列表（名称 + 上下文窗口 + 开关），可添加/删除模型

### 5.3 MemoryManager — 持久记忆

#### 工作原理

纯文件驱动，不使用数据库表。Openclaw runtime 启动时自动加载 workspace 目录下的记忆文件，Agent 在对话中通过 `write` 工具自主读写。

#### 记忆文件结构

| 文件 | 用途 | 加载时机 |
|------|------|---------|
| `MEMORY.md` | 持久化事实、偏好与决策 | 每次会话启动 |
| `memory/YYYY-MM-DD.md` | 每日临时笔记 | 加载今日 + 昨日 |
| `USER.md` | 用户档案（姓名、职业、习惯） | 每次会话启动 |
| `SOUL.md` | Agent 个性与行为准则 | 每次会话启动 |

#### 工作机制

1. 会话启动时，Openclaw 按顺序读取 `SOUL.md` → `USER.md` → 今日/昨日 `memory/YYYY-MM-DD.md` → `MEMORY.md`，注入 system prompt
2. 用户说"记住 xxx"→ Agent 调用 `write` 工具写入 `MEMORY.md`
3. Agent 执行任务时可主动记录发现到 `memory/YYYY-MM-DD.md`
4. PetClaw 前端设置页提供记忆管理界面：查看/编辑/删除 `MEMORY.md` 条目

#### 核心接口

```typescript
export class MemoryManager {
  readMemoryMd(workspaceDir: string): string
  writeMemoryMd(workspaceDir: string, content: string): void
  listEntries(workspaceDir: string): MemoryEntry[]     // 解析 MEMORY.md 中的条目
  addEntry(workspaceDir: string, text: string): void
  removeEntry(workspaceDir: string, index: number): void
  searchEntries(workspaceDir: string, keyword: string): MemoryEntry[]
}
```

### 5.4 McpManager — MCP 服务器管理

#### 工作原理

MCP (Model Context Protocol) 服务器为 Agent 提供额外的工具和上下文。McpManager 管理 MCP 服务器配置，持久化到 SQLite，通过 ConfigSync 同步到 openclaw.json 的 `mcpServers` 段。

#### 数据库表

```sql
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  transport_type TEXT NOT NULL DEFAULT 'stdio',   -- 'stdio' | 'sse' | 'streamable-http'
  config_json TEXT NOT NULL DEFAULT '{}',          -- 传输配置 JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**config_json 结构（按 transport_type）**：

```typescript
// stdio
{ command: string; args?: string[]; env?: Record<string, string> }

// sse
{ url: string; headers?: Record<string, string> }

// streamable-http
{ url: string; headers?: Record<string, string> }
```

#### 核心接口

```typescript
export class McpManager extends EventEmitter {
  add(server: McpServerConfig): void
  update(id: string, patch: Partial<McpServerConfig>): void
  remove(id: string): void
  setEnabled(id: string, enabled: boolean): void
  list(): McpServerConfig[]
  getEnabled(): McpServerConfig[]

  toOpenclawConfig(): Record<string, object>  // 序列化为 openclaw.json mcpServers 段
}
```

#### 同步到 openclaw.json

```json
{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@my/mcp-server"],
      "env": { "API_KEY": "xxx" }
    }
  }
}
```

---

## 6. 集成层

### 6.1 ImGateway — IM 机器人

#### 工作原理

ImGateway 将 PetClaw Agent 桥接到各 IM 平台。用户在手机 IM 发消息 → ImGateway 接收 → 路由到绑定的 Agent → CoworkController 执行 → 结果推回 IM。

#### 支持平台

| 平台 | 协议 | 多实例 | 说明 |
|------|------|--------|------|
| 微信 | Openclaw 网关 | 否 | 微信账号接入 |
| 企业微信 | Openclaw 网关 | 是(≤3) | 企业微信应用机器人 |
| 钉钉 | DingTalk Stream | 是(≤3) | 企业机器人双向通信 |
| 飞书 | Lark SDK | 是(≤3) | 飞书/Lark 应用机器人 |
| QQ | Openclaw 网关 | 是(≤3) | QQ Bot API |
| Telegram | grammY | 否 | Bot API |
| Discord | discord.js | 否 | Discord Bot |
| 云信 IM | node-nim V2 SDK | 是(≤5) | 网易云信 P2P |
| 邮箱 | IMAP/SMTP | 是(≤3) | 邮件收发 |

#### 数据库设计

**im_config 表**（KV 结构，和 LobsterAI 一致）：

```sql
CREATE TABLE im_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**Key 命名规则**：
- 单实例平台：`telegram`、`discord`、`wechat`
- 多实例平台：`dingtalk:{instanceId}`、`feishu:{instanceId}`、`qq:{instanceId}`
- 全局设置：`settings`（含 systemPrompt、skillsEnabled、platformAgentBindings）

**im_session_mappings 表**：

```sql
CREATE TABLE im_session_mappings (
  im_conversation_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  cowork_session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'main',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (im_conversation_id, platform)
);
```

#### IM Settings 结构

```typescript
interface IMSettings {
  systemPrompt: string
  skillsEnabled: boolean
  platformAgentBindings: Record<string, string>  // { 'telegram': 'agent-1', 'dingtalk:uuid': 'main' }
}
```

`platformAgentBindings` 将每个 IM 平台/实例绑定到一个 Agent。消息到达时，ImGateway 根据 platform key 查找绑定的 Agent，路由到对应的 CoworkController 会话。

#### 前端 UI（参考 `IM机器人.png`）

设置页 IM 机器人面板：
- 9 个平台卡片，每个显示图标 + 名称 + 启用开关
- 点击展开配置表单（Token、AppId、Secret 等）
- 多实例平台显示实例列表 + "添加实例" 按钮
- 每个实例可绑定 Agent

### 6.2 SchedulerManager — 定时任务

#### 工作原理

SchedulerManager 基于 Cron 表达式调度定时任务。任务触发时自动启动 Cowork 会话执行，结果可通过桌面端查看或经 IM 推送到手机。

#### 创建方式

1. **对话式创建** — 用户对 Agent 说"每天早上 9 点帮我收集科技新闻"，Agent 调用工具创建定时任务
2. **GUI 创建** — 在定时任务管理面板手动添加

#### 数据库表

```sql
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  cron_expression TEXT NOT NULL,       -- '0 9 * * *'
  prompt TEXT NOT NULL,                -- 要执行的提示词
  agent_id TEXT NOT NULL DEFAULT 'main',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE scheduled_task_meta (
  task_id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'gui',  -- 'gui' | 'conversation' | 'im'
  im_platform TEXT,                     -- 结果推送的 IM 平台
  im_conversation_id TEXT,              -- 结果推送的 IM 会话
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
);
```

#### 核心接口

```typescript
export class SchedulerManager extends EventEmitter {
  create(task: CreateTaskOpts): ScheduledTask
  update(id: string, patch: Partial<ScheduledTask>): void
  delete(id: string): void
  enable(id: string, enabled: boolean): void
  list(): ScheduledTask[]

  start(): void     // 启动 Cron 调度器
  stop(): void      // 停止调度器
}
```

#### 执行流程

```
Cron 触发 → SchedulerManager.onTaskTrigger(task)
  → CoworkController.send({
      agentId: task.agentId,
      message: task.prompt,
      source: 'scheduler',
    })
  → 执行完成 → 检查 task_meta.im_platform
    → 有 IM 配置 → ImGateway.pushResult(platform, conversationId, result)
    → 无 → 仅桌面端可查看
```

---

## 7. 工程层

### 7.1 WorkspaceManager — 工作区初始化

```typescript
export class WorkspaceManager {
  syncDefaultWorkspace(settings: PetclawSettings): void   // ~/.petclaw/workspace/
  syncBuiltinSkills(): void                                // → ~/.petclaw/skills/
  initProjectWorkspace(projectDir: string, settings: PetclawSettings): void
}
```

**管理的文件**：SOUL.md（模板+Language 段落）、AGENTS_CHAT.md、AGENTS_WORK.md、内置 skills（8 个）。

**升级策略**：AGENTS_CHAT/WORK.md 升级时强制更新，SOUL.md 指纹追踪仅更新 Language 段落，skills 首次创建不覆盖。

### 7.2 Database — SQLite 表管理

**完整表清单**：

| 表 | 用途 |
|----|------|
| `kv` | 应用配置键值对 |
| `cowork_sessions` | 会话元数据 |
| `cowork_messages` | 消息历史 |
| `cowork_config` | Cowork 全局设置 |
| `agents` | Agent 配置 |
| `mcp_servers` | MCP 服务器配置 |
| `im_config` | IM 网关配置（KV） |
| `im_session_mappings` | IM→Cowork 会话映射 |
| `scheduled_tasks` | 定时任务 |
| `scheduled_task_meta` | 定时任务元数据 |

### 7.3 IPC Channel 设计

命名规范：`模块:动作` 格式，禁止驼峰。

**Chat**:
| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `chat:send` | invoke | `ChatSendPayload` | void |
| `chat:abort` | invoke | `{ sessionId }` | void |
| `chat:history` | invoke | `{ sessionId?, limit }` | Message[] |
| `chat:chunk` | send→renderer | `{ sessionKey, text }` | — |
| `chat:done` | send→renderer | `{ sessionKey }` | — |
| `chat:error` | send→renderer | `{ sessionKey, error }` | — |

**Session**:
| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `session:create` | invoke | `{ workspace?, modelOverride?, agentId?, activeSkillIds? }` | Session |
| `session:list` | invoke | — | Session[] |
| `session:list-recent-cwds` | invoke | `{ limit? }` | string[] |

**Agent**:
| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `agent:list` | invoke | — | Agent[] |
| `agent:create` | invoke | `CreateAgentOpts` | Agent |
| `agent:update` | invoke | `{ id, patch }` | Agent |
| `agent:delete` | invoke | `{ id }` | void |
| `agent:set-active` | invoke | `{ id }` | void |
| `agent:changed` | send→renderer | — | — |

**Skill**:
| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `skill:list` | invoke | — | Skill[] |
| `skill:install` | invoke | `{ source }` | Skill |
| `skill:uninstall` | invoke | `{ id }` | void |
| `skill:enable` | invoke | `{ id, enabled }` | void |
| `skill:changed` | send→renderer | — | — |

**Model**:
| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `model:list-providers` | invoke | — | ModelProvider[] |
| `model:add-provider` | invoke | `ModelProvider` | void |
| `model:update-provider` | invoke | `{ id, patch }` | void |
| `model:remove-provider` | invoke | `{ id }` | void |
| `model:test-connection` | invoke | `{ providerId }` | `{ ok, error? }` |
| `model:set-active` | invoke | `{ ref }` | void |

**MCP**:
| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `mcp:list` | invoke | — | McpServerConfig[] |
| `mcp:add` | invoke | `McpServerConfig` | void |
| `mcp:update` | invoke | `{ id, patch }` | void |
| `mcp:remove` | invoke | `{ id }` | void |
| `mcp:enable` | invoke | `{ id, enabled }` | void |

**IM**:
| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `im:get-config` | invoke | `{ platform }` | IMPlatformConfig |
| `im:set-config` | invoke | `{ platform, config }` | void |
| `im:enable` | invoke | `{ platform, enabled }` | void |
| `im:list-platforms` | invoke | — | IMPlatformStatus[] |

**Scheduler**:
| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `scheduler:list` | invoke | — | ScheduledTask[] |
| `scheduler:create` | invoke | `CreateTaskOpts` | ScheduledTask |
| `scheduler:update` | invoke | `{ id, patch }` | void |
| `scheduler:delete` | invoke | `{ id }` | void |
| `scheduler:enable` | invoke | `{ id, enabled }` | void |

**Approval**:
| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `approval:request` | send→renderer | `ExecApproval` | — |
| `approval:respond` | invoke | `ApprovalResponse` | void |

**Workspace / Dialog**:
| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `dialog:open-directory` | invoke | — | `{ success, path? }` |
| `dialog:select-files` | invoke | `{ title?, multi? }` | `{ success, paths }` |
| `dialog:read-file-as-data-url` | invoke | `{ path }` | `{ success, dataUrl? }` |

**System**:
| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `boot:status` | invoke | — | boolean \| null |
| `boot:step-update` | send→renderer | BootStep[] | — |
| `boot:complete` | send→renderer | boolean | — |
| `gateway:status` | send→renderer | `{ status, port?, error? }` | — |

---

## 8. 前端层

### 8.1 ChatInputBox — 聊天输入框

#### 整体布局

```
┌─────────────────────────────────────────────────────┐
│ 📎 report.xlsx ×   📷[缩略图] ×                       │  ← 附件预览区（上方）
├─────────────────────────────────────────────────────┤
│  [多行文本输入区]                                      │
├─────────────────────────────────────────────────────┤
│ 📁coagent× │ 📎 │ 🔧 │ 🔧pptx× 🔧xlsx× │ 全部清除 │ ▶⌄ │  ← 底部工具栏
└─────────────────────────────────────────────────────┘
```

#### 8.1.1 工作目录选择

点击 📁 弹出 Popover 菜单：

```
┌──────────────────┐
│ ➕ 添加文件夹      │  → dialog.showOpenDialog
├──────────────────┤
│ 🕐 最近使用    ▸  │  → 子菜单（最近 8 个去重目录）
└──────────────────┘
```

**最近目录来源**：`session:list-recent-cwds` → 从 `cowork_sessions` 表查询（不需要额外表）。

**展示逻辑**：
- 新会话/首页：显示 cwd tag `📁 目录名 ×`，可选择/清除
- 历史会话：不显示 cwd tag（cwd 已绑定在 session 记录中）

#### 8.1.2 文件附件

展示在**输入框上方**的附件预览区。

**图片文件** — 64×64 缩略图卡片：
- IPC `dialog:read-file-as-data-url` 读取为 base64 → `<img src={dataUrl}>` 渲染真实内容
- 底部半透明遮罩显示文件名
- hover 右上角 × 删除

**非图片文件** — 横向卡片 (160×64)：
- 文件类型图标（根据扩展名匹配）+ 文件名 + 类型标签
- hover 右上角 × 删除

**输入方式**（三种）：
1. 点击 📎 → 系统文件选择器（多选）
2. 拖拽文件到输入框 → 区域高亮提示
3. Ctrl+V 粘贴 → 支持剪贴板图片

**数据结构**：
```typescript
interface DraftAttachment {
  path: string        // 文件路径（inline 图片为 "inline:name:timestamp"）
  name: string
  isImage?: boolean
  dataUrl?: string    // 图片 base64（用于预览和发送）
}
```

附件状态按 draftKey（sessionId 或 `__home__`）分组存储在 Zustand store，切换会话时保留。

#### 8.1.3 技能选择器

点击 🔧 弹出 Popover 弹窗（向上展开）：

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
│ ☑ pptx        官方       │
│   PPT 演示文稿            │
│ ...                     │
├─────────────────────────┤
│ ⚙ 管理技能               │
└─────────────────────────┘
```

- 搜索框：按 name + description 模糊匹配
- Checkbox 多选，每项显示：技能名 + 来源 badge（官方/自定义）+ 一行描述
- 勾选后底部工具栏生成 tag `🔧 skillName ×`
- "管理技能" 跳转设置页
- "全部清除" 一键清空

#### 8.1.4 发送按钮

- `▶` 发送：文本 + cwd + files + activeSkillIds + agentId
- `⌄` 下拉：切换发送快捷键（Enter / Shift+Enter / Ctrl+Enter / Alt+Enter）
- 快捷键配置持久化到 app config

#### 发送 Payload

```typescript
interface ChatSendPayload {
  text: string
  sessionId?: string
  cwd?: string
  files?: string[]
  activeSkillIds?: string[]
  agentId: string
  imageAttachments?: { name: string; mimeType: string; base64Data: string }[]
}
```

---

## 9. Openclaw 版本管理

### 版本锁定

在 `package.json` 中声明依赖的 Openclaw 版本：

```json
{
  "openclaw": {
    "version": "v2026.3.2",
    "repo": "https://github.com/openclaw/openclaw.git"
  }
}
```

### 构建流程

| 步骤 | 行为 | 时机 |
|------|------|------|
| 版本确认 | 克隆或切换 `../openclaw` 到锁定 tag | 每次 runtime 构建前 |
| 缓存检查 | 比对锁定版本与 `runtime-build-info.json` | 每次构建前 |
| 完整构建 | `pnpm install` → `build` → `ui:build` → 打包为 asar | 仅版本变更时 |

### 更新 Openclaw 版本

1. 修改 `package.json` 中 `openclaw.version` 为目标 tag
2. 执行 `npm run electron:dev:openclaw` 或 `npm run dist:mac` — 自动拉取并构建
3. 提交 `package.json` 变更

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENCLAW_SRC` | Openclaw 源码目录 | `../openclaw` |
| `OPENCLAW_FORCE_BUILD` | `1` 强制重新构建 | — |
| `OPENCLAW_SKIP_ENSURE` | `1` 跳过自动版本切换 | — |

### npm scripts

```json
{
  "scripts": {
    "openclaw:runtime:host": "按当前主机平台自动选择 target",
    "openclaw:runtime:mac-arm64": "构建 macOS ARM64 runtime",
    "openclaw:runtime:mac-x64": "构建 macOS x64 runtime",
    "openclaw:runtime:win-x64": "构建 Windows x64 runtime",
    "openclaw:runtime:linux-x64": "构建 Linux x64 runtime",
    "electron:dev:openclaw": "dev 模式（自动拉取+构建 openclaw）"
  }
}
```

---

## 10. 开发到上线流程

### 10.1 开发环境

```bash
# 1. 克隆仓库
git clone https://github.com/user/petclaw.git && cd petclaw

# 2. 安装依赖
cd petclaw-desktop && npm install

# 3. 准备 Openclaw runtime（首次需要几分钟）
npm run electron:dev:openclaw

# 4. 启动开发环境（Vite + Electron 热重载）
npm run dev
```

开发时 runtime 放在 `vendor/openclaw-runtime/current/`，OpenclawEngineManager 按优先级查找：
1. `resources/cfmind/`（生产）
2. `vendor/openclaw-runtime/current/`（开发）
3. 失败 → BootCheck 面板显示 "Runtime not found"

### 10.2 构建与打包

```bash
# TypeScript 编译 + Vite 打包
npm run build

# ESLint 代码检查
npm run lint

# 类型检查
npm run typecheck
```

**electron-builder 打包**：

```bash
# macOS
npm run dist:mac            # .dmg
npm run dist:mac:arm64      # Apple Silicon
npm run dist:mac:x64        # Intel
npm run dist:mac:universal  # 双架构

# Windows
npm run dist:win            # .exe NSIS 安装包

# Linux
npm run dist:linux          # .AppImage
```

### 10.3 electron-builder 配置

```json
{
  "build": {
    "extraResources": [
      { "from": "resources/cfmind", "to": "cfmind" },
      { "from": "resources/workspace-templates", "to": "workspace-templates" },
      { "from": "resources/workspace-skills", "to": "workspace-skills" }
    ],
    "asarUnpack": ["resources/cfmind/**"]
  }
}
```

### 10.4 CI/CD 建议

```
git push → CI 触发:
  → npm run lint + typecheck + test
  → npm run build
  → 构建 Openclaw runtime（缓存加速）
  → electron-builder 打包各平台安装包
  → 上传 artifacts / 发布 Release
```

---

## 11. 启动流程

```
app.whenReady()
  → initDatabase()
  → createChatWindow()                       // 显示 BootCheckPanel
  → registerEarlyIpcHandlers()
  → runBootCheck(chatWindow)
      ├── detectSetupMode()
      ├── OpenclawEngineManager.resolveRuntimeMetadata()
      ├── 创建目录结构（~/.petclaw/{workspace,skills,state,logs}）
      ├── WorkspaceManager.syncDefaultWorkspace(settings)
      ├── WorkspaceManager.syncBuiltinSkills()
      ├── AgentManager.ensureMainAgent()              ← ★
      ├── ModelRegistry.load()
      ├── McpManager.load()                           ← ★
      ├── ConfigSync.sync('boot')
      ├── OpenclawEngineManager.startGateway()
      │     ├── resolveGatewayPort()
      │     ├── 生成 gateway-token
      │     ├── utilityProcess.fork(openclawEntry)
      │     ├── waitForGatewayReady()
      │     └── ensureBundledCliShims()
      └── 返回 GatewayConnection
  → boot:complete → ChatApp
  → createPetWindow()
  → registerAllIpc(ctx)
  → OpenclawGateway.connect(...)
  → SkillManager.scan() + startWatching()
  → ImGateway.start()                                ← ★
  → SchedulerManager.start()                          ← ★
  → createTray() + registerShortcuts()
```

---

## 12. 文件结构

```
petclaw-desktop/src/main/
├── index.ts
├── bootcheck.ts
├── app-settings.ts
├── database-path.ts
│
├── ai/
│   ├── engine-manager.ts          ← OpenclawEngineManager
│   ├── gateway.ts                 ← OpenclawGateway
│   ├── session-manager.ts         ← SessionManager
│   ├── cowork-controller.ts       ← CoworkController
│   └── config-sync.ts             ← ConfigSync
│
├── agents/
│   └── agent-manager.ts           ← AgentManager
│
├── skills/
│   ├── skill-manager.ts           ← SkillManager
│   └── skill-scanner.ts
│
├── models/
│   └── model-registry.ts          ← ModelRegistry
│
├── memory/
│   └── memory-manager.ts          ← MemoryManager
│
├── mcp/
│   └── mcp-manager.ts             ← McpManager
│
├── im/
│   ├── im-gateway.ts              ← ImGateway
│   ├── im-store.ts                ← IM 数据存储
│   └── platforms/                  ← 各平台适配器
│       ├── telegram.ts
│       ├── discord.ts
│       ├── dingtalk.ts
│       ├── feishu.ts
│       ├── wechat.ts
│       ├── wecom.ts
│       ├── qq.ts
│       ├── nim.ts
│       └── email.ts
│
├── scheduler/
│   └── scheduler-manager.ts       ← SchedulerManager
│
├── workspace/
│   └── workspace-manager.ts       ← WorkspaceManager
│
├── ipc/
│   ├── index.ts
│   ├── chat-ipc.ts
│   ├── agent-ipc.ts
│   ├── skill-ipc.ts
│   ├── model-ipc.ts
│   ├── mcp-ipc.ts
│   ├── im-ipc.ts
│   ├── scheduler-ipc.ts
│   ├── approval-ipc.ts
│   └── settings-ipc.ts
│
├── hooks/
├── system/
└── data/
```

### 运行时数据

```
~/.petclaw/
├── petclaw-settings.json           ← App 全局设置（含 modelProviders + apiKeys）
├── openclaw.json                   ← ConfigSync 唯一写入
├── workspace/                      ← 默认 workspace（main agent）
│   ├── SOUL.md
│   ├── AGENTS_CHAT.md / AGENTS_WORK.md
│   ├── MEMORY.md
│   ├── USER.md
│   └── memory/YYYY-MM-DD.md
├── skills/                         ← Skills 集中管理目录
├── state/
│   ├── gateway-token
│   ├── v8-compile-cache/
│   └── bin/                        ← CLI shims
├── agents/
├── logs/
└── petclaw.db                      ← SQLite
```

---

## 13. 实现分期

### Phase 1: 基础架构

- OpenclawEngineManager（runtime 解析 + utilityProcess.fork + 动态端口 + 健康检查 + 自动重启）
- OpenclawGateway（GatewayClient 动态加载 + 连接 + 事件分发）
- SessionManager（基础会话管理 + chat.send）
- ConfigSync（openclaw.json 生成 + AGENTS.md 同步）
- WorkspaceManager（模板 + 内置 skills 初始化）
- IPC 模块化重构
- BootCheck 简化
- AgentManager（main agent only）

### Phase 2: 功能完善

- ModelRegistry（多 Provider + 测试连接 + Settings UI）
- SkillManager（扫描 + 安装 + 卸载 + 启用/禁用 + SkillsView UI）
- CoworkController（执行模式 + Exec Approval UI）
- ChatInputBox 完整功能（cwd + 附件 + 技能选择器）
- 多 Agent（AgentManager CRUD + AgentSelector UI + Agent 配置弹窗）
- McpManager（CRUD + Settings UI）
- MemoryManager（文件读写 + Settings 记忆管理 UI）

### Phase 3: 集成与高级功能

- ImGateway（9 大平台 + 多实例 + Agent 绑定）
- SchedulerManager（Cron 调度 + GUI + 对话式创建 + IM 推送）
- Openclaw 版本管理（自动构建脚本）
- 完整打包流水线（macOS/Windows/Linux）

---

## 14. 验证标准

- `npx tsc --noEmit` 类型检查通过
- Runtime 检测 + Gateway 启动 + 健康检查 + 自动重启正常
- GatewayClient 动态加载 + chat.send 消息流转正常
- API Keys 通过环境变量注入，openclaw.json 不含明文 key
- Agent CRUD + 切换 → ConfigSync 同步 + workspace 更新
- 模型 Provider 配置 + 测试连接 + 运行时切换
- Skill 扫描/安装/卸载/启用/禁用 → ConfigSync 同步
- 聊天输入框：cwd 选择（添加+最近）、文件附件预览（图片缩略图+文件图标）、技能多选
- Exec Approval 弹窗 + 单次/会话级审批
- MCP 服务器配置 CRUD → ConfigSync 同步
- IM 机器人配置 + 消息路由 + Agent 绑定
- 定时任务 Cron 调度 + IM 推送
- 删除 `~/.petclaw/workspace/` → 重启 → 自动重建