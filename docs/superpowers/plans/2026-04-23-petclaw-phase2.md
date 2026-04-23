# PetClaw v3 Phase 2 — 核心功能层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 1 基础架构（EngineManager / Gateway / CoworkController）之上，构建核心功能层：5 个后端 Manager + ConfigSync 重构 + SessionManager 升级 + IPC 扩展 + 完整前端改造（Settings 全页面、ChatInputBox 增强、Sidebar 重构、欢迎页、三栏布局）。

**Architecture:** 后端新增 AgentManager / ModelRegistry / SkillManager / McpManager / MemoryManager 五个自治模块，各自管理 CRUD 并通过 `toOpenclawConfig()` 序列化。ConfigSync 从 deps 注入重构为直接依赖 Manager，Manager change 事件自动触发 sync。前端从三 Tab 简单布局升级为三栏布局（Sidebar 220px + Main flex-1 + TaskMonitor 240px 可收起），ViewType 升级为 `chat | skills | cron | settings`，Settings 作为独立全页面替代弹窗。

**Tech Stack:** Electron 33 · better-sqlite3 · Zustand · TypeScript strict · Vitest · Tailwind CSS (token-driven) · lucide-react

**参考实现:** LobsterAI `/Users/xiaoxuxuy/Desktop/工作/AI/开源项目/LobsterAI`（参考模式但不照抄）

**v3 Spec:** `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md`
**Phase 2 Spec:** `docs/superpowers/specs/2026-04-23-petclaw-phase2-design.md`

---

## File Structure

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/main/agents/agent-manager.ts` | Agent CRUD + 预设 Agent + toOpenclawConfig |
| `src/main/agents/preset-agents.ts` | 4 个预设 Agent 数据定义 |
| `src/main/models/model-registry.ts` | 模型 Provider 管理 + API Key 安全存储 + toOpenclawConfig |
| `src/main/models/preset-providers.ts` | 16 个预设 Provider 数据定义 |
| `src/main/skills/skill-manager.ts` | Skill 扫描 + 启用/禁用 + toOpenclawConfig |
| `src/main/mcp/mcp-manager.ts` | MCP 服务器 CRUD + toOpenclawConfig |
| `src/main/memory/memory-manager.ts` | MEMORY.md 文件读写 |
| `src/main/ipc/agents-ipc.ts` | Agent IPC handlers |
| `src/main/ipc/models-ipc.ts` | Model Provider IPC handlers |
| `src/main/ipc/skills-ipc.ts` | Skill IPC handlers |
| `src/main/ipc/mcp-ipc.ts` | MCP IPC handlers |
| `src/main/ipc/memory-ipc.ts` | Memory IPC handlers |
| `src/renderer/src/chat/components/settings/SettingsPage.tsx` | Settings 全页面容器 |
| `src/renderer/src/chat/components/settings/PreferenceSettings.tsx` | 偏好设置 |
| `src/renderer/src/chat/components/settings/ProfileSettings.tsx` | 个人资料 |
| `src/renderer/src/chat/components/settings/EngineSettings.tsx` | Agent 引擎设置 |
| `src/renderer/src/chat/components/settings/ModelSettings.tsx` | 模型配置（两栏布局） |
| `src/renderer/src/chat/components/settings/AgentSettings.tsx` | Agent 管理 |
| `src/renderer/src/chat/components/settings/MemorySettings.tsx` | 记忆管理 |
| `src/renderer/src/chat/components/settings/ConnectorSettings.tsx` | 连接器设置 |
| `src/renderer/src/chat/components/settings/McpSettings.tsx` | MCP 服务详细管理 |
| `src/renderer/src/chat/components/settings/AboutSettings.tsx` | 关于页面 |
| `src/renderer/src/chat/components/ChatInputBox.tsx` | 增强输入框 + 工具栏 |
| `src/renderer/src/chat/components/CwdSelector.tsx` | 工作目录选择器 |
| `src/renderer/src/chat/components/SkillSelector.tsx` | Skill 多选器 |
| `src/renderer/src/chat/components/ModelSelector.tsx` | 模型快捷选择器 |
| `src/renderer/src/chat/components/ConnectorPopup.tsx` | 连接器弹窗 |
| `src/renderer/src/chat/components/WelcomePage.tsx` | 欢迎页 |
| `src/renderer/src/chat/components/ChatHeader.tsx` | 聊天顶栏 |
| `src/renderer/src/chat/components/TaskMonitorPanel.tsx` | 右侧任务监控面板 |
| `src/renderer/src/chat/components/SkillsPage.tsx` | 技能管理页面 |
| `src/renderer/src/chat/components/CronPage.tsx` | 定时任务占位页 |
| `tests/main/agents/agent-manager.test.ts` | AgentManager 单元测试 |
| `tests/main/models/model-registry.test.ts` | ModelRegistry 单元测试 |
| `tests/main/skills/skill-manager.test.ts` | SkillManager 单元测试 |
| `tests/main/mcp/mcp-manager.test.ts` | McpManager 单元测试 |
| `tests/main/memory/memory-manager.test.ts` | MemoryManager 单元测试 |
| `tests/main/ai/config-sync-v2.test.ts` | ConfigSync 重构后测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/main/data/db.ts` | `initDatabase()` 新增 agents、mcp_servers 建表 |
| `src/main/ai/config-sync.ts` | 重构：deps 注入 → 直接依赖 Manager |
| `src/main/ai/session-manager.ts` | 支持 agentId 参数、sessionKey 格式 |
| `src/main/ai/types.ts` | 新增 Agent/Model/Skill/Mcp 相关类型 |
| `src/main/index.ts` | 启动流程新增 Manager 初始化 + IPC 注册 |
| `src/main/ipc/index.ts` | 注册 5 个新 IPC handler 模块 |
| `src/main/ipc/chat-ipc.ts` | chat:send 支持 agentId/skillIds/modelOverride |
| `src/preload/index.ts` | 新增 agents/models/skills/mcp/memory channels |
| `src/preload/index.d.ts` | 类型定义同步 |
| `src/renderer/src/chat/ChatApp.tsx` | ViewType 升级 + 三栏布局 + 状态模型重写 |
| `src/renderer/src/chat/components/Sidebar.tsx` | Agent 列表 + 导航联动 + Tab 切换 + 会话过滤 |
| `src/renderer/src/chat/components/ChatView.tsx` | 集成 ChatInputBox + ChatHeader + 消息流数据源 |

---

## Task 1: DB Schema 扩展 — agents 表 + mcp_servers 表

**Files:**
- Modify: `src/main/data/db.ts`
- Test: `tests/main/data/db.test.ts`

- [ ] **Step 1: 写 agents 表测试**

在 `tests/main/data/db.test.ts` 追加：

```typescript
describe('agents table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should create an agent with defaults', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO agents (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
    ).run('main', '默认助手', now, now)
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get('main') as Record<string, unknown>
    expect(row.name).toBe('默认助手')
    expect(row.enabled).toBe(1)
    expect(row.is_default).toBe(0)
    expect(row.source).toBe('custom')
    expect(row.skill_ids).toBe('[]')
  })

  it('should enforce primary key uniqueness', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO agents (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
    ).run('a1', 'Agent', now, now)
    expect(() => {
      db.prepare(
        `INSERT INTO agents (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
      ).run('a1', 'Dup', now, now)
    }).toThrow()
  })
})

