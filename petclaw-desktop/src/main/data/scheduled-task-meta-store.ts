// src/main/data/scheduled-task-meta-store.ts
// ScheduledTaskMetaStore — scheduled_task_meta 表 CRUD
import type Database from 'better-sqlite3'

export interface TaskMeta {
  taskId: string
  directoryPath: string | null
  agentId: string | null
  origin: string | null
  binding: string | null
  createdAt: number
  updatedAt: number
}

export class ScheduledTaskMetaStore {
  constructor(private db: Database.Database) {}

  save(
    taskId: string,
    meta: {
      directoryPath?: string
      agentId?: string
      origin?: string
      binding?: string
    }
  ): void {
    const now = Date.now()
    // 先查已有记录，保留 created_at
    const existing = this.db
      .prepare('SELECT created_at FROM scheduled_task_meta WHERE task_id = ?')
      .get(taskId) as { created_at: number } | undefined
    const createdAt = existing?.created_at ?? now

    this.db
      .prepare(
        'INSERT OR REPLACE INTO scheduled_task_meta (task_id, directory_path, agent_id, origin, binding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        taskId,
        meta.directoryPath ?? null,
        meta.agentId ?? null,
        meta.origin ?? null,
        meta.binding ?? null,
        createdAt,
        now
      )
  }

  get(taskId: string): TaskMeta | null {
    const row = this.db
      .prepare('SELECT * FROM scheduled_task_meta WHERE task_id = ?')
      .get(taskId) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      taskId: row.task_id as string,
      directoryPath: (row.directory_path as string) ?? null,
      agentId: (row.agent_id as string) ?? null,
      origin: (row.origin as string) ?? null,
      binding: (row.binding as string) ?? null,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number
    }
  }

  delete(taskId: string): void {
    this.db.prepare('DELETE FROM scheduled_task_meta WHERE task_id = ?').run(taskId)
  }
}
