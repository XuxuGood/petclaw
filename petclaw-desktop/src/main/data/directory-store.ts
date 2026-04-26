// src/main/data/directory-store.ts
// DirectoryStore — directories 表 CRUD
import type Database from 'better-sqlite3'

import type { Directory } from '../ai/types'

export class DirectoryStore {
  constructor(private db: Database.Database) {}

  get(agentId: string): Directory | null {
    const row = this.db.prepare('SELECT * FROM directories WHERE agent_id = ?').get(agentId) as
      | Record<string, unknown>
      | undefined
    return row ? this.rowToDirectory(row) : null
  }

  getByPath(directoryPath: string): Directory | null {
    const row = this.db.prepare('SELECT * FROM directories WHERE path = ?').get(directoryPath) as
      | Record<string, unknown>
      | undefined
    return row ? this.rowToDirectory(row) : null
  }

  list(): Directory[] {
    const rows = this.db
      .prepare('SELECT * FROM directories ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>
    return rows.map((r) => this.rowToDirectory(r))
  }

  insert(agentId: string, directoryPath: string): void {
    const now = Date.now()
    this.db
      .prepare(
        'INSERT INTO directories (agent_id, path, created_at, updated_at) VALUES (?, ?, ?, ?)'
      )
      .run(agentId, directoryPath, now, now)
  }

  updateName(agentId: string, name: string): void {
    this.db
      .prepare('UPDATE directories SET name = ?, updated_at = ? WHERE agent_id = ?')
      .run(name, Date.now(), agentId)
  }

  updateModelOverride(agentId: string, model: string): void {
    this.db
      .prepare('UPDATE directories SET model_override = ?, updated_at = ? WHERE agent_id = ?')
      .run(model, Date.now(), agentId)
  }

  updateSkillIds(agentId: string, skillIds: string[]): void {
    this.db
      .prepare('UPDATE directories SET skill_ids = ?, updated_at = ? WHERE agent_id = ?')
      .run(JSON.stringify(skillIds), Date.now(), agentId)
  }

  private rowToDirectory(row: Record<string, unknown>): Directory {
    return {
      agentId: row.agent_id as string,
      path: row.path as string,
      name: (row.name as string) ?? null,
      modelOverride: (row.model_override as string) ?? '',
      skillIds: JSON.parse((row.skill_ids as string) ?? '[]') as string[],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number
    }
  }
}
