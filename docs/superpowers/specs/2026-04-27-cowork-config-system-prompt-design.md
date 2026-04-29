# Cowork 配置与 System Prompt 架构设计

**日期**: 2026-04-27  
**状态**: 设计完成，待实现  
**范围**: `app_config` 配置分层、CoworkConfig 类型化门面、session 级 system prompt 固化、`buildOutboundPrompt` 注入逻辑对齐 LobsterAI

---

## 1. 背景

在 Session Start 流程补齐中，PetClaw 为了首轮注入托管 system prompt，将 `skillsDir` 传入了 `CoworkController`，再由 `buildOutboundPrompt()` 调用 `buildManagedSections(this.skillsDir)`。

这能让功能跑通，但职责边界偏离 LobsterAI：

- LobsterAI 的 runtime adapter 不知道 skills 目录，只接收已经组装好的 `systemPrompt` 字符串。
- LobsterAI 的 system prompt 注入条件不是简单首轮，而是“首次或 system prompt 发生变化”。
- LobsterAI 在 session 创建时将本次会话使用的 `systemPrompt` 固化到 session，续聊默认沿用 session 的 prompt。
- PetClaw 当前 `CoworkSession` 没有 `systemPrompt` 字段，导致 system prompt 来源只能临时在 controller 内构造。

本设计目标是保留 PetClaw 当前的 directory-centric 架构和 `app_config` KV 存储，同时对齐 LobsterAI 的职责边界。

---

## 2. 参考实现

### 2.1 LobsterAI 通用配置

LobsterAI 的通用配置存储在 SQLite `kv` 表：

```sql
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)
```

`SqliteStore.get/set/delete()` 对 value 做 JSON 序列化，常用 key 包括：

- `app_config`
- `enterprise_config`
- `auto_launch_enabled`
- `prevent_sleep_enabled`
- `auth_tokens`
- `github_copilot_github_token`

### 2.2 LobsterAI Cowork 配置

LobsterAI 另有 `cowork_config` 表，作为 cowork 域专属 KV，保存：

- `workingDirectory`
- `executionMode`
- `agentEngine`
- memory 相关开关
- embedding 相关配置

但 LobsterAI 当前 `CoworkConfigUpdate` 已不再持久化 `systemPrompt` 到 `cowork_config`。默认 system prompt 来自 `resources/SYSTEM_PROMPT.md`，旧版 `cowork_config.systemPrompt` 只在 migration 时继承到默认 `main` agent。

### 2.3 LobsterAI System Prompt 链路

LobsterAI 的 `cowork:session:start` 流程：

1. 主进程读取 `config = coworkStore.getConfig()`。
2. `systemPrompt = mergeCoworkSystemPrompt(activeEngine, options.systemPrompt ?? config.systemPrompt)`。
3. `createSession(title, cwd, systemPrompt, executionMode, activeSkillIds, agentId)` 将 system prompt 固化到 session。
4. `runtime.startSession(session.id, prompt, { skipInitialUserMessage: true, systemPrompt, skillIds, confirmationMode, imageAttachments, agentId })`。
5. runtime adapter 的 `buildOutboundPrompt()` 只接收 `systemPrompt?: string`，不依赖 skills 目录或配置路径。
6. adapter 用 `lastSystemPromptBySession` 判断是否注入：

```ts
const normalizedSystemPrompt = (systemPrompt ?? '').trim()
const previousSystemPrompt = this.lastSystemPromptBySession.get(sessionId) ?? ''
const shouldInjectSystemPrompt = Boolean(
  normalizedSystemPrompt && normalizedSystemPrompt !== previousSystemPrompt
)
```

---

## 3. 设计目标

