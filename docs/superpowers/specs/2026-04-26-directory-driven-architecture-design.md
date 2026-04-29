# PetClaw 目录驱动的任务执行架构设计

**日期**: 2026-04-26
**状态**: 设计完成，待实现
**前置**: 基于 `docs/架构设计/PetClaw总体架构设计.md` 重构，将 Agent-centric 模型改为 Directory-centric 模型
**参考**: LobsterAI 源码、OpenClaw runtime 机制、PetClaw 设计稿

---

## 目录

1. [设计动机](#1-设计动机)
2. [核心理念](#2-核心理念)
3. [Agent 派生机制](#3-agent-派生机制)
4. [数据库 Schema](#4-数据库-schema)
5. [ConfigSync 与 openclaw.json](#5-configsync-与-openclawjson)
6. [模型配置](#6-模型配置)
7. [Skill 系统](#7-skill-系统)
8. [MCP 连接器](#8-mcp-连接器)
9. [IM 集成](#9-im-集成)
10. [定时任务](#10-定时任务)
11. [对话框 "+" 菜单](#11-对话框--菜单)
12. [Gateway 重启策略](#12-gateway-重启策略)
13. [模块职责变更](#13-模块职责变更)
14. [数据流](#14-数据流)

---

## 1. 设计动机

v3 原设计采用 Agent-centric 模型：用户显式创建/管理 Agent，每个 Agent 有独立的 system_prompt / model / skills / IM 绑定。这导致两个问题：

1. **概念负担** — 用户必须理解 "Agent" 是什么，什么时候该创建新 Agent，Agent 和工作目录的关系是什么
2. **操作冗余** — 用户在使用不同项目目录时，需要先创建 Agent、再绑定目录，多一步操作

**新方案**：用户只与"目录"交互。选择一个目录就自动拥有一个对应的 Agent，Agent ID 由目录路径确定性派生，对用户完全不可见。

---

## 2. 核心理念

### 2.1 目录即 Agent

```
用户选择目录 /Users/xxx/my-project
  → deriveAgentId('/Users/xxx/my-project')
  → 'ws-a1b2c3d4e5f6'
  → 该 agent 自动出现在 openclaw.json agents.list 中
  → 用户无感知
```

### 2.2 main agent 保留

固定 ID `'main'`，不由目录派生。作用：
- IM 消息未绑定目录时的兜底 Agent
- workspace 使用 `app_config.defaultDirectory`（用户可配置）
- 在 `openclaw.json` 中 `"default": true`

### 2.3 全量注册

所有创建过会话的目录（`directories` 表）全部注册到 `openclaw.json agents.list`，不做活跃度剪枝。原因：
- OpenClaw 运行时只认 agents.list 中的 agent
- 定时任务、IM 绑定等可能引用任意历史 agent
- agents.list 是轻量配置，不会造成性能问题
- 数据安全在 SQLite + OpenClaw transcript 中，不依赖 agents.list

---

## 3. Agent 派生机制

### 3.1 deriveAgentId

```typescript
import crypto from 'crypto'
import path from 'path'

function deriveAgentId(dir: string): string {
  const resolved = path.resolve(dir)
  const hash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 12)
  return `ws-${hash}`
}
```

- 输入必须 `path.resolve()` 规范化（消除 `~`、相对路径、尾 `/`）
- 同一目录始终产生相同 ID（确定性）
- `ws-` 前缀表示 workspace-derived（与 `main` 区分）
- 12 位 hex = 48 bit，碰撞概率可忽略

### 3.2 Session Key 格式

```
agent:{agentId}:petclaw:{sessionId}
```

例：`agent:ws-a1b2c3d4e5f6:petclaw:550e8400-e29b`

---

## 4. 数据库 Schema

9 张表，无 `cowork_` 前缀。

### 4.1 app_config — 全局配置 KV

```sql
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

存储内容：
- `defaultDirectory` — main agent 的默认工作目录
- `providers` — 模型提供商 JSON（API keys 等）
- `model.defaultModel` — 默认模型标识
- `theme`、`locale` 等 UI 偏好

### 4.2 directories — 目录配置

```sql
CREATE TABLE directories (
  agent_id TEXT PRIMARY KEY,       -- deriveAgentId(path) 的结果
  path TEXT NOT NULL UNIQUE,       -- 目录绝对路径
  name TEXT,                       -- 用户自定义别名（可选）
  model_override TEXT DEFAULT '',  -- 该目录专属模型（空=跟全局）
  skill_ids TEXT DEFAULT '[]',     -- 该目录启用的 skill 白名单 JSON 数组
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**agent_id 为主键**：因为 openclaw.json 以 agentId 寻址，定时任务/IM 绑定也引用 agentId。
**path 为 UNIQUE**：同一目录只能有一个 agent。
**双字段设计**：业务层通过 path 查询（用户视角），runtime 层通过 agent_id 查询（OpenClaw 视角）。

### 4.3 sessions — 会话

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  directory_path TEXT NOT NULL,        -- 用户选择的工作目录
  agent_id TEXT NOT NULL,              -- deriveAgentId(directory_path)
  status TEXT NOT NULL DEFAULT 'idle', -- idle | running | completed | error
  model_override TEXT NOT NULL DEFAULT '', -- 会话级模型覆盖（空=跟目录→跟全局）
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**model_override 优先级**: session > directory > global

### 4.4 messages — 消息

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,             -- user | assistant | tool_use | tool_result | system
  content TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_session ON messages(session_id);
```

### 4.5 im_instances — IM 实例

```sql
CREATE TABLE im_instances (
  id TEXT PRIMARY KEY,                -- UUID
  platform TEXT NOT NULL,             -- feishu | telegram | discord | wechat | ...
  name TEXT,                          -- 用户自定义名称
  directory_path TEXT,                -- 实例级默认目录（可空=用 main）
  agent_id TEXT,                      -- deriveAgentId(directory_path) 或 'main'
  credentials TEXT NOT NULL,          -- 加密的凭证 JSON
  config TEXT NOT NULL DEFAULT '{}',  -- 平台特定配置
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**一个平台可有多个实例**（如飞书有多个 bot）。
**实例级 directory_path** 是该 bot 的默认工作目录，对话级可覆盖。

### 4.6 im_conversation_bindings — 对话级绑定

```sql
CREATE TABLE im_conversation_bindings (
  conversation_id TEXT NOT NULL,     -- 对话标识（群 ID 或私聊 peer）
  instance_id TEXT NOT NULL REFERENCES im_instances(id) ON DELETE CASCADE,
  peer_kind TEXT NOT NULL,           -- dm | group
  directory_path TEXT NOT NULL,      -- 该对话绑定的工作目录
  agent_id TEXT NOT NULL,            -- deriveAgentId(directory_path)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, instance_id)
);
```

**两层绑定**:
- 实例级默认: im_instances.directory_path（Tier 7 account match）
- 对话级覆盖: im_conversation_bindings（Tier 1 peer match）

### 4.7 im_session_mappings — IM 会话映射

```sql
CREATE TABLE im_session_mappings (
  conversation_id TEXT NOT NULL,
  instance_id TEXT NOT NULL REFERENCES im_instances(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  agent_id TEXT NOT NULL DEFAULT 'main',
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, instance_id)
);
```

### 4.8 scheduled_task_meta — 定时任务元数据

```sql
CREATE TABLE scheduled_task_meta (
  task_id TEXT PRIMARY KEY,       -- OpenClaw cron.* RPC 返回的 ID
  directory_path TEXT,            -- 任务关联的目录
  agent_id TEXT,                  -- deriveAgentId(directory_path)
  origin TEXT,                    -- 创建来源：gui | chat | api
  binding TEXT                    -- IM 推送绑定 JSON（可选）
);
```

定时任务的 CRUD 完全委托给 OpenClaw `cron.*` RPC，本表只存 PetClaw 侧的附加元数据。

### 4.9 mcp_servers — MCP 服务器

```sql
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,   -- 全局开关
  transport_type TEXT NOT NULL DEFAULT 'stdio', -- stdio | sse | streamable-http
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**enabled 是全局状态**：开关 MCP 服务器立即影响所有对话（与 LobsterAI 一致）。

---

## 5. ConfigSync 与 openclaw.json

### 5.1 ConfigSync 职责

ConfigSync 是 **唯一写入 openclaw.json 的模块**，从 DB 聚合所有配置：

```typescript
class ConfigSync {
  sync(reason: string): ConfigSyncResult {
    // 1. 读取现有 openclaw.json（保留 runtime 自注入字段）
    // 2. 从 DB 聚合：model providers, directories→agents.list, im→bindings, skills, mcp
    // 3. 序列化、diff、原子写入
  }
}
```

### 5.2 openclaw.json 结构（目录驱动版）

```jsonc
{
  "gateway": {
    "mode": "local",
    "auth": { "mode": "token", "token": "${OPENCLAW_GATEWAY_TOKEN}" }
  },
  "models": {
    "mode": "replace",
    "providers": {
      "anthropic": { "apiKey": "${ANTHROPIC_API_KEY}" },
      "openai": { "apiKey": "${OPENAI_API_KEY}" }
      // ... 其他 provider
    }
  },
  "agents": {
    "defaults": {
      "timeoutSeconds": 3600,
      "model": { "primary": "claude-sonnet-4-20250514" },
      "workspace": "/Users/xxx/default-project"
    },
    "list": [
      {
        "id": "main",
        "default": true
        // workspace 用 defaults.workspace
      },
      {
        "id": "ws-a1b2c3d4e5f6",
        "workspace": "/Users/xxx/my-project",
        "model": { "primary": "gpt-4o" },   // 目录级 model_override
        "skills": ["deep-research", "docx"]  // 目录级 skill 白名单
      },
      {
        "id": "ws-7890abcdef12",
        "workspace": "/Users/xxx/another-project"
        // 无 model/skills = 跟 defaults
      }
    ]
  },
  "bindings": [
    {
      "agentId": "ws-a1b2c3d4e5f6",
      "match": { "channel": "feishu", "accountId": "a1b2c3d4" }
    },
    {
      "agentId": "ws-7890abcdef12",
      "match": { "channel": "feishu", "accountId": "a1b2c3d4", "peer": "group:oc_xxxx" }
    }
  ],
  "session": { "dmScope": "account" },
  "skills": {
    "entries": {
      "deep-research": { "enabled": true },
      "docx": { "enabled": true },
      "pdf": { "enabled": false }
    },
    "load": {
      "extraDirs": ["{userData}/SKILLs"],
      "watch": true
    }
  },
  "plugins": {
    "entries": {
      "ask-user-question": { "enabled": true, "config": { "callbackUrl": "...", "secret": "..." } },
      "mcp-bridge": { "enabled": true, "config": { "callbackUrl": "...", "secret": "...", "tools": [...] } }
    },
    "thirdPartyDirs": ["{resourcesPath}/openclaw-extensions"]
  },
  "commands": { "ownerAllowFrom": ["gateway-client", "*"] }
}
```

### 5.3 ConfigSync 触发时机与重启判断

| 变更类型 | ConfigSync | Gateway 重启 |
|----------|-----------|-------------|
| 模型 provider / API Key | sync | **是**（环境变量变更） |
| 目录级 model_override | sync | **否**（agents.list 热重载） |
| 目录级 skill_ids | sync | **否**（agents.list 热重载） |
| 全局 skill enable/disable | sync | **否**（skills.entries 热重载 + config bump） |
| IM binding 变更 | sync | **否**（bindings 热重载，config-reload-plan 对 bindings = none） |
| IM instance credentials | sync | **是**（环境变量变更） |
| MCP 服务器增删/开关 | sync | **是**（plugins.entries 变更触发 restart） |
| 新目录首次使用 | sync | **否**（agents.list 热重载） |

**注意**：OpenClaw 的 config-reload-plan 对 bindings 变更的 action 是 `none`（热重载），不需要重启。但 plugins 变更需要 restart。

---

## 6. 模型配置

### 6.1 三级模型优先级

```
session.model_override > directory.model_override > app_config['model.defaultModel']
```

### 6.2 会话级切换（热切换）

用户在对话中切换模型时：
1. 更新 `sessions.model_override`（DB 持久化）
2. 调用 OpenClaw `sessions.patch` RPC 热更新当前会话模型
3. **不触发 ConfigSync**，不重写 openclaw.json
4. 仅影响当前会话

### 6.3 目录级切换

用户在目录设置中切换默认模型时：
1. 更新 `directories.model_override`（DB 持久化）
2. 触发 ConfigSync → 更新 `agents.list[i].model`
3. 热重载生效，不重启 Gateway
4. 影响该目录所有新会话（已有会话不受影响，除非无 session.model_override）

### 6.4 全局默认切换

1. 更新 `app_config['model.defaultModel']`
2. 触发 ConfigSync → 更新 `agents.defaults.model`
3. 影响所有未设置 model_override 的目录和会话

### 6.5 Provider 存储

```json
// app_config key='providers'
{
  "anthropic": { "apiKey": "sk-ant-...", "baseUrl": "" },
  "openai": { "apiKey": "sk-...", "baseUrl": "" },
  "deepseek": { "apiKey": "...", "baseUrl": "https://api.deepseek.com" }
}
```

API Key **不写入 openclaw.json**，通过 `${ANTHROPIC_API_KEY}` 占位符 + 环境变量注入。ConfigSync 在构建 Gateway 启动环境时，将 DB 中的 key 映射为 `ANTHROPIC_API_KEY=sk-ant-...` 等环境变量。

---

## 7. Skill 系统

### 7.1 Skill 存储

```
{userData}/SKILLs/
├── deep-research/
│   ├── SKILL.md          -- YAML frontmatter + markdown prompt
│   └── package.json      -- 可选，有依赖时需要
├── docx/
│   ├── SKILL.md
│   └── ...
└── my-custom-skill/
    └── SKILL.md
```

### 7.2 SkillManager 职责

- 扫描 `{userData}/SKILLs/` 发现所有 skill
- 安装/卸载/升级 skill（操作文件系统）
- 内置 skill 从 `Resources/SKILLs/` 同步到 `{userData}/SKILLs/`
- 全局 enable/disable → 写入 `openclaw.json skills.entries`
- 文件监听 → 热更新

### 7.3 三级 Skill 作用域

| 级别 | 存储 | 效果 |
|------|------|------|
| **全局** | `openclaw.json skills.entries` | enabled=true 的 skill 才能被使用 |
| **目录** | `directories.skill_ids` → `agents.list[i].skills` | 该目录的 agent 只能用白名单中的 skill |
| **会话** | 前端 Zustand `activeSkillIds` | 当前对话实际激活的 skill，发消息时附带 |

**优先级**: 全局 enabled → 目录白名单过滤 → 会话激活选择

### 7.4 会话级 Skill 激活流程

```
用户点击 "+" → 技能 → 选中 deep-research
  → 前端 Zustand: activeSkillIds = ['deep-research']
  → 输入框上方显示 Badge: [deep-research ×]
  → 用户发送消息
  → IPC payload: { message, activeSkillIds: ['deep-research'] }
  → 主进程: buildInlinedSkillPrompt(activeSkillIds)
    → 读取 SKILLs/deep-research/SKILL.md 内容
    → 注入到 system_prompt 或 chatSend 的 context 中
  → Gateway 执行时使用该 skill 上下文
```

**不持久化到 DB**：关闭对话窗口后重置。目录级 `skill_ids` 才是持久配置。

---

## 8. MCP 连接器

### 8.1 全局开关模型

MCP 服务器是**纯全局开关**，没有会话级隔离（与 LobsterAI 一致）。

原因：
- OpenClaw 的 mcp-bridge 插件全局注册 tool，运行时层面无法按会话过滤 tool
- MCP 工具（Notion、Linear 等）是全局资源，不像 Skill 那样适合按对话挑选
- 对话框 "+" 菜单的连接器 Toggle 是全局开关的快捷入口

### 8.2 开关流程

```
用户在 "+" 菜单或设置页切换 MCP 服务器 Toggle
  → IPC: mcp:setEnabled(id, enabled)
  → 主进程: McpStore.setEnabled(id, enabled) → 写 DB
  → refreshMcpBridge():
    1. McpServerManager.startServers(enabledServers) — 只连接 enabled 的
    2. listTools() 发现所有工具 → 汇总为 toolManifest
    3. ConfigSync.sync('mcp-change') → 更新 openclaw.json plugins.entries.mcp-bridge.config.tools
    4. 触发 Gateway 重启（plugins 变更 = restart）
```

### 8.3 mcp-bridge 集成

mcp-bridge 是 OpenClaw 的本地扩展（`openclaw-extensions/mcp-bridge/`），负责：
- 将 PetClaw 管理的 MCP 服务器工具暴露为 OpenClaw 原生 tool
- 命名格式: `mcp_{server}_{tool}`（如 `mcp_notion_search`）
- Agent 调用时通过 HTTP POST 转发给 PetClaw 主进程的 HookServer
- PetClaw 主进程调用实际 MCP server 并返回结果

---

## 9. IM 集成

### 9.1 OpenClaw 路由机制

OpenClaw 的 binding 匹配遵循 8 级优先级（resolve-route.ts）：

| Tier | Match 条件 | 含义 |
|------|-----------|------|
| 1 | channel + accountId + peer | 精确匹配到对话 |
| 2 | channel + accountId + guildId | 匹配到群组（Discord） |
| 3 | channel + accountId + teamId | 匹配到团队 |
| 4 | channel + accountId + roles | 角色匹配 |
| 5 | channel + peer | 跨实例匹配对话 |
| 6 | channel + accountId | 匹配到实例 |
| 7 | channel | 匹配到平台 |
| 8 | (default) | 兜底 main agent |

### 9.2 两层绑定设计

**实例级默认**（Tier 6 account match）：
- im_instances.directory_path 设置后 → ConfigSync 生成 `{ agentId, match: { channel, accountId } }`
- 该 bot 实例的所有消息默认路由到这个目录的 agent
- 未设置 directory_path 时，走 main agent 兜底

**对话级覆盖**（Tier 1 peer match）：
- im_conversation_bindings 记录特定对话绑定的目录
- ConfigSync 生成 `{ agentId, match: { channel, accountId, peer } }`
- 优先级高于实例级，可以让不同群/私聊走不同目录

### 9.3 accountId 生成

```typescript
// im_instances.id 是 UUID，取前 8 位作为 accountId
const accountId = instanceId.slice(0, 8)
```

### 9.4 IM 频道映射

OpenClaw 中一个 platform = 一个 channel ID：

| PetClaw platform | OpenClaw channel |
|-----------------|------------------|
| feishu | feishu |
| telegram | telegram |
| discord | discord |
| wechat | wechat |
| dingtalk | dingtalk |
| qq | qq |

### 9.5 前端 IM 管理

- 实例列表页：显示所有 bot 实例，可设置默认工作目录
- 对话列表页：显示该实例的所有对话（群+私聊），可逐个设置工作目录
- 设置工作目录 = 选择目录 → deriveAgentId → 写入 im_conversation_bindings → ConfigSync → 热重载

### 9.6 binding 变更不重启

OpenClaw config-reload-plan 中 bindings 变更的 action 是 `none`（热重载），不需要重启 Gateway。这意味着用户修改 IM 绑定目录时，可以即时生效而不打断正在进行的对话。

---

## 10. 定时任务

### 10.1 设计原则

定时任务的 CRUD 完全委托给 OpenClaw `cron.*` RPC。PetClaw 只存附加元数据。

### 10.2 RPC 接口

| 操作 | RPC | 说明 |
|------|-----|------|
| 创建 | `cron.create` | 传入 cron 表达式、prompt、agentId |
| 列表 | `cron.list` | 获取所有任务 |
| 更新 | `cron.update` | 修改 cron/prompt/enabled |
| 删除 | `cron.delete` | 删除任务 |
| 执行历史 | `cron.history` | 获取执行记录 |

### 10.3 元数据存储

`scheduled_task_meta` 表存 PetClaw 侧的附加信息：
- `directory_path` / `agent_id` — 任务关联的目录（决定执行环境）
- `origin` — 创建来源（gui=设置页、chat=对话中创建、api=外部调用）
- `binding` — IM 推送配置（任务执行完毕后推送到哪个 IM 对话）

### 10.4 执行模式

| 模式 | 说明 | agentId |
|------|------|---------|
| isolated | 新建独立会话执行 | 任务绑定的 agent |
| main | 注入到已有会话 | 同上 |

### 10.5 前端 UI（参考设计稿 `docs/设计/定时任务/`）

- 任务列表：显示所有定时任务，状态/下次执行/最近结果
- 创建/编辑表单：cron 表达式（可视化选择器）、prompt、目录选择、IM 推送配置
- 执行历史：按任务查看历史执行记录、输出、耗时

---

## 11. 对话框 "+" 菜单

### 11.1 菜单结构

```
点击 "+" 按钮:
┌──────────────┐
│ 🔧 技能      → │  → 技能子菜单
│ ⚡ 连接器    → │  → 连接器子菜单
│ 📎 添加文件    │  → 文件选择器
└──────────────┘
```

### 11.2 技能子菜单

```
┌─ 自定义技能 ──────────────────────┐
│ deep-research  综合多源信息并...  │  ← 点击激活/取消
│ drafter        帮你把「系统怎...  │
├─ 内置技能 ────────────────────────┤
│ create-skill   引导用户创建...    │
│ docx           高级 Word 文档...  │
│ find-skills    当用户询问...      │
│ pdf            高级 PDF 文档...   │
├───────────────────────────────────┤
│ ⚙ 管理技能                       │  ← 跳转设置页
└───────────────────────────────────┘
```

- 只显示全局 enabled 且在当前目录 skill 白名单内的技能
- 点击即激活/取消（toggle），前端 Zustand 管理 `activeSkillIds`
- 激活的技能以 Badge 标签显示在输入框上方

### 11.3 连接器子菜单

```
┌─ 连接器 Beta ─────────────────────┐
│ 在此快速开关；完整选项请在设置中  │
├─ MCP ─────────────────────────────┤
│ Notion          ○                 │  ← Toggle 开关
│ Linear          ○                 │
│ Todoist         ●                 │  ← 已启用
│ Slack           ○                 │
├───────────────────────────────────┤
│ ⚙ 管理连接器                     │  ← 跳转设置页
└───────────────────────────────────┘
```

- Toggle 改变的是 **全局 enabled 状态**（mcp_servers.enabled）
- 开关后立即 refreshMcpBridge → ConfigSync → Gateway 重启
- **不显示 Badge**（MCP 是全局生效，不需要会话级标记）

### 11.4 Badge 展示区

```
┌────────────────────────────────────────┐
│  [deep-research ×] [docx ×]           │  ← 激活的 Skill Badge
├────────────────────────────────────────┤
│  描述任务，/ 快捷方式...              │  ← 输入框
│                                 + ⚡ ↑ │
└────────────────────────────────────────┘
```

---

## 12. Gateway 重启策略

### 12.1 重启条件

| 变更 | 需要重启 |
|------|---------|
| API Key / Provider 变更 | 是（环境变量变更） |
| MCP 服务器增删/开关 | 是（plugins 变更） |
| IM 实例 credentials 变更 | 是（环境变量变更） |
| 目录 model/skill 变更 | 否（热重载） |
| IM binding 变更 | 否（热重载） |
| Skill enable/disable | 否（热重载 + config bump） |

### 12.2 活跃工作负载保护

参考 LobsterAI 实现：当有活跃会话时，延迟重启：

```typescript
function needsRestart(configDiff: ConfigDiff): boolean {
  // 判断 diff 是否涉及需要重启的字段
}

async function safeRestart(): Promise<void> {
  if (hasActiveWorkloads()) {
    // 标记 pendingRestart = true
    // 所有活跃会话完成后自动重启
    return
  }
  await engineManager.restartGateway()
}
```

### 12.3 重启通知

重启前通过 IPC 通知前端：
- `engine:restarting` — 前端显示 "AI 引擎重启中..." 提示
- `engine:ready` — 重启完成，恢复正常

---

## 13. 模块职责变更

对比 v3 原设计的变更：

| 模块 | v3 原设计 | 目录驱动版 |
|------|----------|-----------|
| **AgentManager** | 多 Agent CRUD，预设+自定义 | **删除**，改为 DirectoryManager（目录 CRUD） |
| **DirectoryManager** (新) | 无 | 目录注册/别名/model_override/skill_ids |
| **SessionManager** | 绑定 Agent + workspace | 绑定 directory_path，agent_id 自动派生 |
| **CoworkController** | 不变 | 不变 |
| **ConfigSync** | agents.list 从 agents 表聚合 | agents.list 从 directories 表聚合 |
| **ImGateway** | Agent 绑定 IM | 目录 → agent → binding |
| **SchedulerManager** | 关联 agentId | 关联 directory_path + agent_id |
| **McpManager** | 不变 | 不变（全局 enabled） |
| **SkillManager** | 不变 | 新增目录级白名单支持 |

### 13.1 DirectoryManager

```typescript
class DirectoryManager {
  // 注册目录（首次使用时自动调用）
  register(directoryPath: string, name?: string): Directory

  // 获取目录配置
  get(agentId: string): Directory | null
  getByPath(directoryPath: string): Directory | null

  // 列出所有目录
  list(): Directory[]

  // 更新目录配置
  updateName(agentId: string, name: string): void
  updateModelOverride(agentId: string, model: string): void
  updateSkillIds(agentId: string, skillIds: string[]): void

  // 确保目录已注册（幂等）
  ensureRegistered(directoryPath: string): Directory
}
```

---

## 14. 数据流

### 14.1 用户发送消息（本地桌面端）

```
用户在聊天窗口输入消息
  → 选择工作目录: /Users/xxx/my-project
  → 激活 Skills: [deep-research]
  → 点击发送
  → 前端: IPC chat:send { message, cwd, activeSkillIds }
  → 主进程:
    1. DirectoryManager.ensureRegistered(cwd) → 确保目录已注册
    2. deriveAgentId(cwd) → ws-a1b2c3d4e5f6
    3. SessionManager.createAndStart(title, cwd, message, { skillIds })
    4. 构建 inline skill prompt
    5. Gateway.chatSend(sessionKey, message, { skills, model })
  → OpenClaw runtime 执行
  → SSE 流式事件 → CoworkController → IPC → 前端渲染
  → 完成 → 宠物动画 Happy → Idle
```

### 14.2 IM 消息流

```
飞书用户发送消息
  → OpenClaw runtime 收到 IM 消息
  → resolve-route: channel=feishu, accountId=a1b2c3d4, peer=user:ou_xxxx
  → 匹配 binding:
    优先: im_conversation_bindings（Tier 1 peer match）
    兜底: im_instances 默认目录（Tier 6 account match）
    最终兜底: main agent（Tier 8 default）
  → 路由到对应 agent
  → 执行 & 回复
  → PetClaw 主进程收到事件 → 更新 im_session_mappings
```

### 14.3 定时任务触发

```
Cron 时间到达
  → OpenClaw runtime 触发 cron job
  → 使用 scheduled_task_meta.agent_id 确定执行 agent
  → 执行 prompt
  → 完成后检查 binding → 推送到 IM（如果配置了）
  → PetClaw 主进程收到事件 → 更新 UI
```

### 14.4 宠物动画联动

```
CoworkController 事件 → PetEventBridge → Pet 窗口

事件映射:
  message(type=user)     → ChatSent
  messageUpdate(首次)    → AIResponding
  complete              → AIDone
  error                 → AIDone
  permissionRequest     → 气泡: "等待审批: {toolName}"
  messageUpdate(后续)   → 气泡: 最新内容片段
```

---

## 附录 A: 与 v3 原设计的差异总结

| 项目 | v3 原设计 | 目录驱动版 |
|------|----------|-----------|
| 核心概念 | Agent-centric，用户管理 Agent | Directory-centric，Agent 自动派生 |
| 用户可见 | Agent 名称、Agent 配置页 | 目录路径、目录别名 |
| Agent ID | 用户创建时生成 UUID | `deriveAgentId(path)` 确定性 hash |
| 表结构 | agents 表 | directories 表 |
| DB 表前缀 | cowork_ | 无前缀 |
| IM 绑定 | Agent ↔ IM | 目录 → Agent ↔ IM（两层绑定） |
| MCP 作用域 | 未明确 | 全局 enabled |
| Skill 作用域 | 全局 | 全局 + 目录白名单 + 会话激活 |
| 模型切换 | 未明确 | 三级优先级（session > directory > global） |

## 附录 B: 需保留的 v3 设计

以下 v3 原设计中的内容在目录驱动版中**完全保留不变**：

- **基础层**: OpenclawEngineManager（§4）、OpenclawGateway（§5）的完整设计
- **ConfigSync**: 基础机制不变，只是数据源从 agents 表改为 directories 表
- **CoworkController**: 执行模式、权限审批、流式事件协议
- **BootCheck**: 启动流程（§16）
- **IPC Router**: 模块化拆分方案（§18）
- **PetEventBridge**: 宠物动画联动（§22.4）
- **文件系统路径**: petmind/、SKILLs/、openclaw-extensions/ 布局（§4.2）
- **Runtime 分发策略**: extraResources 打包（§4.3）
- **Gateway 入口解析**: 候选链（§4.4）
- **Openclaw 版本管理**: （§20）
- **开发到上线流程**: （§24）
