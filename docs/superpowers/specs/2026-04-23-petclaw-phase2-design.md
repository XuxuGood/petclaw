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
  logo: string              // 品牌 logo 路径或 icon 名
  baseUrl: string
  apiKey: string            // 明文存储在 SQLite，不写入 openclaw.json
  apiFormat: 'openai-completions' | 'anthropic'
  enabled: boolean          // 是否启用，禁用后不出现在 ModelSelector
  isPreset: boolean
  isCustom: boolean         // 自定义 Provider 显示额外字段（显示名称）
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
  toggleProvider(id: string, enabled: boolean): void  // 启用/禁用
  listProviders(): ModelProvider[]
  getProvider(id: string): ModelProvider | undefined

  // 模型 CRUD（每个 Provider 下的模型列表）
  addModel(providerId: string, model: ModelDefinition): void
  removeModel(providerId: string, modelId: string): void
  updateModel(providerId: string, modelId: string, patch: Partial<ModelDefinition>): void

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
| `deepseek` | DeepSeek | openai-completions | `https://api.deepseek.com/v1` |
| `zhipu` | 智谱 Zhipu | openai-completions | `https://open.bigmodel.cn/api/paas/v4` |
| `minimax` | MiniMax | openai-completions | `https://api.minimax.chat/v1` |
| `volcengine` | 火山引擎 Volcengine | openai-completions | `https://ark.cn-beijing.volces.com/api/v3` |
| `youdao` | 有道 Youdao | openai-completions | `https://api.youdao.com/v1` |
| `qianfan` | 百度千帆 Qianfan | openai-completions | `https://aip.baidubce.com/rpc/2.0/ai_custom/v1` |
| `stepfun` | 阶跃星辰 StepFun | openai-completions | `https://api.stepfun.com/v1` |
| `xiaomi` | 小米 Xiaomi | openai-completions | `https://api.xiaomi.com/v1` |
| `ollama` | Ollama | openai-completions | `http://localhost:11434/v1` |
| `gemini` | Google Gemini | openai-completions | `https://generativelanguage.googleapis.com/v1beta` |
| `alibaba` | 阿里百炼 | openai-completions | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
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

## 12. 主页布局（参考 LobsterAI）

参考设计稿：`docs/设计/主页.png`（空状态）、`docs/设计/主页3.png`（聊天态 + 右面板 + 连接器）

### 12.1 整体结构 — 三栏布局

PetClaw Chat 窗口采用**左侧栏 + 中间主区域 + 可选右面板**三栏布局。

```
┌──────────────┬──────────────────────────────────┬──────────────┐
│              │  会话标题              [问题反馈] [≡]│              │
│  + 新任务     │                                  │  任务监控   ☐ │
│              │                                  │              │
│  🔧 技能     │                                  │  待办         │
│  ⏰ 定时任务  │     主内容区                       │  暂无待办     │
│  💬 IM 频道   │                                  │              │
│              │  · 欢迎页（无活跃会话时）           │  产物         │
│  我的 Agent   │  · 聊天页（有活跃会话时）           │  默认工作目录  │
│  🐾 默认助手 ◀│  · 技能页（侧栏点击「技能」时）     │              │
│  💻 代码专家  │  · 定时任务页（点击「定时任务」时）  │  技能与 MCP   │
│  ✍️ 内容创作  │                                  │  没有描述     │
│  🐱 萌宠管家  │                                  │              │
│              │                                  │              │
│  ┌─────────┐ │                                  │              │
│  │任务│频道 │ │                                  │              │
│  └─────────┘ │                                  │              │
│  · 整理「品牌 │                                  │              │
│  · 帮我使用.. │                                  │              │
│  · 连接如何.. │                                  │              │
│              │                                  │              │
│              │  ┌──────────────────────────────┐│              │
│              │  │ 描述任务，/ 调用技能与工具      ││              │
│  ┌──────────┐│  ├──────────────────────────────┤│              │
│  │ 👤 徐旭  ││  │[📁cwd] [🔧] [🔌] [📎] [⚡][↑]││              │
│  │ ⚙️      ││  └──────────────────────────────┘│              │
│  └──────────┘│                                  │              │
└──────────────┴──────────────────────────────────┴──────────────┘
     220px              flex-1 (自适应)               240px
```

**三栏职责**：
- **左侧栏**（`w-[220px]` 固定）：导航 + Agent 切换 + 会话列表 + 用户/设置
- **主内容区**（`flex-1`）：根据 `activeView` 切换不同页面
- **右面板**（`w-[240px]` 可收起）：任务监控，仅在聊天态下可通过顶栏 `≡` 按钮 toggle

### 12.2 页面路由（ViewType）

Phase 1 的 `ViewType = 'chat' | 'monitor' | 'settings'` 升级为：

```typescript
type ViewType = 'chat' | 'skills' | 'cron' | 'settings'
// 'settings' 是独立全页面（非弹窗），进入时隐藏主侧栏
// 'monitor' 合并到 chat 的右面板
```

每个侧栏元素与主内容区的映射关系：

| 侧栏操作 | 主内容区变化 | 侧栏列表变化 | 状态变更 |
|----------|------------|------------|---------|
| **`+ 新任务`** | 切换到 `chat` → 新会话聊天界面 | 会话列表顶部新增一条 | `activeView='chat'`, 新 `activeSessionId` |
| **技能** | 切换到 `skills` → 技能管理页 | 无变化 | `activeView='skills'` |
| **定时任务** | 切换到 `cron` → 定时任务页 | 无变化 | `activeView='cron'` |
| **IM 频道** | 打开连接器弹窗（Phase 3 实现完整页面） | 无变化 | 弹窗 state |
| **Agent 项** | 切换到 `chat` → 该 Agent 最近会话或欢迎页 | 会话列表重新过滤为该 Agent | `currentAgentId`, `activeView='chat'` |
| **会话项** | 切换到 `chat` → 该会话聊天界面 | 该会话高亮 | `activeSessionId`, `activeView='chat'` |
| **设置齿轮** | 切换到 `settings` → 设置全页面（隐藏主侧栏） | 无变化 | `activeView='settings'` |