1. **保留统一配置存储**：PetClaw 继续使用 `app_config` 表作为全局 KV，不新增 `cowork_config` 表。
2. **引入领域配置门面**：新增 `CoworkConfigStore`，统一管理 cowork 域配置的 key、默认值、normalize 和持久化。
3. **固化 session prompt**：新建 session 时将最终 system prompt 写入 `cowork_sessions.system_prompt`。
4. **收窄 controller 职责**：`CoworkController` 只接收最终 `systemPrompt`，不读取 `skillsDir`，不构造托管段。
5. **对齐注入幂等逻辑**：`buildOutboundPrompt()` 采用 `lastSystemPromptBySession`，首次或变化时注入。
6. **保持 directory-centric 架构**：工作目录仍由用户选择或目录配置提供，agentId 仍由目录派生。

---

## 4. 非目标

- 不新增独立 `cowork_config` 表。
- 不将所有配置合并成一个巨大的 `app_config` JSON 对象。
- 不让前端负责最终 system prompt 组装。
- 不恢复 LobsterAI 的 Agent-centric UI。
- 不实现 LobsterAI 的 IM channel polling、pending user sync、history reconcile 等 IM 专用逻辑。
- 不把 `executionMode` 引入为真实可切换功能；PetClaw 当前只保留 `local` 语义。

---

## 5. 总体架构

```
SQLite
├── app_config                  # 通用 KV：所有配置 key/value
├── directories                 # 目录级 model_override / skill_ids
├── cowork_sessions             # 会话级 system_prompt / model_override
├── cowork_messages             # 消息与 metadata
├── im_instances
├── mcp_servers
└── scheduled_task_meta

Domain Stores
├── CoworkConfigStore           # cowork.* typed 配置门面
├── ModelRegistry               # model.* 配置门面
├── DirectoryStore
├── CoworkStore
├── ImStore
└── McpStore
```

核心原则：

- `app_config` 是存储层，不是业务接口。
- 业务模块通过 typed store 访问配置。
- 每个 typed store 负责自己的 key namespace。
- 结构化业务数据继续使用专表，不塞进 `app_config`。

---

## 6. `app_config` Key 规范

PetClaw 已有 `app_config(key, value, updated_at)` 表，适合继续承载通用 KV。

新增或整理 key 时必须使用 namespace：

| Namespace | 示例 key | 归属 |
|-----------|----------|------|
| `app.*` | `app.language`, `app.autoLaunch` | 应用级 UI/系统设置 |
| `model.*` | `model.providers`, `model.activeModel` | 模型配置 |
| `cowork.*` | `cowork.defaultDirectory`, `cowork.systemPrompt` | cowork 域配置 |
| `openclaw.*` | `openclaw.sessionPolicy` | OpenClaw runtime 策略 |
| `memory.*` | `memory.enabled`, `memory.skipMissedJobs` | 记忆/调度策略 |

禁止在业务代码中散落裸字符串 key。新增 key 必须集中在对应领域 store 的常量中。

---

## 7. CoworkConfigStore

### 7.1 职责

`CoworkConfigStore` 是 cowork 域配置的唯一读写入口。

它负责：

- 从 `app_config` 读取 raw string。
- 将 raw string normalize 成业务类型。
- 提供默认值。
- 写入时做合法性收窄。
- 隐藏底层 key 命名。

### 7.2 文件位置

新增：

```txt
petclaw-desktop/src/main/data/cowork-config-store.ts
```

### 7.3 类型定义

`CoworkConfig` 放在 `src/main/ai/types.ts` 或 `cowork-config-store.ts` 中；若被 IPC 类型使用，再提升到 `types.ts`。

```ts
export interface CoworkConfig {
  defaultDirectory: string
  systemPrompt: string
  memoryEnabled: boolean
  skipMissedJobs: boolean
}

export interface CoworkConfigUpdate {
  defaultDirectory?: string
  systemPrompt?: string
  memoryEnabled?: boolean
  skipMissedJobs?: boolean
}
```

### 7.4 Key 常量

```ts
const COWORK_CONFIG_KEYS = {
  defaultDirectory: 'cowork.defaultDirectory',
  systemPrompt: 'cowork.systemPrompt',
  memoryEnabled: 'cowork.memoryEnabled',
  skipMissedJobs: 'cowork.skipMissedJobs'
} as const
```

