# ConfigSync 架构设计

## 1. 模块定位

ConfigSync 是 OpenClaw runtime 配置同步入口，负责把 PetClaw 本地配置聚合成 runtime 可消费的文件和审批配置。

## 2. 核心概念

- `openclaw.json`：runtime 配置文件。
- main workspace `AGENTS.md`：main agent 工作区规则。
- `exec-approvals.json`：OpenClaw 执行审批默认配置。
- env placeholder：敏感信息写入 runtime 配置时的占位策略。
- changed：同步结果是否需要 boot/reload 链路感知。
- `needsGatewayRestart`：配置变化是否必须重启 Gateway 才能生效。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ Domain Stores                                                       │
│ Directory / Models / Skills / MCP / IM / Cron / Memory / Cowork     │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ read only
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ ConfigSync                                                          │
│  single writer for runtime configuration                            │
│                                                                    │
│  buildGatewayConfig      buildModelsConfig      buildAgentsConfig   │
│  buildSkillsConfig       buildPluginsConfig     buildBindingsConfig │
│  buildCronConfig         buildHooksConfig       buildCommandsConfig │
└──────────────┬───────────────────────────────┬─────────────────────┘
               │                               │
               │ atomic file writes            │ collectSecretEnvVars()
               ▼                               ▼
┌──────────────────────────────┐   ┌───────────────────────────────┐
│ Runtime Files                │   │ EngineManager                  │
│ - openclaw.json              │   │ - setSecretEnvVars             │
│ - workspace/AGENTS.md        │   │ - restart / pendingRestart     │
│ - exec-approvals.json        │   │ - child process env            │
└──────────────┬───────────────┘   └───────────────┬───────────────┘
               │                                   │
               └──────────────────┬────────────────┘
                                  ▼
                         ┌────────────────┐
                         │ OpenClaw Runtime│
                         └────────────────┘
```

关键文件：

| 层 | 文件 |
|---|---|
| ConfigSync | `petclaw-desktop/src/main/ai/config-sync.ts` |
| Managed prompts | `petclaw-desktop/src/main/ai/managed-prompts.ts` |
| System prompt | `petclaw-desktop/src/main/ai/system-prompt.ts` |
| Directory manager | `petclaw-desktop/src/main/ai/directory-manager.ts` |
| Cowork config store | `petclaw-desktop/src/main/data/cowork-config-store.ts` |
| Model registry | `petclaw-desktop/src/main/models/model-registry.ts` |
| Memory search config | `petclaw-desktop/src/main/memory/memory-search-config-store.ts` |

同步时序图：

```text
Settings UI        Domain Store        ConfigSync        EngineManager        Runtime
    │                   │                  │                   │                 │
    │ 保存配置           │                  │                   │                 │
    │──────────────────▶│                  │                   │                 │
    │                   │ persist          │                   │                 │
    │                   │─────────────────▶│ sync(reason)      │                 │
    │                   │                  │ build config      │                 │
    │                   │                  │ write files       │                 │
    │                   │                  │ collect secrets   │                 │
    │                   │                  │──────────────────▶│ set env vars     │
    │                   │                  │ needsRestart?     │                 │
    │                   │                  │──────────────────▶│ restart/defer    │
    │                   │                  │◀──────────────────│ result           │
    │◀──────────────────│◀─────────────────│ changed/restart    │                 │
```

ConfigSync 是唯一写入 `openclaw.json` 的模块。`openclaw.json` 由分域 builder 生成：

```text
gateway
models
agents
tools
browser
skills
cron
plugins
channels
bindings
hooks
commands
```

## 4. 端到端数据流

用户修改模型、目录、MCP、IM、Cron 或 Skill 后，对应 store 持久化配置；服务触发 ConfigSync；ConfigSync 聚合各域配置，生成 runtime 文件；如果文件或 main workspace `AGENTS.md` 变化，返回 changed；调用方据此决定是否 reload runtime 或提示用户。

单入口同步：

```text
sync(reason)
→ syncAgentsMd(workspacePath)
→ syncExecApprovalDefaults()
→ syncOpenClawConfig()
→ collectSecretEnvVars()
→ return { ok, changed, needsGatewayRestart, configPath }
```

敏感信息流：

```text
ModelRegistry / IM / MCP / Memory stores
→ collectSecretEnvVars()
→ EngineManager.setSecretEnvVars()
→ Gateway child process env

