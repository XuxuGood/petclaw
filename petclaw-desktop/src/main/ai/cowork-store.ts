import crypto from 'crypto'

import type Database from 'better-sqlite3'

import type {
  CoworkSession,
  CoworkMessage,
  CoworkSessionStatus,
  CoworkMessageType,
  CoworkMessageMetadata
} from './types'

export class CoworkStore {
  constructor(private db: Database.Database) {}

  createSession(title: string, directoryPath: string, agentId: string): CoworkSession {
    const id = crypto.randomUUID()
    const now = Date.now()
    this.db
      .prepare(
        `
      INSERT INTO sessions (id, title, directory_path, agent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(id, title, directoryPath, agentId, now, now)
    return this.getSession(id)!
  }

  getSession(id: string): CoworkSession | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    if (!row) return null
    const messages = this.getMessages(id)
    return this.rowToSession(row, messages)
  }

  getSessions(): CoworkSession[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as Array<
      Record<string, unknown>
    >
    return rows.map((row) => this.rowToSession(row, []))
  }

  updateSession(
    id: string,
    updates: Partial<
      Pick<
        CoworkSession,
        'title' | 'claudeSessionId' | 'status' | 'directoryPath' | 'modelOverride'
      >
    >
  ): void {
    const fields: string[] = []
    const values: unknown[] = []

    if (updates.title !== undefined) {
      fields.push('title = ?')
      values.push(updates.title)
    }
    if (updates.claudeSessionId !== undefined) {
      fields.push('claude_session_id = ?')
      values.push(updates.claudeSessionId)
    }
    if (updates.status !== undefined) {
      fields.push('status = ?')
      values.push(updates.status)
    }
    if (updates.directoryPath !== undefined) {
      fields.push('directory_path = ?')
      values.push(updates.directoryPath)
    }
    if (updates.modelOverride !== undefined) {
      fields.push('model_override = ?')
      values.push(updates.modelOverride)
    }

    if (fields.length === 0) return

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    this.db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }

  addMessage(
    sessionId: string,
    type: CoworkMessageType,
    content: string,
    metadata?: CoworkMessageMetadata
  ): CoworkMessage {
    const id = crypto.randomUUID()
    const timestamp = Date.now()
    this.db
      .prepare(
        `
      INSERT INTO messages (id, session_id, type, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(id, sessionId, type, content, JSON.stringify(metadata ?? {}), timestamp)

    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(timestamp, sessionId)

    return { id, type, content, timestamp, metadata }
  }

  updateMessageContent(id: string, content: string): void {
    this.db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id)
  }

  getMessages(sessionId: string): CoworkMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: row.id as string,
      type: row.type as CoworkMessageType,
      content: row.content as string,
      timestamp: row.created_at as number,
      metadata: JSON.parse(row.metadata as string) as CoworkMessageMetadata
    }))
  }

  resetRunningSessions(): void {
    this.db
      .prepare("UPDATE sessions SET status = 'idle', updated_at = ? WHERE status = 'running'")
      .run(Date.now())
  }

  getRecentDirectories(limit = 8): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT directory_path FROM sessions ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as Array<{ directory_path: string }>
    return rows.map((r) => r.directory_path)
  }

  private rowToSession(row: Record<string, unknown>, messages: CoworkMessage[]): CoworkSession {
    return {
      id: row.id as string,
      title: row.title as string,
      claudeSessionId: (row.claude_session_id as string | null) ?? null,
      status: row.status as CoworkSessionStatus,
      pinned: (row.pinned as number) === 1,
      directoryPath: row.directory_path as string,
      modelOverride: row.model_override as string,
      agentId: row.agent_id as string,
      messages,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number
    }
  }
}
