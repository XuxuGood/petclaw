# PetClaw 架构设计 v2 — 完整蓝图

**日期**: 2026-04-22
**状态**: 设计完成，待实现
**范围**: Gateway 通信、多 Agent 会话、自管理 Skills、多 Provider 模型、工作目录选择、配置同步

---

## 1. 设计目标

将 PetClaw 从"简化 WebSocket 客户端 + 硬编码单模型"升级为完整的 AI 桌面应用架构：

1. **GatewayClient 重写** — 动态加载 Openclaw 自带客户端，替代手写 WebSocket
2. **多 Agent 会话** — 每个项目目录对应一个 Agent，独立 workspace
3. **自管理 Skills** — 完整 skill 生命周期（扫描/安装/卸载/启用/禁用），通过 `skills.load.extraDirs` 注入 Openclaw
4. **多 Provider 多 Model** — 支持多 LLM Provider（Anthropic、OpenAI、自定义），每次对话可切换模型
5. **工作目录选择** — 每次对话可选择项目目录作为 Agent workspace
6. **ConfigSync 单一写入者** — 唯一写入 `openclaw.json` 的模块，保证配置一致性

### 参考来源

- LobsterAI 源码（`openclawRuntimeAdapter.ts`、`openclawConfigSync.ts`、`skillManager.ts`）
- Openclaw Gateway 协议（129 RPC 方法 + 22 事件，详见 `docs/openclaw-gateway-api.md`）
- 官方 PetClaw App 解包（workspace-templates、内置 skills）

---

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ OpenclawGW   │  │ SessionMgr   │  │ SkillManager  │ │
│  │              │  │              │  │               │ │
│  │ · connect()  │  │ · create()   │  │ · scan()      │ │
│  │ · chatSend() │←─│ · send()     │  │ · install()   │ │
│  │ · onEvent()  │  │ · abort()    │  │ · uninstall() │ │
│  │ · disconnect │  │ · setCwd()   │  │ · enable()    │ │
│  └──────┬───────┘  └──────────────┘  │ · disable()   │ │
│         │                             └───────┬───────┘ │
│         │          ┌──────────────┐           │         │
│         │          │ ConfigSync   │←──────────┘         │
│         │          │              │                      │
│         │          │ · syncAll()  │← ModelRegistry       │
│         │          │ → openclaw.json                    │ │
│         │          │ → AGENTS.md  │                      │
│         │          └──────────────┘                      │
│         │                                               │
│  ┌──────┴───────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ ModelRegistry│  │ WorkspaceMgr │  │ BootCheck     │ │
│  │              │  │              │  │ (existing)    │ │
│  │ · providers  │  │ · syncAll()  │  └───────────────┘ │
│  │ · models     │  │ · templates  │                     │
│  │ · active     │  │ · skills     │  ┌───────────────┐ │
│  └──────────────┘  └──────────────┘  │ HookServer    │ │
│                                       │ (existing)    │ │
│  ┌──────────────┐  ┌──────────────┐  └───────────────┘ │
│  │ Database     │  │ IPC Router   │                     │
│  │ (SQLite)     │  │ (modular)    │                     │
│  └──────────────┘  └──────────────┘                     │
│                                                         │
├──────────────── contextBridge (preload) ─────────────────┤
│                                                         │
│                    Renderer (React + Zustand)            │
│  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌──────────────┐ │
│  │ChatView │ │SkillsView│ │Settings│ │  PetCanvas   │ │
│  │+cwd     │ │+market   │ │+models │ │  (existing)  │ │
│  │+model   │ │+install  │ │+provdr │ └──────────────┘ │
│  └─────────┘ └──────────┘ └────────┘                   │
└─────────────────────────────────────────────────────────┘
         ↕ WebSocket (GatewayClient)