### 7.5 默认值

```ts
const DEFAULT_COWORK_CONFIG: CoworkConfig = {
  defaultDirectory: mainWorkspace,
  systemPrompt: '',
  memoryEnabled: true,
  skipMissedJobs: true
}
```

`defaultDirectory` 的运行时默认值是 main agent workspace：`{userData}/openclaw/workspace`。该默认值不写入 DB；只有用户显式配置默认目录时才持久化 `cowork.defaultDirectory`。空字符串视为未配置，继续回落 main workspace。

### 7.6 API

```ts
export class CoworkConfigStore {
  constructor(
    private db: Database.Database,
    private defaultDirectory: string
  ) {}

  getConfig(): CoworkConfig
  hasDefaultDirectory(): boolean
  setConfig(patch: CoworkConfigUpdate): CoworkConfig
}
```

写入策略：

- `defaultDirectory`: `trim()` 后保存，可为空。
- `systemPrompt`: 原文保存，但统一去掉首尾空白。
- `memoryEnabled`: boolean → `'true' | 'false'`。
- `skipMissedJobs`: boolean → `'true' | 'false'`。

读取策略：

- 缺失 key 返回默认值。
- 非法 boolean 值返回默认值。
- 非 string 值按空字符串处理。

---

## 8. Session 级 System Prompt 固化

### 8.1 Schema 变更

`cowork_sessions` 增加：

```sql
system_prompt TEXT NOT NULL DEFAULT ''
```

项目尚未上线，不需要为旧库编写兼容 migration。`initDatabase()` 直接更新建表 schema 即可；本地开发库如需重建，由开发者手动清理。

### 8.2 类型变更

`CoworkSession` 增加：

```ts
systemPrompt: string
```

`CoworkStore.rowToSession()` 读取：

```ts
systemPrompt: (row.system_prompt as string) ?? ''
```

`CoworkStore.createSession()` 签名改为：

```ts
createSession(
  title: string,
  directoryPath: string,
  agentId: string,
  systemPrompt: string
): CoworkSession
```

### 8.3 更新策略

session 创建后默认不随全局 `cowork.systemPrompt` 自动漂移。原因：

- 历史 session 的行为需要可追溯。
- 续聊应延续创建时的系统指令。
- 用户修改全局 prompt 后，只影响新建 session。

如果未来需要“将新 prompt 应用到当前会话”，必须通过显式 IPC 更新 session 的 `systemPrompt`，并由 controller 的 `lastSystemPromptBySession` 触发下一轮重新注入。

---

## 9. System Prompt 组装链路

### 9.1 新增 Prompt Builder

新增或调整：

```txt
petclaw-desktop/src/main/ai/system-prompt.ts
```

职责：

- 前置 scheduled task engine prompt。
- 追加主进程上层传入的托管 prompt。
- 合并用户自定义 prompt。
- 输出最终传给 session/runtime 的字符串。

API：

```ts
export function mergeCoworkSystemPrompt(options: {
  managedPrompt: string
  userPrompt?: string
}): string
```

实现规则：

1. `buildScheduledTaskPrompt()` 始终在最前。
2. `managedPrompt.trim()` 非空时追加。
3. `userPrompt?.trim()` 非空时追加。
4. 中间用两个换行分隔。
5. managed/user 都为空时仍返回 scheduled task prompt。

### 9.2 托管 Prompt 生成位置

`buildManagedSections(skillsDir)` 仍保留在 `managed-prompts.ts`，但调用方必须是主进程上层初始化或 IPC handler，不是 `CoworkController`。
`buildManagedSections()` 只生成写入 `AGENTS.md` / 长期托管 prompt 的段落，不包含 `buildScheduledTaskPrompt()`；scheduled task prompt 只在 `mergeCoworkSystemPrompt()` 中合并。

推荐在 `initializeRuntimeServices()` 初始化后创建：