### 12.3 核心状态模型

```typescript
// ChatApp 顶层状态
interface ChatAppState {
  // 页面路由
  activeView: ViewType              // 'chat' | 'skills' | 'cron' | 'settings'
  previousView: ViewType            // settings 返回时恢复的 view

  // Agent & 会话
  currentAgentId: string            // 当前选中 Agent ID（默认 'main'）
  activeSessionId: string | null    // 当前活跃会话 ID（null = 欢迎页）

  // 侧栏 Tab
  sidebarTab: 'tasks' | 'channels'  // 侧栏列表区域的 tab

  // Settings 子菜单
  settingsTab: string               // Settings 页面内的菜单项（如 'preferences'）

  // 面板 & 弹窗
  taskMonitorOpen: boolean          // 右侧任务监控面板是否展开
  connectorOpen: boolean            // 连接器弹窗是否打开
}
```

### 12.4 侧栏（Sidebar）— 分区与交互

参考 LobsterAI 侧栏结构，PetClaw 侧栏自上而下 6 个分区：

| 分区 | 内容 | 交互行为 |
|------|------|----------|
| **Logo + 新任务** | PetClaw Logo + `+ 新任务` 按钮 | 点击 → `createSession(currentAgentId)` → 切换到新会话聊天 |
| **导航** | 技能、定时任务、IM 频道 | 点击 → 切换 `activeView`（IM 频道特殊处理见下方） |
| **我的 Agent** | section 标题 + Agent 列表（4 个预设） | 点击 Agent → `setCurrentAgentId` → 过滤会话列表 → 切换到 chat |
| **Tab 切换** | `任务 │ 频道` | 只切换 `sidebarTab`，**不改变主内容区** |
| **列表区** | 根据 sidebarTab 显示不同列表 | 详见下方 |
| **底部栏** | 头像 + 昵称 + 设置齿轮 | 齿轮 → `settingsOpen=true` |

**列表区联动规则**：

| sidebarTab | 列表内容 | 数据来源 | 点击行为 |
|------------|---------|----------|---------|
| `tasks` | 当前 Agent 的会话列表 | `CoworkStore.getSessions()` 按 `agentId` 过滤 | 点击 → `activeSessionId` = 该会话, `activeView='chat'` |
| `channels` | IM 频道列表（Phase 3 占位） | McpManager / IM 配置 | Phase 3 实现 |

**IM 频道导航特殊行为**：
- Phase 2：点击「IM 频道」打开连接器弹窗（ConnectorPopup），展示 MCP 服务器开关
- Phase 3：切换到独立的 channels 页面

### 12.5 Agent 切换 — 完整交互流程

```
用户点击侧栏 Agent（如「💻 代码专家」）
  │
  ├→ 1. setCurrentAgentId('code-expert')
  ├→ 2. sidebarTab 强制切换到 'tasks'
  ├→ 3. 侧栏列表 refetch: sessions.filter(s => s.agentId === 'code-expert')
  ├→ 4. activeView = 'chat'
  └→ 5. 判断该 Agent 是否有历史会话
       ├→ 有 → activeSessionId = 最近更新的会话 → 加载消息
       └→ 无 → activeSessionId = null → 显示欢迎页
```

**重要约束**：
- Agent 切换只影响**新建会话**的 agentId，不改变已有会话
- 侧栏列表只显示 `agentId === currentAgentId` 的会话
- 选中态：当前 Agent 行高亮 + `◀` 指示符

### 12.6 `+ 新任务` — 创建会话流程

```
用户点击「+ 新任务」
  │
  ├→ 1. activeView = 'chat'
  ├→ 2. activeSessionId = null（进入欢迎页/空聊天态）
  └→ 3. 用户在输入框输入消息并发送
       │
       ├→ chat:send IPC (message, cwd, currentAgentId, skillIds, modelOverride)
       ├→ SessionManager.createAndStart() → 返回 { sessionId }
       ├→ activeSessionId = sessionId
       └→ 侧栏会话列表自动追加新会话（顶部）
```

**注意**：「+ 新任务」不立刻创建 DB 会话，只是清空当前聊天界面。真正的会话在用户发送第一条消息时创建。

### 12.7 欢迎页（空状态）

当 `activeView === 'chat' && activeSessionId === null` 时显示欢迎页：

```
                      🐾

               不止聊天，搞定一切

        本地运行，自主规划，安全可控的 AI 工作搭子

     ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
     │ 📁           │  │ ✍️           │  │ 📊           │
     │ 文件整理      │  │ 内容创作      │  │ 文档处理      │
     │ 智能整理和管  │  │ 创作演义文稿  │  │ 处理和分析文  │
     │ 理本地文件    │  │ 和多种内容    │  │ 档数据内容    │
     └─────────────┘  └─────────────┘  └─────────────┘

     ┌──────────────────────────────────────────────┐
     │ 描述任务，/ 调用技能与工具                      │
     ├──────────────────────────────────────────────┤
     │ [📁 cwd] [🔧] [🔌] [📎]      [⚡ 标准] [↑]   │
     └──────────────────────────────────────────────┘
```

