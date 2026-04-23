# PetClaw v3 Phase 1 — 基础架构重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PetClaw 的 Openclaw 通信从 v1 WebSocket 客户端重构为 v3 utilityProcess + GatewayClient 架构，实现 runtime 捆绑、进程管理、配置同步、会话管理、IPC 模块化。

**Architecture:** 主进程新增 EngineManager（进程管理）→ OpenclawGateway（GatewayClient 动态加载）→ CoworkController（事件路由）三层。ConfigSync 唯一写入 openclaw.json。CoworkStore 持久化会话到 SQLite。IPC 从单文件拆分为模块化。前端 Pet 窗口适配统一事件入口。

**Tech Stack:** Electron 33 (utilityProcess.fork) · better-sqlite3 · Zustand · TypeScript strict · Vitest

**参考实现:** LobsterAI `/Users/xiaoxuxuy/Desktop/工作/AI/开源项目/LobsterAI`（参考但不照抄，保持 PetClaw 特色）

**v3 Spec:** `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md`

---

## File Structure

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/main/ai/engine-manager.ts` | Openclaw runtime 检测、utilityProcess fork、健康检查、自动重启 |
| `src/main/ai/gateway.ts` | GatewayClient 动态加载、RPC/SSE 通信封装 |
| `src/main/ai/config-sync.ts` | 唯一写入 openclaw.json，聚合所有配置 |
| `src/main/ai/cowork-store.ts` | CoworkSession/Message SQLite 持久化 |
| `src/main/ai/cowork-controller.ts` | 会话执行控制、权限审批、流式事件 |
| `src/main/ai/session-manager.ts` | 会话生命周期管理（创建/恢复/删除） |
| `src/main/ai/types.ts` | 共享类型定义（PermissionRequest, CoworkRuntimeEvents 等） |
| `src/main/ipc/chat-ipc.ts` | 聊天相关 IPC handlers |
| `src/main/ipc/settings-ipc.ts` | 设置相关 IPC handlers |
| `src/main/ipc/window-ipc.ts` | 窗口操作 IPC handlers |
| `src/main/ipc/boot-ipc.ts` | BootCheck/Onboarding IPC handlers |
| `src/main/ipc/pet-ipc.ts` | Pet 窗口 IPC handlers |
| `src/main/ipc/index.ts` | 统一注册入口 |
| `src/main/pet/pet-event-bridge.ts` | 宠物动画事件聚合层 |
| `tests/main/ai/engine-manager.test.ts` | EngineManager 单元测试 |
| `tests/main/ai/config-sync.test.ts` | ConfigSync 单元测试 |
| `tests/main/ai/cowork-store.test.ts` | CoworkStore 单元测试 |
| `tests/main/ai/cowork-controller.test.ts` | CoworkController 单元测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/main/data/db.ts` | 新增 kv/cowork_sessions/cowork_messages 表 |
| `src/main/bootcheck.ts` | 删除 v1 逻辑，重写为调用 EngineManager + ConfigSync |
| `src/main/index.ts` | 启动流程重写为 v3 时序 |
| `src/main/database-path.ts` | 路径迁移到 `{userData}/petclaw.db` |
| `src/main/app-settings.ts` | 精简为常量定义，移除 JSON 文件读写 |
| `src/preload/index.ts` | 新增 v3 channels，删除 v1 channels |
| `src/preload/index.d.ts` | 类型定义同步更新 |
| `src/renderer/src/App.tsx` | Pet 窗口适配统一事件入口 |

### 删除文件

| 文件 | 原因 |
|------|------|
| `src/main/ai/openclaw.ts` | v1 WebSocket 客户端，被 OpenclawGateway 替代 |
| `src/main/ai/provider.ts` | v1 AIProvider 抽象层，v3 不需要 |

---

## Task 1: 数据库 Schema 扩展

**Files:**
- Modify: `src/main/data/db.ts`
- Test: `tests/main/data/db.test.ts`

- [ ] **Step 1: 写 kv 表测试**

```typescript
// tests/main/data/db.test.ts — 追加
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

describe('kv table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    // 调用 initDatabase 的 schema 部分
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  })

  it('should set and get a value', () => {
    const now = Date.now()
    db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)').run('theme', '"dark"', now)
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('theme') as { value: string }
    expect(JSON.parse(row.value)).toBe('dark')
  })

  it('should upsert on conflict', () => {
    const now = Date.now()
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)').run('port', '29890', now)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)').run('port', '18789', now + 1)
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('port') as { value: string }
    expect(row.value).toBe('18789')
  })
})

describe('cowork_sessions table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE IF NOT EXISTS cowork_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        claude_session_id TEXT,
        agent_id TEXT NOT NULL DEFAULT 'main',
        status TEXT NOT NULL DEFAULT 'idle',
        cwd TEXT NOT NULL,
        system_prompt TEXT NOT NULL DEFAULT '',
        model_override TEXT NOT NULL DEFAULT '',
        execution_mode TEXT NOT NULL DEFAULT 'local',
        active_skill_ids TEXT NOT NULL DEFAULT '[]',
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  })

  it('should create a session', () => {
    const now = Date.now()
    db.prepare(`INSERT INTO cowork_sessions (id, title, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('s1', 'Test', '/tmp', now, now)
    const row = db.prepare('SELECT * FROM cowork_sessions WHERE id = ?').get('s1') as Record<string, unknown>
    expect(row.title).toBe('Test')
    expect(row.status).toBe('idle')
    expect(row.execution_mode).toBe('local')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/data/db.test.ts`
Expected: 现有测试通过，新测试也应该通过（因为直接用内存 DB 建表）

- [ ] **Step 3: 在 db.ts 中添加新表 schema**

读取当前 `src/main/data/db.ts`，在 `initDatabase` 函数中追加建表语句：

```typescript
// 在现有 messages 表之后追加

// KV 配置存储（替代 petclaw-settings.json）
db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)

