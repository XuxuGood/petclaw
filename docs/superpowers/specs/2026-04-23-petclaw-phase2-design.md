# PetClaw v3 Phase 2 — 核心功能设计

**日期**: 2026-04-23
**状态**: 设计完成，待实现
**范围**: AgentManager、ModelRegistry、SkillManager、McpManager、MemoryManager、ConfigSync 重构、SessionManager 升级、IPC 扩展、前端 Settings 改造、ChatInputBox 重构
**参考**: LobsterAI 源码 `/Users/xiaoxuxuy/Desktop/工作/AI/开源项目/LobsterAI`

---

## 1. 设计目标

在 Phase 1 基础架构（EngineManager / Gateway / CoworkController）之上，构建**核心功能层**：

1. **多 Agent** — 预设 + 自定义 Agent，DB 持久化，每个 Agent 独立 system_prompt / model / skills
2. **多 Provider 多 Model** — 11 个预设提供商 + 自定义，API Key 安全存储，测试连接
3. **Skills 管理** — 扫描 + 启用/禁用，通过 openclaw.json 原生加载
4. **MCP 服务器** — stdio/sse/streamable-http 三种传输，DB 持久化
5. **持久记忆** — 纯文件驱动（MEMORY.md + daily notes）
6. **ConfigSync 升级** — 从 deps 注入重构为直接依赖 Manager，新增 workspace 文件同步
7. **前端完整改造** — Settings 分 Tab 页面 + ChatInputBox 增强

---

## 2. 架构概览

```
Phase 1 基础层（已完成）:
  OpenclawEngineManager → OpenclawGateway → CoworkController → CoworkStore

Phase 2 新增功能层（本次）:
  AgentManager ──┐
  ModelRegistry ─┤
  SkillManager ──┼→ ConfigSync（聚合）→ openclaw.json
  McpManager ────┘
  MemoryManager（独立，纯文件）

Phase 2 升级:
  ConfigSync    — deps 注入 → 直接依赖 Manager
  SessionManager — 支持 Agent 切换 + sessionKey 格式
  IPC           — 新增 agents/models/skills/mcp/memory channels
  前端           — Settings 分 Tab + ChatInputBox 增强
```

**关键设计决策**：

| 决策 | 选择 | 原因 |
|------|------|------|
| ConfigSync 依赖方式 | 直接依赖 Manager | ConfigSync 是聚合层，deps 注入增加不必要间接性 |
| DB 组织 | Manager 自包含 CRUD | 每个 Manager 自治，不需要集中 CRUD 层 |
| API Key 存储 | SQLite kv 表 + 环境变量注入 | Key 不写入 openclaw.json，通过 `${VAR}` 占位符 |
| Skills 加载 | openclaw.json `skills.load.extraDirs` | Openclaw runtime 原生扫描，不需要手动注入 |

---

## 3. DB Schema 扩展

在 `data/db.ts` 的 `initDatabase()` 中新增两张表。ModelRegistry 复用 kv 表，不新建表。

### 3.1 agents 表

```sql
CREATE TABLE IF NOT EXISTS agents (
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
```

### 3.2 mcp_servers 表

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  transport_type TEXT NOT NULL DEFAULT 'stdio',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 3.3 ModelRegistry 存储

复用 kv 表，两个 key：

| key | value | 说明 |
|-----|-------|------|
| `modelProviders` | JSON: `ModelProvider[]` | 所有 Provider 配置（含自定义） |
| `activeModel` | JSON: `string` | 当前活跃模型 ID（如 `openai/gpt-4o`） |

---

## 4. AgentManager

### 4.1 文件位置

`src/main/agents/agent-manager.ts`

### 4.2 接口设计

```typescript
export interface Agent {
  id: string
  name: string
  description: string
  systemPrompt: string
  identity: string
  model: string           // 'llm/openai/gpt-4o' 格式
  icon: string            // emoji
  skillIds: string[]
  enabled: boolean
  isDefault: boolean
  source: 'preset' | 'custom'
  presetId: string
  createdAt: number
  updatedAt: number
}

export class AgentManager extends EventEmitter {
  constructor(private db: Database.Database) {}

  create(agent: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Agent
  update(id: string, patch: Partial<Agent>): Agent
  delete(id: string): void        // main agent 不可删除
  list(): Agent[]
  get(id: string): Agent | undefined
  ensurePresetAgents(): void      // 首次启动安装预设 Agent
  toOpenclawConfig(): OpenclawAgentsConfig

  on('change', () => void): this  // CRUD 后触发
}
```

