# 目录驱动架构重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PetClaw 现有的 Agent-centric 架构重构为 Directory-centric 架构——用户只选择工作目录，Agent 由 `deriveAgentId(path)` 自动派生，用户无感知。

**Architecture:** 删除 `agents/` 目录和 `AgentManager`，新建 `DirectoryManager`（放在 `ai/` 目录下）。DB 表 `agents` → `directories`，`cowork_sessions` → `sessions`，`cowork_messages` → `messages`（去 `cowork_` 前缀），`kv` → `app_config`，`im_config` + `im_session_mappings` → `im_instances` + `im_conversation_bindings` + `im_session_mappings`（两层绑定），新增 `scheduled_task_meta`。ConfigSync 从 `AgentManager.toOpenclawConfig()` 切换到 `DirectoryManager.toOpenclawConfig()`。SessionManager 不再依赖 AgentManager，改为依赖 DirectoryManager。IPC channel `agents:*` → `directory:*`。前端 `AgentConfigDialog` → `DirectoryConfigDialog`。

**Tech Stack:** Electron 33 · better-sqlite3 · Zustand · TypeScript strict · Vitest

**参考实现:** LobsterAI `/Users/xiaoxuxuy/Desktop/工作/AI/开源项目/LobsterAI`

**v3 Spec:** `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md`（§3, §7, §8, §14, §15, §17, §18, §25）

---

## 变更范围总览

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/main/ai/directory-manager.ts` | 目录注册 + deriveAgentId + 全量注册到 ConfigSync |
| `tests/main/ai/directory-manager.test.ts` | DirectoryManager 单元测试 |
| `src/main/ipc/directory-ipc.ts` | 目录相关 IPC handlers |
| `src/renderer/src/chat/components/DirectoryConfigDialog.tsx` | 目录配置对话框（替代 AgentConfigDialog） |
| `src/renderer/src/chat/components/DirectorySkillSelector.tsx` | 目录技能多选子组件（替代 AgentSkillSelector） |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/main/data/db.ts` | DB schema 重构：9 表新设计 |
| `src/main/ai/types.ts` | Agent → Directory 类型，Session 字段调整 |
| `src/main/ai/config-sync.ts` | AgentManager → DirectoryManager 依赖 |
| `src/main/ai/session-manager.ts` | AgentManager → DirectoryManager，directoryPath 字段 |
| `src/main/ai/cowork-store.ts` | 表名 + 字段名更新 |
| `src/main/ai/cowork-controller.ts` | 增加 DirectoryManager.ensureRegistered 调用 |
| `src/main/im/im-gateway-manager.ts` | 重构为两层绑定模型 |
| `src/main/im/types.ts` | 更新 IM 类型定义 |
| `src/main/ipc/chat-ipc.ts` | 移除 agentId 参数，由 cwd 自动派生 |
| `src/main/ipc/im-ipc.ts` | 适配新 IM 表结构 |
| `src/main/ipc/index.ts` | AgentsIpc → DirectoryIpc |
| `src/main/index.ts` | AgentManager → DirectoryManager 初始化 |
| `src/main/bootcheck.ts` | 移除 AgentManager 引用 |
| `src/preload/index.ts` | agents API → directories API |
| `src/preload/index.d.ts` | 类型同步 |
| 相关 test 文件 | 全部适配新接口 |

### 删除文件

| 文件 | 原因 |
|------|------|
| `src/main/agents/agent-manager.ts` | 被 DirectoryManager 替代 |
| `src/main/agents/preset-agents.ts` | 目录驱动不需要预设 Agent |
| `src/main/ipc/agents-ipc.ts` | 被 directory-ipc.ts 替代 |
| `tests/main/agents/agent-manager.test.ts` | 被 directory-manager.test.ts 替代 |
| `src/renderer/src/chat/components/AgentConfigDialog.tsx` | 被 DirectoryConfigDialog 替代 |
| `src/renderer/src/chat/components/AgentSkillSelector.tsx` | 被 DirectorySkillSelector 替代 |

---

## Task 1: DB Schema 重构

**Files:**
- Modify: `src/main/data/db.ts`
- Modify: `tests/main/data/db.test.ts`

将现有 6 表（messages, kv, cowork_sessions, cowork_messages, agents, mcp_servers, im_config, im_session_mappings）重构为 v3 规格的 9 表设计。

- [ ] **Step 1: 读取现有 db.test.ts**

读取 `tests/main/data/db.test.ts` 了解现有测试结构。

- [ ] **Step 2: 重写 db.test.ts 测试**