// Cowork 会话
db.exec(`
  CREATE TABLE IF NOT EXISTS cowork_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    claude_session_id TEXT,
    agent_id TEXT NOT NULL DEFAULT 'main',
    status TEXT NOT NULL DEFAULT 'idle',
    cwd TEXT NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '',
    model_override TEXT NOT NULL DEFAULT '',
    execution_mode TEXT NOT NULL DEFAULT 'local',
    active_skill_ids TEXT NOT NULL DEFAULT '[]',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)

// Cowork 消息
db.exec(`
  CREATE TABLE IF NOT EXISTS cowork_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
  )
`)

// 索引
db.exec(`CREATE INDEX IF NOT EXISTS idx_cowork_messages_session ON cowork_messages(session_id)`)
```

同时导出 kv 辅助函数：

```typescript
export function kvGet(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
  return row ? row.value : null
}

export function kvSet(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, Date.now())
}

export function kvGetAll(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM kv').all() as Array<{ key: string; value: string }>
  const result: Record<string, string> = {}
  for (const row of rows) result[row.key] = row.value
  return result
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/data/db.test.ts`

- [ ] **Step 5: 提交**

```bash
git add src/main/data/db.ts tests/main/data/db.test.ts
git commit -m "feat(db): add kv table and cowork session/message tables for v3"
```

---

## Task 2: 共享类型定义

**Files:**
- Create: `src/main/ai/types.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
// src/main/ai/types.ts
// v3 Cowork 共享类型（参考 LobsterAI agentEngine/types.ts，PetClaw 简化版）

export type CoworkExecutionMode = 'auto' | 'local' | 'sandbox'
export type CoworkSessionStatus = 'idle' | 'running' | 'completed' | 'error'
export type CoworkMessageType = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system'

export interface CoworkMessage {
  id: string
  type: CoworkMessageType
  content: string
  timestamp: number
  metadata?: CoworkMessageMetadata
}

export interface CoworkMessageMetadata {
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  toolUseId?: string | null
  error?: string
  isStreaming?: boolean
  skillIds?: string[]
  [key: string]: unknown
}

export interface CoworkSession {
  id: string
  title: string
  claudeSessionId: string | null
  status: CoworkSessionStatus
  pinned: boolean
  cwd: string
  systemPrompt: string
  modelOverride: string
  executionMode: CoworkExecutionMode
  activeSkillIds: string[]
  agentId: string
  messages: CoworkMessage[]
  createdAt: number
  updatedAt: number
}

export interface PermissionRequest {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId?: string | null
}

export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean }

export interface CoworkRuntimeEvents {
  message: (sessionId: string, message: CoworkMessage) => void
  messageUpdate: (sessionId: string, messageId: string, content: string) => void
  permissionRequest: (sessionId: string, request: PermissionRequest) => void
  complete: (sessionId: string, claudeSessionId: string | null) => void
  error: (sessionId: string, error: string) => void
  sessionStopped: (sessionId: string) => void
}

export interface CoworkStartOptions {
  skillIds?: string[]
  systemPrompt?: string
  autoApprove?: boolean
  workspaceRoot?: string
  confirmationMode?: 'modal' | 'text'
  agentId?: string
}

// EngineManager 状态
export type EnginePhase = 'not_installed' | 'starting' | 'ready' | 'error'

export interface EngineStatus {
  phase: EnginePhase
  version: string | null
  message: string
  canRetry: boolean
}

// Runtime 元数据
export interface RuntimeMetadata {
  root: string | null
  version: string | null
  expectedPathHint: string
}
```

- [ ] **Step 2: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add src/main/ai/types.ts
git commit -m "feat(types): add v3 cowork shared type definitions"
```

---

## Task 3: EngineManager — Runtime 检测与进程管理

**Files:**
- Create: `src/main/ai/engine-manager.ts`
- Test: `tests/main/ai/engine-manager.test.ts`

这是最核心的模块。参考 LobsterAI `openclawEngineManager.ts` 的设计，但做以下 PetClaw 定制：
- 目录名 `petmind/`（非 `cfmind/`）
- 路径基于 `app.getPath('userData')`
- 环境变量前缀用 `PETCLAW_` 而非 `LOBSTER_`
- 简化版无企业功能、无 token proxy

- [ ] **Step 1: 写 runtime 检测测试**

```typescript
// tests/main/ai/engine-manager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs'

// Mock electron — vitest.config.ts 已配置 alias
// 需要扩展 electron mock 支持 utilityProcess

describe('EngineManager', () => {
  describe('resolveRuntimeMetadata', () => {
    it('should detect packaged runtime at resources/petmind', () => {
      // 测试 app.isPackaged = true 时查找 process.resourcesPath/petmind/
      // 具体实现：创建临时目录模拟 runtime 结构
    })

    it('should detect dev runtime at vendor/openclaw-runtime/current', () => {
      // 测试 app.isPackaged = false 时查找 vendor 路径
    })

    it('should return null root when runtime not found', () => {
      // 测试找不到 runtime 时的降级
    })
  })

  describe('readRuntimeVersion', () => {
    it('should read version from package.json', () => {
      // 模拟 package.json 读取
    })

    it('should fallback to runtime-build-info.json', () => {
      // 模拟 package.json 缺失时的备选
    })
  })
})
```

注意：由于 EngineManager 深度依赖 Electron API（utilityProcess.fork、app.getPath 等），单元测试主要测试纯函数部分（路径解析、版本读取、端口扫描逻辑）。进程管理的集成测试在 Phase 4 E2E 中覆盖。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/engine-manager.test.ts`

