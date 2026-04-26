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
    const row = db
      .prepare('SELECT * FROM directories WHERE agent_id = ?')
      .get('ws-abc123') as Record<string, unknown>
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
      db
        .prepare(
          'INSERT INTO directories (agent_id, path, created_at, updated_at) VALUES (?, ?, ?, ?)'
        )
        .run('ws-bbb', '/tmp/a', now, now)
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
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('s1') as Record<
      string,
      unknown
    >
    expect(row.directory_path).toBe('/tmp/proj')
    expect(row.agent_id).toBe('ws-abc123')
    expect(row.status).toBe('idle')
  })
})

describe('messages table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('should insert and query messages by session', () => {
    const now = Date.now()
    // Create session first (FK dependency)
    db.prepare(
      `INSERT INTO sessions (id, title, directory_path, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('s1', 'Test', '/tmp', 'ws-abc', now, now)
    db.prepare(
      'INSERT INTO messages (id, session_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('m1', 's1', 'user', 'hello', now)
    const msgs = db.prepare('SELECT * FROM messages WHERE session_id = ?').all('s1') as Record<
      string,
      unknown
    >[]
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('hello')
  })

  it('should cascade delete messages when session deleted', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO sessions (id, title, directory_path, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('s1', 'Test', '/tmp', 'ws-abc', now, now)
    db.prepare(
      'INSERT INTO messages (id, session_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('m1', 's1', 'user', 'hello', now)
    db.prepare('DELETE FROM sessions WHERE id = ?').run('s1')
    const msgs = db.prepare('SELECT * FROM messages WHERE session_id = ?').all('s1')
    expect(msgs).toHaveLength(0)
  })
})

describe('im_instances table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('should insert an IM instance', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO im_instances (id, platform, credentials, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('inst-1', 'dingtalk', '{"appKey":"abc"}', now, now)
    const row = db.prepare('SELECT * FROM im_instances WHERE id = ?').get('inst-1') as Record<
      string,
      unknown
    >
    expect(row.platform).toBe('dingtalk')
    expect(row.enabled).toBe(1)
  })
})

describe('im_conversation_bindings table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('should bind a conversation to a directory', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO im_instances (id, platform, credentials, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('inst-1', 'dingtalk', '{}', now, now)
    db.prepare(
      `INSERT INTO im_conversation_bindings (conversation_id, instance_id, peer_kind, directory_path, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('conv-1', 'inst-1', 'group', '/tmp/proj', 'ws-abc', now, now)
    const row = db
      .prepare(
        'SELECT * FROM im_conversation_bindings WHERE conversation_id = ? AND instance_id = ?'
      )
      .get('conv-1', 'inst-1') as Record<string, unknown>
    expect(row.directory_path).toBe('/tmp/proj')
  })
})

describe('im_session_mappings table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('should insert a session mapping', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO im_instances (id, platform, credentials, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('inst-1', 'dingtalk', '{}', now, now)
    db.prepare(
      `INSERT INTO sessions (id, title, directory_path, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('sess-1', 'Test', '/tmp', 'main', now, now)
    db.prepare(
      `INSERT INTO im_session_mappings (conversation_id, instance_id, session_id, agent_id, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('conv-1', 'inst-1', 'sess-1', 'main', now, now)
    const row = db
      .prepare('SELECT * FROM im_session_mappings WHERE conversation_id = ? AND instance_id = ?')
      .get('conv-1', 'inst-1') as Record<string, unknown>
    expect(row.session_id).toBe('sess-1')
  })
})

