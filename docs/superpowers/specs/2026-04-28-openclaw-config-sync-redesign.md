# OpenClaw ConfigSync 重构设计

**日期**: 2026-04-28  
**状态**: 设计完成，待实现  
**范围**: `ConfigSync` 分层重构、OpenClaw managed baseline、IM channels/bindings/plugins、skills 与 exec approvals、全局 memorySearch 预留

---

## 1. 背景

PetClaw 当前已经把 OpenClaw runtime 作为核心 AI 执行层，`ConfigSync` 是唯一写入 `openclaw.json` 的模块。但当前实现仍偏薄：

- `buildConfig()` 直接拼一个对象，后续 IM、MCP、cron、memorySearch、plugins 都加入后会快速膨胀。
- 只写了 `gateway`、`models`、`agents`、`skills`、`plugins`、`hooks`、`commands` 的最小字段。
- 缺少 LobsterAI 中已经验证过的 runtime 基线字段，例如 `gateway.auth`、`tailscale`、`tools`、`browser`、`cron`、`exec-approvals.json`。
- IM 已经有 `ImGatewayManager` 和持久化层，但尚未纳入 `ConfigSync` 输出。
- `memorySearch` 是 OpenClaw runtime 提供的 agent 记忆检索能力，PetClaw 需要预留全局配置入口，但不应过早做目录级复杂覆盖。

本设计参考 LobsterAI `src/main/libs/openclawConfigSync.ts` 的成熟结构，但不照搬其历史包袱。PetClaw 采用目录驱动 agent、轻量 IM 配置和统一 `app_config` typed store 体系。

---

## 2. 参考结论

### 2.1 LobsterAI `managedConfig` 职责

LobsterAI 的 `managedConfig` 大致覆盖：

- `gateway`: 保留 existing 字段，强制 local、token auth、tailscale off。
- `models`: provider/model 映射，API Key 通过 env placeholder。
- `agents.defaults`: timeout、model、sandbox、workspace、memorySearch。
- `agents.list`: main/custom agents，包含 model、workspace、skills。
- `commands`: owner allow list。
- `tools`: deny built-in `web_search`，关闭 runtime web search。
- `browser`: 启用 browser 工具。
- `skills`: entries、load.extraDirs、watch、managed disabled overrides。
- `cron`: runtime cron 开关和运行策略。
- `plugins`: 保留 runtime auto-injected plugin entries，叠加应用托管插件。
- `channels` / `bindings`: IM 通道账号和路由绑定。
- `exec-approvals.json`: 设置 main agent `security=full`、`ask=off`。
- `AGENTS.md`: system prompt、web search policy、exec safety、memory policy、skill creation、scheduled task policy。

### 2.2 不应照搬的 LobsterAI 复杂度

以下逻辑属于 LobsterAI 历史和业务复杂度，PetClaw 当前不引入：

- 企业版 sandbox 授权判断。
- 多年前旧模型配置迁移。
- 大量 IM 平台兼容分支。
- 旧 channel session store 迁移和 history reconcile。
- Qwen、DingTalk、Feishu 等特定插件重启诊断细节。
- embedding UI 的完整配置面板。

PetClaw 只吸收 OpenClaw runtime 必需基线和当前业务已经存在的 IM/MCP/Skill/Cron 配置。

---

## 3. 设计目标

1. **保持 ConfigSync 单入口**：`openclaw.json`、main workspace `AGENTS.md`、exec approvals 都由 `ConfigSync.sync()` 统一触发。
2. **分域构建 managed config**：用私有 builder 拆分 gateway、models、agents、skills、tools、cron、plugins、channels、bindings、memorySearch。
3. **补齐 OpenClaw baseline**：写入稳定、必要、低风险的 runtime 基线字段。
4. **纳入 IM**：将 IM channels、bindings、插件启用状态和 secret env 纳入 ConfigSync 设计。
5. **保持目录驱动 agent**：目录 agent 仍由 `DirectoryManager` 输出 `agents.list`，继承 `agents.defaults`。
6. **正确处理 skills**：`extraDirs` 让 runtime 原生发现 skills；选中 skill 时只内联选中的 `SKILL.md` 正文；不选 skill 不拼 skill prompt。
7. **预留 memorySearch**：先设计全局 `agents.defaults.memorySearch`，目录 agent 默认继承，不做目录级覆盖。
8. **避免 secrets 落盘**：API Key、IM token、MCP bridge secret 只通过 env placeholder 写入配置。