**快捷卡片**：3 张功能引导卡片（`rounded-[14px]`，`shadow-[var(--shadow-card)]`），点击后填充 prompt 到输入框并自动发送：
- **文件整理** — icon: `FolderOpen` — "帮我整理桌面文件，按类型分类到对应文件夹"
- **内容创作** — icon: `PenLine` — "帮我写一篇关于…的文章"
- **文档处理** — icon: `BarChart3` — "帮我分析这份文档的关键信息"

### 12.8 聊天页

当 `activeView === 'chat' && activeSessionId !== null` 时显示聊天页：

**聊天顶栏**（`ChatHeader`）：
```
┌──────────────────────────────────────────────────┐
│  会话标题                      [问题反馈]  [≡]    │
└──────────────────────────────────────────────────┘
```
- 左侧：当前会话标题（可编辑，blur 时保存）
- 右侧：`问题反馈` 链接 + `≡` 右面板 toggle

**消息区域**支持：
- 用户消息（右对齐气泡，`bg-bg-bubble-user`）
- AI 消息（左对齐 + PetClaw 头像，`bg-bg-bubble-ai`，Markdown 渲染）
- 工具调用展示（折叠面板，显示工具名 + 输入/输出摘要）
- 权限审批卡片（允许/拒绝按钮）
- 流式输出：打字机效果 + typing indicator

**消息数据来源**：
```
activeSessionId 变化
  → window.api.cowork.session(id) → 获取会话元数据
  → CoworkStore.getMessages(id) → 获取历史消息
  → window.api.cowork.onMessage → 监听新增消息（流式）
  → window.api.cowork.onMessageUpdate → 监听消息更新（流式追加）
  → window.api.cowork.onComplete → 会话完成
  → window.api.cowork.onError → 错误处理
```

### 12.9 技能页 & 定时任务页

| 页面 | ViewType | 触发 | 内容 | Phase |
|------|----------|------|------|-------|
| 技能管理 | `skills` | 侧栏「技能」 | Skill 列表 + 开关切换 + 描述 | Phase 2 |
| 定时任务 | `cron` | 侧栏「定时任务」 | 定时任务列表 + 创建/编辑/删除 | Phase 3 占位 |

**技能页布局**：
```
┌──────────────────────────────────────┐
│  技能管理                             │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ 🔍 搜索技能...                │    │
│  └──────────────────────────────┘    │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ web-search        [开关 ☑]    │    │
│  │ 搜索互联网获取最新信息         │    │
│  ├──────────────────────────────┤    │
│  │ code-analyzer     [开关 ☑]    │    │
│  │ 分析和优化代码                 │    │
│  ├──────────────────────────────┤    │
│  │ file-manager      [开关 ☐]    │    │
│  │ 管理本地文件和目录             │    │
│  └──────────────────────────────┘    │
└──────────────────────────────────────┘
```

数据来源：`window.api.skills.list()` → 列表渲染，`window.api.skills.setEnabled(id, bool)` → 开关切换

### 12.10 右面板 — 任务监控（TaskMonitor）

参考 LobsterAI `主页3.png` 右侧面板，仅在 `activeView === 'chat'` 时可展开：

```
┌──────────────┐
│  任务监控   ☐ │
│              │
│  待办         │
│  暂无待办     │
│              │
│  产物         │
│  📁 ~/Desktop │
│              │
│  技能与 MCP   │
│  · web-search │
│  · 文件服务器  │
└──────────────┘
```

| 区域 | 数据来源 | 更新时机 |
|------|----------|----------|
| **待办** | 解析当前会话 AI 消息中的 TODO/checkbox | 消息更新时 |
| **产物** | 当前会话的 cwd | 会话加载 / CwdSelector 切换时 |
| **技能与 MCP** | 当前会话启用的 skillIds + 全局 MCP 列表 | 会话加载时 |

**toggle 行为**：
- 聊天顶栏 `≡` 按钮点击 → `taskMonitorOpen = !taskMonitorOpen`
- 收起时主内容区 `flex-1` 占满，展开时右面板 `w-[240px]` 从右侧推入
- 非 chat view 时自动收起
- Phase 2：先做面板骨架 + 产物/技能展示，待办解析放 Phase 3

### 12.11 连接器弹窗（Connector）

参考 LobsterAI `主页3.png` 连接器弹窗，PetClaw 用于 MCP 服务器快捷管理：

```
┌─────────────────────────────────┐
│  连接器  Beta                    │
│  在此快速开关，完整选项在设置中管理 │
│                                 │
│  ☐ 我的浏览器                    │
│  ☐ 提醒事项                      │
│  ☑ 日历                    ×     │
│  ☐ 备忘录                        │
│  ☐ 邮件                          │
│  ☐ 通讯录                        │
│                                 │
│  打开连接器完整设置               │
└─────────────────────────────────┘
```

**数据流**：
```
打开连接器弹窗
  → window.api.mcp.list() → 获取 MCP 服务器列表
  → 每行渲染：服务器名 + enabled toggle
  → toggle 切换 → window.api.mcp.setEnabled(id, bool)
  → McpManager.setEnabled() → emit('change') → ConfigSync.sync()
  → 底部「打开连接器完整设置」→ settingsOpen=true, settingsTab='im'
```

**触发方式**：
- 侧栏导航「IM 频道」点击
- 输入框工具栏「🔌」连接器图标点击

Phase 2：MCP 服务器开关。Phase 3：IM 集成（浏览器/日历/邮件等）。

---

## 13. Settings 页面（全页面）

参考设计稿：`docs/设计/设置页面.png`

### 13.1 设计变更

