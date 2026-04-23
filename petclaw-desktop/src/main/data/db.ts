import Database from 'better-sqlite3'

export interface ChatMessage {
  id?: number
  role: 'user' | 'assistant'
  content: string
  createdAt?: string
}

export function initDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

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

  db.exec('CREATE INDEX IF NOT EXISTS idx_cowork_messages_session ON cowork_messages(session_id)')
}

export function saveMessage(
  db: Database.Database,
  msg: { role: 'user' | 'assistant'; content: string }
): void {
  db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)').run(msg.role, msg.content)
}

export function getMessages(db: Database.Database, limit: number): ChatMessage[] {
  return (
    db
      .prepare(
        `SELECT id, role, content, created_at as createdAt
       FROM messages ORDER BY id DESC LIMIT ?`
      )
      .all(limit) as ChatMessage[]
  ).reverse()
}

export function kvGet(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : null
}

export function kvSet(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)').run(
    key,
    value,
    Date.now()
  )
}

export function kvGetAll(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM kv').all() as Array<{
    key: string
    value: string
  }>
  const result: Record<string, string> = {}
  for (const row of rows) result[row.key] = row.value
  return result
}