### 4.3 预设 Agent

PetClaw 简化为 4 个预设（参考 LobsterAI，适配宠物助理场景）：

| ID | 名称 | Icon | 说明 |
|----|------|------|------|
| `main` | 默认助手 | 🐾 | 通用助手，不可删除 |
| `code-expert` | 代码专家 | 💻 | 编程辅助 |
| `content-creator` | 内容创作 | ✍️ | 文案/文章写作 |
| `pet-care` | 萌宠管家 | 🐱 | 宠物健康/行为咨询 |

### 4.4 toOpenclawConfig()

```typescript
toOpenclawConfig(): { defaults: { timeoutSeconds: number; model: { primary: string }; workspace: string } } {
  const mainAgent = this.list().find(a => a.isDefault)
  return {
    defaults: {
      timeoutSeconds: 3600,
      model: { primary: mainAgent?.model || 'llm/petclaw-fast' },
      workspace: this.workspacePath
    }
  }
}
```

---

## 5. ModelRegistry

### 5.1 文件位置

`src/main/models/model-registry.ts`

### 5.2 接口设计

```typescript
export interface ModelProvider {
  id: string                // 'petclaw', 'openai', 'custom-xxx'
  name: string
  baseUrl: string
  apiKey: string            // 明文存储在 SQLite，不写入 openclaw.json
  apiFormat: 'openai-completions' | 'anthropic'
  isPreset: boolean
  models: ModelDefinition[]
}

export interface ModelDefinition {
  id: string                // 'gpt-4o'
  name: string
  reasoning: boolean
  supportsImage: boolean
  contextWindow: number
  maxTokens: number
}

export class ModelRegistry extends EventEmitter {
  constructor(private db: Database.Database) {}

  // Provider CRUD
  addProvider(provider: Omit<ModelProvider, 'isPreset'>): void
  updateProvider(id: string, patch: Partial<ModelProvider>): void
  removeProvider(id: string): void    // 预设不可删除
  listProviders(): ModelProvider[]
  getProvider(id: string): ModelProvider | undefined

  // 活跃模型
  setActiveModel(providerModelId: string): void   // 'openai/gpt-4o'
  getActiveModel(): { provider: ModelProvider; model: ModelDefinition } | null

  // 测试连接（发送简单请求验证 API Key）
  async testConnection(providerId: string): Promise<{ ok: boolean; error?: string; latencyMs?: number }>

  // 序列化到 openclaw.json
  toOpenclawConfig(): OpenclawModelsConfig

  // API Key 收集（注入 Gateway 环境变量）
  collectSecretEnvVars(): Record<string, string>

  // 持久化
  save(): void   // → kv 表
  load(): void   // ← kv 表

  on('change', () => void): this
}
```

### 5.3 预设 Provider

11 个预设提供商（参考 v3 spec §11.2）：

| ID | 名称 | API 格式 | Base URL |
|----|------|----------|----------|
| `petclaw` | PetClaw | openai-completions | `https://petclaw.ai/api/v1` |
| `openai` | OpenAI | openai-completions | `https://api.openai.com/v1` |
| `anthropic` | Anthropic | anthropic | `https://api.anthropic.com` |
| `gemini` | Google Gemini | openai-completions | `https://generativelanguage.googleapis.com/v1beta` |
| `deepseek` | 深度求索 | openai-completions | `https://api.deepseek.com` |
| `alibaba` | 阿里百炼 | openai-completions | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `doubao` | 字节豆包 | openai-completions | `https://ark.cn-beijing.volces.com/api/v3` |
| `zhipu` | 智谱 GLM | openai-completions | `https://open.bigmodel.cn/api/paas/v4` |
| `lingyiwanwu` | 零一万物 | openai-completions | `https://api.lingyiwanwu.com/v1` |
| `mistral` | Mistral | openai-completions | `https://api.mistral.ai/v1` |
| `groq` | Groq | openai-completions | `https://api.groq.com/openai/v1` |