Settings 从**弹窗 Modal** 改为**独立全页面**，作为 `ViewType = 'settings'` 路由。页面采用**左侧分类菜单 + 右侧内容区**布局，顶部有「← 返回应用」按钮返回主界面。

```
┌──────────────────────────────────────────────────────────────────┐
│  ← 返回应用                                                      │
│                                                                  │
│  通用                        偏好设置                             │
│  ◉ 偏好设置                  语言、主题、字体与面板布局等个性化偏好   │
│  👤 个人资料                                                      │
│  ℹ️ 关于                     ┌──────────────────────────────────┐ │
│                              │  语言                             │ │
│  AI 配置                     │  选择界面语言            中文 ∨    │ │
│  ⚙️ Agent 引擎               ├──────────────────────────────────┤ │
│  🧠 模型                     │  主题亮暗                         │ │
│  🤖 Agent                    │  浅色、深色，或跟随系统   亮色 ∨    │ │
│  📝 记忆                     ├──────────────────────────────────┤ │
│                              │  对话字号                         │ │
│  扩展与集成                   │  调整对话中的文字大小      小 ∨    │ │
│  🔌 连接器                    └──────────────────────────────────┘ │
│  🔧 MCP 服务                                                     │
│                              ┌──────────────────────────────────┐ │
│                              │  任务面板位置                      │ │
│                              │  任务面板在工作区中的展示位置       │ │
│                              │                     固定在右侧 ∨  │ │
│                              └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
       240px                            flex-1
```

### 13.2 页面路由

```typescript
// ViewType 更新
type ViewType = 'chat' | 'skills' | 'cron' | 'settings'
```

**进入方式**：侧栏底部齿轮图标点击 → `activeView = 'settings'`
**返回方式**：点击「← 返回应用」→ `activeView = 上次非 settings 的 view`（通常是 'chat'）

进入 Settings 页面时，主侧栏（Sidebar）**隐藏**，由 Settings 自身的左侧菜单替代。返回时恢复主侧栏。

### 13.3 左侧分类菜单

参考 LobsterAI 设置页面的三段式分类结构：

| 分类 | 菜单项 | 组件 | 内容 |
|------|--------|------|------|
| **通用** | 偏好设置 | `PreferenceSettings` | 语言、主题亮暗、对话字号、任务面板位置 |
| | 个人资料 | `ProfileSettings` | 昵称、头像、职业角色（来自 Onboarding） |
| | 关于 | `AboutSettings` | 版本号、开源协议、反馈链接、更新检查 |
| **AI 配置** | Agent 引擎 | `EngineSettings` | Openclaw 引擎状态、版本、重启按钮、日志查看 |
| | 模型 | `ModelSettings` | Provider 列表（启用/禁用）+ API Key + Base URL + API 格式 + 测试连接 + 可用模型列表 + 自定义 Provider |
| | Agent | `AgentSettings` | Agent 列表 + 创建/编辑/删除（名称、图标、System Prompt、模型、技能绑定） |
| | 记忆 | `MemorySettings` | MEMORY.md 内容查看/编辑 + 搜索 |
| **扩展与集成** | 连接器 | `ConnectorSettings` | MCP/IM 服务快捷开关（同连接器弹窗，但完整版） |
| | MCP 服务 | `McpSettings` | MCP 服务器详细管理（添加/编辑/删除 + 传输协议选择 + 配置编辑） |

### 13.4 右侧内容区 — 卡片分组设计

参考 LobsterAI 设置页面，右侧内容区采用**卡片分组**布局：

**卡片结构**：
- 每个卡片是一组相关设置项，圆角 `rounded-[14px]`，`bg-bg-card border border-border`
- 卡片内多个设置项用分隔线 `border-b border-border` 分隔
- 最后一个设置项无分隔线

**设置项行结构**：
```
┌────────────────────────────────────────┐
│  标题                                  │
│  描述文字（灰色小字）        [控件 ∨]   │
├────────────────────────────────────────┤
│  标题                                  │
│  描述文字                    [控件 ∨]   │
└────────────────────────────────────────┘
```

- 左侧：设置项标题（`text-[14px] font-medium`）+ 描述（`text-[13px] text-text-tertiary`）
- 右侧：控件（下拉选择 / 开关 / 输入框 / 按钮）
- 行高度：自适应内容，内边距 `py-4 px-5`

**页面标题区**：
- 标题：`text-[24px] font-bold`（如「偏好设置」）
- 副标题：`text-[14px] text-text-tertiary`（如「语言、主题、字体与面板布局等个性化偏好」）
- 标题区与第一个卡片间距 `mb-6`

### 13.5 各页面设置项详细

**偏好设置**（PreferenceSettings）：

| 卡片 | 设置项 | 控件类型 | 选项 |
|------|--------|----------|------|
| 外观 | 语言 | 下拉 | 中文 / English |
| | 主题亮暗 | 下拉 | 亮色 / 深色 / 跟随系统 |
| | 对话字号 | 下拉 | 小 / 中 / 大 |
| 布局 | 任务面板位置 | 下拉 | 固定在右侧 / 隐藏 |
| 快捷键 | 打开聊天 | 快捷键录入 | 默认 `Cmd+Shift+P` |
| | 语音输入 | 快捷键录入 | 自定义 |

**模型**（ModelSettings）— 特殊两栏布局：