openclaw.json 只写 ${VAR} placeholder
```

## 5. 状态机与生命周期

```text
dirty
→ syncing
→ changed | unchanged
→ reload-needed | ready
→ failed
```

重启判断：

| 变更类型 | ConfigSync | Gateway 重启 |
|---|---|---|
| Cowork systemPrompt / defaultDirectory | 是 | 否 |
| 模型 provider / API key | 是 | 是 |
| 目录 model override / skill ids | 是 | 否 |
| 全局 skill enable/disable | 是 | 否 |
| IM binding | 是 | 否 |
| IM credentials | 是 | 是 |
| MCP Bridge callback/secret/tools | 是 | 是 |
| 新目录首次使用 | 是 | 否 |

存在活跃会话时，需要重启的变更应延迟，记录为 pending restart，待会话完成后执行。

## 6. 数据模型

ConfigSync 不拥有业务表，只读取各模块 store。DirectoryManager 只输出 `agents.list`，不负责全局 defaults。

`agents.defaults.memorySearch` 是全局记忆检索配置。main agent 和目录 agent 默认继承；当前不做目录级 memorySearch override。

Main workspace 文件职责：

| 文件 | 写入方 | 说明 |
|---|---|---|
| `AGENTS.md` | ConfigSync | 模板 + managed section |
| `SOUL.md` | Runtime | PetClaw 不写 |
| `IDENTITY.md` | Runtime | PetClaw 不写 |
| `USER.md` | Runtime/Agent | PetClaw 不写 |
| `MEMORY.md` / `memory/*.md` | Runtime/Agent | PetClaw 不写 |

## 7. IPC / Preload 契约

renderer 通常不直接调用底层 ConfigSync，而是通过设置页保存操作间接触发。需要用户可见同步状态时，通过主进程返回 changed/error。

`ConfigSync.sync()` 的调用方必须处理：

- `changed=false`：无需提示 reload。
- `changed=true` 且 `needsGatewayRestart=false`：可热同步或提示配置已生效。
- `needsGatewayRestart=true`：根据活跃任务状态立即重启或延迟重启。

## 8. Renderer 布局、状态与交互

设置保存必须有保存中、成功、失败和需要重启/重载提示。失败不能只写 `console.error`。

Renderer 不应直接编辑 runtime 文件。所有 UI 保存都必须先落到 PetClaw store，再由 main 触发 ConfigSync。

ConfigSync 没有独立页面，它体现在多个 Settings 页面保存后的统一反馈层：

```text
┌────────────────────────────────────────────────────────────────────┐
│ Settings Page                                                       │
│                                                                    │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ Models / MCP / IM / Cron / Directory / Memory form            │   │
│ │ 本地草稿                                                      │   │
│ │ 字段级校验错误                                                │   │
│ │                                                 [保存中...]   │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                                                    │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ Sync Result Banner                                            │   │
│ │ ✓ 配置已保存并同步                                             │   │
│ │ ! 已保存，但 Runtime 需要重启才能生效             [立即重启]   │   │
│ │ ! 当前有活跃会话，重启将在任务结束后执行          [查看任务]   │   │
│ │ ✕ ConfigSync 失败，runtime 配置未更新             [重试同步]   │   │
│ └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

触发 ConfigSync 的前端页面：

| 页面 | 触发保存 | UI 必须展示 |
|---|---|---|
| Models | provider/API key/default model | 保存结果、测试连接结果、needsGatewayRestart |
| MCP | server create/update/enable/bridge refresh | bridge sync 状态、ConfigSync 失败重试 |
| IM | instance credentials/binding | 绑定同步结果、runtime 等待状态 |
| Cron | task create/update/toggle | 保存结果、runtime cron RPC 错误 |
| Directory | alias/model/skill allowlist | 保存结果、目录级配置同步 |
| Memory | memorySearch config | 保存结果、runtime doctor 状态 |
| Cowork Settings | defaultDirectory/systemPrompt | 保存结果、是否热生效 |

状态来源：

| 状态 | 所有者 | 说明 |
|---|---|---|
| form draft | 各 Settings 页面 | 保存前本地状态 |
| save pending | 各 Settings 页面 | 当前保存按钮 pending |
| sync result | main service response | `{ changed, needsGatewayRestart, error }` |
| active workload | Cowork/Runtime state | 决定立即重启或延迟重启 |
| retry action | 当前页面或 shared helper | 重新触发对应保存/同步 |

交互状态：

- `changed=false`：只展示保存成功，不提示 runtime。
- `changed=true` 且可热生效：展示已同步。
- `needsGatewayRestart=true` 且无活跃任务：展示立即重启入口。
- `needsGatewayRestart=true` 且有活跃任务：展示延迟重启说明和任务入口。
- ConfigSync 失败：表单数据已保存时要明确“本地已保存，但 runtime 配置未更新”。

## 9. Runtime / Gateway 集成

ConfigSync 写入 runtime 启动和运行时读取的配置。runtime 未就绪时可以准备文件，但不能假设 Gateway 可用。

Skills 加载机制：

- 通过 `skills.load.extraDirs` 告诉 runtime 扫描 `{userData}/skills`，该目录包含启动时从 `Resources/skills` 同步的内置 skills 和用户自定义 skills。
- 不通过 main workspace `AGENTS.md` 写入 skill 列表。
- 用户发送消息时通过 `skillIds` 选择本轮 skill。

## 10. 错误态、安全和权限

敏感信息只能通过 env placeholder 写入 runtime 配置。同步失败必须保留错误日志，并向用户展示可操作提示。

`AGENTS.md` 同步策略：

- 保留 marker 前用户手写内容。
- marker 后由 PetClaw managed section 管理。
- 用户显式保存空 system prompt 时，不再写入默认 `SYSTEM_PROMPT.md`。
- 非 main agent 不主动写用户项目目录下的 `AGENTS.md`，避免污染仓库。

## 11. 与其它模块的关系

ConfigSync 聚合 Directory、Model、Skill、MCP、IM、Cron、memorySearch 和 exec approvals。它不应散落到业务代码的裸 key 写入中。

## 12. 测试策略

- 配置聚合快照测试。
- main workspace `AGENTS.md` 变化返回 changed 的测试。
- 敏感信息不落盘测试。
- 各模块保存后触发同步的集成测试。