### 5.4 API Key 安全机制

参考 LobsterAI 的 `${VAR}` 占位符模式：

```json
// openclaw.json 中写入
"providers": {
  "openai": {
    "baseUrl": "https://api.openai.com/v1",
    "api": "openai-completions",
    "apiKey": "${PETCLAW_APIKEY_OPENAI}",
    "auth": "api-key"
  }
}
```

```typescript
// collectSecretEnvVars() 返回
{ "PETCLAW_APIKEY_OPENAI": "sk-xxx..." }
```

Gateway 进程启动时注入这些环境变量，runtime 解析 `${VAR}` 占位符后使用真实值。

### 5.5 toOpenclawConfig()

```typescript
toOpenclawConfig() {
  const providers: Record<string, unknown> = {}
  for (const p of this.listProviders()) {
    if (!p.apiKey) continue  // 未配置 Key 的跳过
    const envVar = `PETCLAW_APIKEY_${p.id.toUpperCase()}`
    providers[p.id] = {
      baseUrl: p.baseUrl,
      api: p.apiFormat,
      apiKey: `\${${envVar}}`,
      auth: 'api-key',
      models: p.models.map(m => ({
        id: m.id,
        name: m.name,
        ...(m.reasoning && { reasoning: true }),
      }))
    }
  }
  return { mode: 'replace', providers }
}
```

---

## 6. SkillManager

### 6.1 文件位置

`src/main/skills/skill-manager.ts`

### 6.2 接口设计

```typescript
export interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
  isBuiltIn: boolean
  skillPath: string
  version?: string
}

export class SkillManager extends EventEmitter {
  constructor(private db: Database.Database, private skillsRoot: string) {}

  getSkillsRoot(): string
  async scan(): Promise<Skill[]>           // 扫描 skillsRoot 下的 SKILL.md
  setEnabled(id: string, enabled: boolean): void  // 状态存 kv 表
  list(): Skill[]
  getEnabled(): Skill[]

  toOpenclawConfig(): {
    entries: Record<string, { enabled: boolean }>
    load: { extraDirs: string[]; watch: boolean }
  }

  on('change', () => void): this
}
```

### 6.3 Skills 加载机制

通过 openclaw.json 的 `skills.load.extraDirs` 配置 Skills 目录，Openclaw runtime 原生扫描 SKILL.md：

```json
"skills": {
  "entries": {
    "web-search": { "enabled": true },
    "code-analyzer": { "enabled": false }
  },
  "load": {
    "extraDirs": ["{userData}/SKILLs"],
    "watch": true
  }
}
```

`entries` 控制每个 skill 的启用/禁用状态。`extraDirs` 告诉 runtime 去哪扫描。

### 6.4 enabled 状态存储

参考 LobsterAI，使用 kv 表存储 `skills_state` key，值为 `Record<string, boolean>` JSON。

---

## 7. McpManager

### 7.1 文件位置

`src/main/mcp/mcp-manager.ts`

### 7.2 接口设计

```typescript
export interface McpServer {
  id: string
  name: string
  description: string
  enabled: boolean
  transportType: 'stdio' | 'sse' | 'streamable-http'
  config: StdioConfig | HttpConfig
  createdAt: number
  updatedAt: number
}

export interface StdioConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface HttpConfig {
  url: string
  headers?: Record<string, string>
}

export class McpManager extends EventEmitter {
  constructor(private db: Database.Database) {}

  create(server: Omit<McpServer, 'id' | 'createdAt' | 'updatedAt'>): McpServer
  update(id: string, patch: Partial<McpServer>): McpServer
  delete(id: string): void
  list(): McpServer[]
  get(id: string): McpServer | undefined
  setEnabled(id: string, enabled: boolean): void
  toOpenclawConfig(): OpenclawMcpConfig

  on('change', () => void): this
}
```

### 7.3 toOpenclawConfig()

MCP 服务器作为 plugin 注入 openclaw.json（参考 LobsterAI mcp-bridge 模式）：

```json
"plugins": {
  "entries": {
    "mcp-bridge": {
      "enabled": true,
      "config": {
        "servers": {
          "my-server": {
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem"]
          }
        }
      }
    }
  }
}
```

---

## 8. MemoryManager

