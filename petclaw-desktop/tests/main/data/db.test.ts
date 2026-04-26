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
    expect(names).toContain('cowork_sessions')
    expect(names).toContain('cowork_messages')
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
    expect(names).toContain('idx_cowork_messages_session')
    expect(names).toContain('idx_cowork_sessions_agent')
    expect(names).toContain('idx_cowork_sessions_directory')
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

describe('cowork_sessions table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('should insert with directory_path and agent_id', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO cowork_sessions (id, title, directory_path, agent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('s1', 'Test', '/tmp/proj', 'ws-abc123', now, now)
    const row = db.prepare('SELECT * FROM cowork_sessions WHERE id = ?').get('s1') as Record<
      string,
      unknown
    >
    expect(row.directory_path).toBe('/tmp/proj')
    expect(row.agent_id).toBe('ws-abc123')
    expect(row.status).toBe('idle')
  })
})

describe('cowork_messages table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('should insert and query messages by session', () => {
    const now = Date.now()
    // Create session first (FK dependency)
    db.prepare(
      `INSERT INTO cowork_sessions (id, title, directory_path, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('s1', 'Test', '/tmp', 'ws-abc', now, now)
    db.prepare(
      'INSERT INTO cowork_messages (id, session_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('m1', 's1', 'user', 'hello', now)
    const msgs = db
      .prepare('SELECT * FROM cowork_messages WHERE session_id = ?')
      .all('s1') as Record<string, unknown>[]
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('hello')
  })

  it('should cascade delete messages when session deleted', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO cowork_sessions (id, title, directory_path, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('s1', 'Test', '/tmp', 'ws-abc', now, now)
    db.prepare(
      'INSERT INTO cowork_messages (id, session_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('m1', 's1', 'user', 'hello', now)
    db.prepare('DELETE FROM cowork_sessions WHERE id = ?').run('s1')
    const msgs = db.prepare('SELECT * FROM cowork_messages WHERE session_id = ?').all('s1')
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
      `INSERT INTO cowork_sessions (id, title, directory_path, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
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

describe('scheduled_task_meta table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('should insert task metadata', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO scheduled_task_meta (task_id, directory_path, agent_id, origin, binding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('task-1', '/tmp/proj', 'ws-abc', 'cron', null, now, now)
    const row = db
      .prepare('SELECT * FROM scheduled_task_meta WHERE task_id = ?')
      .get('task-1') as Record<string, unknown>
    expect(row.directory_path).toBe('/tmp/proj')
    expect(row.created_at).toBe(now)
    expect(row.updated_at).toBe(now)
  })
})