```typescript
// tests/main/data/db.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

import { initDatabase, kvGet, kvSet, kvGetAll } from '../../../src/main/data/db'

describe('initDatabase', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('should create all 9 tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)
    expect(names).toContain('app_config')
    expect(names).toContain('directories')
    expect(names).toContain('sessions')
    expect(names).toContain('messages')
    expect(names).toContain('im_instances')
    expect(names).toContain('im_conversation_bindings')
    expect(names).toContain('im_session_mappings')
    expect(names).toContain('scheduled_task_meta')
    expect(names).toContain('mcp_servers')
  })

  it('should create indexes', () => {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
    const names = indexes.map((i) => i.name)
    expect(names).toContain('idx_messages_session')
    expect(names).toContain('idx_sessions_agent')
    expect(names).toContain('idx_sessions_directory')
  })
})

describe('app_config (kv helpers)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('should set and get a value', () => {
    kvSet(db, 'theme', '"dark"')
    expect(kvGet(db, 'theme')).toBe('"dark"')
  })

  it('should upsert on conflict', () => {
    kvSet(db, 'port', '29890')
    kvSet(db, 'port', '18789')
    expect(kvGet(db, 'port')).toBe('18789')
  })

  it('should return null for missing key', () => {
    expect(kvGet(db, 'nonexistent')).toBeNull()
  })

  it('should return all entries', () => {
    kvSet(db, 'a', '1')
    kvSet(db, 'b', '2')
    expect(kvGetAll(db)).toEqual({ a: '1', b: '2' })
  })
})

describe('directories table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('should insert and query a directory', () => {
    const now = Date.now()
    db.prepare(
      'INSERT INTO directories (agent_id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('ws-abc123', '/tmp/proj', 'My Project', now, now)
    const row = db.prepare('SELECT * FROM directories WHERE agent_id = ?').get('ws-abc123') as Record<string, unknown>
    expect(row.path).toBe('/tmp/proj')
    expect(row.model_override).toBe('')
    expect(row.skill_ids).toBe('[]')
  })

  it('should enforce unique path', () => {
    const now = Date.now()
    db.prepare(
      'INSERT INTO directories (agent_id, path, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run('ws-aaa', '/tmp/a', now, now)
    expect(() =>
      db.prepare(
        'INSERT INTO directories (agent_id, path, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).run('ws-bbb', '/tmp/a', now, now)
    ).toThrow()
  })
})

describe('sessions table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('should insert with directory_path and agent_id', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO sessions (id, title, directory_path, agent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('s1', 'Test', '/tmp/proj', 'ws-abc123', now, now)
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('s1') as Record<string, unknown>
    expect(row.directory_path).toBe('/tmp/proj')
    expect(row.agent_id).toBe('ws-abc123')
    expect(row.status).toBe('idle')
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/data/db.test.ts`
Expected: 失败，因为旧 schema 没有 `directories`、`sessions` 等表

- [ ] **Step 4: 重写 db.ts 中的 initDatabase**

```typescript
// src/main/data/db.ts
import Database from 'better-sqlite3'

export function initDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // 全局配置 KV（替代旧 kv 表，改名 app_config）
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 目录配置（替代旧 agents 表）
  db.exec(`
    CREATE TABLE IF NOT EXISTS directories (
      agent_id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT,
      model_override TEXT DEFAULT '',
      skill_ids TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 会话（替代旧 cowork_sessions，去 cowork_ 前缀）
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      directory_path TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      model_override TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 消息（替代旧 cowork_messages）
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `)

  // IM 实例（替代旧 im_config 表）
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_instances (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      name TEXT,
      directory_path TEXT,
      agent_id TEXT,
      credentials TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // IM 对话级绑定（新增）
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_conversation_bindings (
      conversation_id TEXT NOT NULL,
      instance_id TEXT NOT NULL REFERENCES im_instances(id) ON DELETE CASCADE,
      peer_kind TEXT NOT NULL,
      directory_path TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, instance_id)
    )
  `)

  // IM 会话映射（重构主键）
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_session_mappings (
      conversation_id TEXT NOT NULL,
      instance_id TEXT NOT NULL REFERENCES im_instances(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      agent_id TEXT NOT NULL DEFAULT 'main',
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, instance_id)
    )
  `)

  // 定时任务元数据（新增，CRUD 委托给 OpenClaw cron.* RPC）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_task_meta (
      task_id TEXT PRIMARY KEY,
      directory_path TEXT,
      agent_id TEXT,
      origin TEXT,
      binding TEXT
    )
  `)

  // MCP 服务器（保留，无变化）
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

  // 索引
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_directory ON sessions(directory_path)')
}

// ── KV 辅助函数（操作 app_config 表） ──

export function kvGet(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : null
}

export function kvSet(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, ?)').run(
    key,
    value,
    Date.now()
  )
}

export function kvGetAll(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM app_config').all() as Array<{
    key: string
    value: string
  }>
  const result: Record<string, string> = {}
  for (const row of rows) result[row.key] = row.value
  return result
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/data/db.test.ts`

- [ ] **Step 6: 提交**

```bash
git add src/main/data/db.ts tests/main/data/db.test.ts
git commit -m "refactor(db): migrate to 9-table directory-driven schema"
```

---

## Task 2: 类型定义更新

**Files:**
- Modify: `src/main/ai/types.ts`

将 `Agent` 接口替换为 `Directory` 接口，移除 Agent 相关类型，更新 `CoworkSession` 字段。

- [ ] **Step 1: 重写 types.ts**

替换 `Agent` 接口为 `Directory`，更新 `CoworkSession` 移除 `cwd`/`systemPrompt`/`executionMode`/`activeSkillIds` 字段（简化为目录驱动模型），保留其他类型不变：

```typescript
// types.ts 变更点：

// 删除整个 Agent interface（第 87-104 行）
// 新增 Directory interface：
export interface Directory {
  agentId: string        // deriveAgentId(path)
  path: string           // 绝对路径
  name: string | null    // 用户自定义别名
  modelOverride: string  // 空=跟全局
  skillIds: string[]     // skill 白名单
  createdAt: number
  updatedAt: number
}