```ts
const managedSystemPrompt = buildManagedSections(skillsDir).join('\n\n')
```

并将其注入 `registerChatIpcHandlers` 的依赖：

```ts
registerChatIpcHandlers({
  coworkConfigStore,
  managedSystemPrompt,
  coworkSessionManager,
  coworkController,
  getMainWindow,
  getPetWindow
})
```

如果当前 IPC 注册依赖不方便扩展，也可以在 `chat-ipc.ts` 依赖中传入：

```ts
getCoworkSystemPrompt: () => string
```

避免 `chat-ipc.ts` 直接知道 `skillsDir`。

### 9.3 Session Start

`cowork:session:start` options：

```ts
interface SessionStartOptions {
  prompt: string
  cwd?: string
  systemPrompt?: string
  skillIds?: string[]
  modelOverride?: string
}
```

处理流程：

```ts
const config = coworkConfigStore.getConfig()
const hasExplicitCwd = typeof options.cwd === 'string' && options.cwd.trim().length > 0
const hasConfiguredDefaultDirectory = coworkConfigStore.hasDefaultDirectory()
const cwd = (hasExplicitCwd ? options.cwd : config.defaultDirectory).trim()

if (!cwd) {
  return { success: false, error: t('error.dirRequired') }
}

const systemPrompt = mergeCoworkSystemPrompt({
  managedPrompt,
  userPrompt: options.systemPrompt ?? config.systemPrompt
})
const useMainAgent = !hasExplicitCwd && !hasConfiguredDefaultDirectory

return coworkSessionManager.createAndStart(title, cwd, options.prompt, {
  systemPrompt,
  skillIds: options.skillIds,
  modelOverride: options.modelOverride,
  useMainAgent,
  autoApprove: false,
  confirmationMode: 'modal'
})
```

### 9.4 Session Continue

`cowork:session:continue` options：

```ts
interface SessionContinueOptions {
  sessionId: string
  prompt: string
  systemPrompt?: string
}
```

处理流程：

```ts
const session = coworkStore.getSession(options.sessionId)
const systemPrompt = options.systemPrompt
  ? mergeCoworkSystemPrompt({ managedPrompt, userPrompt: options.systemPrompt })
  : session?.systemPrompt ?? ''

coworkSessionManager.continueSession(options.sessionId, options.prompt, {
  systemPrompt
})
```

若没有显式传入 `systemPrompt`，续聊必须使用 session 固化值。

---

## 10. CoworkSessionManager

### 10.1 Start Options

`CoworkStartOptions` 增加：

```ts
systemPrompt?: string
```

`createAndStart()` 创建 session 时传入：

```ts
const session = this.store.createSession(
  title,
  cwd,
  agentId,
  options?.systemPrompt ?? ''
)
```

`modelOverride` 仍在 session 创建后立即写入 store，保持当前已实现逻辑。

### 10.2 Continue Options

新增：

```ts
export interface CoworkContinueOptions {
  systemPrompt?: string
}
```

`continueSession(sessionId, prompt, options?)` 将 options 传给 controller。

---

## 11. CoworkController

### 11.1 移除 skillsDir

`CoworkController` 构造函数恢复为：

```ts
constructor(
  private gateway: OpenclawGateway,
  private store: CoworkStore
)
```

不得在 controller 中调用 `buildManagedSections()`。

### 11.2 Run Options

`runTurn()` options 增加：

```ts
systemPrompt?: string
skillIds?: string[]
```

user message metadata 应记录 `skillIds` 和 `imageAttachments`：

```ts
const metadata =
  options.skillIds?.length || options.imageAttachments?.length
    ? {
        ...(options.skillIds?.length ? { skillIds: options.skillIds } : {}),
        ...(options.imageAttachments?.length ? { imageAttachments: options.imageAttachments } : {})
      }
    : undefined
```

### 11.3 Prompt 注入幂等

新增字段：

```ts
private lastSystemPromptBySession = new Map<string, string>()
```

`buildOutboundPrompt()` 签名：