### 8.1 文件位置

`src/main/memory/memory-manager.ts`

### 8.2 工作原理

**纯文件驱动**，不使用 DB 表。Openclaw runtime 在每次会话启动时自动加载记忆文件注入上下文。

### 8.3 接口设计

```typescript
export class MemoryManager {
  readMemory(workspace: string): string
  appendMemory(workspace: string, entry: string): void
  removeMemory(workspace: string, entryText: string): void
  searchMemory(workspace: string, keyword: string): string[]
  listEntries(workspace: string): MemoryEntry[]
  updateEntry(workspace: string, oldText: string, newText: string): void
}

interface MemoryEntry {
  text: string
  line: number
}
```

### 8.4 文件结构

| 文件 | 位置 | 用途 |
|------|------|------|
| `MEMORY.md` | workspace 根目录 | 持久化事实、偏好与决策 |
| `memory/YYYY-MM-DD.md` | workspace/memory/ | 每日临时笔记 |
| `USER.md` | workspace 根目录 | 用户档案（Agent 自主创建） |

---

## 9. ConfigSync 重构

### 9.1 从 deps 注入改为直接依赖

Phase 1 的 ConfigSync 使用 `ConfigSyncDeps` 接口注入，Phase 2 重构为直接接收 Manager 实例：

```typescript
export class ConfigSync {
  constructor(
    private engineManager: OpenclawEngineManager,
    private agentManager: AgentManager,
    private modelRegistry: ModelRegistry,
    private skillManager: SkillManager,
    private mcpManager: McpManager,
  ) {}

  sync(reason: string): ConfigSyncResult {
    const config = {
      models: this.modelRegistry.toOpenclawConfig(),
      agents: this.agentManager.toOpenclawConfig(),
      skills: this.skillManager.toOpenclawConfig(),
      mcp: this.mcpManager.toOpenclawConfig(),
      hooks: { internal: { entries: { 'session-memory': { enabled: false } } } },
      gateway: this.preserveGatewayConfig(),
      commands: { ownerAllowFrom: ['gateway-client', '*'] },
    }
    this.atomicWrite(config)
    this.syncWorkspaceFiles()
    return { ok: true, changed: true, configPath: this.configPath }
  }

  collectSecretEnvVars(): Record<string, string> {
    return this.modelRegistry.collectSecretEnvVars()
  }
}
```

### 9.2 Workspace 文件同步

每次 `sync()` 时同步 workspace 下的 .md 文件：

**Main Agent**：只写 AGENTS.md（双区结构：用户区 + managed 区）

```
[用户自定义内容]

<!-- PetClaw managed: do not edit below this line -->

## System Prompt
<agent.systemPrompt>

<MANAGED_WEB_SEARCH_POLICY>
<MANAGED_EXEC_SAFETY>
<MANAGED_MEMORY_POLICY>
```

**非 Main Agent**：每个 agent 独立 workspace 目录 `{stateDir}/workspace-{agentId}/`
- SOUL.md = agent.systemPrompt
- IDENTITY.md = agent.identity
- AGENTS.md = 同上双区结构
- MEMORY.md + memory/ = 只确保存在

### 9.3 Manager change 事件自动触发 sync

```typescript
// index.ts 中注册
agentManager.on('change', () => configSync.sync('agent-change'))
modelRegistry.on('change', () => configSync.sync('model-change'))
skillManager.on('change', () => configSync.sync('skill-change'))
mcpManager.on('change', () => configSync.sync('mcp-change'))
```

---

## 10. SessionManager 升级

### 10.1 Agent 切换支持

```typescript
create(opts: {
  workspace?: string
  agentId?: string       // 默认 'main'
  modelOverride?: string
  skillIds?: string[]
}): Session
```

SessionKey 格式：`agent:{agentId}:petclaw:{sessionId}`

### 10.2 outbound prompt 构建

发送消息时根据当前 Agent 构建 prompt：

```typescript
private buildOutboundPrompt(session: Session, message: string): {
  sessionKey: string
  message: string
  workspace: string
  systemPrompt?: string
  activeSkillIds?: string[]
} {
  const agent = this.agentManager.get(session.agentId)
  return {
    sessionKey: `agent:${session.agentId}:petclaw:${session.id}`,
    message,
    workspace: agent?.isDefault
      ? this.workspacePath
      : path.join(this.stateDir, `workspace-${session.agentId}`),
    activeSkillIds: session.activeSkillIds || agent?.skillIds,
  }
}
```