```
┌──────────────────────────────────────────────────────────┐
│  模型                                              ✕    │
│                                                         │
│  ┌──────────────┐  ┌──────────────────────────────────┐ │
│  │ Provider 列表 │  │  DeepSeek 提供商设置 ✎    [已开启]│ │
│  │              │  │                                  │ │
│  │ 🟢 Zhipu    │  │  API Key                         │ │
│  │ 🔵 MiniMax  │  │  [设定 API Key +          ] [👁]  │ │
│  │ 🟣 Volceng  │  │                                  │ │
│  │ 🟡 Youdao   │  │  API Base URL                    │ │
│  │ 🔴 Qianfan  │  │  [https://api.deepseek.com/v1 ]  │ │
│  │ ⚡ StepFun  │  │                                  │ │
│  │ 🟠 Xiaomi   │  │  API 格式                        │ │
│  │ 🐙 Ollama   │  │  ○ Anthropic 兼容  ● OpenAI 兼容  │ │
│  │              │  │  请选择 API 协议兼容格式           │ │
│  │              │  │                                  │ │
│  │              │  │  ↔ 测试连接                      │ │
│  │              │  │                                  │ │
│  │              │  │  可用模型列表            [+ 添加]  │ │
│  │              │  │  ┌────────────────────────────┐  │ │
│  │              │  │  │ ◉ DeepSeek Reasoner        │  │ │
│  │              │  │  │   deepseek-reasoner         │  │ │
│  │              │  │  └────────────────────────────┘  │ │
│  │ [+ 添加自定义]│  │                                  │ │
│  └──────────────┘  └──────────────────────────────────┘ │
│                                         [取消] [保存]    │
└──────────────────────────────────────────────────────────┘
```

自定义 Provider 额外显示「显示名称」字段：

```
┌──────────────────────────────────────────────────────────┐
│  Custom0 提供商设置                           [未开启]    │
│                                                         │
│  API Key                                                │
│  [输入你的 API Key                              ]       │
│                                                         │
│  显示名称                                                │
│  [输入自定义名称...                             ]       │
│                                                         │
│  API Base URL                                           │
│  [输入 API 基础 URL                             ]       │
│  Anthropic 兼容 (已是默认加为): https://api.xxx...       │
│  OpenAI 兼容 (已是默认加为): https://api.xxx...          │
│                                                         │
│  API 格式                                                │
│  ○ Anthropic 兼容  ○ OpenAI 兼容                         │
│  请选择 API 协议兼容格式                                  │
│                                                         │
│  ↔ 测试连接                                              │
│                                                         │
│  可用模型列表                                   [+ 添加] │
│  （添加一个模型）                                         │
└──────────────────────────────────────────────────────────┘
```

**Provider 列表**：

- 左侧固定宽 `w-[200px]`，每行 = 品牌 Logo + 名称 + 启用状态圆点（绿 = 已启用、灰 = 未启用）
- 选中态：`bg-bg-active rounded-[10px]`
- 底部「+ 添加自定义」按钮，点击新建空白 Custom Provider 并自动选中
- 预设 Provider 列表：PetClaw（内置）、OpenAI、Anthropic、DeepSeek、Zhipu、MiniMax、Volcengine、Youdao、Qianfan、StepFun、Xiaomi、Ollama

**右侧配置面板**（选中 Provider 后显示）：

| 字段 | 控件 | 说明 |
|------|------|------|
| 标题栏 | 文本 + 编辑图标 + 开启/关闭 Toggle | Provider 名称可编辑（仅自定义），Toggle 控制是否启用 |
| API Key | 密码输入框 + 显示/隐藏按钮 | 预设 Provider 显示「设定 API Key +」占位；PetClaw 内置无此项 |
| 显示名称 | 文本输入框 | **仅自定义 Provider**，用于侧栏和选择器中的显示名 |
| API Base URL | 文本输入框 | 预填默认值；自定义 Provider 下方显示各格式的默认地址提示 |
| API 格式 | Radio 两选一 | `Anthropic 兼容` / `OpenAI 兼容`，影响请求协议 |
| 测试连接 | 按钮 + 状态 | `↔ 测试连接`，成功显示 `✅ 连接成功 (120ms)`，失败显示 `❌ 连接失败` + 错误信息 |
| 可用模型列表 | 列表 + 添加按钮 | 显示该 Provider 下可用的模型，每行 = 模型显示名 + 模型 ID（灰字）；右上角「+ 添加模型」 |

**添加模型弹窗**（点击「+ 添加模型」后，居中 Modal）：

```
┌────────────────────────────────────┐
│  添加新模型                    ✕   │
│                                    │
│  模型名称                          │
│  ┌──────────────────────────────┐  │
│  │ GPT-4                        │  │
│  └──────────────────────────────┘  │
│                                    │
│  模型ID                            │
│  ┌──────────────────────────────┐  │
│  │ gpt-4                        │  │
│  └──────────────────────────────┘  │
│                                    │
│  ☑ 支持图像输入                     │
│                                    │
│                    [取消]  [保存]   │
└────────────────────────────────────┘
```

| 字段 | 控件 | 说明 |
|------|------|------|
| 模型名称 | 文本输入框 | 显示名称，如 `GPT-4`、`DeepSeek Reasoner` |
| 模型ID | 文本输入框 | API 调用使用的模型标识，如 `gpt-4`、`deepseek-reasoner` |
| 支持图像输入 | Checkbox | 标记该模型是否支持多模态图像输入 |

UI 规范：
- Modal 背景 `bg-bg-card rounded-[14px] border border-border`，`max-w-[420px]`
- 标题 `text-[18px] font-semibold`，右上角 `✕` 关闭按钮
- 输入框 `rounded-[10px] bg-bg-input border-none px-4 py-3 text-[14px]`
- Checkbox 使用 `accent-primary rounded-[4px]`，label `text-[14px] text-text-secondary`
- 按钮区右对齐：「取消」ghost 按钮 + 「保存」primary 按钮，间距 `gap-3`
- 交互：`active:scale-[0.96] duration-[120ms]`