┌─────────────────────────────────────────────────────────┐
│              Openclaw Runtime (Gateway)                   │
│  · LLM 调用 · Tool 执行 · Skill prompt 注入              │
│  · Session 管理 · Exec Approvals                         │
└─────────────────────────────────────────────────────────┘
```

### 模块职责

| 模块 | 职责 | 依赖 |
|------|------|------|
| **OpenclawGateway** | 动态加载 GatewayClient，管理连接、事件分发 | Openclaw npm 包 |
| **SessionManager** | 对话会话生命周期（创建/发送/中止），每次对话绑定 workspace + model | OpenclawGateway |
| **SkillManager** | 扫描/安装/卸载/启用/禁用 skills，解析 SKILL.md frontmatter | 文件系统 |
| **ConfigSync** | 唯一写入 openclaw.json 的模块，同步所有 Manager 状态 | SkillManager, ModelRegistry |
| **ModelRegistry** | Provider/Model CRUD，运行时切换 | ConfigSync |
| **WorkspaceManager** | 模板同步、内置 skills 初始化、项目目录 workspace 初始化 | BootCheck |
| **IPC Router** | 模块化 IPC handler 注册 | 所有 Manager |

---

## 3. 核心概念

### 3.1 Workspace vs 工作目录

- **Openclaw Workspace** = Agent 的"人格和工具"所在地（SOUL.md、AGENTS.md、TOOLS.md 等）
- **工作目录** = 用户选择的项目路径
- **关键**: 在 Openclaw 中，workspace = 用户选择的工作目录。当用户选择 `/Users/xx/projects/A` 时，SOUL.md、AGENTS.md 等文件放在该目录下

### 3.2 Skills 与 Workspace 的关系

Skills **不跟着 workspace 走**：

```
Skills 存放: ~/.petclaw/skills/（App 统一管理目录）
注入方式:    openclaw.json → skills.load.extraDirs = ["~/.petclaw/skills"]
```

无论用户切换到哪个工作目录，skills 都是同一套。切换工作目录只影响 Agent 的人格文件和命令执行位置。

### 3.3 多 Agent 模型

每个项目目录 = 一个 Agent：

```
用户选择 /Users/xx/projects/A → Agent "A"
  workspace = /Users/xx/projects/A
  SOUL.md, AGENTS.md 在此
  Openclaw 在此执行命令

用户切换 /Users/xx/projects/B → Agent "B"
  workspace = /Users/xx/projects/B

默认（无项目）→ main agent
  workspace = ~/.petclaw/workspace
```

**openclaw.json agents 配置**：

```json
{
  "agents": {
    "defaults": {
      "workspace": "/Users/xx/projects/A",
      "model": { "primary": "llm/petclaw-fast" }
    },
    "list": [
      { "id": "main", "default": true, "model": { "primary": "llm/petclaw-fast" } }
    ]
  }
}
```

**PetClaw 目前实现 main agent + 工作目录切换**，后续扩展为独立多 agent（每个项目目录一个 agent）。架构已预留 `agents.list` 数组和 per-agent workspace 同步。

### 3.4 Session Key 格式

```
agent:{agentId}:petclaw:{sessionId}
```

例：`agent:main:petclaw:550e8400-e29b-41d4-a716-446655440000`

---

## 4. 模块详细设计

### 4.1 OpenclawGateway — 连接层

替代当前的 `OpencLawProvider`（手写 WebSocket），动态加载 Openclaw npm 包自带的 `GatewayClient`。

```typescript
// src/main/ai/gateway.ts

type GatewayClientLike = {
  start: () => void
  stop: () => void
  request: <T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean; timeoutMs?: number | null },
  ) => Promise<T>
}

type GatewayEventFrame = {
  event: string
  seq?: number
  payload?: unknown
}

export class OpenclawGateway extends EventEmitter {
  private client: GatewayClientLike | null = null

  // 动态加载 GatewayClient 构造函数
  private async loadGatewayClientCtor(clientEntryPath: string): Promise<Function>

  // 连接 Gateway
  async connect(opts: {
    url: string
    token: string
    clientEntryPath: string
  }): Promise<void>

