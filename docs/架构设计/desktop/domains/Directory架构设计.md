# Directory 架构设计

## 1. 模块定位

Directory 管理“目录驱动 Agent”。用户在产品里选择的是工作目录，不直接创建或管理 Agent；PetClaw 根据目录路径确定性派生 agentId，并把目录配置同步到 OpenClaw `agents.list`。

Directory 是 Cowork、IM、Cron、ConfigSync 和 Renderer 当前目录状态的共同基础。它必须保证同一目录在所有链路中只有一个稳定身份，避免侧栏、Chat 发送、会话固化和 runtime 配置使用不同 cwd。

## 2. 核心概念

- 工作目录：用户选择的项目路径，必须解析为绝对路径。
- agentId：由目录路径确定性派生，格式为 `ws-<12 hex>`。
- main agent：固定 ID `main`，用于默认工作区和无目录绑定的兜底场景。
- Directory record：`directories` 表中的目录配置。
- model override：目录级模型覆盖，优先级低于 session 覆盖，高于全局默认模型。
- skill allowlist：目录级 skill 白名单，限制该目录 agent 可用 skill 范围。
- `agents.list`：OpenClaw runtime 识别 agent 的配置列表。

Session Key 格式：

```text
agent:{agentId}:petclaw:{sessionId}
```

模型优先级：

```text
session.model_override
  -> directory.model_override
  -> app_config['model.defaultModel']
```

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ Renderer                                                           │
│ Sidebar / ChatInputBox / Settings directory UI                      │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ directory:* / dialog:select-directory
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Main Process                                                        │
│                                                                    │
│  DirectoryManager                                                  │
│  ├── normalize path                                                │
│  ├── derive stable agentId                                         │
│  ├── persist directories row                                       │
│  ├── update alias/model/skill allowlist                            │
│  └── serialize agents.list                                         │
└──────────────┬───────────────────────────────┬─────────────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────┐   ┌───────────────────────────────┐
│ SQLite directories table      │   │ ConfigSync                    │
│ path/user-facing config       │   │ openclaw.json agents.list     │
└──────────────────────────────┘   └───────────────┬───────────────┘
                                                    ▼
                                      ┌────────────────────────────┐
                                      │ OpenClaw Runtime            │
                                      │ agents.main + ws-* agents   │
                                      └────────────────────────────┘
```

关键文件：

| 层 | 文件 |
|---|---|
| Manager | `petclaw-desktop/src/main/ai/directory-manager.ts` |
| Store | `petclaw-desktop/src/main/data/directory-store.ts` |
| IPC | `petclaw-desktop/src/main/ipc/directory-ipc.ts` |
| Preload | `petclaw-desktop/src/preload/index.ts` |
| DB schema | `petclaw-desktop/src/main/data/db.ts` |
| ConfigSync | `petclaw-desktop/src/main/ai/config-sync.ts` |
| Renderer | `petclaw-desktop/src/renderer/src/views/chat/` |

## 4. 端到端数据流

用户首次选择目录：

```text
Renderer select directory
  -> dialog:select-directory
  -> DirectoryManager.ensureRegistered(path)
  -> path.resolve / normalize
  -> deriveAgentId(normalizedPath)
  -> upsert directories row
  -> ConfigSync.sync('directory-register')
  -> openclaw.json agents.list includes ws-* entry
  -> Cowork session starts with cwd + agentId
```

目录配置变更：

```text
Directory Settings
  -> directory:update-model / directory:update-skills / directory:update-name
  -> DirectoryManager updates row
  -> ConfigSync.sync('directory-update')
  -> agents.list reflects model/skills
  -> active sessions keep their persisted session context
```

IM 或 Cron 使用目录：

```text
IM conversation / scheduled task binding
  -> stores agentId and directory path
  -> runtime trigger locates agent
  -> Cowork session starts or continues under that directory context
```

## 5. 状态机与生命周期

```text
unknown path
  -> normalized path
  -> registered directory
  -> configured directory
  -> referenced by session / IM / Cron
  -> archived only when no active references