```ts
private async buildOutboundPrompt(
  sessionId: string,
  sessionKey: string,
  prompt: string,
  systemPrompt?: string
): Promise<string>
```

注入规则：

```ts
const normalizedSystemPrompt = (systemPrompt ?? '').trim()
const previousSystemPrompt = this.lastSystemPromptBySession.get(sessionId) ?? ''
const shouldInjectSystemPrompt = Boolean(
  normalizedSystemPrompt && normalizedSystemPrompt !== previousSystemPrompt
)

if (normalizedSystemPrompt) {
  this.lastSystemPromptBySession.set(sessionId, normalizedSystemPrompt)
} else {
  this.lastSystemPromptBySession.delete(sessionId)
}

if (shouldInjectSystemPrompt) {
  sections.push(this.buildSystemPromptPrefix(normalizedSystemPrompt))
}
```

prefix：

```ts
private buildSystemPromptPrefix(systemPrompt: string): string {
  return [
    '[PetClaw system instructions]',
    'Apply the instructions below as the highest-priority guidance for this session.',
    'If earlier PetClaw system instructions exist, replace them with this version.',
    systemPrompt
  ].join('\n')
}
```

`buildLocalTimeContext()` 仍每轮注入。

### 11.4 Cleanup

删除 session 时必须清理：

```ts
this.lastSystemPromptBySession.delete(sessionId)
```

停止 session 不清理。原因：停止只结束当前 turn，不代表系统指令失效。

---

## 12. IPC 与 Preload

### 12.1 新增 Cowork Config IPC

Channel：

| Channel | 用途 |
|---------|------|
| `cowork:config:get` | 获取 `CoworkConfig` |
| `cowork:config:set` | 更新 `CoworkConfigUpdate` |

preload：

```ts
cowork: {
  getConfig: () => Promise<CoworkConfig>
  setConfig: (patch: CoworkConfigUpdate) => Promise<CoworkConfig>
}
```

返回值建议直接返回 config，错误通过 throw 或统一错误响应处理。若沿用现有 IPC 风格，需要在 preload 层保持一致。

### 12.2 Start/Continue Options

preload `startSession` 支持：

```ts
{
  prompt: string
  cwd?: string
  systemPrompt?: string
  skillIds?: string[]
  modelOverride?: string
}
```

preload `continueSession` 支持：

```ts
{
  sessionId: string
  prompt: string
  systemPrompt?: string
}
```

当前前端可以不传 `systemPrompt`。主进程必须使用 config/session fallback。

---

## 13. Frontend 策略

本次架构改造不要求新增 system prompt 编辑 UI。

前端发送消息时：

- 有显式 cwd：传 cwd。
- 没有 cwd：可以不传 cwd，由主进程使用 `cowork.defaultDirectory`。
- `systemPrompt` 默认不传。
- `skillIds` 和 `modelOverride` 继续按当前输入框选择传递。

空 cwd 且无默认目录时，主进程返回结构化错误，前端显示 i18n 文案。

---

## 14. Error Handling

### 14.1 目录缺失

`cwd` 为空：

- 返回结构化错误：`error.dirRequired`
- 不创建 session
- 不调用 controller

`cwd` 非空但路径不存在：

- 返回结构化错误：`error.dirNotFound`
- 不注册 directory
- 不创建 session

### 14.2 System Prompt 为空

允许为空。此时：

- 不注入 `[PetClaw system instructions]`
- 仍注入本地时间上下文
- 仍发送 `[Current user request]`

### 14.3 Config 值损坏

`CoworkConfigStore.getConfig()` 对损坏值做默认回退，不抛错。写入时只接受已收窄后的字段。

---

## 15. 数据一致性

### 15.1 Session Prompt 不漂移

新建 session 使用当时的最终 system prompt，并持久化。后续全局配置变更不影响已有 session。

### 15.2 Continue Prompt 来源

续聊优先级：

1. IPC 显式 `options.systemPrompt`
2. `session.systemPrompt`
3. 空字符串