---

## 11. IPC 扩展

### 11.1 新增 IPC channels

所有 channel 遵循 `模块:动作` kebab-case 规范。

| Channel | 方向 | 说明 |
|---------|------|------|
| `agents:list` | invoke | 获取所有 Agent |
| `agents:get` | invoke | 获取单个 Agent |
| `agents:create` | invoke | 创建 Agent |
| `agents:update` | invoke | 更新 Agent |
| `agents:delete` | invoke | 删除 Agent |
| `models:providers` | invoke | 获取所有 Provider |
| `models:add-provider` | invoke | 添加 Provider |
| `models:update-provider` | invoke | 更新 Provider |
| `models:remove-provider` | invoke | 删除 Provider |
| `models:active` | invoke | 获取活跃模型 |
| `models:set-active` | invoke | 设置活跃模型 |
| `models:test-connection` | invoke | 测试 Provider 连接 |
| `skills:list` | invoke | 获取所有 Skill |
| `skills:set-enabled` | invoke | 启用/禁用 Skill |
| `mcp:list` | invoke | 获取所有 MCP 服务器 |
| `mcp:create` | invoke | 创建 MCP 服务器 |
| `mcp:update` | invoke | 更新 MCP 服务器 |
| `mcp:delete` | invoke | 删除 MCP 服务器 |
| `mcp:set-enabled` | invoke | 启用/禁用 MCP 服务器 |
| `memory:read` | invoke | 读取 MEMORY.md |
| `memory:append` | invoke | 追加记忆条目 |
| `memory:remove` | invoke | 删除记忆条目 |
| `memory:search` | invoke | 搜索记忆 |

### 11.2 IPC 模块文件

| 文件 | 职责 |
|------|------|
| `ipc/agents-ipc.ts` | Agent CRUD handlers |
| `ipc/models-ipc.ts` | Model Provider handlers |
| `ipc/skills-ipc.ts` | Skill 管理 handlers |
| `ipc/mcp-ipc.ts` | MCP 服务器 handlers |
| `ipc/memory-ipc.ts` | 记忆管理 handlers |

### 11.3 Preload 扩展

```typescript
// preload/index.ts 新增
agents: {
  list: () => ipcRenderer.invoke('agents:list'),
  get: (id: string) => ipcRenderer.invoke('agents:get', id),
  create: (data: unknown) => ipcRenderer.invoke('agents:create', data),
  update: (id: string, patch: unknown) => ipcRenderer.invoke('agents:update', id, patch),
  delete: (id: string) => ipcRenderer.invoke('agents:delete', id),
},
models: {
  providers: () => ipcRenderer.invoke('models:providers'),
  addProvider: (data: unknown) => ipcRenderer.invoke('models:add-provider', data),
  updateProvider: (id: string, patch: unknown) => ipcRenderer.invoke('models:update-provider', id, patch),
  removeProvider: (id: string) => ipcRenderer.invoke('models:remove-provider', id),
  active: () => ipcRenderer.invoke('models:active'),
  setActive: (id: string) => ipcRenderer.invoke('models:set-active', id),
  testConnection: (id: string) => ipcRenderer.invoke('models:test-connection', id),
},
skills: {
  list: () => ipcRenderer.invoke('skills:list'),
  setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('skills:set-enabled', id, enabled),
},
mcp: {
  list: () => ipcRenderer.invoke('mcp:list'),
  create: (data: unknown) => ipcRenderer.invoke('mcp:create', data),
  update: (id: string, patch: unknown) => ipcRenderer.invoke('mcp:update', id, patch),
  delete: (id: string) => ipcRenderer.invoke('mcp:delete', id),
  setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('mcp:set-enabled', id, enabled),
},
memory: {
  read: (workspace: string) => ipcRenderer.invoke('memory:read', workspace),
  append: (workspace: string, entry: string) => ipcRenderer.invoke('memory:append', workspace, entry),
  remove: (workspace: string, text: string) => ipcRenderer.invoke('memory:remove', workspace, text),
  search: (workspace: string, keyword: string) => ipcRenderer.invoke('memory:search', workspace, keyword),
},
```

