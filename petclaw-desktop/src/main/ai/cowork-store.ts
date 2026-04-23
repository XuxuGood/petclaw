import crypto from 'crypto'

import type Database from 'better-sqlite3'

import type {
  CoworkSession,
  CoworkMessage,
  CoworkExecutionMode,
  CoworkSessionStatus,
  CoworkMessageType,
  CoworkMessageMetadata
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
  ): CoworkSession {
    const id = crypto.randomUUID()
    const now = Date.now()
    this.db
      .prepare(
        `
      INSERT INTO cowork_sessions (id, title, cwd, system_prompt, execution_mode, active_skill_ids, agent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        id,
        title,
        cwd,
        systemPrompt,
        executionMode,
        JSON.stringify(activeSkillIds),
        agentId,
        now,
        now
      )
    return this.getSession(id)!
  }

  getSession(id: string): CoworkSession | null {
    const row = this.db.prepare('SELECT * FROM cowork_sessions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    if (!row) return null
    const messages = this.getMessages(id)
    return this.rowToSession(row, messages)
  }

  getSessions(): CoworkSession[] {
    const rows = this.db
      .prepare('SELECT * FROM cowork_sessions ORDER BY updated_at DESC')
      .all() as Array<Record<string, unknown>>
    return rows.map((row) => this.rowToSession(row, []))
  }

  updateSession(
    id: string,
    updates: Partial<
      Pick<
        CoworkSession,
        | 'title'
        | 'claudeSessionId'
        | 'status'
        | 'cwd'
        | 'systemPrompt'
        | 'modelOverride'
        | 'executionMode'
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
    if (updates.cwd !== undefined) {
      fields.push('cwd = ?')
      values.push(updates.cwd)
    }
    if (updates.systemPrompt !== undefined) {
      fields.push('system_prompt = ?')
      values.push(updates.systemPrompt)
    }
    if (updates.modelOverride !== undefined) {
      fields.push('model_override = ?')
      values.push(updates.modelOverride)
    }
    if (updates.executionMode !== undefined) {
      fields.push('execution_mode = ?')
      values.push(updates.executionMode)
    }

    if (fields.length === 0) return

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    this.db.prepare(`UPDATE cowork_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM cowork_sessions WHERE id = ?').run(id)
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
      INSERT INTO cowork_messages (id, session_id, type, content, metadata, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(id, sessionId, type, content, JSON.stringify(metadata ?? {}), timestamp)

    this.db
      .prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?')
      .run(timestamp, sessionId)

    return { id, type, content, timestamp, metadata }
  }

  updateMessageContent(id: string, content: string): void {
    this.db.prepare('UPDATE cowork_messages SET content = ? WHERE id = ?').run(content, id)
  }

  getMessages(sessionId: string): CoworkMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM cowork_messages WHERE session_id = ? ORDER BY timestamp ASC')
      .all(sessionId) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: row.id as string,
      type: row.type as CoworkMessageType,
      content: row.content as string,
      timestamp: row.timestamp as number,
      metadata: JSON.parse(row.metadata as string) as CoworkMessageMetadata
    }))
  }

  resetRunningSessions(): void {
    this.db
      .prepare(
        "UPDATE cowork_sessions SET status = 'idle', updated_at = ? WHERE status = 'running'"
      )
      .run(Date.now())
  }

  getRecentWorkingDirs(limit = 8): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT cwd FROM cowork_sessions ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as Array<{ cwd: string }>
    return rows.map((r) => r.cwd)
  }

  private rowToSession(row: Record<string, unknown>, messages: CoworkMessage[]): CoworkSession {
    return {
      id: row.id as string,
      title: row.title as string,
      claudeSessionId: row.claude_session_id as string | null,
      status: row.status as CoworkSessionStatus,
      pinned: (row.pinned as number) === 1,
      cwd: row.cwd as string,
      systemPrompt: row.system_prompt as string,
      modelOverride: row.model_override as string,
      executionMode: row.execution_mode as CoworkExecutionMode,
      activeSkillIds: JSON.parse(row.active_skill_ids as string) as string[],
      agentId: row.agent_id as string,
      messages,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number
    }
  }
}