不读取最新全局 config，避免历史会话隐式改变行为。

### 15.3 Managed Prompt 版本变化

托管 prompt 代码升级后：

- 新 session 使用新托管 prompt。
- 旧 session 默认使用旧 session 固化值。

如果需要对旧 session 应用新托管 prompt，必须提供显式迁移或“刷新当前会话系统指令”的操作，不做静默覆盖。

---

## 16. 测试计划

### 16.1 CoworkConfigStore

- 缺失 key 返回默认值。
- boolean 字符串解析正确。
- 非法 boolean 回退默认值。
- `setConfig()` 只写入 patch 中出现的字段。
- `systemPrompt` trim 后保存。

### 16.2 CoworkStore

- 新库建表包含 `system_prompt`。
- `createSession()` 写入 system prompt。
- `rowToSession()` 返回 systemPrompt。

### 16.3 IPC

- `cowork:session:start` 未传 `systemPrompt` 时使用 `CoworkConfigStore.getConfig().systemPrompt`。
- `cowork:session:start` 未传 cwd 时使用 `CoworkConfigStore.getConfig().defaultDirectory`。
- 未传 cwd 且未持久化 `cowork.defaultDirectory` 时，默认使用 `{userData}/openclaw/workspace` 并固定走 `main` agent。
- 用户持久化了 `cowork.defaultDirectory` 时，该目录按目录 agent 处理。
- cwd 为空且 main workspace 也无法解析时返回 `error.dirRequired`。
- `cowork:session:continue` 未传 `systemPrompt` 时使用 session 固化值。

### 16.4 Controller

- 首轮 prompt 包含 `[PetClaw system instructions]`。
- 第二轮相同 system prompt 不重复注入。
- system prompt 变化时下一轮重新注入。
- `buildLocalTimeContext()` 每轮注入。
- `skillIds` 写入 user message metadata。
- 删除 session 清理 `lastSystemPromptBySession`。

### 16.5 全量验证

- `npm run typecheck`
- `npx vitest run`
- grep 确认 `CoworkController` 不再引用 `skillsDir` / `buildManagedSections`
- grep 确认 `chat:*` 旧 channel 无遗留

---

## 17. 实施分期

### Phase 1：配置门面与 session prompt 持久化

- 新增 `CoworkConfigStore`
- 增加 `cowork_sessions.system_prompt`
- 更新 `CoworkSession` / `CoworkStore`
- 增加单元测试

### Phase 2：System Prompt 链路重构

- 新增 `mergeCoworkSystemPrompt`
- `mergeCoworkSystemPrompt` 前置 `buildScheduledTaskPrompt`
- `chat-ipc.ts` 使用 `CoworkConfigStore` 和 managed prompt
- `CoworkSessionManager` 传递 `systemPrompt`
- `CoworkController` 移除 `skillsDir`
- `buildOutboundPrompt` 使用 `lastSystemPromptBySession`

### Phase 3：IPC 与前端收口

- 新增 `cowork:config:get/set`
- 更新 preload 类型
- 修正 start/continue options
- 空 cwd 错误结构化

### Phase 4：文档同步与验证

- 同步 `CLAUDE.md` / `AGENTS.md`
- 同步 `docs/架构设计/PetClaw总体架构设计.md`
- 跑全量 typecheck/test

---

## 18. 最终判断

PetClaw 不需要照搬 LobsterAI 的 `cowork_config` 表；PetClaw 应保留统一 `app_config` KV 表，并通过 `CoworkConfigStore` 提供 cowork 域的类型化配置接口。

真正需要对齐 LobsterAI 的是职责边界：

- 主进程上层负责组装最终 system prompt。
- session 创建时固化 system prompt。
- controller 只负责 turn 执行与 prompt 注入。
- prompt 注入按“首次或变化”幂等处理。

这样既保留 PetClaw 当前 directory-centric 架构，又避免 controller 继续感知 `skillsDir` 等配置细节。
