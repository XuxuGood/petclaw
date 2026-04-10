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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

export function saveMessage(db: Database.Database, msg: { role: string; content: string }): void {
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

export function saveSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}