**操作按钮**：底部右对齐「取消」（ghost）+「保存」（primary），保存触发 `window.api.models.updateProvider(providerId, config)` → ModelRegistry.update() → ConfigSync.sync()。

### 13.6 UI 规范

遵循 PetClaw 设计系统 + 参考 LobsterAI 设置页风格：

- **返回按钮**：`← 返回应用`，`text-[14px] text-text-secondary hover:text-text-primary`
- **左侧菜单**：`w-[240px]` 固定，分类标题 `text-[12px] text-text-tertiary font-medium uppercase tracking-wider`
- **菜单项**：`rounded-[10px]` 选中态 `bg-bg-active font-medium`，未选 `hover:bg-bg-hover`
- **卡片**：`rounded-[14px] bg-bg-card border border-border`，内边距 `p-0`（由行自身管理 padding）
- **分隔线**：`mx-5 border-b border-border`（卡片内行之间）
- **下拉控件**：`rounded-[10px] border border-border px-3 py-1.5 text-[13px]`，右侧 chevron 图标
- **交互**：`active:scale-[0.96] duration-[120ms]`

### 13.7 数据流

```
Settings 页面加载
  ├→ 偏好设置：window.api.getSetting('theme') / 'language' / 'fontSize' / ...
  ├→ 模型：window.api.models.providers() → 渲染 Provider 列表
  ├→ Agent：window.api.agents.list() → 渲染 Agent 列表
  ├→ 记忆：window.api.memory.read(workspace) → 渲染 MEMORY.md
  ├→ MCP：window.api.mcp.list() → 渲染 MCP 服务器列表
  └→ 引擎：window.api.engine.onStatus() → 实时引擎状态

设置项变更
  → window.api.setSetting(key, value) → kvSet(db, key, value)
  → 需要同步 openclaw.json 的变更（模型/Agent/MCP）
    → Manager.update() → emit('change') → ConfigSync.sync()

模型设置 — 详细数据流
  加载
    → window.api.models.providers() → ModelRegistry.getProviders()
    → 返回 Provider[] 含 { id, name, logo, enabled, apiFormat, models[] }
  选中 Provider
    → window.api.models.provider(id) → ModelRegistry.getProvider(id)
    → 返回完整配置（API Key 返回 masked 值 sk-****xxx）
  保存 Provider
    → window.api.models.updateProvider(id, config) → ModelRegistry.updateProvider()
    → API Key 通过 kvSet(db, `apikey:${providerId}`, encrypted) 安全存储
    → ConfigSync.sync() 写入 openclaw.json（Key 用 ${PETCLAW_APIKEY_xxx} 占位符）
  启用/禁用 Provider
    → window.api.models.toggleProvider(id, enabled) → ModelRegistry.toggleProvider()
    → ConfigSync.sync()
  添加自定义 Provider
    → window.api.models.addCustomProvider(config) → ModelRegistry.addCustomProvider()
    → 返回新 providerId
  删除自定义 Provider
    → window.api.models.deleteProvider(id) → ModelRegistry.deleteProvider()
    → 仅自定义可删除，预设不可删
  测试连接
    → window.api.models.testConnection(id) → ModelRegistry.testConnection()
    → 使用该 Provider 的 API Key + Base URL 发一个轻量请求
    → 返回 { success: boolean, latencyMs: number, error?: string }
  添加/删除模型
    → window.api.models.addModel(providerId, model) / removeModel(providerId, modelId)
    → ModelRegistry.addModel() / removeModel() → ConfigSync.sync()
```

---

## 14. ChatInputBox 重构

### 14.1 现有状态

ChatView 中的输入区域是简单的 textarea + Send 按钮，无工具栏。

### 14.2 新设计

参考 LobsterAI `CoworkPromptInput.tsx`（`主页.png` 底部），输入框 + 工具栏一体化设计。输入区在上，工具栏在下，整体为圆角卡片：

未选 Skills 时：
```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  描述任务，/ 调用技能与工具，标准模式经济高效            │
│                                                      │
├──────────────────────────────────────────────────────┤
│ [📁 Downloads] [🛠] [🔌] [📎]         [⚡ 标准] [↑]  │
└──────────────────────────────────────────────────────┘
```

已选 Skills 时（输入框与工具栏之间插入 chip 标签条）：
```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  描述任务，/ 调用技能与工具                             │
│                                                      │
│  [翻译助手 ×] [代码审查 ×] [+2]                       │
├──────────────────────────────────────────────────────┤
│ [📁 Downloads] [🛠³] [🔌] [📎]        [⚡ 标准] [↑]  │
└──────────────────────────────────────────────────────┘
```

**工具栏布局**：左右两端分布（`justify-between`）
- **左侧**（按使用频率排序）：工作目录选择 → Skills 选择 → 连接器（MCP）→ 附件添加
- **右侧**：模型选择器（下拉）、发送按钮
- 排序逻辑：环境上下文（cwd）→ 能力增强（skills）→ 外部集成（MCP）→ 输入增强（附件），认知负荷从左到右递增

**输入框行为**：
- 自动高度（`min-h-[24px]` → `max-h-[120px]`）
- 支持 `/` 斜杠命令触发 Skills 选择
- `Enter` 发送，`Shift+Enter` 换行
- placeholder 随当前模型模式变化：「描述任务，/ 调用技能与工具，标准模式经济高效」

### 14.3 子组件

