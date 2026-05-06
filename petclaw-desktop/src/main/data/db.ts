// src/main/data/db.ts
import Database from 'better-sqlite3'

export function initDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // ── 全局配置 KV ──
  // 通用键值存储，各模块通过 typed store 访问。
  // 已知 key：
  //   language           — 界面语言，JSON 字符串 "zh" | "en"
  //   nickname           — 用户昵称，JSON 字符串
  //   role               — 用户角色，JSON 字符串
  //   window.mainBounds  — 主窗口位置和尺寸，JSON { x, y, width, height }
  //   window.petPosition — 宠物窗口位置，JSON { x, y }
  //   cowork.defaultDirectory — Cowork 默认工作目录，纯文本路径
  //   cowork.systemPrompt     — 用户自定义系统提示词，纯文本
  //   cowork.memory           — Cowork 记忆内容，纯文本
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,                -- 配置键名
      value TEXT NOT NULL,                 -- 配置值（JSON 字符串或纯文本）
      updated_at INTEGER NOT NULL          -- 更新时间，Unix 毫秒时间戳
    )
  `)

  // ── 目录配置 ──
  // 用户添加的项目/工作区目录，每个目录对应 Openclaw runtime 的一个 agent workspace。
  db.exec(`
    CREATE TABLE IF NOT EXISTS directories (
      agent_id TEXT PRIMARY KEY,           -- 由目录路径 SHA-256 派生的确定性 ID，格式 ws-{hash前12位}
      path TEXT NOT NULL UNIQUE,           -- 目录绝对路径
      name TEXT,                           -- 用户自定义别名，可为 null，仅展示用
      model_override TEXT DEFAULT '',      -- 目录级模型覆盖，空字符串=跟全局默认；非空为 "providerId/modelId"
      skill_ids TEXT DEFAULT '[]',         -- JSON string[]，该目录启用的 Skill ID 白名单
      created_at INTEGER NOT NULL,         -- 创建时间，Unix 毫秒时间戳
      updated_at INTEGER NOT NULL          -- 更新时间，Unix 毫秒时间戳
    )
  `)

  // ── 模型供应商配置 ──
  // 密钥单独存储在 model_provider_secrets，避免普通配置读取时带出敏感信息。
  // 内置供应商 id：petclaw, openai, anthropic, deepseek, zhipu, minimax,
  //   volcengine, youdao, qianfan, stepfun, xiaomi, ollama, gemini, alibaba, mistral, groq 等。
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_providers (
      id TEXT PRIMARY KEY,                 -- 供应商 ID，内置或用户自建
      name TEXT NOT NULL,                  -- 显示名称，如 "OpenAI"、"Anthropic"
      base_url TEXT NOT NULL,              -- API 基础地址，如 https://api.openai.com/v1
      api_format TEXT NOT NULL,            -- API 协议格式：'openai-completions' | 'anthropic' | 'google-generative-ai'
      enabled INTEGER NOT NULL DEFAULT 0,  -- 是否启用（0/1），未启用不写入 openclaw.json
      is_custom INTEGER NOT NULL DEFAULT 0,-- 是否用户自建供应商（0=内置预设，1=自建）
      models_json TEXT NOT NULL DEFAULT '[]', -- JSON ModelDefinition[]，每个元素：
                                           --   { id, name, reasoning, supportsImage, contextWindow, maxTokens }
      created_at INTEGER NOT NULL,         -- 创建时间，Unix 毫秒时间戳
      updated_at INTEGER NOT NULL          -- 更新时间，Unix 毫秒时间戳
    )
  `)

  // ── 模型供应商密钥（隔离存储） ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_provider_secrets (
      provider_id TEXT PRIMARY KEY,        -- 供应商 ID，外键关联 model_providers
      api_key TEXT NOT NULL DEFAULT '',    -- API 密钥
      updated_at INTEGER NOT NULL,         -- 更新时间，Unix 毫秒时间戳
      FOREIGN KEY (provider_id) REFERENCES model_providers(id) ON DELETE CASCADE
    )
  `)

  // ── AI 协作会话 ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_sessions (
      id TEXT PRIMARY KEY,                 -- UUID，PetClaw 侧会话标识
      title TEXT NOT NULL,                 -- 会话标题（通常为首条消息摘要或默认文本）
      directory_path TEXT NOT NULL,        -- 会话绑定的工作目录绝对路径
      agent_id TEXT NOT NULL,              -- deriveAgentId(directory_path) 结果，即 ws-{hash}
      engine_session_id TEXT,              -- Openclaw runtime 返回的 runId，complete 事件时写入；null=未运行
      status TEXT NOT NULL DEFAULT 'idle', -- 会话状态：'idle' | 'running' | 'completed' | 'error'
                                           --   idle=空闲可发消息，running=正在执行 turn
                                           --   completed=turn 完成，error=出错
                                           --   应用启动时 resetRunningSessions() 将 running 重置为 idle
      selected_model_json TEXT,            -- JSON { providerId, modelId } | null
                                           --   会话级模型选择，覆盖目录/全局默认；null=使用默认模型
      system_prompt TEXT NOT NULL DEFAULT '',-- 创建会话时固化的系统提示词
                                           --   由 mergeCoworkSystemPrompt() 合并生成，会话生命周期内不变
      pinned INTEGER NOT NULL DEFAULT 0,   -- 是否置顶（0/1）
      created_at INTEGER NOT NULL,         -- 创建时间，Unix 毫秒时间戳
      updated_at INTEGER NOT NULL          -- 更新时间，Unix 毫秒时间戳
    )
  `)

  // 迁移：为已有数据库添加 origin 列（'chat' | 'im' | 'scheduler' | 'hook'）
  try {
    db.exec(`ALTER TABLE cowork_sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'chat'`)
  } catch {
    // 列已存在，忽略
  }

  // ── 会话消息 ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_messages (
      id TEXT PRIMARY KEY,                 -- UUID
      session_id TEXT NOT NULL,            -- 所属会话 ID
      type TEXT NOT NULL,                  -- 消息类型：'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system'
      content TEXT NOT NULL,               -- 消息文本内容
      metadata TEXT NOT NULL DEFAULT '{}', -- JSON CoworkMessageMetadata，各字段含义：
                                           --   toolName     — (tool_use) 工具名称
                                           --   toolInput    — (tool_use) 工具调用参数 Record<string, unknown>
                                           --   toolResult   — (tool_result) 工具返回值文本
                                           --   toolUseId    — (tool_use/tool_result) 关联的 tool call ID
                                           --   error        — (assistant/system) 错误信息文本
                                           --   isStreaming   — (assistant) 是否正在流式输出中
                                           --   isThinking   — (assistant) 是否为思考/推理过程
                                           --   isTimeout    — (assistant) 是否因超时终止
                                           --   isFinal      — (assistant) 是否为最终完成的消息
                                           --   imageAttachments — (user) 图片附件 [{name, mimeType, base64Data}]
                                           --   skillIds     — (user) 本次消息携带的 skill ID 列表
      created_at INTEGER NOT NULL,         -- 创建时间，Unix 毫秒时间戳
      FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
    )
  `)

  // ── IM 实例 ──
  // 每个 IM 平台连接对应一行。飞书/钉钉/企微可多实例（各最多 3 个），微信仅 1 个。
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_instances (
      id TEXT PRIMARY KEY,                 -- UUID
      platform TEXT NOT NULL,              -- IM 平台：'wechat' | 'wecom' | 'dingtalk' | 'feishu'
      name TEXT,                           -- 实例别名，可为 null
      directory_path TEXT,                 -- 实例级默认工作目录；null=使用 main agent 目录
      agent_id TEXT,                       -- deriveAgentId(directory_path) 或 null，默认路由 agent
      credentials TEXT NOT NULL,           -- JSON 平台凭证，结构因平台而异：
                                           --   飞书:   { appId, appSecret, domain? }  (domain 默认 feishu.cn)
                                           --   钉钉:   { appKey, appSecret }
                                           --   企微:   { corpId, agentId, secret }
                                           --   微信:   { accountId }
      config TEXT NOT NULL DEFAULT '{}',   -- JSON ImInstanceConfig:
                                           --   { dmPolicy: 'open'|'pairing'|'allowlist'|'disabled',
                                           --     groupPolicy: 'open'|'allowlist'|'disabled',
                                           --     allowFrom: string[],
                                           --     debug: boolean }
      enabled INTEGER NOT NULL DEFAULT 1,  -- 是否启用（0/1）
      created_at INTEGER NOT NULL,         -- 创建时间，Unix 毫秒时间戳
      updated_at INTEGER NOT NULL          -- 更新时间，Unix 毫秒时间戳
    )
  `)

  // ── IM 对话级绑定（Tier 1 精确匹配） ──
  // 当 IM 消息到达时，先按 conversation_id+instance_id 精确查绑定，
  // 命中则使用绑定的 directory/agent，优先级高于实例级默认。
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_conversation_bindings (
      conversation_id TEXT NOT NULL,       -- IM 对话标识（平台侧 ID）
      instance_id TEXT NOT NULL REFERENCES im_instances(id) ON DELETE CASCADE,
                                           -- 所属 IM 实例
      peer_kind TEXT NOT NULL,             -- 对话类型：'dm'=私聊 | 'group'=群聊
      directory_path TEXT NOT NULL,        -- 该对话绑定的工作目录
      agent_id TEXT NOT NULL,              -- 该对话绑定的 agent ID
      created_at INTEGER NOT NULL,         -- 创建时间，Unix 毫秒时间戳
      updated_at INTEGER NOT NULL,         -- 更新时间，Unix 毫秒时间戳
      PRIMARY KEY (conversation_id, instance_id)
    )
  `)

  // ── IM 会话映射 ──
  // IM 对话到 Cowork 会话的持久映射，使同一 IM 对话复用同一 Cowork 会话上下文。
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_session_mappings (
      conversation_id TEXT NOT NULL,       -- IM 对话标识
      instance_id TEXT NOT NULL REFERENCES im_instances(id) ON DELETE CASCADE,
                                           -- 所属 IM 实例
      session_id TEXT NOT NULL REFERENCES cowork_sessions(id),
                                           -- 映射到的 Cowork 会话 ID
      agent_id TEXT NOT NULL DEFAULT 'main',-- 该映射使用的 agent ID
      created_at INTEGER NOT NULL,         -- 创建时间，Unix 毫秒时间戳
      last_active_at INTEGER NOT NULL,     -- 上次活跃时间戳（upsert 时更新）
      PRIMARY KEY (conversation_id, instance_id)
    )
  `)

  // ── 定时任务本地元数据 ──
  // 实际定时任务 CRUD 委托给 Openclaw Gateway 的 cron.* RPC，
  // 此表仅存 PetClaw 侧附加元数据（目录绑定、来源标记等）。
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_task_meta (
      task_id TEXT PRIMARY KEY,            -- 对应 Gateway 返回的 job ID
      directory_path TEXT,                 -- 任务绑定的工作目录（可选）
      agent_id TEXT,                       -- 任务绑定的 agent ID
      origin TEXT,                         -- 任务来源标记（预留），设计为 'chat' | 'cron-ui' | 'im' 等
      binding TEXT,                        -- 外部绑定标识（预留），设计为存储如 IM conversation ID 等
      created_at INTEGER NOT NULL,         -- 创建时间，Unix 毫秒时间戳
      updated_at INTEGER NOT NULL          -- 更新时间，Unix 毫秒时间戳
    )
  `)

  // ── MCP 服务器 ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,                 -- UUID
      name TEXT NOT NULL UNIQUE,           -- 服务器名称
      description TEXT NOT NULL DEFAULT '',-- 描述文本
      enabled INTEGER NOT NULL DEFAULT 1,  -- 是否启用（0/1）
      transport_type TEXT NOT NULL DEFAULT 'stdio',
                                           -- 传输协议：'stdio' | 'sse' | 'streamable-http'
      config_json TEXT NOT NULL DEFAULT '{}',
                                           -- JSON 配置，结构取决于 transport_type：
                                           --   stdio → { command, args: string[], env?: Record<string,string> }
                                           --   sse / streamable-http → { url, headers?: Record<string,string> }
      created_at INTEGER NOT NULL,         -- 创建时间，Unix 毫秒时间戳
      updated_at INTEGER NOT NULL          -- 更新时间，Unix 毫秒时间戳
    )
  `)

  // ── 索引 ──
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