describe('mcp_servers table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should create an mcp server', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO mcp_servers (id, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('m1', 'test-server', '{"command":"npx"}', now, now)
    const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get('m1') as Record<string, unknown>
    expect(row.name).toBe('test-server')
    expect(row.transport_type).toBe('stdio')
    expect(row.enabled).toBe(1)
  })

  it('should enforce unique name', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO mcp_servers (id, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('m1', 'srv', '{}', now, now)
    expect(() => {
      db.prepare(
        `INSERT INTO mcp_servers (id, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      ).run('m2', 'srv', '{}', now, now)
    }).toThrow()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/data/db.test.ts`
Expected: 新测试失败（agents/mcp_servers 表不存在）

- [ ] **Step 3: 在 db.ts 的 initDatabase() 中追加建表语句**

在现有 `cowork_messages` 索引之后追加：

```typescript
// Agent 配置
db.exec(`
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
  )
`)

// MCP 服务器
db.exec(`
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    transport_type TEXT NOT NULL DEFAULT 'stdio',
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/data/db.test.ts`

- [ ] **Step 5: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 6: 提交**

```bash
git add src/main/data/db.ts tests/main/data/db.test.ts
git commit -m "feat(db): add agents and mcp_servers tables for Phase 2"
```

---

## Task 2: 共享类型扩展

**Files:**
- Modify: `src/main/ai/types.ts`

- [ ] **Step 1: 在 types.ts 末尾追加 Phase 2 类型**

```typescript
// ── Phase 2: Agent ──

export interface Agent {
  id: string
  name: string
  description: string
  systemPrompt: string
  identity: string
  model: string
  icon: string
  skillIds: string[]
  enabled: boolean
  isDefault: boolean
  source: 'preset' | 'custom'
  presetId: string
  createdAt: number
  updatedAt: number
}

// ── Phase 2: Model ──

export interface ModelProvider {
  id: string
  name: string
  logo: string
  baseUrl: string
  apiKey: string
  apiFormat: 'openai-completions' | 'anthropic'
  enabled: boolean
  isPreset: boolean
  isCustom: boolean
  models: ModelDefinition[]
}

export interface ModelDefinition {
  id: string
  name: string
  reasoning: boolean
  supportsImage: boolean
  contextWindow: number
  maxTokens: number
}

// ── Phase 2: Skill ──

export interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
  isBuiltIn: boolean
  skillPath: string
  version?: string
}

// ── Phase 2: MCP ──

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

// ── Phase 2: Memory ──

export interface MemoryEntry {
  text: string
  line: number
}
```

- [ ] **Step 2: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add src/main/ai/types.ts
git commit -m "feat(types): add Phase 2 shared types (Agent, Model, Skill, Mcp, Memory)"
```

---

## Task 3: AgentManager — Agent CRUD + 预设

**Files:**
- Create: `src/main/agents/preset-agents.ts`
- Create: `src/main/agents/agent-manager.ts`
- Test: `tests/main/agents/agent-manager.test.ts`

- [ ] **Step 1: 创建 preset-agents.ts**

```typescript
// src/main/agents/preset-agents.ts

import type { Agent } from '../ai/types'

type PresetAgent = Omit<Agent, 'createdAt' | 'updatedAt'>

export const PRESET_AGENTS: PresetAgent[] = [
  {
    id: 'main',
    name: '默认助手',
    description: '通用 AI 助手，不可删除',
    systemPrompt: '',
    identity: '',
    model: '',
    icon: '🐾',
    skillIds: [],
    enabled: true,
    isDefault: true,
    source: 'preset',
    presetId: 'main',
  },
  {
    id: 'code-expert',
    name: '代码专家',
    description: '编程辅助，代码审查与优化',
    systemPrompt: '你是一位资深编程专家，擅长代码审查、重构和调试。',
    identity: '',
    model: '',
    icon: '💻',
    skillIds: [],
    enabled: true,
    isDefault: false,
    source: 'preset',
    presetId: 'code-expert',
  },
  {
    id: 'content-creator',
    name: '内容创作',
    description: '文案写作、文章创作、内容策划',
    systemPrompt: '你是一位创意写作专家，擅长撰写各类文案和文章。',
    identity: '',
    model: '',
    icon: '✍️',
    skillIds: [],
    enabled: true,
    isDefault: false,
    source: 'preset',
    presetId: 'content-creator',
  },
  {
    id: 'pet-care',
    name: '萌宠管家',
    description: '宠物健康、行为咨询、养护建议',
    systemPrompt: '你是一位经验丰富的宠物专家，了解各类宠物的健康和行为知识。',
    identity: '',
    model: '',
    icon: '🐱',
    skillIds: [],
    enabled: true,
    isDefault: false,
    source: 'preset',
    presetId: 'pet-care',
  },
]
```

- [ ] **Step 2: 写 AgentManager 测试**

```typescript
// tests/main/agents/agent-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase } from '../../src/main/data/db'
import { AgentManager } from '../../src/main/agents/agent-manager'

describe('AgentManager', () => {
  let db: Database.Database
  let manager: AgentManager

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    manager = new AgentManager(db, '/tmp/workspace')
  })

  afterEach(() => {
    db.close()
  })

  it('should install preset agents on first call', () => {
    manager.ensurePresetAgents()
    const agents = manager.list()
    expect(agents.length).toBe(4)
    expect(agents.find(a => a.id === 'main')?.isDefault).toBe(true)
  })

  it('should not duplicate presets on second call', () => {
    manager.ensurePresetAgents()
    manager.ensurePresetAgents()
    expect(manager.list().length).toBe(4)
  })

  it('should create a custom agent', () => {
    const agent = manager.create({
      name: 'Test Agent',
      description: 'desc',
      systemPrompt: 'prompt',
      identity: '',
      model: 'llm/openai/gpt-4o',
      icon: '🤖',
      skillIds: ['web-search'],
      enabled: true,
      isDefault: false,
      source: 'custom',
      presetId: '',
    })
    expect(agent.id).toBeTruthy()
    expect(manager.get(agent.id)?.name).toBe('Test Agent')
  })

  it('should update an agent', () => {
    manager.ensurePresetAgents()
    manager.update('code-expert', { name: '高级代码专家' })
    expect(manager.get('code-expert')?.name).toBe('高级代码专家')
  })

  it('should not delete the main agent', () => {
    manager.ensurePresetAgents()
    expect(() => manager.delete('main')).toThrow()
  })

  it('should delete a custom agent', () => {
    const agent = manager.create({
      name: 'Temp',
      description: '',
      systemPrompt: '',
      identity: '',
      model: '',
      icon: '',
      skillIds: [],
      enabled: true,
      isDefault: false,
      source: 'custom',
      presetId: '',
    })
    manager.delete(agent.id)
    expect(manager.get(agent.id)).toBeUndefined()
  })

  it('should emit change event on create', () => {
    let fired = false
    manager.on('change', () => { fired = true })
    manager.create({
      name: 'X',
      description: '',
      systemPrompt: '',
      identity: '',
      model: '',
      icon: '',
      skillIds: [],
      enabled: true,
      isDefault: false,
      source: 'custom',
      presetId: '',
    })
    expect(fired).toBe(true)
  })

  it('should generate toOpenclawConfig', () => {
    manager.ensurePresetAgents()
    const config = manager.toOpenclawConfig()
    expect(config.defaults.timeoutSeconds).toBe(3600)
    expect(config.defaults.workspace).toBe('/tmp/workspace')
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/agents/agent-manager.test.ts`

- [ ] **Step 4: 实现 AgentManager**

```typescript
// src/main/agents/agent-manager.ts
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import type Database from 'better-sqlite3'

import type { Agent } from '../ai/types'
import { PRESET_AGENTS } from './preset-agents'

export class AgentManager extends EventEmitter {
  constructor(
    private db: Database.Database,
    private workspacePath: string
  ) {
    super()
  }

  ensurePresetAgents(): void {
    const existing = this.list()
    const existingIds = new Set(existing.map(a => a.id))
    const now = Date.now()

    for (const preset of PRESET_AGENTS) {
      if (!existingIds.has(preset.id)) {
        this.db.prepare(`
          INSERT INTO agents (id, name, description, system_prompt, identity, model, icon, skill_ids, enabled, is_default, source, preset_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          preset.id, preset.name, preset.description, preset.systemPrompt,
          preset.identity, preset.model, preset.icon, JSON.stringify(preset.skillIds),
          preset.enabled ? 1 : 0, preset.isDefault ? 1 : 0, preset.source, preset.presetId,
          now, now
        )
      }
    }
  }

  create(data: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Agent {
    const id = uuidv4()
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO agents (id, name, description, system_prompt, identity, model, icon, skill_ids, enabled, is_default, source, preset_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.name, data.description, data.systemPrompt,
      data.identity, data.model, data.icon, JSON.stringify(data.skillIds),
      data.enabled ? 1 : 0, data.isDefault ? 1 : 0, data.source, data.presetId,
      now, now
    )
    this.emit('change')
    return this.get(id)!
  }

  update(id: string, patch: Partial<Agent>): Agent {
    const existing = this.get(id)
    if (!existing) throw new Error(`Agent not found: ${id}`)

    const fields: string[] = []
    const values: unknown[] = []

    for (const [key, value] of Object.entries(patch)) {
      // 将 camelCase 转为 snake_case
      const col = key.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`)
      if (col === 'id' || col === 'created_at') continue
      if (key === 'skillIds') {
        fields.push('skill_ids = ?')
        values.push(JSON.stringify(value))
      } else if (typeof value === 'boolean') {
        fields.push(`${col} = ?`)
        values.push(value ? 1 : 0)
      } else {
        fields.push(`${col} = ?`)
        values.push(value)
      }
    }

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    this.db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    this.emit('change')
    return this.get(id)!
  }

  delete(id: string): void {
    const agent = this.get(id)
    if (!agent) return
    if (agent.isDefault) throw new Error('Cannot delete the default agent')
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id)
    this.emit('change')
  }

  list(): Agent[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY created_at ASC').all() as Array<Record<string, unknown>>
    return rows.map(r => this.rowToAgent(r))
  }

  get(id: string): Agent | undefined {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.rowToAgent(row) : undefined
  }

  toOpenclawConfig(): { defaults: { timeoutSeconds: number; model: { primary: string }; workspace: string } } {
    const mainAgent = this.list().find(a => a.isDefault)
    return {
      defaults: {
        timeoutSeconds: 3600,
        model: { primary: mainAgent?.model || 'llm/petclaw-fast' },
        workspace: this.workspacePath,
      },
    }
  }

  private rowToAgent(row: Record<string, unknown>): Agent {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      systemPrompt: row.system_prompt as string,
      identity: row.identity as string,
      model: row.model as string,
      icon: row.icon as string,
      skillIds: JSON.parse(row.skill_ids as string),
      enabled: row.enabled === 1,
      isDefault: row.is_default === 1,
      source: row.source as 'preset' | 'custom',
      presetId: row.preset_id as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    }
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/agents/agent-manager.test.ts`

- [ ] **Step 6: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 7: 提交**

```bash
git add src/main/agents/ tests/main/agents/
git commit -m "feat(agents): add AgentManager with CRUD and preset agents"
```

---

## Task 4: ModelRegistry — Provider 管理 + API Key 安全

**Files:**
- Create: `src/main/models/preset-providers.ts`
- Create: `src/main/models/model-registry.ts`
- Test: `tests/main/models/model-registry.test.ts`

- [ ] **Step 1: 创建 preset-providers.ts**

```typescript
// src/main/models/preset-providers.ts
import type { ModelProvider } from '../ai/types'

type PresetProvider = Omit<ModelProvider, 'apiKey' | 'enabled' | 'isCustom'>

export const PRESET_PROVIDERS: PresetProvider[] = [
  {
    id: 'petclaw',
    name: 'PetClaw',
    logo: 'petclaw',
    baseUrl: 'https://petclaw.ai/api/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      { id: 'petclaw-fast', name: 'PetClaw Fast', reasoning: false, supportsImage: true, contextWindow: 128000, maxTokens: 4096 },
      { id: 'petclaw-pro', name: 'PetClaw Pro', reasoning: true, supportsImage: true, contextWindow: 200000, maxTokens: 8192 },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    logo: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', reasoning: false, supportsImage: true, contextWindow: 128000, maxTokens: 16384 },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', reasoning: false, supportsImage: true, contextWindow: 128000, maxTokens: 16384 },
      { id: 'o3-mini', name: 'o3-mini', reasoning: true, supportsImage: false, contextWindow: 200000, maxTokens: 100000 },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    logo: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiFormat: 'anthropic',
    isPreset: true,
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', reasoning: false, supportsImage: true, contextWindow: 200000, maxTokens: 8192 },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', reasoning: true, supportsImage: true, contextWindow: 200000, maxTokens: 8192 },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    logo: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: false, supportsImage: false, contextWindow: 64000, maxTokens: 8192 },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', reasoning: true, supportsImage: false, contextWindow: 64000, maxTokens: 8192 },
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 Zhipu',
    logo: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      { id: 'glm-4-plus', name: 'GLM-4 Plus', reasoning: false, supportsImage: true, contextWindow: 128000, maxTokens: 4096 },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    logo: 'minimax',
    baseUrl: 'https://api.minimax.chat/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      { id: 'abab6.5s-chat', name: 'ABAB 6.5s', reasoning: false, supportsImage: false, contextWindow: 245760, maxTokens: 6144 },
    ],
  },
  {
    id: 'volcengine',
    name: '火山引擎',
    logo: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [],
  },
  {
    id: 'youdao',
    name: '有道 Youdao',
    logo: 'youdao',
    baseUrl: 'https://api.youdao.com/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [],
  },
  {
    id: 'qianfan',
    name: '百度千帆',
    logo: 'qianfan',
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [],
  },
  {
    id: 'stepfun',
    name: '阶跃星辰',
    logo: 'stepfun',
    baseUrl: 'https://api.stepfun.com/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [],
  },
  {
    id: 'xiaomi',
    name: '小米 Xiaomi',
    logo: 'xiaomi',
    baseUrl: 'https://api.xiaomi.com/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    logo: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    logo: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', reasoning: false, supportsImage: true, contextWindow: 1048576, maxTokens: 8192 },
    ],
  },
  {
    id: 'alibaba',
    name: '阿里百炼',
    logo: 'alibaba',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      { id: 'qwen-max', name: 'Qwen Max', reasoning: false, supportsImage: true, contextWindow: 32768, maxTokens: 8192 },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    logo: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large', reasoning: false, supportsImage: false, contextWindow: 128000, maxTokens: 8192 },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    logo: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', reasoning: false, supportsImage: false, contextWindow: 128000, maxTokens: 32768 },
    ],
  },
]
```

- [ ] **Step 2: 写 ModelRegistry 测试**

```typescript
// tests/main/models/model-registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase } from '../../src/main/data/db'
import { ModelRegistry } from '../../src/main/models/model-registry'

describe('ModelRegistry', () => {
  let db: Database.Database
  let registry: ModelRegistry

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    registry = new ModelRegistry(db)
    registry.load()
  })

  afterEach(() => {
    db.close()
  })

  it('should load preset providers', () => {
    const providers = registry.listProviders()
    expect(providers.length).toBeGreaterThanOrEqual(16)
    expect(providers.find(p => p.id === 'openai')).toBeTruthy()
  })

  it('should toggle provider enabled', () => {
    registry.toggleProvider('openai', false)
    expect(registry.getProvider('openai')?.enabled).toBe(false)
    registry.toggleProvider('openai', true)
    expect(registry.getProvider('openai')?.enabled).toBe(true)
  })

  it('should update provider API key without leaking to openclaw config', () => {
    registry.updateProvider('openai', { apiKey: 'sk-test-key' })
    const config = registry.toOpenclawConfig()
    // openclaw.json 中不包含明文 key
    const openaiConfig = config.providers['openai'] as Record<string, unknown>
    expect(openaiConfig.apiKey).toBe('${PETCLAW_APIKEY_OPENAI}')
    // collectSecretEnvVars 返回真实 key
    const envVars = registry.collectSecretEnvVars()
    expect(envVars['PETCLAW_APIKEY_OPENAI']).toBe('sk-test-key')
  })

  it('should add a custom provider', () => {
    registry.addProvider({
      id: 'custom-1',
      name: 'My Provider',
      logo: '',
      baseUrl: 'https://my-api.com/v1',
      apiKey: 'my-key',
      apiFormat: 'openai-completions',
      enabled: true,
      isPreset: false,
      isCustom: true,
      models: [],
    })
    expect(registry.getProvider('custom-1')?.name).toBe('My Provider')
  })

  it('should not delete a preset provider', () => {
    expect(() => registry.removeProvider('openai')).toThrow()
  })

  it('should delete a custom provider', () => {
    registry.addProvider({
      id: 'custom-del',
      name: 'Del',
      logo: '',
      baseUrl: '',
      apiKey: '',
      apiFormat: 'openai-completions',
      enabled: true,
      isPreset: false,
      isCustom: true,
      models: [],
    })
    registry.removeProvider('custom-del')
    expect(registry.getProvider('custom-del')).toBeUndefined()
  })

  it('should set and get active model', () => {
    registry.setActiveModel('openai/gpt-4o')
    const active = registry.getActiveModel()
    expect(active?.provider.id).toBe('openai')
    expect(active?.model.id).toBe('gpt-4o')
  })

  it('should add a model to a provider', () => {
    registry.addModel('openai', {
      id: 'gpt-5',
      name: 'GPT-5',
      reasoning: true,
      supportsImage: true,
      contextWindow: 256000,
      maxTokens: 32768,
    })
    const p = registry.getProvider('openai')
    expect(p?.models.find(m => m.id === 'gpt-5')).toBeTruthy()
  })

  it('should remove a model from a provider', () => {
    registry.removeModel('openai', 'gpt-4o-mini')
    const p = registry.getProvider('openai')
    expect(p?.models.find(m => m.id === 'gpt-4o-mini')).toBeUndefined()
  })

  it('should emit change on update', () => {
    let fired = false
    registry.on('change', () => { fired = true })
    registry.toggleProvider('openai', false)
    expect(fired).toBe(true)
  })

  it('should persist and reload', () => {
    registry.updateProvider('openai', { apiKey: 'sk-persist' })
    registry.setActiveModel('openai/gpt-4o')
    registry.save()

    const registry2 = new ModelRegistry(db)
    registry2.load()
    expect(registry2.getProvider('openai')?.apiKey).toBe('sk-persist')
    expect(registry2.getActiveModel()?.model.id).toBe('gpt-4o')
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/models/model-registry.test.ts`

- [ ] **Step 4: 实现 ModelRegistry**

```typescript
// src/main/models/model-registry.ts
import { EventEmitter } from 'events'
import type Database from 'better-sqlite3'

import type { ModelProvider, ModelDefinition } from '../ai/types'
import { kvGet, kvSet } from '../data/db'
import { PRESET_PROVIDERS } from './preset-providers'

export class ModelRegistry extends EventEmitter {
  private providers: ModelProvider[] = []
  private activeModelId: string | null = null

  constructor(private db: Database.Database) {
    super()
  }

  load(): void {
    const saved = kvGet(this.db, 'modelProviders')
    if (saved) {
      const savedProviders = JSON.parse(saved) as ModelProvider[]
      // 合并预设与已保存数据（保留用户自定义的 apiKey/enabled 等）
      const savedMap = new Map(savedProviders.map(p => [p.id, p]))
      this.providers = PRESET_PROVIDERS.map(preset => {
        const existing = savedMap.get(preset.id)
        if (existing) {
          // 保留用户设置，更新预设字段（名称、默认模型列表等）
          return {
            ...preset,
            apiKey: existing.apiKey || '',
            enabled: existing.enabled,
            isCustom: false,
            models: existing.models.length > 0 ? existing.models : preset.models,
          }
        }
        return { ...preset, apiKey: '', enabled: false, isCustom: false }
      })
      // 追加自定义 Provider
      for (const p of savedProviders) {
        if (p.isCustom && !this.providers.find(pp => pp.id === p.id)) {
          this.providers.push(p)
        }
      }
    } else {
      this.providers = PRESET_PROVIDERS.map(p => ({
        ...p,
        apiKey: '',
        enabled: p.id === 'petclaw',
        isCustom: false,
      }))
    }

    const activeStr = kvGet(this.db, 'activeModel')
    this.activeModelId = activeStr ? JSON.parse(activeStr) : null
  }

  save(): void {
    kvSet(this.db, 'modelProviders', JSON.stringify(this.providers))
    kvSet(this.db, 'activeModel', JSON.stringify(this.activeModelId))
  }

  listProviders(): ModelProvider[] {
    return this.providers
  }

  getProvider(id: string): ModelProvider | undefined {
    return this.providers.find(p => p.id === id)
  }

  addProvider(provider: ModelProvider): void {
    if (this.providers.find(p => p.id === provider.id)) {
      throw new Error(`Provider already exists: ${provider.id}`)
    }
    this.providers.push(provider)
    this.save()
    this.emit('change')
  }

  updateProvider(id: string, patch: Partial<ModelProvider>): void {
    const idx = this.providers.findIndex(p => p.id === id)
    if (idx === -1) throw new Error(`Provider not found: ${id}`)
    this.providers[idx] = { ...this.providers[idx], ...patch }
    this.save()
    this.emit('change')
  }

  removeProvider(id: string): void {
    const provider = this.getProvider(id)
    if (!provider) return
    if (provider.isPreset) throw new Error('Cannot delete a preset provider')
    this.providers = this.providers.filter(p => p.id !== id)
    this.save()
    this.emit('change')
  }

  toggleProvider(id: string, enabled: boolean): void {
    this.updateProvider(id, { enabled })
  }

  addModel(providerId: string, model: ModelDefinition): void {
    const provider = this.getProvider(providerId)
    if (!provider) throw new Error(`Provider not found: ${providerId}`)
    provider.models.push(model)
    this.save()
    this.emit('change')
  }

  removeModel(providerId: string, modelId: string): void {
    const provider = this.getProvider(providerId)
    if (!provider) return
    provider.models = provider.models.filter(m => m.id !== modelId)
    this.save()
    this.emit('change')
  }

  updateModel(providerId: string, modelId: string, patch: Partial<ModelDefinition>): void {
    const provider = this.getProvider(providerId)
    if (!provider) return
    const model = provider.models.find(m => m.id === modelId)
    if (!model) return
    Object.assign(model, patch)
    this.save()
    this.emit('change')
  }

  setActiveModel(providerModelId: string): void {
    this.activeModelId = providerModelId
    this.save()
    this.emit('change')
  }

  getActiveModel(): { provider: ModelProvider; model: ModelDefinition } | null {
    if (!this.activeModelId) return null
    const [providerId, modelId] = this.activeModelId.split('/')
    const provider = this.getProvider(providerId)
    if (!provider) return null
    const model = provider.models.find(m => m.id === modelId)
    if (!model) return null
    return { provider, model }
  }

  async testConnection(providerId: string): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const provider = this.getProvider(providerId)
    if (!provider) return { ok: false, error: 'Provider not found' }
    if (!provider.apiKey) return { ok: false, error: 'API Key not configured' }

    const start = Date.now()
    try {
      const url = provider.baseUrl.replace(/\/$/, '') + '/models'
      const headers: Record<string, string> = {}

      if (provider.apiFormat === 'anthropic') {
        headers['x-api-key'] = provider.apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        headers['Authorization'] = `Bearer ${provider.apiKey}`
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(url, { headers, signal: controller.signal })
      clearTimeout(timeout)

      return { ok: res.status < 400, latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - start }
    }
  }

  toOpenclawConfig(): { mode: string; providers: Record<string, unknown> } {
    const providers: Record<string, unknown> = {}
    for (const p of this.providers) {
      if (!p.apiKey && p.id !== 'petclaw' && p.id !== 'ollama') continue
      const envVar = `PETCLAW_APIKEY_${p.id.toUpperCase().replace(/-/g, '_')}`
      providers[p.id] = {
        baseUrl: p.baseUrl,
        api: p.apiFormat,
        apiKey: p.apiKey ? `\${${envVar}}` : undefined,
        auth: 'api-key',
        models: p.models.map(m => ({
          id: m.id,
          name: m.name,
          ...(m.reasoning && { reasoning: true }),
        })),
      }
    }
    return { mode: 'replace', providers }
  }

  collectSecretEnvVars(): Record<string, string> {
    const vars: Record<string, string> = {}
    for (const p of this.providers) {
      if (p.apiKey) {
        const envVar = `PETCLAW_APIKEY_${p.id.toUpperCase().replace(/-/g, '_')}`
        vars[envVar] = p.apiKey
      }
    }
    return vars
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/models/model-registry.test.ts`

- [ ] **Step 6: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 7: 提交**

```bash
git add src/main/models/ tests/main/models/
git commit -m "feat(models): add ModelRegistry with provider management and API key security"
```

---

## Task 5: SkillManager — Skill 扫描 + 启用/禁用

**Files:**
- Create: `src/main/skills/skill-manager.ts`
- Test: `tests/main/skills/skill-manager.test.ts`

- [ ] **Step 1: 写 SkillManager 测试**

```typescript
// tests/main/skills/skill-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { initDatabase } from '../../src/main/data/db'
import { SkillManager } from '../../src/main/skills/skill-manager'

describe('SkillManager', () => {
  let db: Database.Database
  let tmpDir: string
  let manager: SkillManager

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-skills-'))

    // 创建模拟 Skill 目录
    const skill1 = path.join(tmpDir, 'web-search')
    fs.mkdirSync(skill1)
    fs.writeFileSync(path.join(skill1, 'SKILL.md'), '---\nname: web-search\ndescription: Search the web\nversion: 1.0.0\n---\n')

    const skill2 = path.join(tmpDir, 'code-analyzer')
    fs.mkdirSync(skill2)
    fs.writeFileSync(path.join(skill2, 'SKILL.md'), '---\nname: code-analyzer\ndescription: Analyze code\n---\n')

    manager = new SkillManager(db, tmpDir)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should scan skills from directory', async () => {
    const skills = await manager.scan()
    expect(skills.length).toBe(2)
    expect(skills.find(s => s.id === 'web-search')?.description).toBe('Search the web')
  })

  it('should set enabled state', async () => {
    await manager.scan()
    manager.setEnabled('web-search', false)
    const skills = manager.list()
    expect(skills.find(s => s.id === 'web-search')?.enabled).toBe(false)
  })

  it('should persist enabled state across scans', async () => {
    await manager.scan()
    manager.setEnabled('web-search', false)
    await manager.scan()
    expect(manager.list().find(s => s.id === 'web-search')?.enabled).toBe(false)
  })

  it('should emit change on setEnabled', async () => {
    await manager.scan()
    let fired = false
    manager.on('change', () => { fired = true })
    manager.setEnabled('web-search', false)
    expect(fired).toBe(true)
  })

  it('should generate toOpenclawConfig', async () => {
    await manager.scan()
    manager.setEnabled('code-analyzer', false)
    const config = manager.toOpenclawConfig()
    expect(config.entries['web-search'].enabled).toBe(true)
    expect(config.entries['code-analyzer'].enabled).toBe(false)
    expect(config.load.extraDirs).toContain(tmpDir)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/skills/skill-manager.test.ts`

- [ ] **Step 3: 实现 SkillManager**

```typescript
// src/main/skills/skill-manager.ts
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'

import type { Skill } from '../ai/types'
import { kvGet, kvSet } from '../data/db'

export class SkillManager extends EventEmitter {
  private skills: Skill[] = []
  private enabledState: Record<string, boolean> = {}

  constructor(
    private db: Database.Database,
    private skillsRoot: string
  ) {
    super()
    this.loadEnabledState()
  }

  getSkillsRoot(): string {
    return this.skillsRoot
  }

  async scan(): Promise<Skill[]> {
    this.loadEnabledState()
    this.skills = []

    if (!fs.existsSync(this.skillsRoot)) return this.skills

    const entries = fs.readdirSync(this.skillsRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillMdPath = path.join(this.skillsRoot, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) continue

      const content = fs.readFileSync(skillMdPath, 'utf8')
      const metadata = this.parseFrontmatter(content)

      const id = metadata.name || entry.name
      this.skills.push({
        id,
        name: metadata.name || entry.name,
        description: metadata.description || '',
        enabled: this.enabledState[id] ?? true,
        isBuiltIn: false,
        skillPath: path.join(this.skillsRoot, entry.name),
        version: metadata.version,
      })
    }

    return this.skills
  }

  setEnabled(id: string, enabled: boolean): void {
    const skill = this.skills.find(s => s.id === id)
    if (skill) skill.enabled = enabled
    this.enabledState[id] = enabled
    this.saveEnabledState()
    this.emit('change')
  }

  list(): Skill[] {
    return this.skills
  }

  getEnabled(): Skill[] {
    return this.skills.filter(s => s.enabled)
  }

  toOpenclawConfig(): {
    entries: Record<string, { enabled: boolean }>
    load: { extraDirs: string[]; watch: boolean }
  } {
    const entries: Record<string, { enabled: boolean }> = {}
    for (const skill of this.skills) {
      entries[skill.id] = { enabled: skill.enabled }
    }
    return {
      entries,
      load: { extraDirs: [this.skillsRoot], watch: true },
    }
  }

  private loadEnabledState(): void {
    const saved = kvGet(this.db, 'skills_state')
    if (saved) {
      this.enabledState = JSON.parse(saved)
    }
  }

  private saveEnabledState(): void {
    kvSet(this.db, 'skills_state', JSON.stringify(this.enabledState))
  }

  private parseFrontmatter(content: string): Record<string, string> {
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return {}
    const result: Record<string, string> = {}
    for (const line of match[1].split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      result[key] = value
    }
    return result
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/skills/skill-manager.test.ts`

- [ ] **Step 5: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/main/skills/ tests/main/skills/
git commit -m "feat(skills): add SkillManager with directory scanning and enable/disable"
```

---

## Task 6: McpManager — MCP 服务器 CRUD

**Files:**
- Create: `src/main/mcp/mcp-manager.ts`
- Test: `tests/main/mcp/mcp-manager.test.ts`

- [ ] **Step 1: 写 McpManager 测试**

```typescript
// tests/main/mcp/mcp-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase } from '../../src/main/data/db'
import { McpManager } from '../../src/main/mcp/mcp-manager'

describe('McpManager', () => {
  let db: Database.Database
  let manager: McpManager

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    manager = new McpManager(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should create an MCP server', () => {
    const server = manager.create({
      name: 'fs-server',
      description: 'File system server',
      enabled: true,
      transportType: 'stdio',
      config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
    })
    expect(server.id).toBeTruthy()
    expect(manager.get(server.id)?.name).toBe('fs-server')
  })

  it('should update an MCP server', () => {
    const server = manager.create({
      name: 'test',
      description: '',
      enabled: true,
      transportType: 'stdio',
      config: { command: 'node', args: [] },
    })
    manager.update(server.id, { description: 'updated' })
    expect(manager.get(server.id)?.description).toBe('updated')
  })

  it('should delete an MCP server', () => {
    const server = manager.create({
      name: 'del',
      description: '',
      enabled: true,
      transportType: 'stdio',
      config: { command: 'node', args: [] },
    })
    manager.delete(server.id)
    expect(manager.get(server.id)).toBeUndefined()
  })

  it('should toggle enabled', () => {
    const server = manager.create({
      name: 'toggle',
      description: '',
      enabled: true,
      transportType: 'stdio',
      config: { command: 'node', args: [] },
    })
    manager.setEnabled(server.id, false)
    expect(manager.get(server.id)?.enabled).toBe(false)
  })

  it('should emit change events', () => {
    let count = 0
    manager.on('change', () => { count++ })
    manager.create({ name: 'a', description: '', enabled: true, transportType: 'stdio', config: { command: 'x', args: [] } })
    expect(count).toBe(1)
  })

  it('should generate toOpenclawConfig', () => {
    manager.create({
      name: 'my-server',
      description: '',
      enabled: true,
      transportType: 'stdio',
      config: { command: 'npx', args: ['-y', 'mcp-server'] },
    })
    const config = manager.toOpenclawConfig()
    expect(config.entries['mcp-bridge'].config.servers['my-server']).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/mcp/mcp-manager.test.ts`

- [ ] **Step 3: 实现 McpManager**

```typescript
// src/main/mcp/mcp-manager.ts
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import type Database from 'better-sqlite3'

import type { McpServer, StdioConfig, HttpConfig } from '../ai/types'

export class McpManager extends EventEmitter {
  constructor(private db: Database.Database) {
    super()
  }

  create(data: Omit<McpServer, 'id' | 'createdAt' | 'updatedAt'>): McpServer {
    const id = uuidv4()
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO mcp_servers (id, name, description, enabled, transport_type, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.description, data.enabled ? 1 : 0, data.transportType, JSON.stringify(data.config), now, now)
    this.emit('change')
    return this.get(id)!
  }

  update(id: string, patch: Partial<McpServer>): McpServer {
    const existing = this.get(id)
    if (!existing) throw new Error(`MCP server not found: ${id}`)

    const fields: string[] = []
    const values: unknown[] = []

    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name) }
    if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description) }
    if (patch.enabled !== undefined) { fields.push('enabled = ?'); values.push(patch.enabled ? 1 : 0) }
    if (patch.transportType !== undefined) { fields.push('transport_type = ?'); values.push(patch.transportType) }
    if (patch.config !== undefined) { fields.push('config_json = ?'); values.push(JSON.stringify(patch.config)) }

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    this.db.prepare(`UPDATE mcp_servers SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    this.emit('change')
    return this.get(id)!
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
    this.emit('change')
  }

  list(): McpServer[] {
    const rows = this.db.prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC').all() as Array<Record<string, unknown>>
    return rows.map(r => this.rowToServer(r))
  }

  get(id: string): McpServer | undefined {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.rowToServer(row) : undefined
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.prepare('UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, Date.now(), id)
    this.emit('change')
  }

  toOpenclawConfig(): { entries: Record<string, { enabled: boolean; config: { servers: Record<string, unknown> } }> } {
    const servers: Record<string, unknown> = {}
    for (const s of this.list()) {
      if (!s.enabled) continue
      if (s.transportType === 'stdio') {
        const cfg = s.config as StdioConfig
        servers[s.name] = {
          transport: 'stdio',
          command: cfg.command,
          args: cfg.args,
          ...(cfg.env && { env: cfg.env }),
        }
      } else {
        const cfg = s.config as HttpConfig
        servers[s.name] = {
          transport: s.transportType,
          url: cfg.url,
          ...(cfg.headers && { headers: cfg.headers }),
        }
      }
    }
    return {
      entries: {
        'mcp-bridge': {
          enabled: Object.keys(servers).length > 0,
          config: { servers },
        },
      },
    }
  }

  private rowToServer(row: Record<string, unknown>): McpServer {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      enabled: row.enabled === 1,
      transportType: row.transport_type as McpServer['transportType'],
      config: JSON.parse(row.config_json as string),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/mcp/mcp-manager.test.ts`

- [ ] **Step 5: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/main/mcp/ tests/main/mcp/
git commit -m "feat(mcp): add McpManager with CRUD and openclaw.json serialization"
```

---

## Task 7: MemoryManager — 纯文件驱动记忆

**Files:**
- Create: `src/main/memory/memory-manager.ts`
- Test: `tests/main/memory/memory-manager.test.ts`

- [ ] **Step 1: 写 MemoryManager 测试**

```typescript
// tests/main/memory/memory-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { MemoryManager } from '../../src/main/memory/memory-manager'

describe('MemoryManager', () => {
  let tmpDir: string
  let manager: MemoryManager

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-memory-'))
    manager = new MemoryManager()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should read empty memory when file does not exist', () => {
    expect(manager.readMemory(tmpDir)).toBe('')
  })

  it('should append and read memory', () => {
    manager.appendMemory(tmpDir, '用户喜欢深色主题')
    manager.appendMemory(tmpDir, '项目使用 TypeScript')
    const content = manager.readMemory(tmpDir)
    expect(content).toContain('用户喜欢深色主题')
    expect(content).toContain('项目使用 TypeScript')
  })

  it('should remove a memory entry', () => {
    manager.appendMemory(tmpDir, 'keep this')
    manager.appendMemory(tmpDir, 'remove this')
    manager.removeMemory(tmpDir, 'remove this')
    const content = manager.readMemory(tmpDir)
    expect(content).toContain('keep this')
    expect(content).not.toContain('remove this')
  })

  it('should search memory', () => {
    manager.appendMemory(tmpDir, '用户喜欢深色主题')
    manager.appendMemory(tmpDir, '项目使用 TypeScript')
    const results = manager.searchMemory(tmpDir, '深色')
    expect(results.length).toBe(1)
    expect(results[0]).toContain('深色主题')
  })

  it('should list entries with line numbers', () => {
    manager.appendMemory(tmpDir, 'entry 1')
    manager.appendMemory(tmpDir, 'entry 2')
    const entries = manager.listEntries(tmpDir)
    expect(entries.length).toBe(2)
    expect(entries[0].text).toContain('entry 1')
  })

  it('should update an entry', () => {
    manager.appendMemory(tmpDir, 'old text')
    manager.updateEntry(tmpDir, 'old text', 'new text')
    const content = manager.readMemory(tmpDir)
    expect(content).not.toContain('old text')
    expect(content).toContain('new text')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/memory/memory-manager.test.ts`

- [ ] **Step 3: 实现 MemoryManager**

```typescript
// src/main/memory/memory-manager.ts
import fs from 'fs'
import path from 'path'

import type { MemoryEntry } from '../ai/types'

export class MemoryManager {
  private getMemoryPath(workspace: string): string {
    return path.join(workspace, 'MEMORY.md')
  }

  readMemory(workspace: string): string {
    const filePath = this.getMemoryPath(workspace)
    try {
      return fs.readFileSync(filePath, 'utf8')
    } catch {
      return ''
    }
  }

  appendMemory(workspace: string, entry: string): void {
    const filePath = this.getMemoryPath(workspace)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const existing = this.readMemory(workspace)
    const newLine = existing && !existing.endsWith('\n') ? '\n' : ''
    fs.appendFileSync(filePath, `${newLine}- ${entry}\n`)
  }

  removeMemory(workspace: string, entryText: string): void {
    const filePath = this.getMemoryPath(workspace)
    const content = this.readMemory(workspace)
    if (!content) return

    const lines = content.split('\n')
    const filtered = lines.filter(line => !line.includes(entryText))
    fs.writeFileSync(filePath, filtered.join('\n'))
  }

  searchMemory(workspace: string, keyword: string): string[] {
    const content = this.readMemory(workspace)
    if (!content) return []
    return content
      .split('\n')
      .filter(line => line.trim() && line.toLowerCase().includes(keyword.toLowerCase()))
  }

  listEntries(workspace: string): MemoryEntry[] {
    const content = this.readMemory(workspace)
    if (!content) return []

    return content
      .split('\n')
      .map((line, idx) => ({ text: line, line: idx + 1 }))
      .filter(e => e.text.trim().startsWith('- '))
  }

  updateEntry(workspace: string, oldText: string, newText: string): void {
    const filePath = this.getMemoryPath(workspace)
    const content = this.readMemory(workspace)
    if (!content) return

    const updated = content.replace(oldText, newText)
    fs.writeFileSync(filePath, updated)
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/memory/memory-manager.test.ts`

- [ ] **Step 5: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/main/memory/ tests/main/memory/
git commit -m "feat(memory): add MemoryManager for file-based persistent memory"
```

---

## Task 8: ConfigSync 重构 — deps 注入 → 直接依赖 Manager

**Files:**
- Modify: `src/main/ai/config-sync.ts`
- Test: `tests/main/ai/config-sync-v2.test.ts`

- [ ] **Step 1: 写重构后的 ConfigSync 测试**

```typescript
// tests/main/ai/config-sync-v2.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import Database from 'better-sqlite3'
import { initDatabase } from '../../src/main/data/db'
import { AgentManager } from '../../src/main/agents/agent-manager'
import { ModelRegistry } from '../../src/main/models/model-registry'
import { SkillManager } from '../../src/main/skills/skill-manager'
import { McpManager } from '../../src/main/mcp/mcp-manager'
import { ConfigSync } from '../../src/main/ai/config-sync'

describe('ConfigSync v2', () => {
  let db: Database.Database
  let tmpDir: string
  let configPath: string
  let configSync: ConfigSync

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-config-v2-'))
    configPath = path.join(tmpDir, 'openclaw.json')

    const skillsDir = path.join(tmpDir, 'skills')
    fs.mkdirSync(skillsDir, { recursive: true })
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    const agentManager = new AgentManager(db, workspacePath)
    agentManager.ensurePresetAgents()

    const modelRegistry = new ModelRegistry(db)
    modelRegistry.load()

    const skillManager = new SkillManager(db, skillsDir)

    const mcpManager = new McpManager(db)

    configSync = new ConfigSync({
      configPath,
      stateDir: tmpDir,
      agentManager,
      modelRegistry,
      skillManager,
      mcpManager,
      workspacePath,
    })
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should generate openclaw.json on sync', () => {
    const result = configSync.sync('test')
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    expect(fs.existsSync(configPath)).toBe(true)

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(config.models).toBeTruthy()
    expect(config.agents).toBeTruthy()
    expect(config.skills).toBeTruthy()
    expect(config.commands).toBeTruthy()
  })

  it('should return changed=false when config unchanged', () => {
    configSync.sync('first')
    const result = configSync.sync('second')
    expect(result.changed).toBe(false)
  })

  it('should collect secret env vars from ModelRegistry', () => {
    const vars = configSync.collectSecretEnvVars()
    expect(typeof vars).toBe('object')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/config-sync-v2.test.ts`

- [ ] **Step 3: 重写 config-sync.ts**

替换整个文件内容：

```typescript
// src/main/ai/config-sync.ts
import fs from 'fs'

import type { AgentManager } from '../agents/agent-manager'
import type { ModelRegistry } from '../models/model-registry'
import type { SkillManager } from '../skills/skill-manager'
import type { McpManager } from '../mcp/mcp-manager'

export interface ConfigSyncResult {
  ok: boolean
  changed: boolean
  configPath: string
  error?: string
}

export interface ConfigSyncOptions {
  configPath: string
  stateDir: string
  agentManager: AgentManager
  modelRegistry: ModelRegistry
  skillManager: SkillManager
  mcpManager: McpManager
  workspacePath: string
}

export class ConfigSync {
  private configPath: string
  private agentManager: AgentManager
  private modelRegistry: ModelRegistry
  private skillManager: SkillManager
  private mcpManager: McpManager

  constructor(private opts: ConfigSyncOptions) {
    this.configPath = opts.configPath
    this.agentManager = opts.agentManager
    this.modelRegistry = opts.modelRegistry
    this.skillManager = opts.skillManager
    this.mcpManager = opts.mcpManager
  }

  sync(_reason: string): ConfigSyncResult {
    try {
      const existing = this.readExistingConfig()
      const nextConfig = this.buildConfig(existing)
      const nextContent = JSON.stringify(nextConfig, null, 2)
      const prevContent = this.readFileOrNull(this.configPath)

      if (nextContent === prevContent) {
        return { ok: true, changed: false, configPath: this.configPath }
      }

      // 原子写入
      const tmpPath = `${this.configPath}.tmp-${Date.now()}`
      fs.writeFileSync(tmpPath, nextContent, 'utf8')
      fs.renameSync(tmpPath, this.configPath)

      return { ok: true, changed: true, configPath: this.configPath }
    } catch (err) {
      return {
        ok: false,
        changed: false,
        configPath: this.configPath,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  collectSecretEnvVars(): Record<string, string> {
    return this.modelRegistry.collectSecretEnvVars()
  }

  private buildConfig(existing: Record<string, unknown>): Record<string, unknown> {
    return {
      gateway: existing.gateway ?? {
        mode: 'local',
        auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' },
      },
      models: this.modelRegistry.toOpenclawConfig(),
      agents: this.agentManager.toOpenclawConfig(),
      skills: this.skillManager.toOpenclawConfig(),
      plugins: this.mcpManager.toOpenclawConfig(),
      hooks: { internal: { entries: { 'session-memory': { enabled: false } } } },
      commands: { ownerAllowFrom: ['gateway-client', '*'] },
    }
  }

  private readExistingConfig(): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'))
    } catch {
      return {}
    }
  }

  private readFileOrNull(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, 'utf8')
    } catch {
      return null
    }
  }
}
```

- [ ] **Step 4: 运行新测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/config-sync-v2.test.ts`

- [ ] **Step 5: 更新旧 config-sync 测试（如有）适配新接口**

检查 `tests/main/ai/config-sync.test.ts` 是否存在，如存在则更新其构造参数。

- [ ] **Step 6: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`
注意：此时会因为 `index.ts` 和 `bootcheck.ts` 中旧的 ConfigSync 构造参数报错，需要在 Task 12 中一并修复。暂时可以先确认新模块本身编译通过。

- [ ] **Step 7: 提交**

```bash
git add src/main/ai/config-sync.ts tests/main/ai/config-sync-v2.test.ts
git commit -m "refactor(config-sync): replace deps injection with direct Manager dependencies"
```

---

## Task 9: SessionManager 升级 — 支持 agentId + sessionKey

**Files:**
- Modify: `src/main/ai/session-manager.ts`

- [ ] **Step 1: 更新 SessionManager**

在 `session-manager.ts` 中：

1. 添加 `agentManager` 依赖到构造函数
2. `createAndStart` 增加 `agentId` 参数传递
3. 新增 `buildSessionKey` 私有方法：返回 `agent:{agentId}:petclaw:{sessionId}`
4. 新增 `getSessionsByAgent(agentId: string)` 方法

```typescript
// src/main/ai/session-manager.ts
import path from 'path'

import type { CoworkStore } from './cowork-store'
import type { CoworkController } from './cowork-controller'
import type { CoworkSession, CoworkStartOptions } from './types'
import type { AgentManager } from '../agents/agent-manager'

export class SessionManager {
  constructor(
    private store: CoworkStore,
    private controller: CoworkController,
    private agentManager: AgentManager,
    private workspacePath: string,
    private stateDir: string
  ) {}

  createAndStart(
    title: string,
    cwd: string,
    prompt: string,
    options?: CoworkStartOptions
  ): CoworkSession {
    const agentId = options?.agentId || 'main'
    const session = this.store.createSession(
      title,
      cwd,
      options?.systemPrompt,
      undefined,
      options?.skillIds,
      agentId
    )

    // 构建 agent 感知的 workspace
    const agent = this.agentManager.get(agentId)
    const workspace = agent?.isDefault
      ? this.workspacePath
      : path.join(this.stateDir, `workspace-${agentId}`)

    this.controller.startSession(session.id, prompt, {
      ...options,
      agentId,
      workspaceRoot: workspace,
    })
    return session
  }

  continueSession(sessionId: string, prompt: string): void {
    this.controller.continueSession(sessionId, prompt)
  }

  stopSession(sessionId: string): void {
    this.controller.stopSession(sessionId)
  }

  getSession(id: string): CoworkSession | null {
    return this.store.getSession(id)
  }

  getSessions(): CoworkSession[] {
    return this.store.getSessions()
  }

  getSessionsByAgent(agentId: string): CoworkSession[] {
    return this.store.getSessions().filter(s => s.agentId === agentId)
  }

  deleteSession(id: string): void {
    if (this.controller.isSessionActive(id)) {
      this.controller.stopSession(id)
    }
    this.store.deleteSession(id)
  }

  getRecentWorkingDirs(limit?: number): string[] {
    return this.store.getRecentWorkingDirs(limit)
  }

  private buildSessionKey(agentId: string, sessionId: string): string {
    return `agent:${agentId}:petclaw:${sessionId}`
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`
注意：`index.ts` 中 SessionManager 构造参数需在 Task 12 中一并更新。

- [ ] **Step 3: 提交**

```bash
git add src/main/ai/session-manager.ts
git commit -m "feat(session): upgrade SessionManager with agentId support and workspace routing"
```

---

## Task 10: 5 个新 IPC Handler 模块

**Files:**
- Create: `src/main/ipc/agents-ipc.ts`
- Create: `src/main/ipc/models-ipc.ts`
- Create: `src/main/ipc/skills-ipc.ts`
- Create: `src/main/ipc/mcp-ipc.ts`
- Create: `src/main/ipc/memory-ipc.ts`
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 1: 创建 agents-ipc.ts**

```typescript
// src/main/ipc/agents-ipc.ts
import { ipcMain } from 'electron'

import type { AgentManager } from '../agents/agent-manager'
import type { Agent } from '../ai/types'

export interface AgentsIpcDeps {
  agentManager: AgentManager
}

export function registerAgentsIpcHandlers(deps: AgentsIpcDeps): void {
  const { agentManager } = deps

  ipcMain.handle('agents:list', async () => agentManager.list())
  ipcMain.handle('agents:get', async (_event, id: string) => agentManager.get(id))
  ipcMain.handle('agents:create', async (_event, data: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>) => agentManager.create(data))
  ipcMain.handle('agents:update', async (_event, id: string, patch: Partial<Agent>) => agentManager.update(id, patch))
  ipcMain.handle('agents:delete', async (_event, id: string) => agentManager.delete(id))
}
```

- [ ] **Step 2: 创建 models-ipc.ts**

```typescript
// src/main/ipc/models-ipc.ts
import { ipcMain } from 'electron'

import type { ModelRegistry } from '../models/model-registry'
import type { ModelProvider, ModelDefinition } from '../ai/types'

export interface ModelsIpcDeps {
  modelRegistry: ModelRegistry
}

export function registerModelsIpcHandlers(deps: ModelsIpcDeps): void {
  const { modelRegistry } = deps

  ipcMain.handle('models:providers', async () => {
    // 返回 providers 但 mask API Key
    return modelRegistry.listProviders().map(p => ({
      ...p,
      apiKey: p.apiKey ? `${p.apiKey.slice(0, 5)}****` : '',
    }))
  })

  ipcMain.handle('models:provider', async (_event, id: string) => {
    const p = modelRegistry.getProvider(id)
    if (!p) return null
    return { ...p, apiKey: p.apiKey ? `${p.apiKey.slice(0, 5)}****` : '' }
  })

  ipcMain.handle('models:add-provider', async (_event, data: ModelProvider) => {
    modelRegistry.addProvider(data)
  })

  ipcMain.handle('models:update-provider', async (_event, id: string, patch: Partial<ModelProvider>) => {
    modelRegistry.updateProvider(id, patch)
  })

  ipcMain.handle('models:remove-provider', async (_event, id: string) => {
    modelRegistry.removeProvider(id)
  })

  ipcMain.handle('models:toggle-provider', async (_event, id: string, enabled: boolean) => {
    modelRegistry.toggleProvider(id, enabled)
  })

  ipcMain.handle('models:active', async () => modelRegistry.getActiveModel())

  ipcMain.handle('models:set-active', async (_event, id: string) => {
    modelRegistry.setActiveModel(id)
  })

  ipcMain.handle('models:test-connection', async (_event, id: string) => {
    return modelRegistry.testConnection(id)
  })

  ipcMain.handle('models:add-model', async (_event, providerId: string, model: ModelDefinition) => {
    modelRegistry.addModel(providerId, model)
  })

  ipcMain.handle('models:remove-model', async (_event, providerId: string, modelId: string) => {
    modelRegistry.removeModel(providerId, modelId)
  })
}
```

- [ ] **Step 3: 创建 skills-ipc.ts**

```typescript
// src/main/ipc/skills-ipc.ts
import { ipcMain } from 'electron'

import type { SkillManager } from '../skills/skill-manager'

export interface SkillsIpcDeps {
  skillManager: SkillManager
}

export function registerSkillsIpcHandlers(deps: SkillsIpcDeps): void {
  const { skillManager } = deps

  ipcMain.handle('skills:list', async () => skillManager.list())
  ipcMain.handle('skills:set-enabled', async (_event, id: string, enabled: boolean) => {
    skillManager.setEnabled(id, enabled)
  })
}
```

- [ ] **Step 4: 创建 mcp-ipc.ts**

```typescript
// src/main/ipc/mcp-ipc.ts
import { ipcMain } from 'electron'

import type { McpManager } from '../mcp/mcp-manager'
import type { McpServer } from '../ai/types'

export interface McpIpcDeps {
  mcpManager: McpManager
}

export function registerMcpIpcHandlers(deps: McpIpcDeps): void {
  const { mcpManager } = deps

  ipcMain.handle('mcp:list', async () => mcpManager.list())
  ipcMain.handle('mcp:create', async (_event, data: Omit<McpServer, 'id' | 'createdAt' | 'updatedAt'>) => mcpManager.create(data))
  ipcMain.handle('mcp:update', async (_event, id: string, patch: Partial<McpServer>) => mcpManager.update(id, patch))
  ipcMain.handle('mcp:delete', async (_event, id: string) => mcpManager.delete(id))
  ipcMain.handle('mcp:set-enabled', async (_event, id: string, enabled: boolean) => mcpManager.setEnabled(id, enabled))
}
```

- [ ] **Step 5: 创建 memory-ipc.ts**

```typescript
// src/main/ipc/memory-ipc.ts
import { ipcMain } from 'electron'

import type { MemoryManager } from '../memory/memory-manager'

export interface MemoryIpcDeps {
  memoryManager: MemoryManager
}

export function registerMemoryIpcHandlers(deps: MemoryIpcDeps): void {
  const { memoryManager } = deps

  ipcMain.handle('memory:read', async (_event, workspace: string) => memoryManager.readMemory(workspace))
  ipcMain.handle('memory:append', async (_event, workspace: string, entry: string) => memoryManager.appendMemory(workspace, entry))
  ipcMain.handle('memory:remove', async (_event, workspace: string, text: string) => memoryManager.removeMemory(workspace, text))
  ipcMain.handle('memory:search', async (_event, workspace: string, keyword: string) => memoryManager.searchMemory(workspace, keyword))
  ipcMain.handle('memory:list-entries', async (_event, workspace: string) => memoryManager.listEntries(workspace))
  ipcMain.handle('memory:update-entry', async (_event, workspace: string, oldText: string, newText: string) => memoryManager.updateEntry(workspace, oldText, newText))
}
```

- [ ] **Step 6: 更新 ipc/index.ts**

```typescript
// src/main/ipc/index.ts
import { registerChatIpcHandlers, type ChatIpcDeps } from './chat-ipc'
import { registerSettingsIpcHandlers, type SettingsIpcDeps } from './settings-ipc'
import { registerWindowIpcHandlers, type WindowIpcDeps } from './window-ipc'
import { registerBootIpcHandlers, type BootIpcDeps } from './boot-ipc'
import { registerPetIpcHandlers, type PetIpcDeps } from './pet-ipc'
import { registerAgentsIpcHandlers, type AgentsIpcDeps } from './agents-ipc'
import { registerModelsIpcHandlers, type ModelsIpcDeps } from './models-ipc'
import { registerSkillsIpcHandlers, type SkillsIpcDeps } from './skills-ipc'
import { registerMcpIpcHandlers, type McpIpcDeps } from './mcp-ipc'
import { registerMemoryIpcHandlers, type MemoryIpcDeps } from './memory-ipc'

export type AllIpcDeps = ChatIpcDeps & SettingsIpcDeps & WindowIpcDeps & BootIpcDeps & PetIpcDeps
  & AgentsIpcDeps & ModelsIpcDeps & SkillsIpcDeps & McpIpcDeps & MemoryIpcDeps

export function registerAllIpcHandlers(deps: AllIpcDeps): void {
  registerChatIpcHandlers(deps)
  registerSettingsIpcHandlers(deps)
  registerWindowIpcHandlers(deps)
  registerBootIpcHandlers(deps)
  registerPetIpcHandlers(deps)
  registerAgentsIpcHandlers(deps)
  registerModelsIpcHandlers(deps)
  registerSkillsIpcHandlers(deps)
  registerMcpIpcHandlers(deps)
  registerMemoryIpcHandlers(deps)
}

export { registerBootIpcHandlers, registerSettingsIpcHandlers }
export type { BootIpcDeps, SettingsIpcDeps }
```

- [ ] **Step 7: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/main/ipc/
git commit -m "feat(ipc): add agents/models/skills/mcp/memory IPC handler modules"
```

---

## Task 11: Preload + 类型定义更新

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: 在 preload/index.ts 的 api 对象中追加 5 个新模块**

在 `engine: { ... }` 块之后追加：

```typescript
// ── v3 Phase 2: Manager APIs ──
agents: {
  list: () => ipcRenderer.invoke('agents:list'),
  get: (id: string) => ipcRenderer.invoke('agents:get', id),
  create: (data: unknown) => ipcRenderer.invoke('agents:create', data),
  update: (id: string, patch: unknown) => ipcRenderer.invoke('agents:update', id, patch),
  delete: (id: string) => ipcRenderer.invoke('agents:delete', id),
},
models: {
  providers: () => ipcRenderer.invoke('models:providers'),
  provider: (id: string) => ipcRenderer.invoke('models:provider', id),
  addProvider: (data: unknown) => ipcRenderer.invoke('models:add-provider', data),
  updateProvider: (id: string, patch: unknown) => ipcRenderer.invoke('models:update-provider', id, patch),
  removeProvider: (id: string) => ipcRenderer.invoke('models:remove-provider', id),
  toggleProvider: (id: string, enabled: boolean) => ipcRenderer.invoke('models:toggle-provider', id, enabled),
  active: () => ipcRenderer.invoke('models:active'),
  setActive: (id: string) => ipcRenderer.invoke('models:set-active', id),
  testConnection: (id: string) => ipcRenderer.invoke('models:test-connection', id),
  addModel: (providerId: string, model: unknown) => ipcRenderer.invoke('models:add-model', providerId, model),
  removeModel: (providerId: string, modelId: string) => ipcRenderer.invoke('models:remove-model', providerId, modelId),
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
  listEntries: (workspace: string) => ipcRenderer.invoke('memory:list-entries', workspace),
  updateEntry: (workspace: string, oldText: string, newText: string) => ipcRenderer.invoke('memory:update-entry', workspace, oldText, newText),
},
```

- [ ] **Step 2: 同步更新 preload/index.d.ts**

在 `Window` 接口的 `api` 属性中追加对应的类型声明，所有返回类型使用 `Promise<unknown>` 保持简洁（具体类型在渲染进程中按需 cast）。

- [ ] **Step 3: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/preload/
git commit -m "feat(preload): add Phase 2 IPC channels (agents/models/skills/mcp/memory)"
```

---

## Task 12: 主进程启动流程更新 (index.ts)

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/chat-ipc.ts`

- [ ] **Step 1: 在 index.ts 顶部添加新 import**

```typescript
import { AgentManager } from './agents/agent-manager'
import { ModelRegistry } from './models/model-registry'
import { SkillManager } from './skills/skill-manager'
import { McpManager } from './mcp/mcp-manager'
import { MemoryManager } from './memory/memory-manager'
```

- [ ] **Step 2: 在模块级变量区添加新 Manager 变量**

```typescript
let agentManager: AgentManager
let modelRegistry: ModelRegistry
let skillManager: SkillManager
let mcpManager: McpManager
let memoryManager: MemoryManager
```

- [ ] **Step 3: 在 app.whenReady() 中、CoworkStore 初始化之后、ConfigSync 初始化之前，插入 Manager 初始化**

```typescript
// Phase 2: Manager 初始化
const workspacePath = path.join(petclawHome, 'workspace')
agentManager = new AgentManager(db, workspacePath)
agentManager.ensurePresetAgents()

modelRegistry = new ModelRegistry(db)
modelRegistry.load()

const skillsDir = path.join(petclawHome, 'skills')
fs.mkdirSync(skillsDir, { recursive: true })
skillManager = new SkillManager(db, skillsDir)
await skillManager.scan()

mcpManager = new McpManager(db)

memoryManager = new MemoryManager()
```

- [ ] **Step 4: 更新 ConfigSync 构造为新接口**

```typescript
configSync = new ConfigSync({
  configPath: engineManager.getConfigPath(),
  stateDir: engineManager.getStateDir(),
  agentManager,
  modelRegistry,
  skillManager,
  mcpManager,
  workspacePath,
})
```

- [ ] **Step 5: 添加 Manager change 事件绑定**

```typescript
agentManager.on('change', () => configSync.sync('agent-change'))
modelRegistry.on('change', () => configSync.sync('model-change'))
skillManager.on('change', () => configSync.sync('skill-change'))
mcpManager.on('change', () => configSync.sync('mcp-change'))
```

- [ ] **Step 6: 更新 SessionManager 构造**

```typescript
sessionManager = new SessionManager(
  coworkStore,
  coworkController,
  agentManager,
  workspacePath,
  engineManager.getStateDir()
)
```

- [ ] **Step 7: 更新 registerAllIpcHandlers 调用**

追加新 deps：

```typescript
registerAllIpcHandlers({
  // 原有 deps...
  agentManager,
  modelRegistry,
  skillManager,
  mcpManager,
  memoryManager,
})
```

- [ ] **Step 8: 更新 chat-ipc.ts — chat:send 支持新参数**

```typescript
ipcMain.handle('chat:send', async (
  _event,
  message: string,
  cwd: string,
  agentId?: string,
  skillIds?: string[],
  modelOverride?: string
) => {
  return sessionManager.createAndStart('Chat', cwd, message, {
    agentId,
    skillIds,
    ...(modelOverride && { systemPrompt: undefined }),
  })
})
```

- [ ] **Step 9: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 10: 运行全量测试**

Run: `cd petclaw-desktop && npx vitest run`

- [ ] **Step 11: 提交**

```bash
git add src/main/index.ts src/main/ipc/chat-ipc.ts
git commit -m "feat(boot): integrate Phase 2 managers into startup flow and IPC"
```

---

## Task 13: 前端 — ChatApp 状态模型 + ViewType 升级

**Files:**
- Modify: `src/renderer/src/chat/ChatApp.tsx`

- [ ] **Step 1: 更新 ChatApp.tsx**

重写 `ChatApp.tsx`，升级 ViewType 和状态模型：

```typescript
import { useState, useEffect, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { SkillsPage } from './components/SkillsPage'
import { CronPage } from './components/CronPage'
import { SettingsPage } from './components/settings/SettingsPage'
import { StatusBar } from './components/StatusBar'
import { OnboardingPanel } from '../panels/OnboardingPanel'
import { BootCheckPanel } from '../panels/BootCheckPanel'

export type ViewType = 'chat' | 'skills' | 'cron' | 'settings'

type AppPhase = 'bootcheck' | 'onboarding' | 'main'

export function ChatApp() {
  const [phase, setPhase] = useState<AppPhase>('bootcheck')

  // 核心路由状态
  const [activeView, setActiveView] = useState<ViewType>('chat')
  const [previousView, setPreviousView] = useState<ViewType>('chat')

  // Agent 与会话
  const [currentAgentId, setCurrentAgentId] = useState('main')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // 侧栏 Tab
  const [sidebarTab, setSidebarTab] = useState<'tasks' | 'channels'>('tasks')

  // Settings 子菜单
  const [settingsTab, setSettingsTab] = useState('preferences')

  // 面板
  const [taskMonitorOpen, setTaskMonitorOpen] = useState(false)

  const handleViewChange = useCallback((view: ViewType) => {
    if (view === 'settings') {
      setPreviousView(activeView === 'settings' ? 'chat' : activeView)
    }
    setActiveView(view)
    window.api.setSetting('lastActiveTab', view)
  }, [activeView])

  const handleBackFromSettings = useCallback(() => {
    setActiveView(previousView)
  }, [previousView])

  const handleAgentChange = useCallback((agentId: string) => {
    setCurrentAgentId(agentId)
    setSidebarTab('tasks')
    setActiveView('chat')
    // 会话列表会在 Sidebar 中根据 agentId 重新过滤
    setActiveSessionId(null)
  }, [])

  const handleNewTask = useCallback(() => {
    setActiveView('chat')
    setActiveSessionId(null)
  }, [])

  // Restore tab on mount
  useEffect(() => {
    window.api.getSetting('lastActiveTab').then((val) => {
      if (val === 'chat' || val === 'skills' || val === 'cron' || val === 'settings') {
        setActiveView(val as ViewType)
      }
    })
  }, [])

  // Boot listener
  useEffect(() => {
    function handleBootSuccess(): void {
      window.api.getSetting('onboardingComplete').then((val) => {
        setPhase(val === 'true' ? 'main' : 'onboarding')
      })
    }

    const unsub = window.api.onBootComplete((success) => {
      if (success) handleBootSuccess()
    })

    window.api.getBootStatus().then((success) => {
      if (success) handleBootSuccess()
    }).catch(() => {})

    return unsub
  }, [])

  useEffect(() => {
    if (phase === 'main') window.api.petReady()
  }, [phase])

  useEffect(() => {
    const unsub = window.api.onPanelOpen((panel) => {
      if (panel === 'chat' || panel === 'skills' || panel === 'cron' || panel === 'settings') {
        handleViewChange(panel as ViewType)
      }
    })
    return unsub
  }, [handleViewChange])

  if (phase === 'bootcheck') {
    return <BootCheckPanel onRetry={() => window.api.retryBoot()} />
  }

  if (phase === 'onboarding') {
    return <OnboardingPanel onComplete={() => setPhase('main')} />
  }

  // Settings 全页面模式：隐藏主侧栏
  if (activeView === 'settings') {
    return (
      <SettingsPage
        activeTab={settingsTab}
        onTabChange={setSettingsTab}
        onBack={handleBackFromSettings}
      />
    )
  }

  return (
    <div className="w-full h-full flex bg-bg-root overflow-hidden">
      <Sidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        currentAgentId={currentAgentId}
        onAgentChange={handleAgentChange}
        activeSessionId={activeSessionId}
        onSessionSelect={setActiveSessionId}
        sidebarTab={sidebarTab}
        onSidebarTabChange={setSidebarTab}
        onNewTask={handleNewTask}
        onSettingsOpen={() => handleViewChange('settings')}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            {activeView === 'chat' && (
              <ChatView
                activeSessionId={activeSessionId}
                onSessionCreated={setActiveSessionId}
                currentAgentId={currentAgentId}
                taskMonitorOpen={taskMonitorOpen}
                onToggleMonitor={() => setTaskMonitorOpen(p => !p)}
              />
            )}
            {activeView === 'skills' && <SkillsPage />}
            {activeView === 'cron' && <CronPage />}
          </div>
        </main>
        <StatusBar />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`
注意：此步会因缺少 SkillsPage / CronPage / SettingsPage 等组件而报错，在后续 Task 中逐步创建。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/chat/ChatApp.tsx
git commit -m "refactor(chat-app): upgrade ViewType to 4-route model with agent/session state"
```

---

## Task 14: 前端 — Sidebar 重构

**Files:**
- Modify: `src/renderer/src/chat/components/Sidebar.tsx`

- [ ] **Step 1: 重写 Sidebar**

完全重写 Sidebar 以支持 Agent 列表、导航联动、Tab 切换、会话过滤。参考设计稿 §12.4 分区结构。

关键变化：
- Props 扩展：`currentAgentId`, `onAgentChange`, `activeSessionId`, `onSessionSelect`, `sidebarTab`, `onSidebarTabChange`, `onNewTask`, `onSettingsOpen`
- 导航区：技能、定时任务、IM 频道（Phase 3 占位）
- 我的 Agent 区：从 `window.api.agents.list()` 加载，点击切换 `currentAgentId`
- Tab 区：`任务 | 频道` 切换 `sidebarTab`
- 列表区：`sidebarTab === 'tasks'` 显示 `window.api.cowork.sessions()` 按 `agentId` 过滤的会话列表
- 底部栏：头像 + 昵称 + 设置齿轮

完整代码见实现时参考 spec §12.4 和现有 Sidebar 风格（button class、icon size 等）。

- [ ] **Step 2: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/renderer/src/chat/components/Sidebar.tsx
git commit -m "refactor(sidebar): add agent list, nav routing, tab switching, and session filtering"
```

---

## Task 15: 前端 — WelcomePage 欢迎页

**Files:**
- Create: `src/renderer/src/chat/components/WelcomePage.tsx`

- [ ] **Step 1: 创建 WelcomePage 组件**

参考 spec §12.7 欢迎页设计：

```typescript
// src/renderer/src/chat/components/WelcomePage.tsx
import { PawPrint, FolderOpen, PenLine, BarChart3 } from 'lucide-react'

const QUICK_CARDS = [
  {
    icon: FolderOpen,
    title: '文件整理',
    desc: '智能整理和管理本地文件',
    prompt: '帮我整理桌面文件，按类型分类到对应文件夹',
  },
  {
    icon: PenLine,
    title: '内容创作',
    desc: '创作演义文稿和多种内容',
    prompt: '帮我写一篇关于的文章',
  },
  {
    icon: BarChart3,
    title: '文档处理',
    desc: '处理和分析文档数据内容',
    prompt: '帮我分析这份文档的关键信息',
  },
]

interface WelcomePageProps {
  onSendPrompt: (text: string) => void
}

export function WelcomePage({ onSendPrompt }: WelcomePageProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      {/* Mascot */}
      <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mb-6">
        <PawPrint size={30} className="text-white" strokeWidth={2} />
      </div>

      {/* Tagline */}
      <h2 className="text-[20px] font-bold text-text-primary mb-2 tracking-tight">
        不止聊天，搞定一切
      </h2>
      <p className="text-[14px] text-text-tertiary mb-10">
        本地运行，自主规划，安全可控的 AI 工作搭子
      </p>

      {/* Quick cards */}
      <div className="flex gap-4 max-w-[640px]">
        {QUICK_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <button
              key={card.title}
              onClick={() => onSendPrompt(card.prompt)}
              className="flex-1 flex flex-col items-start p-4 rounded-[14px] bg-bg-card border border-border shadow-[var(--shadow-card)] hover:border-text-tertiary hover:shadow-[var(--shadow-dropdown)] active:scale-[0.96] transition-all duration-[120ms] text-left"
            >
              <Icon size={20} className="text-text-secondary mb-3" strokeWidth={1.75} />
              <span className="text-[14px] font-medium text-text-primary mb-1">{card.title}</span>
              <span className="text-[12px] text-text-tertiary leading-[1.5]">{card.desc}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/renderer/src/chat/components/WelcomePage.tsx
git commit -m "feat(welcome): add WelcomePage with quick action cards"
```

---

## Task 16: 前端 — ChatInputBox + CwdSelector + SkillSelector + ModelSelector

**Files:**
- Create: `src/renderer/src/chat/components/ChatInputBox.tsx`
- Create: `src/renderer/src/chat/components/CwdSelector.tsx`
- Create: `src/renderer/src/chat/components/SkillSelector.tsx`
- Create: `src/renderer/src/chat/components/ModelSelector.tsx`

- [ ] **Step 1: 创建 CwdSelector**

参考 spec §14.4，Popover 选择器：最近目录列表 + 添加文件夹。

- [ ] **Step 2: 创建 SkillSelector**

参考 spec §14.5：工具栏图标 + badge + Popover checkbox 列表 + chip 标签条。

- [ ] **Step 3: 创建 ModelSelector**

参考 spec §14.6：⚡标准 / 🧠推理 快捷切换 + 展开模型列表。

- [ ] **Step 4: 创建 ChatInputBox**

参考 spec §14.2，整合 textarea + 工具栏（CwdSelector / SkillSelector / ConnectorButton / AttachmentButton / ModelSelector / SendButton）。接收 `onSend(message, cwd, skillIds, modelOverride)` 回调。

```typescript
// ChatInputBox 核心结构
interface ChatInputBoxProps {
  onSend: (message: string, cwd: string, skillIds: string[], modelOverride: string) => void
  disabled?: boolean
}

export function ChatInputBox({ onSend, disabled }: ChatInputBoxProps) {
  const [input, setInput] = useState('')
  const [cwd, setCwd] = useState('')
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [activeModel, setActiveModel] = useState('standard')
  // ... textarea + toolbar layout
}
```

- [ ] **Step 5: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/renderer/src/chat/components/ChatInputBox.tsx src/renderer/src/chat/components/CwdSelector.tsx src/renderer/src/chat/components/SkillSelector.tsx src/renderer/src/chat/components/ModelSelector.tsx
git commit -m "feat(input): add ChatInputBox with CwdSelector, SkillSelector, and ModelSelector"
```

---

## Task 17: 前端 — ChatHeader + TaskMonitorPanel + ConnectorPopup

**Files:**
- Create: `src/renderer/src/chat/components/ChatHeader.tsx`
- Create: `src/renderer/src/chat/components/TaskMonitorPanel.tsx`
- Create: `src/renderer/src/chat/components/ConnectorPopup.tsx`

- [ ] **Step 1: 创建 ChatHeader**

参考 spec §12.8 聊天顶栏：会话标题（可编辑）+ 问题反馈 + ≡ 右面板 toggle。

- [ ] **Step 2: 创建 TaskMonitorPanel**

参考 spec §12.10：右面板骨架（待办/产物/技能与MCP 三个区域），`w-[240px]` 可收起。

- [ ] **Step 3: 创建 ConnectorPopup**

参考 spec §12.11：MCP 服务器快捷开关弹窗，`window.api.mcp.list()` 加载数据。

- [ ] **Step 4: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/renderer/src/chat/components/ChatHeader.tsx src/renderer/src/chat/components/TaskMonitorPanel.tsx src/renderer/src/chat/components/ConnectorPopup.tsx
git commit -m "feat(chat): add ChatHeader, TaskMonitorPanel, and ConnectorPopup"
```

---

## Task 18: 前端 — ChatView 重构

**Files:**
- Modify: `src/renderer/src/chat/components/ChatView.tsx`

- [ ] **Step 1: 重写 ChatView 集成新组件**

主要变化：
- Props：接收 `activeSessionId`, `onSessionCreated`, `currentAgentId`, `taskMonitorOpen`, `onToggleMonitor`
- 条件渲染：`activeSessionId === null` → WelcomePage，否则 → 聊天界面
- 聊天界面集成 ChatHeader + 消息区域 + ChatInputBox
- 消息数据源从 v1 IPC 切换到 v3 cowork channels
- 发送消息走 `window.api.cowork.send(message, cwd)` 并传入 agentId/skillIds/modelOverride
- 右侧 TaskMonitorPanel 根据 `taskMonitorOpen` 显示/隐藏

```typescript
export function ChatView({
  activeSessionId,
  onSessionCreated,
  currentAgentId,
  taskMonitorOpen,
  onToggleMonitor,
}: ChatViewProps) {
  // ...

  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 flex flex-col min-w-0">
        {activeSessionId ? (
          <>
            <ChatHeader
              sessionTitle={sessionTitle}
              onToggleMonitor={onToggleMonitor}
            />
            <MessageList messages={messages} />
            <ChatInputBox onSend={handleSend} disabled={isLoading} />
          </>
        ) : (
          <>
            <div className="drag-region h-[52px] shrink-0" />
            <WelcomePage onSendPrompt={handleSendFromWelcome} />
            <div className="shrink-0 px-6 pb-4 pt-3">
              <ChatInputBox onSend={handleSend} />
            </div>
          </>
        )}
      </div>
      {taskMonitorOpen && activeSessionId && (
        <TaskMonitorPanel sessionId={activeSessionId} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/renderer/src/chat/components/ChatView.tsx
git commit -m "refactor(chat-view): integrate ChatInputBox, WelcomePage, and TaskMonitorPanel"
```

---

## Task 19: 前端 — SkillsPage + CronPage

**Files:**
- Create: `src/renderer/src/chat/components/SkillsPage.tsx`
- Create: `src/renderer/src/chat/components/CronPage.tsx`

- [ ] **Step 1: 创建 SkillsPage**

参考 spec §12.9 技能管理页面：搜索 + Skill 列表 + 开关。

```typescript
// src/renderer/src/chat/components/SkillsPage.tsx
import { useState, useEffect } from 'react'
import { Search } from 'lucide-react'

interface SkillItem {
  id: string
  name: string
  description: string
  enabled: boolean
}

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    window.api.skills.list().then((list: unknown) => {
      setSkills(list as SkillItem[])
    })
  }, [])

  const filtered = skills.filter(
    s => s.name.toLowerCase().includes(search.toLowerCase()) ||
         s.description.toLowerCase().includes(search.toLowerCase())
  )

  const handleToggle = (id: string, enabled: boolean) => {
    window.api.skills.setEnabled(id, enabled)
    setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled } : s))
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="drag-region h-[52px] shrink-0" />
      <div className="flex-1 overflow-y-auto px-8 py-4">
        <h1 className="text-[20px] font-bold text-text-primary mb-1">技能管理</h1>
        <p className="text-[13px] text-text-tertiary mb-6">管理和配置可用的技能</p>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索技能..."
            className="w-full pl-9 pr-4 py-2.5 rounded-[10px] bg-bg-input border-none text-[14px] text-text-primary outline-none placeholder:text-text-tertiary"
          />
        </div>

        {/* Skill list */}
        <div className="rounded-[14px] bg-bg-card border border-border overflow-hidden">
          {filtered.map((skill, i) => (
            <div
              key={skill.id}
              className={`flex items-center justify-between px-5 py-4 ${i < filtered.length - 1 ? 'border-b border-border' : ''}`}
            >
              <div>
                <span className="text-[14px] font-medium text-text-primary">{skill.name}</span>
                <p className="text-[13px] text-text-tertiary mt-0.5">{skill.description}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={e => handleToggle(skill.id, e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-bg-hover peer-focus:outline-none rounded-full peer peer-checked:bg-accent transition-colors duration-[120ms]" />
                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform duration-[120ms]" />
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建 CronPage 占位**

```typescript
// src/renderer/src/chat/components/CronPage.tsx
import { Clock } from 'lucide-react'

export function CronPage() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="drag-region h-[52px] shrink-0" />
      <div className="flex-1 flex flex-col items-center justify-center">
        <Clock size={48} className="text-text-tertiary mb-4" strokeWidth={1.25} />
        <h2 className="text-[17px] font-semibold text-text-primary mb-1">定时任务</h2>
        <p className="text-[13px] text-text-tertiary">即将推出，敬请期待</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/renderer/src/chat/components/SkillsPage.tsx src/renderer/src/chat/components/CronPage.tsx
git commit -m "feat(pages): add SkillsPage with search/toggle and CronPage placeholder"
```

---

## Task 20: 前端 — Settings 全页面

**Files:**
- Create: `src/renderer/src/chat/components/settings/SettingsPage.tsx`
- Create: `src/renderer/src/chat/components/settings/PreferenceSettings.tsx`
- Create: `src/renderer/src/chat/components/settings/ProfileSettings.tsx`
- Create: `src/renderer/src/chat/components/settings/AboutSettings.tsx`
- Create: `src/renderer/src/chat/components/settings/EngineSettings.tsx`

- [ ] **Step 1: 创建 SettingsPage 容器**

参考 spec §13.1-§13.4，左侧分类菜单 + 右侧内容区：

```typescript
// src/renderer/src/chat/components/settings/SettingsPage.tsx
import { ArrowLeft } from 'lucide-react'
import { PreferenceSettings } from './PreferenceSettings'
import { ProfileSettings } from './ProfileSettings'
import { AboutSettings } from './AboutSettings'
import { EngineSettings } from './EngineSettings'
import { ModelSettings } from './ModelSettings'
import { AgentSettings } from './AgentSettings'
import { MemorySettings } from './MemorySettings'
import { ConnectorSettings } from './ConnectorSettings'
import { McpSettings } from './McpSettings'

const MENU_SECTIONS = [
  {
    label: '通用',
    items: [
      { id: 'preferences', label: '偏好设置', icon: '⚙️' },
      { id: 'profile', label: '个人资料', icon: '👤' },
      { id: 'about', label: '关于', icon: 'ℹ️' },
    ],
  },
  {
    label: 'AI 配置',
    items: [
      { id: 'engine', label: 'Agent 引擎', icon: '⚙️' },
      { id: 'models', label: '模型', icon: '🧠' },
      { id: 'agents', label: 'Agent', icon: '🤖' },
      { id: 'memory', label: '记忆', icon: '📝' },
    ],
  },
  {
    label: '扩展与集成',
    items: [
      { id: 'connectors', label: '连接器', icon: '🔌' },
      { id: 'mcp', label: 'MCP 服务', icon: '🔧' },
    ],
  },
]

interface SettingsPageProps {
  activeTab: string
  onTabChange: (tab: string) => void
  onBack: () => void
}

export function SettingsPage({ activeTab, onTabChange, onBack }: SettingsPageProps) {
  return (
    <div className="w-full h-full flex bg-bg-root overflow-hidden">
      {/* 左侧菜单 */}
      <div className="w-[240px] shrink-0 flex flex-col border-r border-border bg-bg-sidebar">
        <div className="drag-region h-[52px] shrink-0 flex items-center pl-[78px]">
          <button
            onClick={onBack}
            className="no-drag flex items-center gap-1.5 text-[14px] text-text-secondary hover:text-text-primary transition-colors duration-[120ms]"
          >
            <ArrowLeft size={15} strokeWidth={2} />
            <span>返回应用</span>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-1">
          {MENU_SECTIONS.map((section) => (
            <div key={section.label} className="mb-4">
              <div className="px-3 mb-1.5 text-[11px] text-text-tertiary font-medium uppercase tracking-wider">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onTabChange(item.id)}
                    className={`no-drag w-full flex items-center gap-2.5 px-3 py-[7px] rounded-[10px] text-[13px] transition-all duration-[120ms] ${
                      activeTab === item.id
                        ? 'bg-bg-active text-text-primary font-medium'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                    }`}
                  >
                    <span className="text-[14px]">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="drag-region h-[52px] shrink-0" />
        <div className="flex-1 overflow-y-auto px-8 py-4">
          {activeTab === 'preferences' && <PreferenceSettings />}
          {activeTab === 'profile' && <ProfileSettings />}
          {activeTab === 'about' && <AboutSettings />}
          {activeTab === 'engine' && <EngineSettings />}
          {activeTab === 'models' && <ModelSettings />}
          {activeTab === 'agents' && <AgentSettings />}
          {activeTab === 'memory' && <MemorySettings />}
          {activeTab === 'connectors' && <ConnectorSettings />}
          {activeTab === 'mcp' && <McpSettings />}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建 PreferenceSettings**

参考 spec §13.5 偏好设置：卡片分组设计，语言/主题/字号/面板位置。

- [ ] **Step 3: 创建 ProfileSettings**

昵称、职业角色编辑，数据来自 `window.api.getSetting('nickname')` 等 kv。

- [ ] **Step 4: 创建 AboutSettings**

版本号（`window.api.getAppVersion()`）、反馈链接、开源协议。

- [ ] **Step 5: 创建 EngineSettings**

引擎状态（`window.api.engine.onStatus()`）、版本号、重启按钮。

- [ ] **Step 6: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/renderer/src/chat/components/settings/
git commit -m "feat(settings): add SettingsPage container with Preferences, Profile, About, and Engine tabs"
```

---

## Task 21: 前端 — ModelSettings（两栏布局）

**Files:**
- Create: `src/renderer/src/chat/components/settings/ModelSettings.tsx`

- [ ] **Step 1: 实现 ModelSettings**

参考 spec §13.5 模型设置：

左侧 Provider 列表（`w-[200px]`）+ 右侧配置面板。实现：
- Provider 列表：品牌 Logo + 名称 + 启用状态圆点，底部「+ 添加自定义」
- 右侧面板：API Key 输入 + Base URL + API 格式 Radio + 测试连接按钮 + 可用模型列表 + 添加模型弹窗
- 自定义 Provider 额外显示「显示名称」字段
- 数据流：`window.api.models.providers()` → 列表渲染，`window.api.models.updateProvider(id, patch)` → 保存

完整代码参考 spec §13.5 两个 ASCII mockup 和字段表，遵循 PetClaw 设计系统（`rounded-[14px]`、`bg-bg-card`、`active:scale-[0.96]`）。

- [ ] **Step 2: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/renderer/src/chat/components/settings/ModelSettings.tsx
git commit -m "feat(settings): add ModelSettings with two-column provider management layout"
```

---

## Task 22: 前端 — AgentSettings + MemorySettings + ConnectorSettings + McpSettings

**Files:**
- Create: `src/renderer/src/chat/components/settings/AgentSettings.tsx`
- Create: `src/renderer/src/chat/components/settings/MemorySettings.tsx`
- Create: `src/renderer/src/chat/components/settings/ConnectorSettings.tsx`
- Create: `src/renderer/src/chat/components/settings/McpSettings.tsx`

- [ ] **Step 1: 创建 AgentSettings**

Agent 列表 + 创建/编辑/删除。编辑表单：名称、图标（emoji picker）、System Prompt（textarea）、模型选择（下拉）、技能绑定（多选）。数据来源：`window.api.agents.list()`

- [ ] **Step 2: 创建 MemorySettings**

MEMORY.md 内容查看（只读 textarea）+ 编辑 + 搜索。数据来源：`window.api.memory.read(workspace)`

- [ ] **Step 3: 创建 ConnectorSettings**

MCP 服务器快捷开关列表（同连接器弹窗但完整版）。数据来源：`window.api.mcp.list()`

- [ ] **Step 4: 创建 McpSettings**

MCP 服务器详细管理：添加/编辑/删除 + 传输协议选择（stdio/sse/streamable-http）+ 配置编辑（command/args/url 等）。

- [ ] **Step 5: 类型检查 + 提交**

```bash
cd petclaw-desktop && npx tsc --noEmit
git add src/renderer/src/chat/components/settings/AgentSettings.tsx src/renderer/src/chat/components/settings/MemorySettings.tsx src/renderer/src/chat/components/settings/ConnectorSettings.tsx src/renderer/src/chat/components/settings/McpSettings.tsx
git commit -m "feat(settings): add Agent, Memory, Connector, and MCP settings pages"
```

---

## Task 23: 清理旧代码 + 删除 SettingsView

**Files:**
- Delete: `src/renderer/src/chat/components/SettingsView.tsx`
- Delete: `src/renderer/src/chat/components/MonitorView.tsx`

- [ ] **Step 1: 删除旧文件**

```bash
rm src/renderer/src/chat/components/SettingsView.tsx
rm src/renderer/src/chat/components/MonitorView.tsx
```

- [ ] **Step 2: 清理 ChatApp.tsx 中的旧导入**

确保不再引用 `SettingsView` 和 `MonitorView`。

- [ ] **Step 3: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 4: 运行全量测试**

Run: `cd petclaw-desktop && npx vitest run`

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: remove v1 SettingsView and MonitorView, replaced by Phase 2 components"
```

---

## Task 24: 全量验证

- [ ] **Step 1: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 2: 全量测试**

Run: `cd petclaw-desktop && npx vitest run`

- [ ] **Step 3: 验证 IPC 三处同步**

检查每个新 channel 在三处都有定义：
- `ipc/*.ts` 中的 `ipcMain.handle`
- `preload/index.ts` 中的 `ipcRenderer.invoke`
- `preload/index.d.ts` 中的类型声明

- [ ] **Step 4: 验证 API Key 安全**

检查 `openclaw.json` 不包含明文 API Key，只有 `${PETCLAW_APIKEY_xxx}` 占位符。

- [ ] **Step 5: 同步文档**

更新 `.ai/README.md` 和 `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md` 中的对应章节。

- [ ] **Step 6: 提交文档更新**

```bash
git add .ai/README.md docs/superpowers/specs/
git commit -m "docs: sync Phase 2 implementation to architecture spec and README"
```

---

## Verification

### 手动验证
1. `cd petclaw-desktop && npx tsc --noEmit` — 类型检查通过
2. `npx vitest run` — 全量测试通过
3. 开发模式启动 `npm run dev`：
   - 侧栏显示 4 个预设 Agent + 导航项
   - 点击 Agent → 会话列表过滤 → 欢迎页/聊天页切换
   - 设置齿轮 → Settings 全页面（隐藏主侧栏）→ ← 返回应用
   - Settings 模型页：Provider 列表 + API Key + 测试连接
   - ChatInputBox：cwd 选择 + Skills 选择 + 模型选择 + 发送
   - 连接器弹窗：MCP 服务器开关
   - 技能页：搜索 + 开关切换

### 回归验证
- 宠物状态机不变（PetEventBridge 仍从 CoworkController 事件驱动）
- BootCheck 流程不变
- Hook 系统正常
- 托盘 + 全局快捷键正常

### 关键检查点
- IPC channel 三处同步（`ipc/*.ts` + `preload/index.ts` + `preload/index.d.ts`）
- API Key 不出现在 `openclaw.json`
- ConfigSync 聚合 5 个 Manager 生成正确配置
- Manager change 事件 → `ConfigSync.sync()` 自动触发
- 前端 ViewType 四路由正确切换
- Settings 进入/退出正确隐藏/恢复主侧栏