---

## 4. 非目标

- 不重建 LobsterAI 的 Agent-centric UI。
- 不在本次实现 embedding/memorySearch 设置页面。
- 不做目录级 memorySearch override。
- 不把所有 skill 文件、脚本、references 拼进 prompt。
- 不把 IM 所有平台一次性完整实现到 UI；ConfigSync 只消费已有 `ImGatewayManager` 输出。
- 不把 `ConfigSync` 拆成多个对外服务；对外仍是一个 sync 入口。

---

## 5. 总体架构

```text
ConfigSync
├── sync(reason)
│   ├── syncOpenClawConfig()
│   ├── syncAgentsMd()
│   ├── syncExecApprovalDefaults()
│   └── syncManagedSessionStore()
│
├── buildManagedConfig(existing)
│   ├── buildGatewayConfig(existing.gateway)
│   ├── buildModelsConfig()
│   ├── buildAgentsConfig()
│   ├── buildToolsConfig()
│   ├── buildBrowserConfig()
│   ├── buildSkillsConfig()
│   ├── buildCronConfig()
│   ├── buildPluginsConfig(existing.plugins)
│   ├── buildChannelsConfig()
│   ├── buildBindingsConfig()
│   ├── buildHooksConfig()
│   └── buildCommandsConfig()
│
└── collectSecretEnvVars()
```

对外 API 不变：

```ts
sync(reason: string): ConfigSyncResult
collectSecretEnvVars(): Record<string, string>
```

`ConfigSyncOptions` 增加可选依赖：

```ts
interface ConfigSyncOptions {
  configPath: string
  stateDir: string
  workspacePath: string
  skillsDir: string
  coworkConfigStore: CoworkConfigStore
  directoryManager: DirectoryManager
  modelRegistry: ModelRegistry
  skillManager: SkillManager
  mcpManager: McpManager
  imGatewayManager?: ImGatewayManager
  memorySearchConfigStore?: MemorySearchConfigStore
}
```

可选依赖的目的是允许当前阶段逐步接入：没有 IM 或 memorySearch store 时，builder 输出空配置或默认关闭。

---

## 6. Managed Config 字段设计

### 6.1 Gateway

目标：减少 runtime 配置 diff 和重启循环。

```ts
gateway: {
  ...existingGateway,
  mode: 'local',
  auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' },
  tailscale: { mode: 'off' }
}
```

规则：

- 保留 existing gateway 字段，兼容 OpenClaw runtime 自动注入字段。
- PetClaw 托管字段覆盖旧值。
- Desktop 只使用 loopback gateway，不启用 tailscale。

### 6.2 Models

继续委托 `ModelRegistry.toOpenclawConfig()`。

要求：

- `openclaw.json` 不写明文 API Key。
- Provider API Key 通过 `${PETCLAW_APIKEY_<PROVIDER>}` placeholder 引用。
- `collectSecretEnvVars()` 从 `ModelRegistry` 收集真实 secret。

### 6.3 Agents

```ts
agents: {
  defaults: {
    timeoutSeconds: 3600,
    model: { primary: modelRegistry.getDefaultOpenClawModelRef() },
    workspace: workspacePath,
    sandbox: { mode: 'off' },
    ...(memorySearch ? { memorySearch } : {})
  },
  list: directoryManager.toOpenclawConfig().list
}
```

目录驱动 agent 规则：

- `main` agent 使用 `agents.defaults.workspace`。
- 目录 agent 使用 `agents.list[i].workspace = directory.path`。
- 目录 agent 的 model override 继续写 `agents.list[i].model.primary`。
- 目录 agent 的 skill 白名单继续写 `agents.list[i].skills`。
- 目录 agent 默认继承 `agents.defaults.memorySearch`。

`memorySearch` 只写 `agents.defaults`。如果未来需要目录级覆盖，再在 `directories` 表增加 override 字段并输出 `agents.list[i].memorySearch`。当前阶段不做。

### 6.4 Tools 与 Browser

```ts
tools: {
  deny: ['web_search'],
  web: {
    search: { enabled: false }
  }
},
browser: {
  enabled: true
}
```

原因：

- PetClaw 不依赖 Brave Search API。
- Web 搜索策略由 managed `AGENTS.md` 指导：优先 `browser` / `web_fetch` / PetClaw `web-search` skill。
- 保持与 LobsterAI 一致，避免模型误用 runtime built-in `web_search`。