| 组件 | 位置 | 功能 |
|------|------|------|
| `CwdSelector` | 工具栏左侧 | 工作目录选择器（Popover：最近目录列表 + `📁 添加文件夹` 按钮，选择系统目录） |
| `SkillSelector` | 工具栏左侧 | Skills 多选（Popover + checkbox），选中后工具栏图标显示 badge 数字，输入框下方显示 chip 标签条 |
| `ConnectorButton` | 工具栏左侧 | 连接器快捷入口（打开连接器弹窗，见 §12.6） |
| `AttachmentButton` | 工具栏左侧 | 附件添加按钮（拖放或点击选择文件，支持图片/文档） |
| `ModelSelector` | 工具栏右侧 | 模型选择下拉（⚡标准 / 🧠推理 + 具体模型列表） |
| `SendButton` | 工具栏右侧 | 发送按钮（圆形，`ArrowUp` 图标，`bg-accent`） |

### 14.4 CwdSelector 细节

参考 LobsterAI `主页3.png` 底部工具栏的「Downloads」工作目录展示：

```
┌──────────────────────┐
│  最近工作目录          │
│  📁 ~/Desktop         │
│  📁 ~/Downloads       │  ← 当前选中，高亮
│  📁 ~/projects/xxx    │
│  ─────────────────── │
│  📁 添加文件夹...      │  ← 打开系统目录选择器
└──────────────────────┘
```

- 工具栏展示：`[📁 目录名]`（只显示最后一级目录名，如 `Downloads`）
- 最近目录来源：`CoworkStore.getRecentWorkingDirs()`
- 新会话默认 cwd：用户 home 目录

### 14.5 SkillSelector 细节

**工具栏按钮状态**：

- 未选中：纯图标 `🛠`，`text-text-tertiary`
- 已选中：图标 + 右上角 badge 数字 `🛠³`，badge 为 `bg-accent text-white text-[10px] min-w-[16px] h-[16px] rounded-full`

**Popover 选择面板**（点击图标弹出）：

```
┌──────────────────────────┐
│  选择技能                 │
│                          │
│  ☑ 翻译助手              │
│  ☑ 代码审查              │
│  ☐ 文档生成              │
│  ☑ 数据分析              │
│  ☐ 图片理解              │
│                          │
│  已选 3 个                │
└──────────────────────────┘
```

- 列表来源：`window.api.skills.list()` 返回已启用的 skills
- 每行 = checkbox + skill 名称，点击切换选中
- 底部显示已选数量统计
- Popover 宽度 `w-[240px]`，最大高度 `max-h-[280px]` 超出滚动

**Chip 标签条**（输入框与工具栏之间）：

- 选中 ≥1 个 skill 时出现，`px-3 py-1.5` 内边距
- 每个 chip：`rounded-[8px] bg-bg-hover text-[12px] text-text-secondary px-2 py-0.5`，右侧 `×` 移除按钮
- 最多显示 3 个 chip，超出显示 `+N` 折叠标签（点击展开全部或打开 Popover）
- chip 移除时同步更新 Popover 中的 checkbox 状态
- 无选中时标签条隐藏，不占空间（`animate-collapse` 过渡 150ms）

### 14.6 模型选择器（ModelSelector）

工具栏右侧的模型选择器是快捷入口：

```
┌────────────────┐
│ ⚡ 标准（推荐） │ ← 默认，经济高效
│ 🧠 推理        │ ← 复杂任务
├────────────────┤
│ 切换模型 →      │ ← 展开具体模型列表
└────────────────┘
```

- 「标准」和「推理」是模式快捷切换，映射到 ModelRegistry 中配置的默认标准/推理模型
- 「切换模型」展开完整模型列表（按 Provider 分组），选择后覆盖当前会话模型
- 工具栏展示：`[⚡ 标准]` 或 `[🧠 推理]`，紧凑文字 + 图标

### 14.7 数据流

```
用户输入消息 + 选择 cwd/skills/model
  → chat:send IPC (message, cwd, agentId, skillIds, modelOverride)
  → SessionManager.createAndStart(title, cwd, prompt, { agentId, skillIds, modelOverride })
  → CoworkController → Gateway
```

- `agentId` 来自侧栏当前选中的 Agent（自动注入，不在输入框中选择）
- `cwd` 来自 CwdSelector 选中的工作目录
- `skillIds` 来自 SkillSelector 选中的技能列表
- `modelOverride` 来自 ModelSelector 选中的模型（空则使用 Agent 默认模型）

---

## 15. 启动流程变更

### 15.1 index.ts 调整

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

## 16. 文件结构

### 16.1 新建文件

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
| `src/renderer/src/chat/components/settings/SettingsPage.tsx` | Settings 全页面容器（左菜单 + 右内容） |
| `src/renderer/src/chat/components/settings/PreferenceSettings.tsx` | 偏好设置（语言/主题/字号/布局） |
| `src/renderer/src/chat/components/settings/ProfileSettings.tsx` | 个人资料设置 |
| `src/renderer/src/chat/components/settings/EngineSettings.tsx` | Agent 引擎设置 |
| `src/renderer/src/chat/components/settings/ModelSettings.tsx` | 模型配置 |
| `src/renderer/src/chat/components/settings/ImSettings.tsx` | 连接器设置（MCP/IM 完整管理） |
| `src/renderer/src/chat/components/settings/MemorySettings.tsx` | 记忆管理 |
| `src/renderer/src/chat/components/settings/AgentSettings.tsx` | Agent 管理 |
| `src/renderer/src/chat/components/settings/AboutSettings.tsx` | 关于页面 |
| `src/renderer/src/chat/components/settings/McpSettings.tsx` | MCP 服务详细管理 |
| `src/renderer/src/chat/components/ChatInputBox.tsx` | 增强输入框 |
| `src/renderer/src/chat/components/CwdSelector.tsx` | 工作目录选择器 |
| `src/renderer/src/chat/components/SkillSelector.tsx` | Skill 选择器 |
| `src/renderer/src/chat/components/McpPanel.tsx` | MCP 服务器管理面板 |
| `src/renderer/src/chat/components/ModelSelector.tsx` | 模型快捷选择器（输入框工具栏） |
| `src/renderer/src/chat/components/WelcomePage.tsx` | 欢迎页（空状态 + 功能引导卡片） |
| `src/renderer/src/chat/components/ConnectorPopup.tsx` | 连接器弹窗（MCP 快捷开关） |
| `src/renderer/src/chat/components/TaskMonitorPanel.tsx` | 右侧任务监控面板 |
| `src/renderer/src/chat/components/ChatHeader.tsx` | 聊天顶栏（会话标题 + 功能按钮） |
| `src/renderer/src/chat/components/SkillsPage.tsx` | 技能管理页面（Skill 列表 + 搜索 + 开关） |
| `src/renderer/src/chat/components/CronPage.tsx` | 定时任务页面（Phase 3 占位） |