  // 通用 RPC 请求
  async request<T>(method: string, params?: unknown): Promise<T>

  // 便捷方法
  async chatSend(params: ChatSendParams): Promise<ChatSendResult>
  async chatAbort(sessionKey: string, runId: string): Promise<void>
  async sessionsPatch(key: string, patch: SessionPatch): Promise<void>

  disconnect(): void
  isConnected(): boolean
}
```

**连接参数**：

| 参数 | 值 | 来源 |
|------|-----|------|
| `url` | `ws://127.0.0.1:{port}` | bootcheck 返回 |
| `token` | Gateway auth token | bootcheck 返回 |
| `clientEntryPath` | `~/.petclaw/node/lib/node_modules/openclaw/dist/gateway-client.js` | Openclaw 安装路径推断 |
| `role` | `'operator'` | 固定 |
| `scopes` | `['operator.admin']` | 固定 |
| `caps` | `['tool-events']` | 固定 |

**事件分发**：通过 Node.js EventEmitter，按 `event` 名发射。

```typescript
// GatewayClient onEvent 回调
private handleEvent(frame: GatewayEventFrame): void {
  this.emit(frame.event, frame.payload)
  // chat.reply, chat.done, exec.approval.requested, etc.
}
```

### 4.2 SessionManager — 会话管理

```typescript
// src/main/ai/session-manager.ts

export interface Session {
  id: string                    // UUID
  agentId: string               // 'main' 或自定义
  sessionKey: string            // 'agent:{agentId}:petclaw:{sessionId}'
  workspace: string             // 工作目录路径
  modelOverride?: string        // 'llm/xxx' 格式
  status: 'idle' | 'running' | 'error'
  createdAt: number
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>()
  private activeTurns = new Map<string, ActiveTurn>()

  constructor(
    private gateway: OpenclawGateway,
    private configSync: ConfigSync,
  ) {
    // 监听 Gateway 事件，按 sessionKey 分发
    gateway.on('chat.reply', (payload) => this.handleChatReply(payload))
    gateway.on('chat.done', (payload) => this.handleChatDone(payload))
    gateway.on('exec.approval.requested', (payload) => this.handleApproval(payload))
  }

  create(opts: {
    workspace?: string
    modelOverride?: string
    agentId?: string
  }): Session

  async send(sessionId: string, message: string, opts?: {
    systemPrompt?: string
    skillIds?: string[]
    attachments?: ImageAttachment[]
  }): Promise<void>

  abort(sessionId: string): void

  async patchWorkspace(sessionId: string, workspace: string): Promise<void>

  // 构建 outbound prompt
  private buildOutboundPrompt(
    session: Session,
    message: string,
    systemPrompt?: string,
  ): string
}
```

**buildOutboundPrompt 格式**（参考 LobsterAI）：

```
[PetClaw system instructions]
{systemPrompt}
[/PetClaw system instructions]

Current local time: 2026-04-22 11:30 (Asia/Shanghai, UTC+8)

{userMessage}
```

**切换 workspace 流程**：

```
SessionManager.patchWorkspace(sessionId, newPath)
  → 更新 session.workspace
  → WorkspaceManager.initProjectWorkspace(newPath)
  → ConfigSync.sync() → 更新 agents.defaults.workspace
  → gateway.sessionsPatch(sessionKey, { /* ... */ })
```

### 4.3 SkillManager — 技能管理

```typescript
// src/main/skills/skill-manager.ts

export interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
  isBuiltIn: boolean            // App 内置的 8 个
  skillPath: string             // SKILL.md 绝对路径
  version?: string
  requires?: {
    bins?: string[]
    env?: string[]
    config?: string[]
  }
  metadata?: Record<string, unknown>
}

export class SkillManager extends EventEmitter {
  private skills: Skill[] = []
  private watcher: FSWatcher | null = null

  // ~/.petclaw/skills/
  getSkillsRoot(): string

  // 扫描所有 skills
  async scan(): Promise<Skill[]>

  // 启用/禁用（触发 ConfigSync）
  setEnabled(id: string, enabled: boolean): void

  // 安装
  async install(source: string): Promise<Skill>

  // 卸载（内置 skill 不可卸载）
  async uninstall(id: string): Promise<void>

  // 列表
  list(): Skill[]
  getEnabled(): Skill[]

  // 文件监听
  startWatching(): void
  stopWatching(): void
}
```