### 6.5 Skills

继续委托 `SkillManager.toOpenclawConfig()`，但规范输出：

```ts
skills: {
  entries: {
    ...skillManager.toOpenclawConfig().entries,
    ...MANAGED_SKILL_ENTRY_OVERRIDES
  },
  load: {
    extraDirs: [skillsDir],
    watch: true
  }
}
```

规则：

- `extraDirs` 指向 `{userData}/SKILLs`。
- `entries` 控制全局 enable/disable。
- 选中 skill 时，PetClaw 主进程读取对应 `SKILL.md`，去掉 frontmatter，作为本轮 `skillPrompt` 注入。
- 不选 skill 时不拼任何 skill prompt。
- 其他 `scripts/*.js`、`references/*.md` 不预拼，按 `SKILL.md` 中引用和 `<directory>` 规则由模型按需读取/执行。

### 6.6 Cron

```ts
cron: {
  enabled: true,
  skipMissedJobs: coworkConfigStore.getConfig().skipMissedJobs === true,
  maxConcurrentRuns: 3,
  sessionRetention: '7d'
}
```

当前 `CoworkConfigStore` 未必已有 `skipMissedJobs`，第一阶段可固定：

```ts
cron: { enabled: true, maxConcurrentRuns: 3, sessionRetention: '7d' }
```

后续再把 `skipMissedJobs` 纳入 typed config。

### 6.7 Plugins

目标：保留 runtime 自动注入插件，叠加 PetClaw 托管插件。

```ts
plugins: {
  ...existingPlugins,
  deny: [],
  entries: {
    ...cleanedExistingEntries,
    ...mcpManager.toOpenclawPluginEntries(),
    ...imGatewayManager.toOpenclawPluginEntries(),
    'mcp-bridge': { enabled: true, config: { ... } },
    'ask-user-question': { enabled: true, config: { ... } }
  }
}
```

实现原则：

- 不直接用 `McpManager.toOpenclawConfig()` 覆盖整个 `plugins`。
- 保留 existing `plugins.load`、`plugins.entries` 中 runtime 注入的稳定字段。
- PetClaw 管理的插件字段覆盖旧值。
- 明确清理已知不再存在且会导致 schema 校验失败的 stale plugin，可后续加白名单。

第一阶段可以只做到：

- 保留 `existing.plugins`。
- 合并当前 `McpManager.toOpenclawConfig()`。
- 不做复杂 stale plugin 清理。

### 6.8 IM Channels 与 Bindings

IM 应纳入 `ConfigSync`，因为 OpenClaw runtime 负责 channel 路由和 delivery。

建议 `ImGatewayManager` 提供三个方法：

```ts
toOpenclawChannelsConfig(): Record<string, unknown>
toOpenclawBindingsConfig(): { bindings?: Array<Record<string, unknown>> }
toOpenclawPluginEntries(): Record<string, { enabled: boolean; config?: Record<string, unknown> }>
collectSecretEnvVars(): Record<string, string>
```

ConfigSync 输出：

```ts
{
  channels: imGatewayManager.toOpenclawChannelsConfig(),
  ...imGatewayManager.toOpenclawBindingsConfig(),
  plugins: buildPluginsConfig(existing.plugins)
}
```

绑定规则：

- 用户/频道到 agent 的路由写 `bindings`。
- `agentId` 使用目录驱动 agent ID 或 `main`。
- IM credential 不写明文，配置中使用 `${PETCLAW_IM_<PLATFORM>_<ID>_TOKEN}`。
- `collectSecretEnvVars()` 汇总 IM secrets。

变更语义：

- channel credential/env 改变，需要重启 gateway。
- bindings 改变理论上应由 runtime 热加载；如果 OpenClaw 对 bindings 不热加载，则 `ConfigSyncResult` 增加 `bindingsChanged` 给上层决定重启。

### 6.9 MemorySearch

`memorySearch` 是 OpenClaw agent/runtime 提供的记忆检索能力。PetClaw 不自建 embedding 索引。

第一阶段只设计 typed store 和输出结构，不做 UI：

```ts
interface MemorySearchConfig {
  enabled: boolean
  provider: 'openai' | 'gemini' | 'voyage' | 'mistral' | 'ollama'
  model?: string
  remoteBaseUrl?: string
  remoteApiKeyEnv?: string
  vectorWeight?: number
}
```

输出：

