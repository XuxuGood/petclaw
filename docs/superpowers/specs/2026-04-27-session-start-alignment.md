# Session Start 流程补齐设计

## 背景

对比 LobsterAI 的 `cowork:session:start` 全链路实现，PetClaw 在以下方面存在差异：

1. IPC channel 命名不一致（`chat:*` vs `cowork:session:*`）
2. 前端已有的 `skillIds` / `modelOverride` 参数在 `ChatView` 层被丢弃，未传到主进程
3. `chat.send` RPC 缺少 `deliver: false` 参数
4. 首轮对话缺少 System Prompt 注入（AGENTS.md 托管段）

本次改动仅补齐实际使用的功能，排除 PetClaw 场景不需要的 IM 通道、channel polling、命令危险等级判断等。

## 改动 1：IPC Channel 重命名

### 目标

请求 channel 从 `chat:*` 改为 `cowork:session:*`，对齐 LobsterAI 命名规范。推送 channel `cowork:stream:*` 已对齐，不改。

### 映射表

| 旧 channel | 新 channel |
|------------|------------|
| `chat:send` | `cowork:session:start` |
| `chat:continue` | `cowork:session:continue` |
| `chat:stop` | `cowork:session:stop` |
| `chat:sessions` | `cowork:session:list` |
| `chat:session` | `cowork:session:get` |
| `chat:delete-session` | `cowork:session:delete` |
| `cowork:permission:respond` | 不变 |

### 涉及文件（IPC 三处同步）

- `src/main/ipc/chat-ipc.ts` — handler 注册
- `src/preload/index.ts` — preload bridge
- `src/preload/index.d.ts` — 类型声明

### 渲染进程调用方

以下文件通过 `window.api.cowork.*` 调用，preload bridge 改名后 API 方法名同步调整：

| 旧方法 | 新方法 |
|--------|--------|
| `window.api.cowork.send(message, cwd)` | `window.api.cowork.startSession(options)` |
| `window.api.cowork.continue(sessionId, message)` | `window.api.cowork.continueSession(options)` |
| `window.api.cowork.stop(sessionId)` | `window.api.cowork.stopSession(sessionId)` |
| `window.api.cowork.sessions()` | `window.api.cowork.listSessions()` |
| `window.api.cowork.session(id)` | `window.api.cowork.getSession(id)` |
| `window.api.cowork.deleteSession(id)` | 不变 |

调用方文件：
- `src/renderer/src/views/chat/ChatView.tsx`
- `src/renderer/src/views/onboarding/OnboardingPanel.tsx`
- 其他通过 `window.api.cowork.*` 调用的组件（需 grep 确认）

## 改动 2：打通 IPC 参数链路

### 目标

`ChatInputBox` 已传出 `(message, cwd, skillIds, modelOverride)`，但 `ChatView.handleSend` 只收 `(message, cwd)`，`skillIds` 和 `modelOverride` 被丢弃。需要全链路打通。

### `cowork:session:start` 参数格式

从散列参数改为 options 对象（对齐 LobsterAI）：

```ts
interface SessionStartOptions {
  prompt: string
  cwd: string
  skillIds?: string[]
  modelOverride?: string
  // 未来扩展：imageAttachments、autoApprove 等
}
```

### `cowork:session:continue` 参数格式

同样改为 options 对象：

```ts
interface SessionContinueOptions {
  sessionId: string
  prompt: string
}
```

### 改动链路（从外到内）

**ChatView.tsx**：
- `handleSend` 签名改为 `(message, cwd, skillIds, modelOverride)`
- 调用 `window.api.cowork.startSession({ prompt: message, cwd, skillIds, modelOverride })`

**preload/index.ts**：
```ts
startSession: (options: { prompt: string; cwd: string; skillIds?: string[]; modelOverride?: string }) =>
  ipcRenderer.invoke('cowork:session:start', options),
continueSession: (options: { sessionId: string; prompt: string }) =>
  ipcRenderer.invoke('cowork:session:continue', options),
```

**chat-ipc.ts**：
```ts
ipcMain.handle('cowork:session:start', async (_event, options: {
  prompt: string
  cwd: string
  skillIds?: string[]
  modelOverride?: string
}) => {
  return coworkSessionManager.createAndStart(
    options.prompt.split('\n')[0].slice(0, 50) || 'New Session',
    options.cwd,
    options.prompt,
    {
      autoApprove: false,
      confirmationMode: 'modal',
      skillIds: options.skillIds,
      modelOverride: options.modelOverride,
    }
  )
})
```