**Skill 扫描流程**：

```
scan()
  → readdir(~/.petclaw/skills/)
  → 每个子目录找 SKILL.md
  → 解析 YAML frontmatter（metadata.openclaw）
  → 构建 Skill 对象
  → 返回 Skill[]
```

**SKILL.md 解析**（`skill-scanner.ts`）：

```typescript
export function parseSkillMd(content: string): ParsedSkill {
  // 解析 YAML frontmatter
  // 提取 metadata.openclaw（emoji, os, requires, install）
  // 提取 skill 描述（frontmatter 之后的 markdown）
}
```

**安装来源支持**：

| 来源 | 方式 |
|------|------|
| 本地目录 | 复制到 skills root |
| 本地 zip | 解压到 skills root |
| GitHub URL | HTTP 下载 zip，失败 fallback git clone |
| ClawHub | `npx clawhub@latest install {id}` |

### 4.4 ModelRegistry — 模型管理

```typescript
// src/main/models/model-registry.ts

export interface ModelProvider {
  id: string                     // 'petclaw', 'openai', 'anthropic', 'custom-1'
  name: string                   // 显示名
  baseUrl: string
  apiKey: string
  api: 'openai-completions' | 'anthropic'
  models: ModelDefinition[]
}

export interface ModelDefinition {
  id: string                     // 'petclaw-fast', 'gpt-4o'
  name: string
  reasoning: boolean
  contextWindow: number
  maxTokens: number
}

export class ModelRegistry extends EventEmitter {
  private providers: ModelProvider[] = []
  private activeModelId: string = 'petclaw/petclaw-fast'

  addProvider(provider: ModelProvider): void
  updateProvider(id: string, patch: Partial<ModelProvider>): void
  removeProvider(id: string): void

  setActiveModel(providerModelId: string): void  // 'petclaw/petclaw-fast'
  getActiveModel(): { provider: ModelProvider; model: ModelDefinition }

  // 序列化为 openclaw.json models 配置
  toOpenclawConfig(): {
    mode: 'merge'
    providers: Record<string, OpenclawProviderConfig>
  }

  // 持久化
  save(): void  // → petclaw-settings.json
  load(): void  // ← petclaw-settings.json
}
```

**Provider 到 openclaw.json 映射**：

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "petclaw": {
        "baseUrl": "https://petclaw.ai/api/v1",
        "apiKey": "xxx",
        "api": "openai-completions",
        "models": [
          {
            "id": "petclaw-fast",
            "name": "petclaw-fast",
            "reasoning": false,
            "input": ["text", "image"],
            "contextWindow": 200000,
            "maxTokens": 65536
          }
        ]
      },
      "openai": {
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "sk-xxx",
        "api": "openai-completions",
        "models": [
          { "id": "gpt-4o", "name": "GPT-4o", "reasoning": false, "contextWindow": 128000, "maxTokens": 16384 },
          { "id": "o3-mini", "name": "o3-mini", "reasoning": true, "contextWindow": 200000, "maxTokens": 100000 }
        ]
      }
    }
  }
}
```

**PetclawSettings 扩展**：

```typescript
export interface PetclawSettings {
  // ... 现有字段 ...
  modelProviders?: ModelProvider[]        // 多 Provider 配置
  activeModelId?: string                  // 当前活跃模型 'provider/model'
}
```

### 4.5 ConfigSync — 配置同步

**唯一写入 openclaw.json 的模块**。

```typescript
// src/main/ai/config-sync.ts

