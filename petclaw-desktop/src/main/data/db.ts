// src/main/data/db.ts
import Database from 'better-sqlite3'

export function initDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // 全局配置 KV（替代旧 kv 表，改名 app_config）
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 目录配置（替代旧 agents 表）
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

  // 会话（替代旧 cowork_sessions，去 cowork_ 前缀）
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      directory_path TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      claude_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      model_override TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 消息（替代旧 cowork_messages）
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `)

  // IM 实例（替代旧 im_config 表）
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

  // IM 对话级绑定（新增）
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

  // IM 会话映射（重构主键）
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_session_mappings (
      conversation_id TEXT NOT NULL,
      instance_id TEXT NOT NULL REFERENCES im_instances(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      agent_id TEXT NOT NULL DEFAULT 'main',
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, instance_id)
    )
  `)

  // 定时任务元数据（新增，CRUD 委托给 OpenClaw cron.* RPC）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_task_meta (
      task_id TEXT PRIMARY KEY,
      directory_path TEXT,
      agent_id TEXT,
      origin TEXT,
      binding TEXT
    )
  `)

  // MCP 服务器（保留，无变化）
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_directory ON sessions(directory_path)')

  // 新表创建完毕后，执行旧表迁移
  migrateIfNeeded(db)
}

// ── v1→v3 数据迁移 ──

function migrateIfNeeded(db: Database.Database): void {
  // 检测旧表是否存在——全新安装则直接跳过
  const hasOldAgents = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'")
    .get()
  const hasOldKv = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kv'")
    .get()
  const hasOldCoworkSessions = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cowork_sessions'")
    .get()

  // 无旧表，全新安装，无需迁移
  if (!hasOldAgents && !hasOldKv && !hasOldCoworkSessions) return

  // 1. kv → app_config（结构一致，直接搬数据）
  if (hasOldKv) {
    db.exec('INSERT OR IGNORE INTO app_config SELECT * FROM kv')
    db.exec('DROP TABLE IF EXISTS kv')
  }

  // 2. agents → 直接丢弃（目录驱动模型从路径自动注册）
  db.exec('DROP TABLE IF EXISTS agents')

  // 3. cowork_sessions → sessions（cwd 字段映射为 directory_path）
  if (hasOldCoworkSessions) {
    db.exec(`
      INSERT OR IGNORE INTO sessions (id, title, directory_path, agent_id, status, model_override, pinned, created_at, updated_at)
      SELECT id, title, cwd, agent_id, status, model_override, pinned, created_at, updated_at
      FROM cowork_sessions
    `)
    db.exec('DROP TABLE IF EXISTS cowork_sessions')
  }

  // 4. cowork_messages → messages（timestamp 字段映射为 created_at）
  const hasOldCoworkMessages = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cowork_messages'")
    .get()
  if (hasOldCoworkMessages) {
    db.exec(`
      INSERT OR IGNORE INTO messages (id, session_id, type, content, metadata, created_at)
      SELECT id, session_id, type, content, metadata, timestamp
      FROM cowork_messages
    `)
    db.exec('DROP TABLE IF EXISTS cowork_messages')
  }

  // 5. 旧 IM 表结构差异过大，直接丢弃
  db.exec('DROP TABLE IF EXISTS im_config')

  // 6. 检测 v1 遗留的 messages 表（含 role 列而非 type 列）
  const cols = db.prepare("PRAGMA table_info('messages')").all() as Array<{ name: string }>
  if (cols.some((c) => c.name === 'role')) {
    // 删除旧表并用 v3 schema 重建
    db.exec('DROP TABLE messages')
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `)
    db.exec('CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)')
  }
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