**cowork-session-manager.ts**：
- `createAndStart` 的 `CoworkStartOptions` 增加 `skillIds` 和 `modelOverride`
- 如果 `modelOverride` 非空，在 session 创建后立即 `store.updateSession(session.id, { modelOverride })`

**CoworkStartOptions 扩展**（`types.ts`）：
```ts
export interface CoworkStartOptions {
  autoApprove?: boolean
  confirmationMode?: 'modal' | 'text'
  imageAttachments?: ImageAttachment[]
  skillIds?: string[]       // 新增
  modelOverride?: string    // 新增
}
```

**cowork-controller.ts**：
- `runTurn` 已读 `session.modelOverride` 做 model patch — 无需改
- `skillIds` 暂存但不影响 `chat.send` RPC（OpenClaw 引擎端通过 AGENTS.md 中的 skill 配置生效）

### Title 生成逻辑

对齐 LobsterAI：取 prompt 第一行前 50 字符作为标题，空则 fallback 'New Session'。当前 PetClaw 硬编码 `'Chat'`。

改动在 `chat-ipc.ts` handler 中完成，不改 `createAndStart` 签名。

## 改动 3：`deliver: false`

### 目标

`chat.send` RPC 加上 `deliver: false`，阻止引擎自动推送消息到 IM 通道。LobsterAI 桌面端所有 `chat.send` 都带此参数。

### 改动

`cowork-controller.ts` 的 `runTurn` 方法中 `gateway.chatSend` 调用：

```ts
const sendResult = await this.gateway.chatSend(sessionKey, outboundMessage, {
  idempotencyKey: runId,
  deliver: false,  // 新增：桌面端不自动推送到 IM 通道
  ...(options.autoApprove !== undefined ? { autoApprove: options.autoApprove } : {}),
  ...(attachments ? { attachments } : {}),
})
```

## 改动 4：System Prompt 首轮注入

### 目标

首轮对话时将 `managed-prompts.ts` 中已定义的托管段注入到 outbound prompt，让 AI 知道 PetClaw 的使用规则（exec safety、memory policy、scheduled task、web search、skill creation）。

### 参考

LobsterAI 的 `mergeCoworkSystemPrompt` + `buildOutboundPrompt` 中的 system prompt 注入逻辑：
- 首轮或 systemPrompt 变更时注入 `[LobsterAI system instructions]` 前缀
- 用 `lastSystemPromptBySession` 缓存做幂等

### 实现

**controller 构造函数新增 `skillsDir` 参数**：

```ts
constructor(
  private gateway: OpenclawGateway,
  private store: CoworkStore,
  private skillsDir: string  // 新增：传给 buildManagedSections
)
```

从 `index.ts` 的 `initializeRuntimeServices` 传入。

**`buildOutboundPrompt` 扩展**：

在 `buildLocalTimeContext()` 之后、context bridge 之前注入：

```ts
// 首轮注入 managed system prompt
if (!this.bridgedSessions.has(sessionId)) {
  const managedSections = buildManagedSections(this.skillsDir).join('\n\n')
  sections.push('[PetClaw system instructions]\n' + managedSections)
}
```

注意：只在首轮（`!bridgedSessions.has(sessionId)`）注入，后续 turn 不重复。这比 LobsterAI 的 `lastSystemPromptBySession` 方案简单，因为 PetClaw 不支持运行时修改 systemPrompt。

### `buildManagedSections` 输出内容

已在 `managed-prompts.ts` 定义，包含：
1. `MANAGED_WEB_SEARCH_POLICY` — web search 使用规则
2. `MANAGED_EXEC_SAFETY` — 命令执行安全策略
3. `MANAGED_MEMORY_POLICY` — 记忆写入规则
4. `buildSkillCreationPrompt(skillsDir)` — skill 创建路径
5. `buildScheduledTaskPrompt()` — 定时任务使用指引

## 排除清单

| 项 | 理由 |
|----|------|
| IPC 事件 sanitize/truncate | 防御性优化，非核心功能缺失，后续可加 |
| Model info 注入 `[Session info]` | AI 不需要知道模型名，无实际用途 |
| `skipInitialUserMessage` 模式 | PetClaw 由 controller 写 user msg，职责分配等价正确 |
| Engine 就绪前检查（IPC handler 层） | `ensureConnected` 已做同等保障，后续可优化但非阻塞 |
| Approval 自动批准 + 危险等级 | UX 策略问题，需 UI 迭代时一起决定 |
| `reconcileWithHistory` | IM 场景专用 |
| Channel polling / proxy | IM 场景专用 |
| `pendingUserSync` / buffered events | IM 场景专用 |
