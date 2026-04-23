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

describe('im_config table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should set and get a single platform config', () => {
    const now = Date.now()
    // 直接写入单一平台 key
    db.prepare('INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)').run(
      'dingtalk',
      '{"appKey":"abc"}',
      now
    )
    const row = db.prepare('SELECT * FROM im_config WHERE key = ?').get('dingtalk') as Record<
      string,
      unknown
    >
    expect(row.value).toBe('{"appKey":"abc"}')
  })

  it('should support multi-instance keys like platform:instance-id', () => {
    const now = Date.now()
    // 多实例 key 格式：平台:实例ID
    db.prepare('INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)').run(
      'dingtalk:instance-1',
      '{"appKey":"k1"}',
      now
    )
    db.prepare('INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)').run(
      'dingtalk:instance-2',
      '{"appKey":"k2"}',
      now
    )
    const rows = db.prepare("SELECT * FROM im_config WHERE key LIKE 'dingtalk:%'").all() as Record<
      string,
      unknown
    >[]
    expect(rows).toHaveLength(2)
  })

  it('should upsert on conflict', () => {
    const now = Date.now()
    db.prepare('INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)').run(
      'feishu',
      '{"v":1}',
      now
    )
    db.prepare('INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)').run(
      'feishu',
      '{"v":2}',
      now
    )
    const row = db.prepare('SELECT value FROM im_config WHERE key = ?').get('feishu') as Record<
      string,
      unknown
    >
    expect(row.value).toBe('{"v":2}')
  })
})

describe('im_session_mappings table', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should insert and query a session mapping', () => {
    const now = Date.now()
    db.prepare(
      'INSERT INTO im_session_mappings (im_conversation_id, platform, cowork_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('conv-001', 'dingtalk', 'sess-abc', now, now)
    const row = db
      .prepare('SELECT * FROM im_session_mappings WHERE im_conversation_id = ? AND platform = ?')
      .get('conv-001', 'dingtalk') as Record<string, unknown>
    expect(row.cowork_session_id).toBe('sess-abc')
    // agent_id 应有默认值 'main'
    expect(row.agent_id).toBe('main')
  })

  it('should enforce composite primary key uniqueness', () => {
    const now = Date.now()
    db.prepare(
      'INSERT INTO im_session_mappings (im_conversation_id, platform, cowork_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('conv-001', 'dingtalk', 'sess-abc', now, now)
    // 相同 (im_conversation_id, platform) 组合不可重复插入
    expect(() => {
      db.prepare(
        'INSERT INTO im_session_mappings (im_conversation_id, platform, cowork_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run('conv-001', 'dingtalk', 'sess-xyz', now, now)
    }).toThrow()
  })

  it('should allow same conversation id on different platforms', () => {
    const now = Date.now()
    // 同一 IM 会话 ID 在不同平台可以独立映射
    db.prepare(
      'INSERT INTO im_session_mappings (im_conversation_id, platform, cowork_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('conv-001', 'dingtalk', 'sess-1', now, now)
    db.prepare(
      'INSERT INTO im_session_mappings (im_conversation_id, platform, cowork_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('conv-001', 'feishu', 'sess-2', now, now)
    const rows = db
      .prepare('SELECT * FROM im_session_mappings WHERE im_conversation_id = ?')
      .all('conv-001') as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
  })
})