---

## 12. 前端 Settings 改造

### 12.1 现有状态

SettingsView 只有一个 Gateway URL 配置项 + 快捷键信息 + 版本号。

### 12.2 新设计：分 Tab 结构

参考 LobsterAI Settings 布局，适配 PetClaw 设计语言。

```
┌──────────────────────────────────────────────┐
│  设置                                         │
├──────────────────────────────────────────────┤
│  [模型] [Agent] [MCP] [记忆] [通用]           │
├──────────────────────────────────────────────┤
│                                              │
│  ┌──────────┐  ┌──────────────────────┐      │
│  │ Provider  │  │  配置面板            │      │
│  │ 列表     │  │                      │      │
│  │ (左栏)   │  │  API Key             │      │
│  │          │  │  Base URL            │      │
│  │  OpenAI  │  │  API 格式            │      │
│  │  Claude  │  │  [测试连接]          │      │
│  │  ...     │  │  模型列表            │      │
│  │          │  │                      │      │
│  │ [+自定义]│  │                      │      │
│  └──────────┘  └──────────────────────┘      │
│                                              │
└──────────────────────────────────────────────┘
```

### 12.3 Tab 内容

| Tab | 组件 | 内容 |
|-----|------|------|
| 模型 | `ModelSettingsTab` | 左栏 Provider 列表 + 右栏配置面板（API Key、Base URL、模型列表、测试连接） |
| Agent | `AgentSettingsTab` | Agent 列表 + 创建/编辑对话框（名称、描述、图标、System Prompt、模型选择、技能绑定） |
| MCP | `McpSettingsTab` | 服务器列表 + 添加/编辑对话框（名称、传输协议、配置参数） |
| 记忆 | `MemorySettingsTab` | MEMORY.md 内容查看/编辑 + 搜索 |
| 通用 | `GeneralSettingsTab` | 快捷键、版本信息（保留原有内容） |

### 12.4 UI 规范

遵循 PetClaw 设计系统：

- 圆角：`rounded-[10px]` / `rounded-[14px]`
- 交互：`active:scale-[0.96] duration-[120ms]`
- 卡片：`bg-bg-card shadow-[var(--shadow-card)] border border-border`
- 输入框：`bg-bg-input border-border-input focus:border-accent`
- 按钮：`bg-accent text-white hover:bg-accent-hover`

---

## 13. ChatInputBox 重构

### 13.1 现有状态

ChatView 中的输入区域是简单的 textarea + Send 按钮。

### 13.2 新设计

参考 LobsterAI `CoworkPromptInput.tsx`，增加以下功能：

```
┌──────────────────────────────────────────────┐
│  [🐾 默认助手 ▾]  [📁 ~/projects ▾]         │
├──────────────────────────────────────────────┤
│                                              │
│  输入消息...                                  │
│                                              │
├──────────────────────────────────────────────┤
│  [🔧 Skills: web-search, code +2]  [📎] [↑] │
└──────────────────────────────────────────────┘
```

### 13.3 子组件

| 组件 | 功能 |
|------|------|
| `AgentSelector` | 下拉选择当前 Agent（显示 icon + name） |
| `CwdSelector` | 工作目录选择器（最近目录列表 + 添加文件夹） |
| `SkillSelector` | 多选已启用的 Skills（Popover 展示 Skill 列表 + checkbox） |
| `AttachmentBar` | 附件预览栏（图片缩略图 + 文件图标，拖放或点击添加） |

### 13.4 数据流

```
用户输入消息 + 选择 Agent/cwd/skills
  → chat:send IPC (message, cwd, agentId, skillIds)
  → SessionManager.createAndStart(title, cwd, prompt, { agentId, skillIds })
  → CoworkController → Gateway
```

---

## 14. 启动流程变更

### 14.1 index.ts 调整

Phase 2 在 Phase 1 的启动流程基础上插入 Manager 初始化：