```

规则：

- 注册是幂等操作。同一绝对路径必须返回同一个 agentId。
- `directories` 不按活跃度剪枝。历史 IM 绑定、Cron 任务和 transcript 可能引用旧 agent。
- 删除或归档目录前必须扫描 Cowork、IM、Cron 引用关系。
- main agent 不由目录派生，不可删除。

## 6. 数据模型

`directories` 表字段：

```sql
CREATE TABLE IF NOT EXISTS directories (
  agent_id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT,
  model_override TEXT DEFAULT '',
  skill_ids TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

字段含义：

| 字段 | 说明 |
|---|---|
| `agent_id` | `deriveAgentId(path)` 结果，OpenClaw、IM、Cron 以它寻址 |
| `path` | 用户目录绝对路径，唯一 |
| `name` | 用户自定义别名，可为空 |
| `model_override` | 目录级模型覆盖，空字符串表示跟随全局 |
| `skill_ids` | JSON 数组，目录级 skill 白名单 |
| `created_at` / `updated_at` | 本地配置时间戳 |

agentId 派生规则：

```text
path.resolve(directoryPath)
  -> sha256(resolvedPath)
  -> first 12 hex chars
  -> "ws-" + hash
```

约束：

- 输入必须先解析相对路径、`~` 和尾部 `/` 差异。
- 12 位 hex 是 48 bit，碰撞概率可忽略；如果发生 UNIQUE 冲突，必须阻断并记录错误。
- `ws-` 表示 workspace-derived，和 `main` 区分。

## 7. IPC / Preload 契约

Directory IPC 见 `IPCChannel契约.md`。核心 channel：

```text
directory:list
directory:get
directory:get-by-path
directory:update-name
directory:update-model
directory:update-skills
dialog:select-directory
```

所有写操作必须在 main 校验：

- agentId 是否存在。
- model 是否是 Models 模块可识别的模型 ID。
- skillIds 是否存在且已启用。
- path 是否是用户通过系统选择器或可信来源确认的路径。

## 8. Renderer 布局、状态与交互

Directory 在前端体现为三个位置：

```text
┌────────────────────────────────────────────────────────────────────┐
│ Chat / Cowork                                                       │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ ChatTitleSlot: 当前目录摘要 / 当前会话标题                       │ │
│ └────────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ ChatInputBox                                                    │ │
│ │ [cwd selector: /Users/example/project             选择目录...]  │ │
│ │ 发送时固化 cwd / agentId / session directory context             │ │
│ └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┐
│ Sidebar                      │
│ ┌──────────────────────────┐ │
│ │ 当前目录入口              │ │
│ ├──────────────────────────┤ │
│ │ 会话列表                  │ │
│ │ - session title           │ │
│ │ - directory badge         │ │
│ │ - running/unread          │ │
│ └──────────────────────────┘ │
│ 只展示目录上下文，不成为第二个 cwd 事实源                              │
└──────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ Settings / 工作目录                                                 │
│ 管理已注册目录、别名、模型覆盖和 skill 白名单                         │
│                                                                    │
│ ┌────────────────────┬─────────────────────────────────────────┐  │
│ │ 目录列表             │  目录配置                               │  │
│ │ ┌────────────────┐ │                                         │  │
│ │ │ my-project     │ │  路径                                   │  │
│ │ │ /Users/...     │ │  /Users/example/my-project              │  │
│ │ │ ws-a1b2c3...   │ │                                         │  │
│ │ ├────────────────┤ │  别名                                   │  │
│ │ │ petclaw        │ │  [ PetClaw repo                       ] │  │
│ │ └────────────────┘ │                                         │  │
│ │                    │  模型覆盖                                │  │
│ │                    │  [ 跟随全局默认模型                  ∨ ] │  │
│ │                    │                                         │  │
│ │                    │  Skill 白名单                            │  │
│ │                    │  ┌───────────────────────────────────┐  │  │
│ │                    │  │ [x] docx   [ ] research  [x] mcp  │  │  │
│ │                    │  └───────────────────────────────────┘  │  │
│ │                    │                              [保存更改] │  │
│ └────────────────────┴─────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

页面入口与源码：

| 区域 | 源码 |
|---|---|
| Settings/Directory | `petclaw-desktop/src/renderer/src/views/settings/DirectorySettings.tsx` |
| 目录配置弹窗 | `petclaw-desktop/src/renderer/src/components/DirectoryConfigDialog.tsx` |
| Skill 白名单 | `petclaw-desktop/src/renderer/src/components/DirectorySkillSelector.tsx` |
| cwd 选择器 | `petclaw-desktop/src/renderer/src/components/CwdSelector.tsx` |
| Sidebar | `petclaw-desktop/src/renderer/src/components/Sidebar.tsx` |

状态来源：

| 状态 | 所有者 | 说明 |
|---|---|---|
| current directory | `App.tsx` 或 ChatInputBox 受控状态 | 全局唯一事实源 |
| directory list | `DirectorySettings` / Sidebar | 来自 `directory:list` |
| selected directory | 页面本地 state | 控制详情或弹窗 |
| directory draft | `DirectoryConfigDialog` | 保存前不写主数据 |
| skill allowlist | `DirectorySkillSelector` | 保存到 `directory:update-skills` |

当前目录规则：

- 前端只能有一个“当前目录”事实源。
- Chat 发送、会话启动、继续会话、目录展示必须从同一状态源读取。
- 如需缓存，只能缓存 `sessionId -> directoryId/cwd` 这类已固化上下文。
- 禁止侧栏显示一个目录，而 ChatInputBox 发送另一个隐式 cwd。

## 9. Runtime / Gateway 集成

ConfigSync 负责把 Directory 序列化到 `openclaw.json`：

```json
{
  "agents": {
    "defaults": {
      "workspace": "{userData}/openclaw/workspace"
    },
    "list": [
      { "id": "main", "default": true },
      {
        "id": "ws-a1b2c3d4e5f6",
        "workspace": "/Users/example/project",
        "model": { "primary": "gpt-4o" },
        "skills": ["deep-research", "docx"]
      }
    ]
  }
}
```

DirectoryManager 只输出 `agents.list` 所需的目录记录。`agents.defaults` 由 ConfigSync 汇总全局模型、memorySearch 和 main workspace 规则后生成。

## 10. 错误态、安全和权限

- 路径不存在、权限不足或不可访问时，UI 必须展示可恢复错误。
- 用户项目目录不应被 DirectoryManager 主动写入 `AGENTS.md`；非 main agent 的工作目录只作为 workspace 指向。
- 目录级配置不能覆盖敏感 env 或 runtime token。
- 删除目录配置前必须检查引用，避免 IM/Cron 历史绑定悬空。
- renderer 不得自行派生 agentId 并跳过 main 校验。

## 11. 与其它模块的关系

| 模块 | 关系 |
|---|---|
| Cowork | 会话启动时固化 cwd、agentId、model context |
| ConfigSync | 读取目录列表生成 `agents.list` |
| Models | 提供目录级模型覆盖候选 |
| Skills | 提供目录级 skill 白名单候选 |
| IM | conversation binding 指向具体目录/agentId |
| Cron | 定时任务可绑定目录 agent |
| Renderer | 展示当前目录和目录配置入口 |
| DataStorage | 持久化 `directories` 表 |

## 12. 测试策略

- `deriveAgentId` 对相对路径、尾 `/`、`~`、重复路径的稳定性测试。
- `ensureRegistered` 幂等测试。
- `directory:update-*` 校验和持久化测试。
- ConfigSync `agents.list` 聚合快照测试。
- Chat 发送 cwd 与会话固化上下文一致性测试。
- IM/Cron 引用目录后重启应用的恢复测试。