- [ ] **Step 3: 实现 EngineManager**

创建 `src/main/ai/engine-manager.ts`，核心结构：

```typescript
// src/main/ai/engine-manager.ts
import { EventEmitter } from 'events'
import { app, utilityProcess } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

import type { EngineStatus, RuntimeMetadata } from './types'

const DEFAULT_OPENCLAW_VERSION = '2026.2.23'
const DEFAULT_GATEWAY_PORT = 18789
const GATEWAY_PORT_SCAN_LIMIT = 80
const GATEWAY_BOOT_TIMEOUT_MS = 300_000
const GATEWAY_MAX_RESTART_ATTEMPTS = 5
const GATEWAY_RESTART_DELAYS = [3000, 5000, 10000, 20000, 30000]
const HEALTH_CHECK_INTERVAL_MS = 600

export class OpenclawEngineManager extends EventEmitter {
  private baseDir: string          // {userData}/openclaw
  private stateDir: string         // {userData}/openclaw/state
  private logsDir: string          // {userData}/openclaw/state/logs（注意与 LobsterAI 路径差异）
  private gatewayTokenPath: string
  private gatewayPortPath: string
  private gatewayLogPath: string
  private configPath: string

  private gatewayProcess: Electron.UtilityProcess | null = null
  private shutdownRequested = false
  private restartAttempts = 0
  private restartTimer: NodeJS.Timeout | null = null

  status: EngineStatus
  private desiredVersion: string

  constructor() {
    super()
    const userDataPath = app.getPath('userData')
    this.baseDir = path.join(userDataPath, 'openclaw')
    this.stateDir = path.join(this.baseDir, 'state')
    this.logsDir = path.join(this.stateDir, 'logs')
    this.gatewayTokenPath = path.join(this.stateDir, 'gateway-token')
    this.gatewayPortPath = path.join(this.stateDir, 'gateway-port.json')
    this.gatewayLogPath = path.join(this.logsDir, 'gateway.log')
    this.configPath = path.join(this.stateDir, 'openclaw.json')

    for (const dir of [this.baseDir, this.stateDir, this.logsDir]) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const runtime = this.resolveRuntimeMetadata()
    this.desiredVersion = runtime.version || DEFAULT_OPENCLAW_VERSION

    this.status = runtime.root
      ? { phase: 'ready', version: this.desiredVersion, message: 'Runtime ready', canRetry: false }
      : { phase: 'not_installed', version: null, message: `Runtime not found: ${runtime.expectedPathHint}`, canRetry: true }
  }

  // --- 公开接口 ---

  async startGateway(): Promise<{ port: number; token: string }>
  // 1. resolveRuntimeMetadata → 找到 runtime root
  // 2. resolveGatewayEntry → 找到入口文件（gateway-bundle.mjs / openclaw.mjs / dist/entry.js）
  // 3. ensureGatewayToken → 复用或生成 48 字符 hex token
  // 4. resolveGatewayPort → 默认 18789，冲突则扫描
  // 5. buildEnv → 构建环境变量
  // 6. utilityProcess.fork() 或 spawn()（Windows）
  // 7. waitForGatewayReady → 轮询健康检查
  // 8. 监听 exit 事件 → 触发自动重启

  async stopGateway(): Promise<void>
  // shutdownRequested=true → kill → 超时 force kill

  getPort(): number | null
  getToken(): string | null
  getConfigPath(): string
  getStateDir(): string
  getBaseDir(): string

  // --- 私有方法 ---

  private resolveRuntimeMetadata(): RuntimeMetadata
  // packaged: process.resourcesPath/petmind
  // dev: app.getAppPath()/vendor/openclaw-runtime/current → realpathSync

  private resolveGatewayEntry(runtimeRoot: string): string | null
  // 候选链: gateway-bundle.mjs → openclaw.mjs → dist/entry.js

  private ensureGatewayToken(): string
  // 读文件 → 有则复用，无则 crypto.randomBytes(24).hex() 写入

  private async resolveGatewayPort(): Promise<number>
  // 尝试默认端口 → 已绑定端口 → 持久化端口 → 扫描

  private buildEnv(runtime: RuntimeMetadata, port: number, token: string): NodeJS.ProcessEnv
  // 构建 OPENCLAW_HOME, STATE_DIR, CONFIG_PATH 等

  private async waitForGatewayReady(port: number, timeoutMs: number): Promise<boolean>
  // 600ms 轮询 HTTP /health + TCP 探针

  private async isGatewayHealthy(port: number): Promise<boolean>
  // HTTP GET http://127.0.0.1:{port}/health → status < 500

  private scheduleRestart(): void
  // 指数退避重启，最多 5 次
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/engine-manager.test.ts`

- [ ] **Step 5: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 6: 提交**

```bash
git add src/main/ai/engine-manager.ts tests/main/ai/engine-manager.test.ts
git commit -m "feat(engine): add OpenclawEngineManager with runtime detection and process management"
```

---

## Task 4: ConfigSync — openclaw.json 生成

**Files:**
- Create: `src/main/ai/config-sync.ts`
- Test: `tests/main/ai/config-sync.test.ts`

PetClaw 特色：ConfigSync 比 LobsterAI 简单很多（无 10 个 IM 平台、无企业功能）。初始版本只聚合模型配置和基础 skills 路径。

- [ ] **Step 1: 写 ConfigSync 测试**

```typescript
// tests/main/ai/config-sync.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('ConfigSync', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-config-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should generate minimal openclaw.json on first sync', () => {
    // 测试首次生成配置文件
  })

  it('should preserve existing gateway/plugins fields', () => {
    // 测试保留 runtime 自注入的字段
  })

  it('should detect config changes', () => {
    // 测试内容相同时 changed=false
  })

  it('should atomic write (tmp + rename)', () => {
    // 测试写入不会产生损坏的中间状态
  })
})
```

