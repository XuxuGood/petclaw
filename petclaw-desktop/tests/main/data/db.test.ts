import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  initDatabase,
  saveMessage,
  getMessages,
  kvGet,
  kvSet,
  kvGetAll
} from '../../../src/main/data/db'

describe('Database', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('messages', () => {
    it('saves and retrieves a message', () => {
      saveMessage(db, { role: 'user', content: 'hello' })
      const messages = getMessages(db, 10)
      expect(messages).toHaveLength(1)
      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('hello')
    })

    it('returns messages in chronological order', () => {
      saveMessage(db, { role: 'user', content: 'first' })
      saveMessage(db, { role: 'assistant', content: 'second' })
      const messages = getMessages(db, 10)
      expect(messages[0].content).toBe('first')
      expect(messages[1].content).toBe('second')
    })

    it('respects limit parameter', () => {
      saveMessage(db, { role: 'user', content: 'a' })
      saveMessage(db, { role: 'user', content: 'b' })
      saveMessage(db, { role: 'user', content: 'c' })
      const messages = getMessages(db, 2)
      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe('b')
      expect(messages[1].content).toBe('c')
    })
  })

  describe('kv table', () => {
    it('should set and get a value via kvSet/kvGet', () => {
      kvSet(db, 'theme', '"dark"')
      const val = kvGet(db, 'theme')
      expect(val).toBe('"dark"')
    })

    it('should return null for missing key', () => {
      expect(kvGet(db, 'nonexistent')).toBeNull()
    })

    it('should upsert on conflict', () => {
      kvSet(db, 'port', '29890')
      kvSet(db, 'port', '18789')
      expect(kvGet(db, 'port')).toBe('18789')
    })

    it('should get all kv pairs', () => {
      kvSet(db, 'a', '1')
      kvSet(db, 'b', '2')
      const all = kvGetAll(db)
      expect(all).toEqual({ a: '1', b: '2' })
    })
  })

  describe('cowork_sessions table', () => {
    it('should create a session with defaults', () => {
      const now = Date.now()
      db.prepare(
        'INSERT INTO cowork_sessions (id, title, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run('s1', 'Test', '/tmp', now, now)
      const row = db.prepare('SELECT * FROM cowork_sessions WHERE id = ?').get('s1') as Record<
        string,
        unknown
      >
      expect(row.title).toBe('Test')
      expect(row.status).toBe('idle')
      expect(row.agent_id).toBe('main')
      expect(row.execution_mode).toBe('local')
      expect(row.pinned).toBe(0)
    })
  })

  describe('cowork_messages table', () => {
    it('should insert and query messages by session', () => {
      const now = Date.now()
      db.prepare(
        'INSERT INTO cowork_sessions (id, title, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run('s1', 'Test', '/tmp', now, now)
      db.prepare(
        'INSERT INTO cowork_messages (id, session_id, type, content, timestamp) VALUES (?, ?, ?, ?, ?)'
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
        'INSERT INTO cowork_sessions (id, title, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run('s1', 'Test', '/tmp', now, now)
      db.prepare(
        'INSERT INTO cowork_messages (id, session_id, type, content, timestamp) VALUES (?, ?, ?, ?, ?)'
      ).run('m1', 's1', 'user', 'hello', now)
      db.prepare('DELETE FROM cowork_sessions WHERE id = ?').run('s1')
      const msgs = db.prepare('SELECT * FROM cowork_messages WHERE session_id = ?').all('s1')
      expect(msgs).toHaveLength(0)
    })
  })
})

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
    db.prepare(`INSERT INTO agents (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
      'main',
      '默认助手',
      now,
      now
    )
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get('main') as Record<
      string,
      unknown
    >
    expect(row.name).toBe('默认助手')
    expect(row.enabled).toBe(1)
    expect(row.is_default).toBe(0)
    expect(row.source).toBe('custom')
    expect(row.skill_ids).toBe('[]')
  })

  it('should enforce primary key uniqueness', () => {
    const now = Date.now()
    db.prepare(`INSERT INTO agents (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
      'a1',
      'Agent',
      now,
      now
    )
    expect(() => {
      db.prepare(`INSERT INTO agents (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
        'a1',
        'Dup',
        now,
        now
      )
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