```
Phase 1 步骤 1-4（DB、CoworkStore、EngineManager、ConfigSync）

+ Phase 2 新增:
  5. AgentManager 初始化 + ensurePresetAgents()
  6. ModelRegistry 初始化 + load()
  7. SkillManager 初始化 + scan()
  8. McpManager 初始化
  9. MemoryManager 初始化
  10. ConfigSync 重构（接收 5 个 Manager）
  11. Manager change 事件绑定 ConfigSync.sync()

Phase 1 步骤 5-15（窗口创建、BootCheck、IPC 注册等）

+ Phase 2 新增:
  注册新 IPC handlers（agents、models、skills、mcp、memory）
```

---

## 15. 文件结构

### 15.1 新建文件

| 文件 | 职责 |
|------|------|
| `src/main/agents/agent-manager.ts` | Agent CRUD + 预设 Agent |
| `src/main/agents/preset-agents.ts` | 预设 Agent 数据定义 |
| `src/main/models/model-registry.ts` | 模型 Provider 管理 |
| `src/main/models/preset-providers.ts` | 11 个预设 Provider 数据 |
| `src/main/skills/skill-manager.ts` | Skill 扫描 + 开关控制 |
| `src/main/mcp/mcp-manager.ts` | MCP 服务器管理 |
| `src/main/memory/memory-manager.ts` | 记忆文件读写 |
| `src/main/ipc/agents-ipc.ts` | Agent IPC handlers |
| `src/main/ipc/models-ipc.ts` | Model IPC handlers |
| `src/main/ipc/skills-ipc.ts` | Skill IPC handlers |
| `src/main/ipc/mcp-ipc.ts` | MCP IPC handlers |
| `src/main/ipc/memory-ipc.ts` | Memory IPC handlers |
| `src/renderer/src/chat/components/settings/*.tsx` | Settings 各 Tab 组件 |
| `src/renderer/src/chat/components/ChatInputBox.tsx` | 增强输入框 |
| `src/renderer/src/chat/components/AgentSelector.tsx` | Agent 选择器 |
| `src/renderer/src/chat/components/CwdSelector.tsx` | 工作目录选择器 |
| `src/renderer/src/chat/components/SkillSelector.tsx` | Skill 选择器 |

### 15.2 修改文件

| 文件 | 变更 |
|------|------|
| `src/main/data/db.ts` | `initDatabase()` 新增 agents、mcp_servers 建表 |
| `src/main/ai/config-sync.ts` | 重构：deps 注入 → 直接依赖 Manager |
| `src/main/ai/session-manager.ts` | 支持 agentId、sessionKey 格式 |
| `src/main/index.ts` | 启动流程新增 Manager 初始化 |
| `src/main/ipc/index.ts` | 注册新 IPC handlers |
| `src/preload/index.ts` | 新增 agents/models/skills/mcp/memory channels |
| `src/preload/index.d.ts` | 类型定义同步 |
| `src/renderer/src/chat/components/SettingsView.tsx` | 改为分 Tab 结构 |
| `src/renderer/src/chat/components/ChatView.tsx` | 集成 ChatInputBox |

---

## 16. 验证标准

### 后端验证

- `npx tsc --noEmit` 类型检查通过
- AgentManager: CRUD → DB 持久化 → ConfigSync 同步，预设 Agent 首次自动创建
- ModelRegistry: 多 Provider 配置，API Key 不出现在 openclaw.json（只有 `${VAR}` 占位符）
- SkillManager: 扫描返回 Skill 列表，启用/禁用触发 ConfigSync
- McpManager: CRUD → DB 持久化 → ConfigSync 同步
- MemoryManager: 读写 MEMORY.md 正常
- ConfigSync: 聚合 5 个 Manager → openclaw.json 生成正确
- IPC channel 三处同步（ipc/*.ts + preload/index.ts + preload/index.d.ts）
- Manager change 事件 → ConfigSync.sync() 自动触发

### 前端验证

- Settings 模型 Tab: Provider 列表 + API Key 配置 + 测试连接反馈
- Settings Agent Tab: Agent 列表 + 创建/编辑/删除
- Settings MCP Tab: 服务器列表 + 添加/编辑/删除 + 传输协议选择
- Settings 记忆 Tab: MEMORY.md 查看/编辑/搜索
- ChatInputBox: Agent 选择 + cwd 选择 + Skill 多选 + 附件添加
- 所有 UI 组件遵循 PetClaw 设计系统（Tailwind token、圆角、动效）