export class ConfigSync {
  constructor(
    private skillManager: SkillManager,
    private modelRegistry: ModelRegistry,
    private configPath: string,          // ~/.petclaw/openclaw.json
  ) {}

  sync(reason: string): SyncResult {
    const config = this.buildConfig()
    this.writeConfig(config)
    this.syncAgentsMd(this.currentWorkspace, { /* ... */ })
    return { ok: true, changed: true, configPath: this.configPath }
  }

  syncAgentsMd(workspaceDir: string, opts: AgentsMdOptions): void {
    // 读取现有 AGENTS.md
    // 保留用户内容（marker 之上）
    // 追加/更新 managed section（marker 之下）
    // managed section 包含：系统提示策略、exec 安全策略、skill 创建路径等
  }

  setCurrentWorkspace(workspace: string): void

  private buildConfig(): OpenclawConfig {
    return {
      models: this.modelRegistry.toOpenclawConfig(),
      agents: {
        defaults: {
          workspace: this.currentWorkspace,
          model: { primary: this.modelRegistry.getActiveModel().fullId },
          compaction: { memoryFlush: { enabled: false } },
        },
        list: this.buildAgentsList(),
      },
      skills: {
        entries: this.buildSkillEntries(),
        load: {
          extraDirs: [this.skillManager.getSkillsRoot()],
          watch: true,
        },
      },
      gateway: this.preserveGatewayConfig(),
      hooks: {
        internal: {
          entries: { 'session-memory': { enabled: false } },
        },
      },
    }
  }

  private buildSkillEntries(): Record<string, { enabled: boolean }> {
    const entries: Record<string, { enabled: boolean }> = {}
    for (const skill of this.skillManager.list()) {
      entries[skill.id] = { enabled: skill.enabled }
    }
    return entries
  }

  private buildAgentsList(): { list: AgentEntry[] } {
    // 目前只有 main agent
    // 后续扩展多 agent 时在此添加
    return {
      list: [
        { id: 'main', default: true, model: { primary: this.modelRegistry.getActiveModel().fullId } },
      ],
    }
  }

  // 原子写入（tmp + rename）
  private writeConfig(config: OpenclawConfig): void {
    const content = JSON.stringify(config, null, 2)
    const tmpPath = `${this.configPath}.tmp-${Date.now()}`
    writeFileSync(tmpPath, content, 'utf8')
    renameSync(tmpPath, this.configPath)
  }

  // 保留 gateway 现有配置（port, token, 运行时注入的字段）
  private preserveGatewayConfig(): Record<string, unknown>
}
```

**AGENTS.md managed section**：

```markdown
用户自定义内容...

<!-- PetClaw managed: do not edit below this line -->

## System Configuration

- Web search: enabled
- Execution safety: standard mode
- Skill creation path: ~/.petclaw/skills/
```

### 4.6 WorkspaceManager — 工作区初始化

```typescript
// src/main/workspace/workspace-manager.ts

export class WorkspaceManager {
  constructor(
    private resourcesPath: string,  // app resources 路径
    private skillsRoot: string,     // ~/.petclaw/skills/
  ) {}

  // 初始化默认 workspace（bootcheck 调用）
  syncDefaultWorkspace(settings: PetclawSettings): void {
    const workspaceDir = join(PETCLAW_HOME, 'workspace')
    mkdirSync(workspaceDir, { recursive: true })

    // 1. 模板文件：首次创建不覆盖
    this.copyTemplateIfMissing('AGENTS_CHAT.md', workspaceDir)
    this.copyTemplateIfMissing('AGENTS_WORK.md', workspaceDir)

    // 2. SOUL.md：模板 + language 动态段落（指纹追踪）
    this.syncSoulMd(settings, workspaceDir)

    // 3. 升级时强制更新 AGENTS_CHAT/WORK.md
    if (needsUpgrade) {
      this.copyTemplate('AGENTS_CHAT.md', workspaceDir)
      this.copyTemplate('AGENTS_WORK.md', workspaceDir)
    }
  }