- [ ] **Step 2: 实现 ConfigSync**

```typescript
// src/main/ai/config-sync.ts
import fs from 'fs'
import path from 'path'

export interface ConfigSyncDeps {
  getConfigPath: () => string
  getStateDir: () => string
  getModelConfig: () => { primary: string; providers: Record<string, unknown> }
  getSkillsExtraDirs: () => string[]
  getWorkspacePath: () => string
  collectSecretEnvVars: () => Record<string, string>
}

export interface ConfigSyncResult {
  ok: boolean
  changed: boolean
  configPath: string
  error?: string
}

export class ConfigSync {
  constructor(private deps: ConfigSyncDeps) {}

  sync(reason: string): ConfigSyncResult {
    const configPath = this.deps.getConfigPath()

    // 1. 读取现有配置（保留 runtime 自注入字段）
    const existing = this.readExistingConfig(configPath)

    // 2. 构建新配置
    const nextConfig = this.buildConfig(existing)

    // 3. 序列化并比较
    const nextContent = JSON.stringify(nextConfig, null, 2)
    const prevContent = this.readFileOrNull(configPath)

    if (nextContent === prevContent) {
      return { ok: true, changed: false, configPath }
    }

    // 4. 原子写入（tmp → rename）
    const tmpPath = `${configPath}.tmp-${Date.now()}`
    fs.writeFileSync(tmpPath, nextContent, 'utf8')
    fs.renameSync(tmpPath, configPath)

    return { ok: true, changed: true, configPath }
  }

  private buildConfig(existing: Record<string, unknown>): Record<string, unknown> {
    const model = this.deps.getModelConfig()
    return {
      // 保留 runtime 自注入的 gateway 字段
      gateway: existing.gateway ?? {
        mode: 'local',
        auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' }
      },
      models: {
        mode: 'replace',
        providers: model.providers
      },
      agents: {
        defaults: {
          timeoutSeconds: 3600,
          model: { primary: model.primary },
          workspace: this.deps.getWorkspacePath()
        }
      },
      skills: {
        load: {
          extraDirs: this.deps.getSkillsExtraDirs(),
          watch: true
        }
      },
      commands: { ownerAllowFrom: ['gateway-client', '*'] },
      // 保留 runtime 自注入的 plugins 字段
      plugins: existing.plugins ?? {}
    }
  }

  collectSecretEnvVars(): Record<string, string> {
    return this.deps.collectSecretEnvVars()
  }

  private readExistingConfig(configPath: string): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch {
      return {}
    }
  }

  private readFileOrNull(filePath: string): string | null {
    try { return fs.readFileSync(filePath, 'utf8') } catch { return null }
  }
}
```

- [ ] **Step 3-6: 运行测试、类型检查、提交**（同前）

---

## Task 5: CoworkStore — 会话持久化

**Files:**
- Create: `src/main/ai/cowork-store.ts`
- Test: `tests/main/ai/cowork-store.test.ts`

- [ ] **Step 1: 写 CoworkStore 测试**

核心测试场景：createSession、getSession、updateSession、addMessage、getMessages、resetRunningSessions

- [ ] **Step 2: 实现 CoworkStore**

```typescript
// src/main/ai/cowork-store.ts
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

import type {
  CoworkSession, CoworkMessage, CoworkExecutionMode,
  CoworkSessionStatus, CoworkMessageType, CoworkMessageMetadata
} from './types'

export class CoworkStore {
  constructor(private db: Database.Database) {}

  createSession(
    title: string,
    cwd: string,
    systemPrompt = '',
    executionMode: CoworkExecutionMode = 'local',
    activeSkillIds: string[] = [],
    agentId = 'main'
  ): CoworkSession { ... }

  getSession(id: string): CoworkSession | null { ... }

  getSessions(): CoworkSession[] { ... }

  updateSession(id: string, updates: Partial<Pick<CoworkSession,
    'title' | 'claudeSessionId' | 'status' | 'cwd' | 'systemPrompt' | 'modelOverride' | 'executionMode'
  >>): void { ... }

  deleteSession(id: string): void { ... }

  addMessage(sessionId: string, type: CoworkMessageType, content: string, metadata?: CoworkMessageMetadata): CoworkMessage { ... }

  updateMessageContent(id: string, content: string): void { ... }

  getMessages(sessionId: string): CoworkMessage[] { ... }

  resetRunningSessions(): void {
    // 启动时防御性重置：running → idle
    this.db.prepare(`UPDATE cowork_sessions SET status = 'idle', updated_at = ? WHERE status = 'running'`).run(Date.now())
  }

  getRecentWorkingDirs(limit = 8): string[] {
    // SELECT DISTINCT cwd FROM cowork_sessions ORDER BY updated_at DESC
  }
}
```

- [ ] **Step 3-6: 运行测试、类型检查、提交**

---

## Task 6: OpenclawGateway — GatewayClient 动态加载

**Files:**
- Create: `src/main/ai/gateway.ts`

GatewayClient 是从 runtime 的 `dist/plugin-sdk/gateway-runtime.js` 动态导入的，不在 PetClaw 代码中重新实现。

- [ ] **Step 1: 实现 OpenclawGateway**