// 更新 CoworkSession（移除旧字段，新增 directoryPath）：
export interface CoworkSession {
  id: string
  title: string
  directoryPath: string          // 替代 cwd
  agentId: string                // deriveAgentId(directoryPath)
  claudeSessionId: string | null
  status: CoworkSessionStatus
  modelOverride: string          // 会话级模型覆盖
  pinned: boolean
  messages: CoworkMessage[]
  createdAt: number
  updatedAt: number
}
// 移除字段：cwd, systemPrompt, executionMode, activeSkillIds
// 新增字段：directoryPath

// 新增 deriveAgentId 工具函数
export function deriveAgentId(dir: string): string {
  const resolved = path.resolve(dir)
  const hash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 12)
  return `ws-${hash}`
}
```

- [ ] **Step 2: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit 2>&1 | head -50`
Expected: 大量报错（下游依赖还没更新），记录需要修复的文件列表

- [ ] **Step 3: 提交**

```bash
git add src/main/ai/types.ts
git commit -m "refactor(types): replace Agent with Directory, update CoworkSession fields"
```

---

## Task 3: DirectoryManager 实现

**Files:**
- Create: `src/main/ai/directory-manager.ts`
- Create: `tests/main/ai/directory-manager.test.ts`

- [ ] **Step 1: 写 DirectoryManager 测试**

```typescript
// tests/main/ai/directory-manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

import { initDatabase } from '../../../src/main/data/db'
import { DirectoryManager } from '../../../src/main/ai/directory-manager'

describe('DirectoryManager', () => {
  let db: Database.Database
  let dm: DirectoryManager

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    dm = new DirectoryManager(db, '/default/workspace')
  })

  describe('ensureRegistered', () => {
    it('should register a new directory and return it', () => {
      const dir = dm.ensureRegistered('/tmp/my-project')
      expect(dir.path).toBe('/tmp/my-project')
      expect(dir.agentId).toMatch(/^ws-[0-9a-f]{12}$/)
      expect(dir.modelOverride).toBe('')
      expect(dir.skillIds).toEqual([])
    })

    it('should be idempotent', () => {
      const dir1 = dm.ensureRegistered('/tmp/my-project')
      const dir2 = dm.ensureRegistered('/tmp/my-project')
      expect(dir1.agentId).toBe(dir2.agentId)
    })

    it('should emit change on first registration', () => {
      let changed = false
      dm.on('change', () => { changed = true })
      dm.ensureRegistered('/tmp/new-project')
      expect(changed).toBe(true)
    })

    it('should not emit change on re-registration', () => {
      dm.ensureRegistered('/tmp/project')
      let changed = false
      dm.on('change', () => { changed = true })
      dm.ensureRegistered('/tmp/project')
      expect(changed).toBe(false)
    })
  })

  describe('get / getByPath / list', () => {
    it('should get by agentId', () => {
      const dir = dm.ensureRegistered('/tmp/proj')
      expect(dm.get(dir.agentId)?.path).toBe('/tmp/proj')
    })

    it('should get by path', () => {
      dm.ensureRegistered('/tmp/proj')
      expect(dm.getByPath('/tmp/proj')?.agentId).toMatch(/^ws-/)
    })

    it('should list all directories', () => {
      dm.ensureRegistered('/tmp/a')
      dm.ensureRegistered('/tmp/b')
      expect(dm.list()).toHaveLength(2)
    })
  })

  describe('updateName / updateModelOverride / updateSkillIds', () => {
    it('should update name', () => {
      const dir = dm.ensureRegistered('/tmp/proj')
      dm.updateName(dir.agentId, 'My Project')
      expect(dm.get(dir.agentId)?.name).toBe('My Project')
    })

    it('should update model override', () => {
      const dir = dm.ensureRegistered('/tmp/proj')
      dm.updateModelOverride(dir.agentId, 'gpt-4o')
      expect(dm.get(dir.agentId)?.modelOverride).toBe('gpt-4o')
    })

    it('should update skill ids', () => {
      const dir = dm.ensureRegistered('/tmp/proj')
      dm.updateSkillIds(dir.agentId, ['deep-research', 'docx'])
      expect(dm.get(dir.agentId)?.skillIds).toEqual(['deep-research', 'docx'])
    })
  })

  describe('toOpenclawConfig', () => {
    it('should generate config with main default and directory agents', () => {
      dm.ensureRegistered('/tmp/proj-a')
      const config = dm.toOpenclawConfig()
      expect(config.defaults.workspace).toBe('/default/workspace')
      expect(config.list[0]).toEqual({ id: 'main', default: true })
      expect(config.list).toHaveLength(2) // main + proj-a
      expect(config.list[1].id).toMatch(/^ws-/)
      expect(config.list[1].workspace).toBe('/tmp/proj-a')
    })

    it('should include model override in agent config', () => {
      const dir = dm.ensureRegistered('/tmp/proj')
      dm.updateModelOverride(dir.agentId, 'gpt-4o')
      const config = dm.toOpenclawConfig()
      const agent = config.list.find((a: { id: string }) => a.id === dir.agentId)
      expect(agent?.model).toEqual({ primary: 'gpt-4o' })
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/directory-manager.test.ts`

- [ ] **Step 3: 实现 DirectoryManager**