```ts
memorySearch: {
  enabled: true,
  provider,
  ...(model ? { model } : {}),
  ...(remote ? { remote } : {}),
  store: { fts: { tokenizer: 'trigram' } },
  query: { hybrid: { vectorWeight } }
}
```

规则：

- 只写 `agents.defaults.memorySearch`。
- main agent 和目录 agent 默认继承。
- API Key 走 env placeholder。
- 默认关闭；没有配置时不输出 `memorySearch`。

### 6.10 Commands 与 Hooks

```ts
commands: {
  ownerAllowFrom: ['gateway-client', '*']
},
hooks: {
  internal: {
    entries: {
      'session-memory': { enabled: false }
    }
  }
}
```

保持当前行为。`ownerAllowFrom` 允许 gateway-client 和 IM channel sender 使用 owner-only 工具，例如 cron。

---

## 7. AGENTS.md 同步

`syncAgentsMd()` 继续写 main workspace 的 `AGENTS.md`。

内容：

- 用户区保留。
- marker 后写 PetClaw managed sections。
- `System Prompt` 来自 `CoworkConfigStore.getConfig().systemPrompt`。
- `buildManagedSections(skillsDir)` 保留。

规则：

- 不写所有 skill 列表。
- 不写所有 `SKILL.md` 正文。
- `Skill Creation` 继续指向 `{userData}/SKILLs/<skill-name>/SKILL.md`。
- scheduled task prompt 继续由 `mergeCoworkSystemPrompt()` 注入会话 prompt，不迁回 `AGENTS.md`。这和 LobsterAI 不同，但符合 PetClaw 当前 Cowork 设计。

---

## 8. Exec Approvals 与 Skill 脚本执行

选中 skill 后，模型能看到 `SKILL.md` 正文和 skill 目录。若 `SKILL.md` 引导执行 `scripts/foo.js`，runtime 需要能执行本地命令。

参考 LobsterAI，新增：

```ts
syncExecApprovalDefaults(): boolean
```

写入路径：

```text
{OPENCLAW_HOME}/.openclaw/exec-approvals.json
```

在 PetClaw 中即：

```text
{userData}/openclaw/.openclaw/exec-approvals.json
```

内容规则：

```json
{
  "version": 1,
  "agents": {
    "main": {
      "security": "full",
      "ask": "off"
    }
  }
}
```

要求：

- 保留未知字段。
- 如果已有 `agents.main`，只修正 `security` 和 `ask`。
- 变更时返回 `changed = true`。
- 删除命令保护仍由 managed prompt 和 UI 审批策略负责，不依赖 OpenClaw 自身 ask。

`syncManagedSessionStore()` 第一阶段只做 channel session 的 `execSecurity = full` 修正。若当前 PetClaw 尚未接入 OpenClaw channel sessions，可先保留方法但无变更。

---

## 9. Secret Env 汇总

`collectSecretEnvVars()` 汇总：

- `ModelRegistry.collectSecretEnvVars()`
- `McpManager.collectSecretEnvVars()`，如果后续存在
- `ImGatewayManager.collectSecretEnvVars()`
- `MemorySearchConfigStore.collectSecretEnvVars()`
- `OPENCLAW_GATEWAY_TOKEN` 仍由 EngineManager 自己注入

命名规范：

```text
PETCLAW_APIKEY_<PROVIDER_ID>
PETCLAW_IM_<PLATFORM>_<INSTANCE_ID>_<SECRET_NAME>
PETCLAW_MCP_BRIDGE_SECRET
PETCLAW_MEMORY_SEARCH_API_KEY
```

所有写入 `openclaw.json` 的 secret 均使用 `${ENV_NAME}` placeholder。

---

## 10. 同步结果与 Gateway 重启

扩展结果类型：

```ts
interface ConfigSyncResult {
  ok: boolean
  changed: boolean
  configPath: string
  error?: string
  bindingsChanged?: boolean
  pluginConfigChanged?: boolean
  secretEnvChanged?: boolean
}
```

第一阶段可以只返回 `changed`，但内部测试应覆盖哪些字段会变化。

推荐重启判断：

| 变化 | 建议 |
|------|------|
| model provider config | 可能需要重启 |
| API Key / IM secret env | 需要重启 |
| plugins.entries / plugin config | 需要重启 |
| bindings | 视 runtime 热加载能力决定 |
| agents.list | 优先热加载 |
| skills.entries / extraDirs | 优先热加载 |
| AGENTS.md | 不重启 |
| exec-approvals.json | 不重启 |