```typescript
// src/main/ai/gateway.ts
import { EventEmitter } from 'events'

export class OpenclawGateway extends EventEmitter {
  private client: unknown = null
  private port: number
  private token: string

  constructor(port: number, token: string) {
    super()
    this.port = port
    this.token = token
  }

  async connect(runtimeRoot: string): Promise<void> {
    // 动态加载 GatewayClient
    // 候选路径：dist/plugin-sdk/gateway-runtime.js → dist/gateway/client.js
    const clientModule = await this.loadGatewayClient(runtimeRoot)
    this.client = new clientModule.GatewayClient({
      baseUrl: `http://127.0.0.1:${this.port}`,
      token: this.token
    })

    // 绑定 SSE 事件 → 转发为 EventEmitter 事件
    // exec.approval.requested → emit('permissionRequest')
    // chat 相关事件 → emit('message'/'messageUpdate'/'complete'/'error')
  }

  async chatSend(sessionKey: string, message: string, options?: Record<string, unknown>): Promise<void> {
    // client.request('chat.send', { sessionKey, message, ...options })
  }

  async approvalResolve(requestId: string, result: unknown): Promise<void> {
    // client.request('exec.approval.resolve', { requestId, result })
  }

  disconnect(): void {
    // client.close()
  }

  private async loadGatewayClient(runtimeRoot: string): Promise<{ GatewayClient: new (opts: unknown) => unknown }> {
    // 动态 import() — 不 require，因为是 ESM
    const candidates = [
      'dist/plugin-sdk/gateway-runtime.js',
      'dist/plugin-sdk/gateway-runtime.mjs',
      'dist/gateway/client.js'
    ]
    // 尝试每个候选路径
  }
}
```

- [ ] **Step 2: 类型检查、提交**

---

## Task 7: CoworkController — 事件路由与权限审批

**Files:**
- Create: `src/main/ai/cowork-controller.ts`
- Test: `tests/main/ai/cowork-controller.test.ts`

- [ ] **Step 1: 写 CoworkController 测试**

测试场景：startSession → 收到 message/messageUpdate/complete 事件、permissionRequest → respondToPermission 流程、executionMode 切换

- [ ] **Step 2: 实现 CoworkController**

```typescript
// src/main/ai/cowork-controller.ts
import { EventEmitter } from 'events'

import type { OpenclawGateway } from './gateway'
import type { CoworkStore } from './cowork-store'
import type {
  CoworkRuntimeEvents, CoworkStartOptions, PermissionResult,
  CoworkExecutionMode, CoworkMessage
} from './types'

export class CoworkController extends EventEmitter {
  private activeSessionIds = new Set<string>()

  constructor(
    private gateway: OpenclawGateway,
    private store: CoworkStore
  ) {
    super()
    this.bindGatewayEvents()
  }

  async startSession(sessionId: string, prompt: string, options?: CoworkStartOptions): Promise<void> {
    this.activeSessionIds.add(sessionId)
    this.store.updateSession(sessionId, { status: 'running' })
    // 添加 user message
    this.store.addMessage(sessionId, 'user', prompt)
    const msg = this.store.getMessages(sessionId).at(-1)!
    this.emit('message', sessionId, msg)
    // 发送到 Gateway
    await this.gateway.chatSend(sessionId, prompt, options)
  }

  async continueSession(sessionId: string, prompt: string): Promise<void> {
    // 类似 startSession，但不改 status
  }

  stopSession(sessionId: string): void {
    this.activeSessionIds.delete(sessionId)
    this.store.updateSession(sessionId, { status: 'idle' })
    this.emit('sessionStopped', sessionId)
  }

  respondToPermission(requestId: string, result: PermissionResult): void {
    this.gateway.approvalResolve(requestId, result)
  }

  setExecutionMode(mode: CoworkExecutionMode): void {
    // 更新默认执行模式
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessionIds.has(sessionId)
  }

  getActiveSessionCount(): number {
    return this.activeSessionIds.size
  }

  private bindGatewayEvents(): void {
    this.gateway.on('message', (sessionId: string, msg: CoworkMessage) => {
      this.store.addMessage(sessionId, msg.type, msg.content, msg.metadata)
      this.emit('message', sessionId, msg)
    })

    this.gateway.on('messageUpdate', (sessionId: string, msgId: string, content: string) => {
      this.store.updateMessageContent(msgId, content)
      this.emit('messageUpdate', sessionId, msgId, content)
    })

    this.gateway.on('permissionRequest', (sessionId: string, req: unknown) => {
      this.emit('permissionRequest', sessionId, req)
    })

    this.gateway.on('complete', (sessionId: string, claudeSessionId: string | null) => {
      this.activeSessionIds.delete(sessionId)
      this.store.updateSession(sessionId, { status: 'completed', claudeSessionId })
      this.emit('complete', sessionId, claudeSessionId)
    })

    this.gateway.on('error', (sessionId: string, error: string) => {
      this.activeSessionIds.delete(sessionId)
      this.store.updateSession(sessionId, { status: 'error' })
      this.emit('error', sessionId, error)
    })
  }
}
```

- [ ] **Step 3-6: 运行测试、类型检查、提交**

---

## Task 8: SessionManager — 会话生命周期

**Files:**
- Create: `src/main/ai/session-manager.ts`

SessionManager 是对 CoworkStore + CoworkController 的上层封装，提供面向 IPC 的简洁接口。

- [ ] **Step 1: 实现 SessionManager**

```typescript
// src/main/ai/session-manager.ts
import type { CoworkStore } from './cowork-store'
import type { CoworkController } from './cowork-controller'
import type { CoworkSession, CoworkStartOptions } from './types'

export class SessionManager {
  constructor(
    private store: CoworkStore,
    private controller: CoworkController
  ) {}