```typescript
// src/main/ai/directory-manager.ts
import { EventEmitter } from 'events'
import type Database from 'better-sqlite3'

import { deriveAgentId, type Directory } from './types'

interface OpenclawAgentEntry {
  id: string
  default?: boolean
  workspace?: string
  model?: { primary: string }
  skills?: string[]
}

interface OpenclawAgentsConfig {
  defaults: { timeoutSeconds: number; model: { primary: string }; workspace: string }
  list: OpenclawAgentEntry[]
}

export class DirectoryManager extends EventEmitter {
  constructor(
    private db: Database.Database,
    // main agent 的默认 workspace 路径
    private defaultWorkspace: string
  ) {
    super()
  }

  // 注册目录（首次使用时自动调用，幂等）
  ensureRegistered(directoryPath: string): Directory {
    const agentId = deriveAgentId(directoryPath)
    const existing = this.get(agentId)
    if (existing) return existing

    const now = Date.now()
    this.db
      .prepare(
        'INSERT INTO directories (agent_id, path, created_at, updated_at) VALUES (?, ?, ?, ?)'
      )
      .run(agentId, directoryPath, now, now)

    this.emit('change')
    return this.get(agentId)!
  }

  get(agentId: string): Directory | null {
    const row = this.db
      .prepare('SELECT * FROM directories WHERE agent_id = ?')
      .get(agentId) as Record<string, unknown> | undefined
    return row ? this.rowToDirectory(row) : null
  }

  getByPath(directoryPath: string): Directory | null {
    const row = this.db
      .prepare('SELECT * FROM directories WHERE path = ?')
      .get(directoryPath) as Record<string, unknown> | undefined
    return row ? this.rowToDirectory(row) : null
  }

  list(): Directory[] {
    const rows = this.db
      .prepare('SELECT * FROM directories ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>
    return rows.map((r) => this.rowToDirectory(r))
  }

  updateName(agentId: string, name: string): void {
    this.db
      .prepare('UPDATE directories SET name = ?, updated_at = ? WHERE agent_id = ?')
      .run(name, Date.now(), agentId)
    this.emit('change')
  }

  updateModelOverride(agentId: string, model: string): void {
    this.db
      .prepare('UPDATE directories SET model_override = ?, updated_at = ? WHERE agent_id = ?')
      .run(model, Date.now(), agentId)
    this.emit('change')
  }

  updateSkillIds(agentId: string, skillIds: string[]): void {
    this.db
      .prepare('UPDATE directories SET skill_ids = ?, updated_at = ? WHERE agent_id = ?')
      .run(JSON.stringify(skillIds), Date.now(), agentId)
    this.emit('change')
  }

  // 序列化为 openclaw.json agents 配置
  toOpenclawConfig(): OpenclawAgentsConfig {
    const directories = this.list()
    const list: OpenclawAgentEntry[] = [{ id: 'main', default: true }]

    for (const dir of directories) {
      const entry: OpenclawAgentEntry = {
        id: dir.agentId,
        workspace: dir.path
      }
      if (dir.modelOverride) {
        entry.model = { primary: dir.modelOverride }
      }
      if (dir.skillIds.length > 0) {
        entry.skills = dir.skillIds
      }
      list.push(entry)
    }

    return {
      defaults: {
        timeoutSeconds: 3600,
        model: { primary: 'llm/petclaw-fast' },
        workspace: this.defaultWorkspace
      },
      list
    }
  }

  private rowToDirectory(row: Record<string, unknown>): Directory {
    return {
      agentId: row.agent_id as string,
      path: row.path as string,
      name: (row.name as string) ?? null,
      modelOverride: (row.model_override as string) ?? '',
      skillIds: JSON.parse((row.skill_ids as string) ?? '[]') as string[],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/directory-manager.test.ts`

- [ ] **Step 5: 提交**

```bash
git add src/main/ai/directory-manager.ts tests/main/ai/directory-manager.test.ts
git commit -m "feat(directory): add DirectoryManager with deriveAgentId and full registration"
```

---

## Task 4: CoworkStore 适配新表名

**Files:**
- Modify: `src/main/ai/cowork-store.ts`
- Modify: `tests/main/ai/cowork-store.test.ts`

将 `cowork_sessions` → `sessions`、`cowork_messages` → `messages`，字段 `cwd` → `directory_path`，移除 `system_prompt`/`execution_mode`/`active_skill_ids` 字段。

- [ ] **Step 1: 更新 cowork-store.test.ts**

更新测试中的表名和字段名，适配新 schema。关键变更：
- `createSession(title, directoryPath, agentId)` — 移除 systemPrompt/executionMode/skillIds 参数
- `rowToSession` 返回 `directoryPath` 而非 `cwd`

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-store.test.ts`

- [ ] **Step 3: 重写 CoworkStore**

关键变更：
- SQL 表名 `cowork_sessions` → `sessions`，`cowork_messages` → `messages`
- `createSession` 签名改为 `(title: string, directoryPath: string, agentId: string)`
- `INSERT` 语句用 `directory_path` + `agent_id`，移除 `system_prompt`/`execution_mode`/`active_skill_ids`
- `rowToSession` 返回 `directoryPath` 而非 `cwd`
- `timestamp` 列改为 `created_at`（与 v3 schema 一致）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-store.test.ts`

- [ ] **Step 5: 提交**

```bash
git add src/main/ai/cowork-store.ts tests/main/ai/cowork-store.test.ts
git commit -m "refactor(store): migrate CoworkStore to sessions/messages tables"
```

---

## Task 5: ConfigSync 切换依赖

**Files:**
- Modify: `src/main/ai/config-sync.ts`
- Modify: `tests/main/ai/config-sync.test.ts`

