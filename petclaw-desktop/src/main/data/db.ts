// src/main/data/db.ts
import Database from 'better-sqlite3'

export function initDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // 全局配置 KV
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 目录配置
  db.exec(`
    CREATE TABLE IF NOT EXISTS directories (
      agent_id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT,
      model_override TEXT DEFAULT '',
      skill_ids TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 会话
  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      directory_path TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      engine_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      model_override TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 消息
  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
    )
  `)

  // IM 实例
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_instances (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      name TEXT,
      directory_path TEXT,
      agent_id TEXT,
      credentials TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // IM 对话级绑定
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_conversation_bindings (
      conversation_id TEXT NOT NULL,
      instance_id TEXT NOT NULL REFERENCES im_instances(id) ON DELETE CASCADE,
      peer_kind TEXT NOT NULL,
      directory_path TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, instance_id)
    )
  `)

  // IM 会话映射
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_session_mappings (
      conversation_id TEXT NOT NULL,
      instance_id TEXT NOT NULL REFERENCES im_instances(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES cowork_sessions(id),
      agent_id TEXT NOT NULL DEFAULT 'main',
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, instance_id)
    )
  `)

  // 定时任务元数据（CRUD 委托给 OpenClaw cron.* RPC）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_task_meta (
      task_id TEXT PRIMARY KEY,
      directory_path TEXT,
      agent_id TEXT,
      origin TEXT,
      binding TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // MCP 服务器
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      transport_type TEXT NOT NULL DEFAULT 'stdio',
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 索引
  db.exec('CREATE INDEX IF NOT EXISTS idx_cowork_messages_session ON cowork_messages(session_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_cowork_sessions_agent ON cowork_sessions(agent_id)')
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_cowork_sessions_directory ON cowork_sessions(directory_path)'
  )
}

// ── KV 辅助函数（操作 app_config 表） ──

export function kvGet(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : null
}

export function kvSet(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, ?)').run(
    key,
    value,
    Date.now()
  )
}

export function kvGetAll(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM app_config').all() as Array<{
    key: string
    value: string
  }>
  const result: Record<string, string> = {}
  for (const row of rows) result[row.key] = row.value
  return result
}