  createAndStart(title: string, cwd: string, prompt: string, options?: CoworkStartOptions): CoworkSession {
    const session = this.store.createSession(title, cwd, options?.systemPrompt, undefined, options?.skillIds, options?.agentId)
    this.controller.startSession(session.id, prompt, options)
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

  deleteSession(id: string): void {
    if (this.controller.isSessionActive(id)) {
      this.controller.stopSession(id)
    }
    this.store.deleteSession(id)
  }

  getRecentWorkingDirs(limit?: number): string[] {
    return this.store.getRecentWorkingDirs(limit)
  }
}
```

- [ ] **Step 2: 类型检查、提交**

---

## Task 9: IPC 模块化拆分

**Files:**
- Create: `src/main/ipc/chat-ipc.ts`, `settings-ipc.ts`, `window-ipc.ts`, `boot-ipc.ts`, `pet-ipc.ts`, `index.ts`
- Delete（后续）: `src/main/ipc.ts`（旧的单文件）

参考 LobsterAI 的 `constants + handlers(Deps) + index` 三件套模式，但 PetClaw 简化为 `handlers + index`（channel 名直接写在 handler 中，不单独拆 constants）。

- [ ] **Step 1: 创建 chat-ipc.ts**

```typescript
// src/main/ipc/chat-ipc.ts
import { ipcMain, BrowserWindow } from 'electron'

import type { SessionManager } from '../ai/session-manager'
import type { CoworkController } from '../ai/cowork-controller'

export interface ChatIpcDeps {
  sessionManager: SessionManager
  coworkController: CoworkController
  getChatWindow: () => BrowserWindow | null
  getPetWindow: () => BrowserWindow | null
}

export function registerChatIpcHandlers(deps: ChatIpcDeps): void {
  const { sessionManager, coworkController, getChatWindow, getPetWindow } = deps

  ipcMain.handle('chat:send', async (_event, message: string, cwd: string) => {
    const session = sessionManager.createAndStart('Chat', cwd, message)
    return { sessionId: session.id }
  })

  ipcMain.handle('chat:continue', async (_event, sessionId: string, message: string) => {
    sessionManager.continueSession(sessionId, message)
  })

  ipcMain.handle('chat:stop', async (_event, sessionId: string) => {
    sessionManager.stopSession(sessionId)
  })

  ipcMain.handle('chat:sessions', async () => {
    return sessionManager.getSessions()
  })

  ipcMain.handle('chat:session', async (_event, id: string) => {
    return sessionManager.getSession(id)
  })

  ipcMain.handle('chat:delete-session', async (_event, id: string) => {
    sessionManager.deleteSession(id)
  })

  // 流式事件转发到渲染进程
  coworkController.on('message', (sessionId, msg) => {
    getChatWindow()?.webContents.send('cowork:stream:message', { sessionId, message: msg })
  })

  coworkController.on('messageUpdate', (sessionId, msgId, content) => {
    getChatWindow()?.webContents.send('cowork:stream:messageUpdate', { sessionId, messageId: msgId, content })
  })

  coworkController.on('permissionRequest', (sessionId, req) => {
    getChatWindow()?.webContents.send('cowork:stream:permission', { sessionId, request: req })
  })

  coworkController.on('complete', (sessionId) => {
    getChatWindow()?.webContents.send('cowork:stream:complete', { sessionId })
  })

  coworkController.on('error', (sessionId, error) => {
    getChatWindow()?.webContents.send('cowork:stream:error', { sessionId, error })
  })

  // 权限审批响应
  ipcMain.handle('cowork:permission:respond', async (_event, requestId: string, result: unknown) => {
    coworkController.respondToPermission(requestId, result as any)
  })
}
```

- [ ] **Step 2: 创建 settings-ipc.ts**

```typescript
// src/main/ipc/settings-ipc.ts
import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'

import { kvGet, kvSet } from '../data/db'

export interface SettingsIpcDeps {
  db: Database.Database
}

export function registerSettingsIpcHandlers(deps: SettingsIpcDeps): void {
  ipcMain.handle('settings:get', async (_event, key: string) => {
    return kvGet(deps.db, key)
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    kvSet(deps.db, key, value)
  })
}
```

- [ ] **Step 3: 创建 window-ipc.ts, boot-ipc.ts, pet-ipc.ts**

（类似结构，从旧 ipc.ts 迁移对应逻辑）

- [ ] **Step 4: 创建 index.ts 统一入口**

```typescript
// src/main/ipc/index.ts
import { registerChatIpcHandlers, type ChatIpcDeps } from './chat-ipc'
import { registerSettingsIpcHandlers, type SettingsIpcDeps } from './settings-ipc'
import { registerWindowIpcHandlers, type WindowIpcDeps } from './window-ipc'
import { registerBootIpcHandlers, type BootIpcDeps } from './boot-ipc'
import { registerPetIpcHandlers, type PetIpcDeps } from './pet-ipc'

export interface AllIpcDeps extends ChatIpcDeps, SettingsIpcDeps, WindowIpcDeps, BootIpcDeps, PetIpcDeps {}

export function registerAllIpcHandlers(deps: AllIpcDeps): void {
  registerChatIpcHandlers(deps)
  registerSettingsIpcHandlers(deps)
  registerWindowIpcHandlers(deps)
  registerBootIpcHandlers(deps)
  registerPetIpcHandlers(deps)
}
```

- [ ] **Step 5: 类型检查、提交**

---

## Task 10: Preload + 类型定义更新

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: 更新 preload/index.ts**

新增 v3 channels，保留兼容的 v1 channels（逐步迁移）。关键新增：

```typescript
// v3 新增
cowork: {
  send: (message: string, cwd: string) => ipcRenderer.invoke('chat:send', message, cwd),
  continue: (sessionId: string, message: string) => ipcRenderer.invoke('chat:continue', sessionId, message),
  stop: (sessionId: string) => ipcRenderer.invoke('chat:stop', sessionId),
  sessions: () => ipcRenderer.invoke('chat:sessions'),
  session: (id: string) => ipcRenderer.invoke('chat:session', id),
  deleteSession: (id: string) => ipcRenderer.invoke('chat:delete-session', id),
  respondPermission: (requestId: string, result: unknown) => ipcRenderer.invoke('cowork:permission:respond', requestId, result),

  // 流式事件订阅（统一返回 unsubscribe 函数）
  onMessage: (cb: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => cb(data)
    ipcRenderer.on('cowork:stream:message', handler)
    return () => ipcRenderer.removeListener('cowork:stream:message', handler)
  },
  onMessageUpdate: (cb: (data: unknown) => void) => { /* 同上 */ },
  onPermission: (cb: (data: unknown) => void) => { /* 同上 */ },
  onComplete: (cb: (data: unknown) => void) => { /* 同上 */ },
  onError: (cb: (data: unknown) => void) => { /* 同上 */ },
},

// Pet 窗口统一入口
pet: {
  onStateEvent: (cb: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => cb(data)
    ipcRenderer.on('pet:state-event', handler)
    return () => ipcRenderer.removeListener('pet:state-event', handler)
  },
  onBubble: (cb: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => cb(data)
    ipcRenderer.on('pet:bubble', handler)
    return () => ipcRenderer.removeListener('pet:bubble', handler)
  },
},

// Engine 状态
engine: {
  onStatus: (cb: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown) => cb(status)
    ipcRenderer.on('engine:status', handler)
    return () => ipcRenderer.removeListener('engine:status', handler)
  },
},
```

- [ ] **Step 2: 同步更新 preload/index.d.ts**

- [ ] **Step 3: 类型检查、提交**

---

## Task 11: PetEventBridge — 宠物动画事件聚合

**Files:**
- Create: `src/main/pet/pet-event-bridge.ts`

- [ ] **Step 1: 实现 PetEventBridge**

```typescript
// src/main/pet/pet-event-bridge.ts
import { BrowserWindow } from 'electron'