从 `AgentManager` 切换到 `DirectoryManager`。

- [ ] **Step 1: 更新 config-sync.test.ts**

将 mock 的 `agentManager` 替换为 `directoryManager`，`toOpenclawConfig` 返回新格式（含 `list` 数组）。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/config-sync.test.ts`

- [ ] **Step 3: 更新 ConfigSync**

```typescript
// config-sync.ts 变更点：
// 1. import AgentManager → DirectoryManager
// 2. ConfigSyncOptions.agentManager → directoryManager
// 3. buildConfig 中 this.agentManager.toOpenclawConfig() → this.directoryManager.toOpenclawConfig()
// 4. constructor 中 this.agentManager → this.directoryManager

import type { DirectoryManager } from './directory-manager'
// ... 其他 import 不变

export interface ConfigSyncOptions {
  configPath: string
  stateDir: string
  directoryManager: DirectoryManager  // 替代 agentManager
  modelRegistry: ModelRegistry
  skillManager: SkillManager
  mcpManager: McpManager
  workspacePath: string
}

// buildConfig 中：
agents: this.directoryManager.toOpenclawConfig(),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/config-sync.test.ts`

- [ ] **Step 5: 提交**

```bash
git add src/main/ai/config-sync.ts tests/main/ai/config-sync.test.ts
git commit -m "refactor(config-sync): switch from AgentManager to DirectoryManager"
```

---

## Task 6: SessionManager 切换依赖

**Files:**
- Modify: `src/main/ai/session-manager.ts`
- Modify: `tests/main/ai/session-manager.test.ts`

从 `AgentManager` 切换到 `DirectoryManager`，workspace 路由逻辑改为目录驱动。

- [ ] **Step 1: 更新 session-manager.test.ts**

替换 AgentManager mock 为 DirectoryManager mock。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/session-manager.test.ts`

- [ ] **Step 3: 重写 SessionManager**

关键变更：
- 构造函数注入 `DirectoryManager` 而非 `AgentManager`
- `createAndStart` 不再接收 `agentId` 参数，由 `cwd` 自动派生
- workspace 路径对 main agent 使用 `this.workspacePath`，对目录 agent 直接使用目录路径
- session key 格式保持 `agent:{agentId}:petclaw:{sessionId}`

```typescript
// session-manager.ts 关键变更
import type { DirectoryManager } from './directory-manager'
import { deriveAgentId } from './types'

export class SessionManager {
  constructor(
    private store: CoworkStore,
    private controller: CoworkController,
    private directoryManager: DirectoryManager,
    private workspacePath: string,
    private stateDir: string
  ) {}

  createAndStart(title: string, cwd: string, prompt: string, options?: CoworkStartOptions): CoworkSession {
    // 自动注册目录 + 派生 agentId
    this.directoryManager.ensureRegistered(cwd)
    const agentId = deriveAgentId(cwd)

    const session = this.store.createSession(title, cwd, agentId)

    this.controller.startSession(session.id, prompt, {
      ...options,
      agentId,
      workspaceRoot: cwd  // 目录路径直接作为 workspace
    })
    return session
  }

  // getSessionsByAgent 保留（Sidebar 按目录分组）
  getSessionsByDirectory(directoryPath: string): CoworkSession[] {
    const agentId = deriveAgentId(directoryPath)
    return this.store.getSessions().filter((s) => s.agentId === agentId)
  }

  // 其他方法基本不变
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/session-manager.test.ts`

- [ ] **Step 5: 提交**

```bash
git add src/main/ai/session-manager.ts tests/main/ai/session-manager.test.ts
git commit -m "refactor(session): switch SessionManager to DirectoryManager"
```

---

## Task 7: IPC 层重构

**Files:**
- Create: `src/main/ipc/directory-ipc.ts`
- Delete: `src/main/ipc/agents-ipc.ts`
- Modify: `src/main/ipc/chat-ipc.ts`
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 1: 创建 directory-ipc.ts**

```typescript
// src/main/ipc/directory-ipc.ts
import { ipcMain } from 'electron'

import type { DirectoryManager } from '../ai/directory-manager'

export interface DirectoryIpcDeps {
  directoryManager: DirectoryManager
}

export function registerDirectoryIpcHandlers(deps: DirectoryIpcDeps): void {
  const { directoryManager } = deps

  ipcMain.handle('directory:list', async () => directoryManager.list())

  ipcMain.handle('directory:get', async (_event, agentId: string) =>
    directoryManager.get(agentId)
  )

  ipcMain.handle('directory:get-by-path', async (_event, directoryPath: string) =>
    directoryManager.getByPath(directoryPath)
  )

  ipcMain.handle('directory:update-name', async (_event, agentId: string, name: string) =>
    directoryManager.updateName(agentId, name)
  )

  ipcMain.handle('directory:update-model', async (_event, agentId: string, model: string) =>
    directoryManager.updateModelOverride(agentId, model)
  )

  ipcMain.handle('directory:update-skills', async (_event, agentId: string, skillIds: string[]) =>
    directoryManager.updateSkillIds(agentId, skillIds)
  )
}
```

- [ ] **Step 2: 更新 chat-ipc.ts**

移除 `agentId` 参数（由 `cwd` 自动派生）：