describe('mcp_servers table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('should create an mcp server', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO mcp_servers (id, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('m1', 'test-server', '{"command":"npx"}', now, now)
    const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get('m1') as Record<
      string,
      unknown
    >
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

describe('migrateIfNeeded', () => {
  it('should skip migration on fresh install', () => {
    const db = new Database(':memory:')
    initDatabase(db)
    // 验证新表存在即可
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
    expect(tables.map((t) => t.name)).toContain('app_config')
    expect(tables.map((t) => t.name)).toContain('directories')
    db.close()
  })

  it('should migrate kv to app_config', () => {
    const db = new Database(':memory:')
    // 先手动创建旧 kv 表
    db.exec(
      'CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)'
    )
    db.exec("INSERT INTO kv VALUES ('theme', '\"dark\"', 1000)")
    // initDatabase 内部会触发迁移
    initDatabase(db)
    // kv 应该被删除
    const hasKv = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kv'")
      .get()
    expect(hasKv).toBeUndefined()
    // 数据应迁移到 app_config
    const row = db.prepare("SELECT value FROM app_config WHERE key = 'theme'").get() as
      | { value: string }
      | undefined
    expect(row).toBeDefined()
    expect(row!.value).toBe('"dark"')
    db.close()
  })

  it('should drop old agents table', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT)')
    db.exec("INSERT INTO agents VALUES ('a1', 'Test Agent')")
    initDatabase(db)
    const hasAgents = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'")
      .get()
    expect(hasAgents).toBeUndefined()
    db.close()
  })

  it('should migrate cowork_sessions to sessions', () => {
    const db = new Database(':memory:')
    // 创建旧 cowork_sessions 表
    db.exec(`CREATE TABLE cowork_sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, claude_session_id TEXT,
      agent_id TEXT NOT NULL DEFAULT 'main', status TEXT NOT NULL DEFAULT 'idle',
      cwd TEXT NOT NULL, model_override TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`)
    db.exec(
      "INSERT INTO cowork_sessions (id, title, cwd, created_at, updated_at) VALUES ('s1', 'Test', '/tmp', 1000, 1000)"
    )
    initDatabase(db)
    const hasOld = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cowork_sessions'")
      .get()
    expect(hasOld).toBeUndefined()
    const row = db.prepare("SELECT * FROM sessions WHERE id = 's1'").get() as Record<
      string,
      unknown
    >
    expect(row).toBeDefined()
    expect(row.directory_path).toBe('/tmp')
    db.close()
  })

  it('should migrate cowork_messages to messages', () => {
    const db = new Database(':memory:')
    // 创建旧的 cowork_sessions 和 cowork_messages 表
    db.exec(`CREATE TABLE cowork_sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, claude_session_id TEXT,
      agent_id TEXT NOT NULL DEFAULT 'main', status TEXT NOT NULL DEFAULT 'idle',
      cwd TEXT NOT NULL, model_override TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`)
    db.exec(
      "INSERT INTO cowork_sessions (id, title, cwd, created_at, updated_at) VALUES ('s1', 'Test', '/tmp', 1000, 1000)"
    )
    db.exec(`CREATE TABLE cowork_messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
      content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', timestamp INTEGER NOT NULL
    )`)
    db.exec("INSERT INTO cowork_messages VALUES ('m1', 's1', 'user', 'hello', '{}', 2000)")
    initDatabase(db)
    const hasOld = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cowork_messages'")
      .get()
    expect(hasOld).toBeUndefined()
    const row = db.prepare("SELECT * FROM messages WHERE id = 'm1'").get() as Record<
      string,
      unknown
    >
    expect(row).toBeDefined()
    expect(row.content).toBe('hello')
    expect(row.created_at).toBe(2000)
    db.close()
  })

  it('should drop v1 messages table with role column and recreate', () => {
    const db = new Database(':memory:')
    // 需要一个旧表来触发迁移流程
    db.exec('CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT)')
    // 创建 v1 版本的 messages 表（有 role 列）
    db.exec(`CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL
    )`)
    db.exec("INSERT INTO messages VALUES ('m1', 's1', 'user', 'old msg')")
    initDatabase(db)
    // 旧数据应被清除，表结构应更新为含 type 列
    const cols = db.prepare("PRAGMA table_info('messages')").all() as Array<{ name: string }>
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('type')
    expect(colNames).not.toContain('role')
    // 旧数据不保留
    const rows = db.prepare('SELECT * FROM messages').all()
    expect(rows).toHaveLength(0)
    db.close()
  })
})

describe('scheduled_task_meta table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('should insert task metadata', () => {
    db.prepare(
      `INSERT INTO scheduled_task_meta (task_id, directory_path, agent_id, origin, binding) VALUES (?, ?, ?, ?, ?)`
    ).run('task-1', '/tmp/proj', 'ws-abc', 'cron', null)
    const row = db
      .prepare('SELECT * FROM scheduled_task_meta WHERE task_id = ?')
      .get('task-1') as Record<string, unknown>
    expect(row.directory_path).toBe('/tmp/proj')
  })
})