  // 初始化内置 skills
  syncBuiltinSkills(): void {
    // 从 resources/workspace-skills/ 复制到 ~/.petclaw/skills/
    // 首次创建不覆盖
    for (const skillDir of BUILTIN_SKILLS) {
      this.copySkillIfMissing(skillDir)
    }
  }

  // 为项目目录初始化 workspace
  initProjectWorkspace(projectDir: string, settings: PetclawSettings): void {
    // 如果目录下没有必要的 workspace 文件，从模板初始化
    this.copyTemplateIfMissing('AGENTS_CHAT.md', projectDir)
    this.copyTemplateIfMissing('AGENTS_WORK.md', projectDir)
    this.syncSoulMd(settings, projectDir)
  }
}
```

**内置 Skills（8 个）**：

| Skill | 说明 |
|-------|------|
| `calendar` | macOS 日历事件创建 |
| `ai-news` | AI/科技新闻搜索 |
| `agent-browser` | 浏览器操作 |
| `apple-reminders` | macOS 提醒事项 |
| `deep-research` | 深度研究报告 |
| `obsidian` | Obsidian 笔记集成 |
| `skill-auditor` | 技能安全审计 |
| `skill-creator` | 技能创建向导 |

---

## 5. 文件结构

```
petclaw-desktop/src/main/
├── index.ts                       ← 入口（重构）
├── bootcheck.ts                   ← 启动检查（扩展 syncWorkspace）
├── app-settings.ts                ← 配置定义（扩展 ModelProvider 类型）
├── database-path.ts               ← 不变
├── diagnostics.ts                 ← 不变
│
├── ai/
│   ├── gateway.ts                 ← ★ OpenclawGateway（替代 openclaw.ts）
│   ├── session-manager.ts         ← ★ SessionManager
│   └── config-sync.ts             ← ★ ConfigSync
│
├── skills/
│   ├── skill-manager.ts           ← ★ SkillManager
│   ├── skill-scanner.ts           ← ★ SKILL.md 解析
│   └── skill-types.ts             ← ★ 类型定义
│
├── models/
│   └── model-registry.ts          ← ★ ModelRegistry
│
├── workspace/
│   └── workspace-manager.ts       ← ★ WorkspaceManager
│
├── ipc/
│   ├── index.ts                   ← ★ 模块化注册入口
│   ├── chat-ipc.ts                ← ★ chat:* handlers
│   ├── skill-ipc.ts               ← ★ skill:* handlers
│   ├── model-ipc.ts               ← ★ model:* handlers
│   ├── workspace-ipc.ts           ← ★ workspace:* handlers
│   └── settings-ipc.ts            ← ★ settings:* + onboarding
│
├── hooks/                          ← 不变
├── system/                         ← 不变
├── data/                           ← 不变
└── onboarding.ts                   ← 扩展

petclaw-desktop/resources/
├── workspace-templates/            ← ★ 新建
│   ├── AGENTS_CHAT.md
│   ├── AGENTS_WORK.md
│   └── SOUL.md
└── workspace-skills/               ← ★ 新建（8 个内置 skill）
    ├── calendar/SKILL.md
    └── ...