```typescript
// chat-ipc.ts 变更：
ipcMain.handle(
  'chat:send',
  async (_event, message: string, cwd: string, skillIds?: string[], _modelOverride?: string) => {
    // agentId 不再由前端传入，SessionManager 内部通过 cwd 派生
    return sessionManager.createAndStart('Chat', cwd, message, { skillIds })
  }
)
```

- [ ] **Step 3: 更新 ipc/index.ts**

替换 `registerAgentsIpcHandlers` → `registerDirectoryIpcHandlers`：

```typescript
import { registerDirectoryIpcHandlers, type DirectoryIpcDeps } from './directory-ipc'
// 删除 import { registerAgentsIpcHandlers }

export type AllIpcDeps = ChatIpcDeps &
  SettingsIpcDeps &
  // ... 其他不变
  DirectoryIpcDeps &  // 替代 AgentsIpcDeps
  // ...

export function registerAllIpcHandlers(deps: AllIpcDeps): void {
  // ...
  registerDirectoryIpcHandlers(deps)  // 替代 registerAgentsIpcHandlers(deps)
  // ...
}
```

- [ ] **Step 4: 删除 agents-ipc.ts**

```bash
rm src/main/ipc/agents-ipc.ts
```

- [ ] **Step 5: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 6: 提交**

```bash
git add src/main/ipc/directory-ipc.ts src/main/ipc/chat-ipc.ts src/main/ipc/index.ts
git rm src/main/ipc/agents-ipc.ts
git commit -m "refactor(ipc): replace agents-ipc with directory-ipc"
```

---

## Task 8: Preload 层更新

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: 更新 preload/index.ts**

替换 `agents` API 为 `directories`：

```typescript
// 删除 agents 对象（第 204-210 行），替换为：
directories: {
  list: () => ipcRenderer.invoke('directory:list'),
  get: (agentId: string) => ipcRenderer.invoke('directory:get', agentId),
  getByPath: (path: string) => ipcRenderer.invoke('directory:get-by-path', path),
  updateName: (agentId: string, name: string) =>
    ipcRenderer.invoke('directory:update-name', agentId, name),
  updateModel: (agentId: string, model: string) =>
    ipcRenderer.invoke('directory:update-model', agentId, model),
  updateSkills: (agentId: string, skillIds: string[]) =>
    ipcRenderer.invoke('directory:update-skills', agentId, skillIds)
},
```

同时更新 `cowork.send` 移除 agentId 参数：

```typescript
cowork: {
  send: (message: string, cwd: string, skillIds?: string[]) =>
    ipcRenderer.invoke('chat:send', message, cwd, skillIds),
  // 其他方法不变
},
```

- [ ] **Step 2: 同步更新 preload/index.d.ts**

更新类型声明匹配新接口。

- [ ] **Step 3: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 4: 提交**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "refactor(preload): replace agents API with directories API"
```

---

## Task 9: 主进程入口重构

**Files:**
- Modify: `src/main/index.ts`
- Delete: `src/main/agents/agent-manager.ts`
- Delete: `src/main/agents/preset-agents.ts`

- [ ] **Step 1: 更新 index.ts**

关键变更：
1. `import { AgentManager }` → `import { DirectoryManager }`
2. `let agentManager` → `let directoryManager`
3. 初始化代码：
   - 删除 `agentManager = new AgentManager(db, workspacePath)`
   - 删除 `agentManager.ensurePresetAgents()`
   - 新增 `directoryManager = new DirectoryManager(db, workspacePath)`
4. `ConfigSyncOptions` 中 `agentManager` → `directoryManager`
5. `SessionManager` 构造函数 `agentManager` → `directoryManager`
6. 事件监听 `agentManager.on('change')` → `directoryManager.on('change')`
7. `registerAllIpcHandlers` deps 中 `agentManager` → `directoryManager`

- [ ] **Step 2: 删除旧文件**

```bash
rm -r src/main/agents/
rm tests/main/agents/agent-manager.test.ts
```

- [ ] **Step 3: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 4: 提交**

```bash
git rm -r src/main/agents/
git rm tests/main/agents/agent-manager.test.ts
git add src/main/index.ts
git commit -m "refactor(main): replace AgentManager with DirectoryManager"
```

---

## Task 10: IM Gateway 重构为两层绑定

**Files:**
- Modify: `src/main/im/im-gateway-manager.ts`
- Modify: `src/main/im/types.ts`
- Modify: `src/main/ipc/im-ipc.ts`
- Modify: `tests/main/im/im-gateway-manager.test.ts`

- [ ] **Step 1: 更新 im/types.ts**

删除旧 `IMSettings`（含 `platformAgentBindings`），更新为两层绑定类型：

```typescript
// 删除 IMSettings 接口
// 删除 IMPlatformConfig 接口
// 更新为：