import type { CoworkController } from '../ai/cowork-controller'

type PetEvent = 'ChatSent' | 'AIResponding' | 'AIDone' | 'HookActive' | 'HookIdle'
  | 'DragStart' | 'DragEnd' | 'SleepStart' | 'WakeUp'

export class PetEventBridge {
  private activeSessionCount = 0
  private firstResponseSent = new Set<string>()

  constructor(
    private petWindow: BrowserWindow,
    private coworkController: CoworkController
  ) {
    this.bindEvents()
  }

  private bindEvents(): void {
    this.coworkController.on('message', (sessionId, msg) => {
      if (msg.type === 'user') {
        this.activeSessionCount++
        if (this.activeSessionCount === 1) {
          this.sendPetEvent('ChatSent', 'chat')
        }
      }
    })

    this.coworkController.on('messageUpdate', (sessionId, _msgId, content) => {
      if (!this.firstResponseSent.has(sessionId)) {
        this.firstResponseSent.add(sessionId)
        this.sendPetEvent('AIResponding', 'chat')
      }
      // 气泡文本
      this.sendBubble(content.slice(-50), 'chat')
    })

    this.coworkController.on('complete', (sessionId) => {
      this.firstResponseSent.delete(sessionId)
      this.activeSessionCount = Math.max(0, this.activeSessionCount - 1)
      if (this.activeSessionCount === 0) {
        this.sendPetEvent('AIDone', 'chat')
      }
    })

    this.coworkController.on('error', (sessionId) => {
      this.firstResponseSent.delete(sessionId)
      this.activeSessionCount = Math.max(0, this.activeSessionCount - 1)
      if (this.activeSessionCount === 0) {
        this.sendPetEvent('AIDone', 'chat')
      }
    })

    this.coworkController.on('permissionRequest', (_sessionId, req) => {
      this.sendBubble(`等待审批：${(req as any).toolName}`, 'approval')
    })
  }

  private sendPetEvent(event: PetEvent, source: string): void {
    this.petWindow.webContents.send('pet:state-event', { event, source })
  }

  private sendBubble(text: string, source: string): void {
    this.petWindow.webContents.send('pet:bubble', { text, source })
  }
}
```

- [ ] **Step 2: 类型检查、提交**

---

## Task 12: Bootcheck 重写

**Files:**
- Modify: `src/main/bootcheck.ts`

v1 bootcheck 881 行，包含 Node.js 安装、npm install、Gateway 启动等。v3 大幅简化：只做目录创建 + Skills 同步 + EngineManager 启动。

- [ ] **Step 1: 重写 bootcheck.ts**

保留 `BootStep` 接口和进度汇报机制（BootCheckPanel.tsx 依赖），但步骤从 6 个减为 3 个：

```typescript
export interface BootStep {
  id: 'env' | 'engine' | 'connect'
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
}