```

### 运行时数据

```
~/.petclaw/
├── petclaw-settings.json           ← App 全局设置（含 modelProviders）
├── openclaw.json                   ← ConfigSync 唯一写入
├── workspace/                      ← 默认 workspace（main agent）
│   ├── SOUL.md
│   ├── AGENTS_CHAT.md / AGENTS_WORK.md
│   └── ...
├── skills/                         ← Skills 集中管理目录
│   ├── calendar/SKILL.md           ← 内置
│   ├── deep-research/SKILL.md      ← 内置
│   └── my-custom-skill/SKILL.md    ← 用户安装
├── node/                           ← Node.js + Openclaw 运行时
├── agents/                         ← Openclaw agent 数据
├── logs/
└── petclaw.db                      ← SQLite
```

---

## 6. IPC Channel 设计

### 命名规范

`模块:动作` 格式，禁止驼峰。

### 完整 Channel 列表

**Chat**:

| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `chat:send` | invoke | `{ sessionId, message, attachments? }` | void |
| `chat:abort` | invoke | `{ sessionId }` | void |
| `chat:history` | invoke | `{ sessionId?, limit }` | Message[] |
| `chat:chunk` | send→renderer | `{ sessionKey, text }` | — |
| `chat:done` | send→renderer | `{ sessionKey }` | — |
| `chat:error` | send→renderer | `{ sessionKey, error }` | — |
| `chat:ai-responding` | send→renderer | `{ sessionKey }` | — |

**Session**:

| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `session:create` | invoke | `{ workspace?, modelOverride? }` | Session |
| `session:list` | invoke | — | Session[] |
| `session:get` | invoke | `{ id }` | Session |

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
| `model:set-active` | invoke | `{ providerModelId }` | void |
| `model:get-active` | invoke | — | `{ provider, model }` |

**Workspace**:

| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `workspace:select` | invoke | `{ path }` | void |
| `workspace:list-recent` | invoke | — | string[] |
| `workspace:browse` | invoke | — | string \| null |

**Settings & Onboarding**:

| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `settings:get` | invoke | `key` | string \| null |
| `settings:set` | invoke | `{ key, value }` | void |
| `onboarding:save-config` | invoke | `OnboardingSettingsInput` | void |
| `onboarding:setup-profile` | invoke | `{ userName, userOccupation }` | OnboardingResult |
| `onboarding:read-result` | invoke | — | OnboardingResult \| null |

**System**:

| Channel | 方向 | 参数 | 返回 |
|---------|------|------|------|
| `boot:status` | invoke | — | boolean \| null |
| `boot:retry` | send | — | — |
| `boot:step-update` | send→renderer | BootStep[] | — |
| `boot:complete` | send→renderer | boolean | — |
| `app:version` | invoke | — | string |
| `app:pet-ready` | send | — | — |
| `app:quit` | send | — | — |

---

## 7. 数据流

### 7.1 用户发送消息

```
Renderer → IPC chat:send { sessionId, message }
  → SessionManager.send(sessionId, message)
    → buildOutboundPrompt()
      → "[PetClaw system instructions]...[/PetClaw system instructions]\n\n{message}"
    → gateway.chatSend({
        sessionKey: 'agent:main:petclaw:{sessionId}',
        message: outboundMessage,
        deliver: false,
        idempotencyKey: runId,
      })
    → WebSocket → Openclaw Gateway → LLM + Tool 执行

Gateway 事件流返回:
  → chat.reply { sessionKey, text/delta }
    → OpenclawGateway.emit('chat.reply', payload)
      → SessionManager.handleChatReply(payload)
        → 匹配 sessionKey → 找到 session
        → IPC chat:chunk → Renderer ChatView 渲染
        → IPC pet:chat-event → PetCanvas 动画

  → chat.done { sessionKey }
    → session.status = 'idle'
    → IPC chat:done → Renderer
```

### 7.2 切换工作目录

```
Renderer → IPC workspace:select { path: '/Users/xx/projects/A' }
  → WorkspaceManager.initProjectWorkspace(path, settings)
    → 如果缺少 AGENTS_CHAT.md / AGENTS_WORK.md → 从模板复制
    → syncSoulMd(settings, path)
  → ConfigSync.setCurrentWorkspace(path)
  → ConfigSync.sync('workspace-changed')
    → 更新 openclaw.json agents.defaults.workspace
  → ConfigSync.syncAgentsMd(path, opts)
    → 同步 AGENTS.md managed section 到项目目录
  → SessionManager 创建新 session 或切换