export interface ImInstance {
  id: string
  platform: Platform
  name: string | null
  directoryPath: string | null  // 实例级默认目录（null=main）
  agentId: string | null        // deriveAgentId(directoryPath) 或 null
  credentials: Record<string, unknown>
  config: ImInstanceConfig
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface ImInstanceConfig {
  dmPolicy: 'open' | 'pairing' | 'allowlist' | 'disabled'
  groupPolicy: 'open' | 'allowlist' | 'disabled'
  allowFrom: string[]
  debug: boolean
}

export interface ImConversationBinding {
  conversationId: string
  instanceId: string
  peerKind: 'dm' | 'group'
  directoryPath: string
  agentId: string
  createdAt: number
  updatedAt: number
}
```

- [ ] **Step 2: 重写 im-gateway-manager.ts**

关键变更：
- 操作 `im_instances` 表（替代 `im_config`）
- 新增 `im_conversation_bindings` CRUD
- `getAgentForPlatform` → `resolveAgent(instanceId, conversationId)`（两层查找）
- `toOpenclawConfig` 生成 bindings 数组（Tier 1 peer + Tier 6 account）
- `upsertSessionMapping` 适配新主键 `(conversation_id, instance_id)`

- [ ] **Step 3: 更新 im-ipc.ts**

适配新 ImGatewayManager 接口。

- [ ] **Step 4: 更新测试**

- [ ] **Step 5: 运行测试**

Run: `cd petclaw-desktop && npx vitest run tests/main/im/im-gateway-manager.test.ts`

- [ ] **Step 6: 提交**

```bash
git add src/main/im/ src/main/ipc/im-ipc.ts tests/main/im/
git commit -m "refactor(im): implement two-layer binding model"
```

---

## Task 11: Scheduler 添加 scheduled_task_meta

**Files:**
- Modify: `src/main/scheduler/cron-job-service.ts`
- Modify: `src/main/ipc/scheduler-ipc.ts`
- Modify: `tests/main/scheduler/cron-job-service.test.ts`

- [ ] **Step 1: 在 CronJobService 中添加元数据 CRUD**

```typescript
// cron-job-service.ts 新增方法：

// 构造函数新增 db 依赖
constructor(deps: CronJobServiceDeps & { db: Database.Database }) {
  // ...
  this.db = deps.db
}

// 保存任务元数据（创建任务时调用）
saveTaskMeta(taskId: string, meta: {
  directoryPath?: string
  agentId?: string
  origin?: string
  binding?: string
}): void {
  this.db.prepare(
    `INSERT OR REPLACE INTO scheduled_task_meta
     (task_id, directory_path, agent_id, origin, binding)
     VALUES (?, ?, ?, ?, ?)`
  ).run(taskId, meta.directoryPath ?? null, meta.agentId ?? null, meta.origin ?? null, meta.binding ?? null)
}

getTaskMeta(taskId: string): { directoryPath: string | null; agentId: string | null; origin: string | null; binding: string | null } | null {
  return this.db.prepare('SELECT * FROM scheduled_task_meta WHERE task_id = ?').get(taskId) as any ?? null
}

deleteTaskMeta(taskId: string): void {
  this.db.prepare('DELETE FROM scheduled_task_meta WHERE task_id = ?').run(taskId)
}
```

- [ ] **Step 2: 更新 addJob 和 removeJob**

`addJob` 后自动调用 `saveTaskMeta`，`removeJob` 后调用 `deleteTaskMeta`。

- [ ] **Step 3: 更新测试**

- [ ] **Step 4: 运行测试**

Run: `cd petclaw-desktop && npx vitest run tests/main/scheduler/cron-job-service.test.ts`

- [ ] **Step 5: 提交**

```bash
git add src/main/scheduler/ src/main/ipc/scheduler-ipc.ts tests/main/scheduler/
git commit -m "feat(scheduler): add scheduled_task_meta for directory/agent binding"
```

---

## Task 12: 前端组件重命名

**Files:**
- Create: `src/renderer/src/chat/components/DirectoryConfigDialog.tsx`
- Create: `src/renderer/src/chat/components/DirectorySkillSelector.tsx`
- Delete: `src/renderer/src/chat/components/AgentConfigDialog.tsx`
- Delete: `src/renderer/src/chat/components/AgentSkillSelector.tsx`
- Modify: 所有引用这两个组件的文件

- [ ] **Step 1: 查找所有引用 AgentConfigDialog 的文件**

Run: `cd petclaw-desktop && grep -rn 'AgentConfigDialog\|AgentSkillSelector' src/renderer/ --include='*.tsx' --include='*.ts'`

- [ ] **Step 2: 创建 DirectoryConfigDialog.tsx**

基于 `AgentConfigDialog.tsx` 重构：
- 移除 "创建 Agent" 模式（目录不能手动创建，只能自动注册）
- Tab 改为：基础（名称 + 模型覆盖）→ 技能白名单
- 移除 IM Tab（IM 绑定改到 ImConfigDialog 中管理）
- 接口改为 `window.api.directories.*`

- [ ] **Step 3: 创建 DirectorySkillSelector.tsx**

基于 `AgentSkillSelector.tsx` 重构，接口不变，只改组件名。

- [ ] **Step 4: 更新所有引用文件**

替换 import 和使用。

- [ ] **Step 5: 删除旧组件**

```bash
rm src/renderer/src/chat/components/AgentConfigDialog.tsx
rm src/renderer/src/chat/components/AgentSkillSelector.tsx
```

- [ ] **Step 6: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/chat/components/DirectoryConfigDialog.tsx
git add src/renderer/src/chat/components/DirectorySkillSelector.tsx
git rm src/renderer/src/chat/components/AgentConfigDialog.tsx
git rm src/renderer/src/chat/components/AgentSkillSelector.tsx
git add -u  # 更新引用文件
git commit -m "refactor(ui): replace Agent dialogs with Directory dialogs"
```

---

## Task 13: 数据迁移脚本

**Files:**
- Modify: `src/main/data/db.ts`（添加迁移逻辑）

旧 schema → 新 schema 的数据迁移，在 `initDatabase` 中自动检测并执行。

- [ ] **Step 1: 在 initDatabase 中添加迁移检测**

```typescript
// db.ts 在建表之后添加迁移逻辑：

function migrateIfNeeded(db: Database.Database): void {
  // 检测旧表是否存在
  const hasOldAgents = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'")
    .get()
  if (!hasOldAgents) return // 全新安装，无需迁移

  // 1. kv → app_config
  const hasOldKv = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kv'")
    .get()
  if (hasOldKv) {
    db.exec('INSERT OR IGNORE INTO app_config SELECT * FROM kv')
    db.exec('DROP TABLE IF EXISTS kv')
  }

  // 2. agents → directories（只迁移非预设 Agent）
  // 由于目录驱动模型中 Agent 由目录派生，预设 Agent 数据不迁移
  // 用户自定义 Agent 的 name/model/skillIds 保留为目录配置
  db.exec('DROP TABLE IF EXISTS agents')

  // 3. cowork_sessions → sessions
  const hasOldSessions = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cowork_sessions'")
    .get()
  if (hasOldSessions) {
    db.exec(`
      INSERT OR IGNORE INTO sessions (id, title, directory_path, agent_id, status, model_override, pinned, created_at, updated_at)
      SELECT id, title, cwd, agent_id, status, model_override, pinned, created_at, updated_at
      FROM cowork_sessions
    `)
    db.exec('DROP TABLE IF EXISTS cowork_sessions')
  }

  // 4. cowork_messages → messages
  const hasOldMessages = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cowork_messages'")
    .get()
  if (hasOldMessages) {
    db.exec(`
      INSERT OR IGNORE INTO messages (id, session_id, type, content, metadata, created_at)
      SELECT id, session_id, type, content, metadata, timestamp
      FROM cowork_messages
    `)
    db.exec('DROP TABLE IF EXISTS cowork_messages')
  }

  // 5. im_config → 不迁移（结构差异太大，用户重新配置）
  db.exec('DROP TABLE IF EXISTS im_config')
  db.exec('DROP TABLE IF EXISTS im_session_mappings')

  // 6. 清理旧 messages 表（v1 遗留的 role/content 格式）
  const hasOldV1Messages = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
    .get()
  if (hasOldV1Messages) {
    // 检查是否是旧格式（有 role 列）
    const cols = db.prepare("PRAGMA table_info('messages')").all() as Array<{ name: string }>
    if (cols.some((c) => c.name === 'role')) {
      db.exec('DROP TABLE messages')
      // initDatabase 会重新创建新格式的 messages 表
    }
  }
}
```

- [ ] **Step 2: 在 initDatabase 末尾调用迁移**

```typescript
export function initDatabase(db: Database.Database): void {
  // ... 建表语句 ...
  migrateIfNeeded(db)
}
```

- [ ] **Step 3: 运行全量测试**

Run: `cd petclaw-desktop && npx vitest run`

- [ ] **Step 4: 提交**

```bash
git add src/main/data/db.ts
git commit -m "feat(db): add v1→v3 schema migration for directory-driven architecture"
```

---

## Task 14: 全量测试 + 清理

**Files:**
- 所有 test 文件

- [ ] **Step 1: 运行类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

修复所有类型错误。

- [ ] **Step 2: 运行全量测试**

Run: `cd petclaw-desktop && npx vitest run`

修复所有失败的测试。

- [ ] **Step 3: 清理残留引用**

搜索并修复所有残留的 Agent 引用：

Run: `cd petclaw-desktop && grep -rn 'AgentManager\|agentManager\|agents-ipc\|agents:list\|agents:get\|agents:create\|agents:update\|agents:delete' src/ --include='*.ts' --include='*.tsx'`

- [ ] **Step 4: 更新 settings-migration.ts**

确保旧设置迁移逻辑仍然正常工作。

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "refactor: complete directory-driven architecture migration"
```

---

## Task 15: 文档同步

**Files:**
- Modify: `.ai/README.md`
- Modify: `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md`

按照 CLAUDE.md 要求，实现完成后同步文档。

- [ ] **Step 1: 更新 .ai/README.md**

更新架构描述，将 Agent 相关章节改为目录驱动描述。

- [ ] **Step 2: 更新 v3 spec §25 标记完成状态**

标记目录驱动重构的 Phase 为已完成。

- [ ] **Step 3: 提交**

```bash
git add .ai/README.md docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md
git commit -m "docs: sync directory-driven architecture to README and v3 spec"
```

---

## Verification

### 类型检查
- `npx tsc --noEmit` 全部通过

### 单元测试
- `npx vitest run` 全部通过

### 核心功能验证
- DirectoryManager.ensureRegistered(cwd) → directories 表自动注册 + agentId 正确
- 同一目录多次注册 → 幂等（不重复插入）
- ConfigSync → openclaw.json agents.list 包含 main + 所有注册目录
- SessionManager.createAndStart(title, cwd, prompt) → 自动派生 agentId，不需前端传入
- CoworkStore CRUD 正常（新表名 sessions/messages）
- IPC channel `directory:*` 正常响应
- Preload `window.api.directories.*` 类型正确
- IM 两层绑定：conversation 级 > instance 级 > main agent
- scheduled_task_meta 保存/查询正常

### 回归验证
- 宠物状态机 6 状态转换不变
- Hook 系统正常
- 托盘 + 全局快捷键正常
- BootCheck 3 步正常
- 模型/技能/MCP 管理不受影响