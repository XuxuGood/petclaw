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