```

### 7.3 安装 Skill

```
Renderer → IPC skill:install { source: 'https://github.com/user/my-skill' }
  → SkillManager.install(source)
    → 下载 zip / git clone → 解压到 ~/.petclaw/skills/my-skill/
    → scan() 重新扫描所有 skills
    → emit('changed')
  → ConfigSync.sync('skill-installed')
    → 更新 openclaw.json:
      skills.entries = { ..., 'my-skill': { enabled: true } }
      skills.load.extraDirs = ['~/.petclaw/skills']
  → IPC skill:changed → Renderer SkillsView 刷新
```

### 7.4 添加模型 Provider

```
Renderer → IPC model:add-provider { id: 'openai', name: 'OpenAI', ... }
  → ModelRegistry.addProvider(provider)
    → save() → 写入 petclaw-settings.json
  → ConfigSync.sync('model-provider-added')
    → 更新 openclaw.json models.providers
  → Gateway 检测 config 变更 → 热重载模型列表
```

---

## 8. 启动流程

```
app.whenReady()
  → initDatabase()
  → createChatWindow()                       // 显示 BootCheckPanel
  → registerEarlyIpcHandlers()               // settings + onboarding
  → runBootCheck(chatWindow)
      ├── detectSetupMode()
      ├── checkEnv() → checkNode() → checkRuntime()
      ├── checkModelConfig()
      │     ├── ensurePetclawCli()
      │     ├── 创建目录结构
      │     ├── WorkspaceManager.syncDefaultWorkspace(settings)  ← ★
      │     ├── WorkspaceManager.syncBuiltinSkills()             ← ★
      │     ├── ModelRegistry.load()                             ← ★
      │     ├── ConfigSync.sync('boot')                          ← ★
      │     └── 返回 { gatewayPort, gatewayToken }
      └── startAndConnect()
  → boot:complete → ChatApp:
      ├── 需要 Onboarding → OnboardingPanel
      │     ├── onboarding:save-config
      │     ├── onboarding:setup-profile → AI 对话 → onboarding-result.json
      │     └── onboarding:complete
      └── 不需要 → main → app:pet-ready
  → createPetWindow()
  → registerAllIpc(ctx)                      // 模块化 IPC 注册 ★
  → createTray() + registerShortcuts()
  → OpenclawGateway.connect()                // GatewayClient 连接 ★
  → SkillManager.scan() + startWatching()    // Skill 扫描 ★
```

---

## 9. 实现分期

### Phase 1: 基础架构（当前迭代）

- OpenclawGateway（GatewayClient 动态加载 + 连接 + 事件分发）
- SessionManager（基础会话管理 + chat.send）
- ConfigSync（openclaw.json 生成 + AGENTS.md 同步）
- WorkspaceManager（模板 + 内置 skills 初始化）
- IPC 模块化重构
- 删除旧 `OpencLawProvider`

### Phase 2: Skills + Models

- SkillManager（扫描 + 安装 + 卸载 + 启用/禁用）
- ModelRegistry（多 Provider + 多 Model）
- SkillsView 前端页面
- Settings 模型管理 UI
- Onboarding AI 对话（`chat.send` → `agent:main:onboarding`）

### Phase 3: 多 Agent + 高级功能

- 工作目录选择 UI + 切换逻辑
- 多 Agent workspace 管理
- Exec Approval UI（命令审批弹窗）
- Skill 市场集成
- StarterCards 渲染

---

## 10. 不做的事

- IM Gateway（微信/钉钉/飞书等通道）
- Cron 定时任务
- Artifacts 沙箱渲染
- Voice 语音功能
- Channel 管理
- CoworkEngineRouter 多引擎路由（只用 Openclaw）

---

## 11. 验证标准

- `npx tsc --noEmit --project tsconfig.node.json` 类型检查通过
- GatewayClient 动态加载成功，`chat.send` 消息正常流转
- 删除 `~/.petclaw/workspace/` → 重启 → 模板文件 + 内置 skills 自动生成
- ConfigSync 生成的 openclaw.json 包含正确的 models、skills、agents 配置
- SkillManager 扫描 `~/.petclaw/skills/` 返回正确列表
- IPC channel 三处同步（ipc.ts + preload/index.ts + preload/index.d.ts）