export async function runBootCheck(
  chatWindow: BrowserWindow,
  engineManager: OpenclawEngineManager,
  configSync: ConfigSync,
  db: Database.Database
): Promise<{ success: boolean; port?: number; token?: string }> {
  // Step 1: env — 创建目录结构 + Skills 同步
  // Step 2: engine — ConfigSync.sync('boot') + EngineManager.startGateway()
  // Step 3: connect — 验证 Gateway 健康
}
```

- [ ] **Step 2: 更新 BootCheckPanel.tsx 中的步骤 ID 映射**（如果需要）

- [ ] **Step 3: 运行现有 bootcheck 测试、类型检查、提交**

---

## Task 13: index.ts 启动流程重写

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 重写 app.whenReady() 内的启动序列**

```typescript
// 新启动流程（v3 §21 时序）
app.whenReady().then(async () => {
  // 1. 数据库初始化
  const dbPath = resolveDatabasePath({ ... })
  const db = initDatabase(dbPath)

  // 2. CoworkStore 防御性重置
  const coworkStore = new CoworkStore(db)
  coworkStore.resetRunningSessions()

  // 3. EngineManager 初始化
  const engineManager = new OpenclawEngineManager()

  // 4. ConfigSync 初始化
  const configSync = new ConfigSync({ ... })

  // 5. 创建 Chat 窗口（尽早显示 loading UI）
  const chatWindow = createChatWindow()

  // 6. 注册早期 IPC（boot、settings）
  registerBootIpcHandlers({ ... })
  registerSettingsIpcHandlers({ db })

  // 7. 等待窗口 ready-to-show
  await new Promise<void>(r => chatWindow.once('ready-to-show', () => { chatWindow.show(); r() }))

  // 8. 运行 BootCheck（进度通知到 BootCheckPanel）
  const bootResult = await runBootCheck(chatWindow, engineManager, configSync, db)

  // 9. 如果 boot 成功
  if (bootResult.success) {
    // 10. 创建 Gateway + CoworkController
    const gateway = new OpenclawGateway(bootResult.port!, bootResult.token!)
    await gateway.connect(engineManager.getRuntimeRoot()!)
    const coworkController = new CoworkController(gateway, coworkStore)
    const sessionManager = new SessionManager(coworkStore, coworkController)

    // 11. 创建 Pet 窗口
    // app:pet-ready → createPetWindow → PetEventBridge

    // 12. 注册完整 IPC
    registerAllIpcHandlers({ sessionManager, coworkController, ... })

    // 13. HookServer 启动
    // 14. 通知 boot:complete
  }
})
```

- [ ] **Step 2: 类型检查**
- [ ] **Step 3: 提交**

---

## Task 14: Pet 窗口适配

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: 将分散的 IPC 监听改为统一入口**

```typescript
// 旧代码（多个 onXxx 监听）：
// api.onChatSent → send ChatSent
// api.onAIResponding → send AIResponding
// api.onChatDone → send AIDone
// api.onChatError → send AIDone

// 新代码（统一 pet:state-event）：
useEffect(() => {
  const unsub = window.api.pet.onStateEvent((data: { event: string; source: string }) => {
    machine.send(data.event)
  })
  return unsub
}, [machine])

useEffect(() => {
  const unsub = window.api.pet.onBubble((data: { text: string; source: string }) => {
    setBubbleText(data.text)
  })
  return unsub
}, [])
```

- [ ] **Step 2: 保留 v1 兼容监听（渐进迁移）**

在 preload 中保留 v1 channel，让旧代码继续工作。新代码优先走 v3 channel。

- [ ] **Step 3: 类型检查、提交**

---

## Task 15: 清理旧代码

**Files:**
- Delete: `src/main/ai/openclaw.ts`
- Delete: `src/main/ai/provider.ts`
- Modify: `package.json` — 移除 `ws` 依赖

- [ ] **Step 1: 删除旧文件**

```bash
rm src/main/ai/openclaw.ts src/main/ai/provider.ts
```

- [ ] **Step 2: 清理旧 ipc.ts 中的导入引用**

- [ ] **Step 3: 移除 ws 依赖**

```bash
cd petclaw-desktop && pnpm remove ws @types/ws
```

- [ ] **Step 4: 类型检查确保无残留引用**

Run: `npx tsc --noEmit`

- [ ] **Step 5: 运行全量测试**

Run: `npx vitest run`

- [ ] **Step 6: 提交**

```bash
git commit -m "refactor: remove v1 WebSocket client and AIProvider abstraction"
```

---

## Task 16: v1 数据迁移

**Files:**
- Modify: `src/main/database-path.ts`
- Create: `src/main/data/settings-migration.ts`

- [ ] **Step 1: 实现 petclaw-settings.json → DB kv 迁移**

```typescript
// src/main/data/settings-migration.ts
import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'

import { kvSet } from './db'

export function migrateSettingsToKv(db: Database.Database, oldSettingsPath: string): void {
  if (!fs.existsSync(oldSettingsPath)) return

  try {
    const settings = JSON.parse(fs.readFileSync(oldSettingsPath, 'utf8'))
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined && value !== null) {
        kvSet(db, key, JSON.stringify(value))
      }
    }
    // 迁移完成后重命名（不删除，留作备份）
    fs.renameSync(oldSettingsPath, oldSettingsPath + '.migrated')
  } catch {
    // 迁移失败不阻塞启动
  }
}
```

- [ ] **Step 2: 更新 database-path.ts**

调整迁移路径：`{userData}/petclaw.db`（而非 `~/.petclaw/data/petclaw.db`）

- [ ] **Step 3: 在 index.ts 启动流程中调用迁移**

- [ ] **Step 4: 测试、类型检查、提交**

---

## Verification

### 手动验证
1. `cd petclaw-desktop && npx tsc --noEmit` — 类型检查通过
2. `npx vitest run` — 全量测试通过
3. 开发模式启动 `npm run dev`：
   - BootCheckPanel 显示 3 步（env → engine → connect）
   - Gateway 通过 utilityProcess 成功启动
   - 发送消息 → 流式回复 → 宠物 Thinking → Working → Happy → Idle
   - 关闭重启 → 数据不丢失（SQLite 持久化）

### 回归验证
- 宠物状态机 6 状态转换不变
- Hook 系统正常工作
- 托盘 + 全局快捷键正常
- 窗口位置记忆正常（改为从 DB kv 读取）

### 关键检查点
- `openclaw.json` 只由 ConfigSync 写入，无其他模块直接写
- API Key 不出现在 openclaw.json（通过 `${VAR}` 占位符 + 环境变量注入）
- IPC channel 三处同步（ipc/*.ts + preload/index.ts + preload/index.d.ts）
- v1 数据迁移：petclaw-settings.json → DB kv 表