---

## 11. 实施计划

### 阶段 1：ConfigSync 结构重构与 baseline

- 拆分 `buildConfig()` 为私有 builder。
- 补齐 gateway auth/tailscale。
- 补齐 agents sandbox 默认 `off`。
- 补齐 tools/browser/cron baseline。
- 保持当前 models/directories/skills/mcp 行为不回退。

### 阶段 2：Exec approvals

- 新增 `syncExecApprovalDefaults()`。
- `sync()` 聚合 `agentsMdChanged || configChanged || execApprovalsChanged`。
- 测试新建、无变化、保留未知字段。

### 阶段 3：Plugins 保留策略

- `buildPluginsConfig(existing.plugins)` 保留 existing fields/entries。
- 合并当前 `McpManager` 输出。
- 为后续 `mcp-bridge` / `ask-user-question` 明确托管入口。

### 阶段 4：IM 接入

- 给 `ImGatewayManager` 增加 OpenClaw config 输出方法。
- `ConfigSyncOptions` 注入 `imGatewayManager`。
- 写入 `channels`、`bindings`、IM plugin entries。
- `collectSecretEnvVars()` 汇总 IM secrets。

### 阶段 5：MemorySearch 预留

- 新增 `MemorySearchConfigStore` typed store。
- 默认 disabled，不输出 `memorySearch`。
- 有配置时写入 `agents.defaults.memorySearch`。
- 暂不做 UI。

### 阶段 6：文档同步

- 更新 `docs/架构设计/PetClaw总体架构设计.md` 第 6 章。
- 清理旧的 `activeSkillIds` 文档语义，改为本轮 `skillIds`。
- 更新 AGENTS/CLAUDE 中 ConfigSync 职责摘要。

---

## 12. 测试计划

新增或更新：

- `tests/main/ai/config-sync.test.ts`
  - 生成 managed baseline。
  - 保留 existing gateway 字段，但覆盖 auth/tailscale。
  - 输出 tools/browser/cron。
  - 输出 agents.defaults.sandbox。
  - skills.extraDirs 指向 skills root。
  - plugins 保留 existing entries 并合并 MCP。
  - exec approvals 新建/幂等/保留未知字段。
  - AGENTS.md 变化仍返回 changed。

- `tests/main/im/*`
  - IM manager 输出 channels/bindings/plugin entries。
  - secret 不落盘，只出现在 env vars。

- `tests/main/models/model-registry.test.ts`
  - 确认 provider secret 仍是 placeholder。

验证命令：

```bash
pnpm --filter petclaw-desktop test -- tests/main/ai/config-sync.test.ts
pnpm --filter petclaw-desktop typecheck
```

---

## 13. 风险与决策

### 13.1 Plugins 保留策略可能掩盖坏配置

保留 existing plugin entries 可以避免 runtime auto-injected 字段被删除导致重启循环，但也可能保留坏配置。

决策：第一阶段只保留，不做复杂清理；如果遇到 plugin not found，再加入受控 stale plugin 清理列表。

### 13.2 `exec-approvals.json` ask=off 的安全边界

ask=off 会让 OpenClaw 不再弹自己的命令审批。

决策：PetClaw 使用自己的审批/安全策略和 managed prompt 约束删除命令。这样能保证 skill 脚本可执行，避免双层审批互相卡住。

### 13.3 MemorySearch 目录级覆盖

目录 agent 可能未来需要不同 embedding provider。

决策：当前只做全局 `agents.defaults.memorySearch`。目录级 override 等真实需求出现后再加，避免过早复杂化。

### 13.4 Scheduled task prompt 放置位置

LobsterAI 把 scheduled task prompt 写入 `AGENTS.md`。PetClaw 当前通过 `mergeCoworkSystemPrompt()` 注入。

决策：保持 PetClaw 当前方式。原因是 scheduled task 行为属于 Cowork/cron 会话运行时约束，不需要污染 AGENTS.md 的长期 workspace 文件。

---

## 14. 完成标准

- `ConfigSync` 外部入口保持简单，内部 builder 边界清晰。
- `openclaw.json` 包含 PetClaw managed runtime baseline。
- IM、MCP、Skills、Cron、MemorySearch 都有明确配置归属。
- Secret 不落盘。
- Skill 子文件和脚本执行链路完整：`extraDirs` + selected `SKILL.md` prompt + exec approvals。
- 相关测试通过，架构文档同步更新。