### 16.2 修改文件

| 文件 | 变更 |
|------|------|
| `src/main/data/db.ts` | `initDatabase()` 新增 agents、mcp_servers 建表 |
| `src/main/ai/config-sync.ts` | 重构：deps 注入 → 直接依赖 Manager |
| `src/main/ai/session-manager.ts` | 支持 agentId、sessionKey 格式 |
| `src/main/index.ts` | 启动流程新增 Manager 初始化 |
| `src/main/ipc/index.ts` | 注册新 IPC handlers |
| `src/preload/index.ts` | 新增 agents/models/skills/mcp/memory channels |
| `src/preload/index.d.ts` | 类型定义同步 |
| `src/renderer/src/chat/components/SettingsView.tsx` | 删除，被 settings/SettingsPage.tsx 替代 |
| `src/renderer/src/chat/components/Sidebar.tsx` | 重构：Agent 列表 + 导航联动 + Tab 切换 + 会话过滤 + settings 时隐藏 |
| `src/renderer/src/chat/ChatApp.tsx` | ViewType 升级（含 settings）, 新增状态模型, settings 时隐藏主侧栏 |
| `src/renderer/src/chat/components/ChatView.tsx` | 集成 ChatInputBox |

---

## 17. 验证标准

### 17.1 后端验证

- `npx tsc --noEmit` 类型检查通过
- AgentManager: CRUD → DB 持久化 → ConfigSync 同步，预设 Agent 首次自动创建
- ModelRegistry: 多 Provider 配置，API Key 不出现在 openclaw.json（只有 `${VAR}` 占位符）
- SkillManager: 扫描返回 Skill 列表，启用/禁用触发 ConfigSync
- McpManager: CRUD → DB 持久化 → ConfigSync 同步
- MemoryManager: 读写 MEMORY.md 正常
- ConfigSync: 聚合 5 个 Manager → openclaw.json 生成正确
- IPC channel 三处同步（ipc/*.ts + preload/index.ts + preload/index.d.ts）
- Manager change 事件 → ConfigSync.sync() 自动触发

### 17.2 前端验证

- **三栏布局**：侧栏（220px）+ 主内容区（flex-1）+ 右面板（240px 可收起）正确渲染
- **ViewType 路由**：`chat` / `skills` / `cron` / `settings` 四个视图正确切换
- **侧栏导航联动**：点击「技能」→ 主内容区切换到 SkillsPage，点击「定时任务」→ CronPage
- **Agent 切换完整流程**：点击 Agent → 会话列表过滤 → `sidebarTab='tasks'` → 主区域显示该 Agent 最近会话或欢迎页
- **`+ 新任务`**：点击 → 清空当前会话（欢迎页）→ 用户发送消息 → 创建会话 → 自动切入聊天页
- **任务│频道 Tab**：切换只改变侧栏列表内容，不改变主内容区
- **会话列表**：按 `agentId` 过滤 + 按 `updatedAt` 倒序 + 点击切换聊天
- **欢迎页**：mascot + 标语 + 3 张功能引导卡片 + ChatInputBox
- **聊天顶栏**：会话标题（可编辑）+ 问题反馈链接 + 右面板 toggle
- **右面板（任务监控）**：toggle 展开/收起，显示产物/技能与MCP
- **连接器弹窗**：MCP 服务器快捷开关列表 + 底部跳转完整设置
- **技能页**：Skill 列表 + 搜索 + 开关切换
- **Settings 全页面**：「← 返回应用」+ 三段式分类菜单（通用/AI配置/扩展与集成）+ 卡片分组设置项
- **Settings 进入/返回**：齿轮 → 进入 settings（隐藏主侧栏）→ ← 返回应用（恢复主侧栏）
- **Settings 模型**：左侧 Provider 列表 + 右侧配置面板（API Key + Base URL + 测试连接）
- **Settings Agent**：Agent 列表 + 创建/编辑/删除
- **Settings 记忆**：MEMORY.md 查看/编辑/搜索
- **Settings MCP**：MCP 服务器详细管理（添加/编辑/删除 + 传输协议 + 配置）
- **ChatInputBox 工具栏**：左侧（cwd + skills + 连接器 + 附件）右侧（模型选择 + 发送）
- **ModelSelector**：标准/推理快捷切换 + 展开完整模型列表
- **CwdSelector**：最近目录列表 + 添加文件夹
- **消息数据流**：`cowork.onMessage` → 消息追加，`cowork.onMessageUpdate` → 流式更新，`cowork.onComplete` → 完成态
- 所有 UI 组件遵循 PetClaw 设计系统（Tailwind token、圆角、动效）
