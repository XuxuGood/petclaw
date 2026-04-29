# Session Start 流程补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 补齐 PetClaw cowork:session:start 相对于 LobsterAI 的 4 项关键差异：IPC channel 重命名、参数链路打通、deliver:false、System Prompt 首轮注入。

**Architecture:** IPC 层从 `chat:*` 统一改为 `cowork:session:*`，参数从散列改为 options 对象，controller 的 chatSend 补 `deliver: false`，buildOutboundPrompt 首轮注入 managed sections。

**Tech Stack:** Electron IPC, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-27-session-start-alignment.md`

---

### Task 1: 扩展 CoworkStartOptions 类型

**Files:**
- Modify: `src/main/ai/types.ts:72-76`
- Test: `tests/main/ai/cowork-controller.test.ts` (现有测试应继续通过)

- [x] **Step 1: 修改 CoworkStartOptions 类型**

在 `src/main/ai/types.ts` 的 `CoworkStartOptions` 接口中增加 `skillIds` 和 `modelOverride`：

```ts
export interface CoworkStartOptions {
  autoApprove?: boolean
  confirmationMode?: 'modal' | 'text'
  imageAttachments?: ImageAttachment[]
  skillIds?: string[]
  modelOverride?: string
}
```

- [x] **Step 2: 运行 typecheck 确认无破坏**

Run: `cd petclaw-desktop && npx tsc --noEmit 2>&1 | head -30`
Expected: 无新增错误（现有错误不变即可）

- [x] **Step 3: 运行测试确认无破坏**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-controller.test.ts 2>&1 | tail -10`
Expected: 所有 18 个测试通过

- [x] **Step 4: Commit**

```bash
git add src/main/ai/types.ts
git commit -m "feat(types): add skillIds and modelOverride to CoworkStartOptions"
```

---

### Task 2: IPC Channel 重命名 + 参数链路打通（主进程侧）

**Files:**
- Modify: `src/main/ipc/chat-ipc.ts:17-47`
- Modify: `src/main/ai/cowork-session-manager.ts:17-38`
- Test: `tests/main/ai/cowork-session-manager.test.ts` (现有测试需适配)

- [x] **Step 1: 写测试 — cowork-session-manager 接受 modelOverride 并写入 store**

在 `tests/main/ai/cowork-session-manager.test.ts` 中增加测试：

```ts
it('createAndStart 传入 modelOverride 时写入 session', () => {
  const session = manager.createAndStart('Test', '/test', 'hello', {
    modelOverride: 'gpt-4o'
  })
  expect(mockStore.updateSession).toHaveBeenCalledWith(
    session.id,
    { modelOverride: 'gpt-4o' }
  )
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-session-manager.test.ts 2>&1 | tail -10`
Expected: 新测试 FAIL

- [x] **Step 3: 实现 cowork-session-manager.ts 的 modelOverride 写入**

在 `src/main/ai/cowork-session-manager.ts` 的 `createAndStart` 方法中，session 创建后、controller.startSession 调用前，如果 `options?.modelOverride` 非空则写入 store：

```ts
createAndStart(title: string, cwd: string, prompt: string, options?: CoworkStartOptions): CoworkSession {
  if (!fs.existsSync(cwd)) throw new Error(t('error.dirNotFound'))
  this.directoryManager.ensureRegistered(cwd)
  const agentId = deriveAgentId(cwd)
  const session = this.store.createSession(title, cwd, agentId)

  // modelOverride 立即写入 store，runTurn 读 session.modelOverride 生效
  if (options?.modelOverride) {
    this.store.updateSession(session.id, { modelOverride: options.modelOverride })
  }

  void this.controller.startSession(session.id, prompt, options).catch(() => {})
  return session
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-session-manager.test.ts 2>&1 | tail -10`
Expected: 全部通过

- [x] **Step 5: 重命名 IPC channel + 改参数格式（chat-ipc.ts）**

将 `src/main/ipc/chat-ipc.ts` 中的 channel 名称和参数格式改为：

```ts
// chat:send → cowork:session:start（options 对象）
ipcMain.handle('cowork:session:start', async (_event, options: {
  prompt: string
  cwd: string
  skillIds?: string[]
  modelOverride?: string
}) => {
  const title = options.prompt.split('\n')[0].slice(0, 50) || 'New Session'
  return coworkSessionManager.createAndStart(title, options.cwd, options.prompt, {
    autoApprove: false,
    confirmationMode: 'modal',
    skillIds: options.skillIds,
    modelOverride: options.modelOverride
  })
})

// chat:continue → cowork:session:continue（options 对象）
ipcMain.handle('cowork:session:continue', async (_event, options: {
  sessionId: string
  prompt: string
}) => {
  await coworkController.continueSession(options.sessionId, options.prompt)
})

// chat:stop → cowork:session:stop
ipcMain.handle('cowork:session:stop', async (_event, sessionId: string) => {
  coworkController.stopSession(sessionId)
})

// chat:sessions → cowork:session:list
ipcMain.handle('cowork:session:list', async () => {
  return coworkStore.getSessions()
})

// chat:session → cowork:session:get
ipcMain.handle('cowork:session:get', async (_event, id: string) => {
  return coworkStore.getSession(id)
})

// chat:delete-session → cowork:session:delete
ipcMain.handle('cowork:session:delete', async (_event, id: string) => {
  coworkStore.deleteSession(id)
  coworkController.onSessionDeleted(id)
})
```

Title 生成逻辑：取 prompt 第一行前 50 字符，空则 fallback `'New Session'`。

- [x] **Step 6: Commit**

```bash
git add src/main/ipc/chat-ipc.ts src/main/ai/cowork-session-manager.ts tests/main/ai/cowork-session-manager.test.ts
git commit -m "feat(ipc): rename chat:* to cowork:session:* and pass options object"
```

---

### Task 3: IPC Channel 重命名（preload + 类型声明）

**Files:**
- Modify: `src/preload/index.ts:104-140`
- Modify: `src/preload/index.d.ts:48-61`

- [x] **Step 1: 更新 preload/index.ts 的 cowork 部分**

```ts
cowork: {
  startSession: (options: { prompt: string; cwd: string; skillIds?: string[]; modelOverride?: string }) =>
    ipcRenderer.invoke('cowork:session:start', options),
  continueSession: (options: { sessionId: string; prompt: string }) =>
    ipcRenderer.invoke('cowork:session:continue', options),
  stopSession: (sessionId: string) =>
    ipcRenderer.invoke('cowork:session:stop', sessionId),
  listSessions: () =>
    ipcRenderer.invoke('cowork:session:list'),
  getSession: (id: string) =>
    ipcRenderer.invoke('cowork:session:get', id),
  deleteSession: (id: string) =>
    ipcRenderer.invoke('cowork:session:delete', id),
  respondPermission: (requestId: string, result: unknown) =>
    ipcRenderer.invoke('cowork:permission:respond', requestId, result),
  // on* 监听器不变（推送 channel cowork:stream:* 已对齐）
  onMessage: (cb) => { /* 不变 */ },
  onMessageUpdate: (cb) => { /* 不变 */ },
  onPermission: (cb) => { /* 不变 */ },
  onComplete: (cb) => { /* 不变 */ },
  onError: (cb) => { /* 不变 */ },
}
```

- [x] **Step 2: 更新 preload/index.d.ts 的类型声明**

```ts
cowork: {
  startSession: (options: { prompt: string; cwd: string; skillIds?: string[]; modelOverride?: string }) => Promise<unknown>
  continueSession: (options: { sessionId: string; prompt: string }) => Promise<void>
  stopSession: (sessionId: string) => Promise<void>
  listSessions: () => Promise<unknown[]>
  getSession: (id: string) => Promise<unknown>
  deleteSession: (id: string) => Promise<void>
  respondPermission: (requestId: string, result: unknown) => Promise<void>
  onMessage: (cb: (data: unknown) => void) => () => void
  onMessageUpdate: (cb: (data: unknown) => void) => () => void
  onPermission: (cb: (data: unknown) => void) => () => void
  onComplete: (cb: (data: unknown) => void) => () => void
  onError: (cb: (data: unknown) => void) => () => void
}
```

- [x] **Step 3: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(preload): rename cowork API methods to match new IPC channels"
```

---

### Task 4: 渲染进程调用方适配

**Files:**
- Modify: `src/renderer/src/views/chat/ChatView.tsx:103-120`
- Modify: `src/renderer/src/views/onboarding/OnboardingPanel.tsx:580-588`

- [x] **Step 1: 更新 ChatView.tsx 的 handleSend**

```ts
const handleSend = async (message: string, cwd: string, skillIds?: string[], modelOverride?: string) => {
  if (!message || isLoading) return
  addMessage({ role: 'user', content: message })
  if (!activeSessionId) {
    const result = await window.api.cowork.startSession({
      prompt: message,
      cwd,
      skillIds,
      modelOverride
    })
    const r = result as Record<string, unknown>
    if (typeof r.sessionId === 'string') {
      onSessionCreated?.(r.sessionId)
      setSessionTitle(message.slice(0, 30) || t('chat.newConversation'))
    }
  } else {
    await window.api.cowork.continueSession({
      sessionId: activeSessionId,
      prompt: message
    })
  }
}
```

- [x] **Step 2: 更新 ChatView.tsx 中其他 cowork 调用**

检查 ChatView.tsx 中其他 `window.api.cowork.*` 调用，替换为新方法名：
- `stop(sessionId)` → `stopSession(sessionId)`
- `sessions()` → `listSessions()`
- `session(id)` → `getSession(id)`

- [x] **Step 3: 更新 OnboardingPanel.tsx**

```ts
const handleSelectCard = useCallback(
  async (message: string) => {
    await saveAndComplete()
    setTimeout(() => {
      window.api.cowork.startSession({ prompt: message, cwd: '' })
    }, 500)
  },
  [saveAndComplete]
)
```

- [x] **Step 4: Grep 其他调用方确认无遗漏**

Run: `cd petclaw-desktop && grep -rn 'window\.api\.cowork\.\(send\|continue\|stop\|sessions\|session\)' src/renderer/ --include='*.tsx' --include='*.ts'`
Expected: 无匹配（所有旧方法名已替换）

- [x] **Step 5: Commit**

```bash
git add src/renderer/src/views/chat/ChatView.tsx src/renderer/src/views/onboarding/OnboardingPanel.tsx
git commit -m "feat(renderer): adapt cowork API calls to new channel names and options format"
```

---

### Task 5: `deliver: false` 注入

**Files:**
- Modify: `src/main/ai/cowork-controller.ts:419-423`
- Test: `tests/main/ai/cowork-controller.test.ts`

- [x] **Step 1: 写测试 — chatSend 包含 deliver: false**

在 `tests/main/ai/cowork-controller.test.ts` 中找到 `'设置 status=running，添加 user message，调用 gateway.chatSend'` 测试，将 chatSend 断言改为：

```ts
expect(gateway.chatSend).toHaveBeenCalledWith(
  TEST_SESSION_KEY,
  expect.stringContaining('hello'),
  expect.objectContaining({
    idempotencyKey: expect.any(String),
    deliver: false
  })
)
```

- [x] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-controller.test.ts 2>&1 | tail -20`
Expected: 该测试 FAIL（当前 chatSend 调用不含 deliver: false）

- [x] **Step 3: 在 cowork-controller.ts 的 chatSend 调用中加 deliver: false**

修改 `src/main/ai/cowork-controller.ts` 约第 419-423 行：

```ts
const sendResult = await this.gateway.chatSend(sessionKey, outboundMessage, {
  idempotencyKey: runId,
  deliver: false,
  ...(options.autoApprove !== undefined ? { autoApprove: options.autoApprove } : {}),
  ...(attachments ? { attachments } : {})
})
```

- [x] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-controller.test.ts 2>&1 | tail -10`
Expected: 全部通过

- [x] **Step 5: Commit**

```bash
git add src/main/ai/cowork-controller.ts tests/main/ai/cowork-controller.test.ts
git commit -m "feat(controller): add deliver:false to chatSend RPC call"
```

---

### Task 6: System Prompt 首轮注入

**Files:**
- Modify: `src/main/ai/cowork-controller.ts` — constructor + buildOutboundPrompt
- Modify: `src/main/index.ts` — 传 skillsDir 给 controller
- Test: `tests/main/ai/cowork-controller.test.ts`

- [x] **Step 1: 写测试 — 首轮 prompt 包含 system instructions**

更新 `tests/main/ai/cowork-controller.test.ts` 的 mock：

```ts
vi.mock('../../../src/main/ai/managed-prompts', () => ({
  buildLocalTimeContext: () => '[time-context]',
  buildManagedSections: () => ['[section-1]', '[section-2]']
}))
```

添加新测试：

```ts
it('首轮 prompt 包含 managed system instructions', async () => {
  await startAndComplete(TEST_SESSION_ID, 'hello')

  const outboundPrompt = gateway.chatSend.mock.calls[0][1] as string
  expect(outboundPrompt).toContain('[PetClaw system instructions]')
  expect(outboundPrompt).toContain('[section-1]')
  expect(outboundPrompt).toContain('[section-2]')
})

it('第二轮 prompt 不重复注入 system instructions', async () => {
  await startAndComplete(TEST_SESSION_ID, 'hello')

  // 再起一轮（模拟 continueSession）
  gateway.chatSend.mockClear()
  const p2 = controller.startSession(TEST_SESSION_ID, 'follow up')
  await vi.advanceTimersByTimeAsync(0)
  gateway.emit('chatEvent', {
    sessionKey: TEST_SESSION_KEY,
    state: 'final',
    stopReason: 'end_turn'
  } satisfies ChatEventPayload)
  await p2

  const secondPrompt = gateway.chatSend.mock.calls[0][1] as string
  expect(secondPrompt).not.toContain('[PetClaw system instructions]')
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-controller.test.ts 2>&1 | tail -20`
Expected: 新测试 FAIL

- [x] **Step 3: 给 CoworkController constructor 增加 skillsDir 参数**

修改 `src/main/ai/cowork-controller.ts` 的 constructor：

```ts
constructor(
  private gateway: OpenclawGateway,
  private store: CoworkStore,
  private skillsDir: string = ''
)
```

- [x] **Step 4: 在 buildOutboundPrompt 中注入 managed sections**

在 `buildOutboundPrompt` 方法中，在 `buildLocalTimeContext()` 之后、context bridge 检查之前注入：

```ts
// 首轮注入 managed system prompt
if (!this.bridgedSessions.has(sessionId)) {
  const managedSections = buildManagedSections(this.skillsDir).join('\n\n')
  sections.push('[PetClaw system instructions]\n' + managedSections)
}
```

同时在文件顶部导入 `buildManagedSections`：

```ts
import { buildLocalTimeContext, buildManagedSections } from './managed-prompts'
```

- [x] **Step 5: 更新 index.ts 传入 skillsDir**

在 `src/main/index.ts` 中创建 CoworkController 的地方传入 skillsDir：

```ts
const controller = new CoworkController(gateway, store, skillsDir)
```

（skillsDir 已在 initializeRuntimeServices 中可用）

- [x] **Step 6: 更新测试中的 controller 构造**

在 `tests/main/ai/cowork-controller.test.ts` 的 `beforeEach` 中：

```ts
controller = new CoworkController(
  gateway as unknown as OpenclawGateway,
  store as unknown as CoworkStore,
  '/test/skills'
)
```

- [x] **Step 7: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-controller.test.ts 2>&1 | tail -10`
Expected: 全部通过

- [x] **Step 8: 运行全量 typecheck**

Run: `cd petclaw-desktop && npx tsc --noEmit 2>&1 | head -30`
Expected: 无新增错误

- [x] **Step 9: Commit**

```bash
git add src/main/ai/cowork-controller.ts src/main/index.ts tests/main/ai/cowork-controller.test.ts
git commit -m "feat(controller): inject managed system prompt on first turn"
```

---

### Task 7: 全量验证

- [x] **Step 1: 运行所有测试**

Run: `cd petclaw-desktop && npx vitest run 2>&1 | tail -20`
Expected: 所有测试通过

- [x] **Step 2: 运行 typecheck**

Run: `cd petclaw-desktop && npx tsc --noEmit 2>&1 | tail -10`
Expected: 无错误

- [x] **Step 3: Grep 确认无遗留旧 channel 名**

Run: `cd petclaw-desktop && grep -rn "chat:send\|chat:continue\|chat:stop\|chat:sessions\|'chat:session'\|chat:delete-session" src/ --include='*.ts' --include='*.tsx'`
Expected: 无匹配

- [x] **Step 4: Grep 确认无遗留旧 API 方法名**

Run: `cd petclaw-desktop && grep -rn 'cowork\.\(send\|continue\|stop\|sessions\|session\)(' src/renderer/ --include='*.ts' --include='*.tsx'`
Expected: 无匹配（只有新方法名 startSession/continueSession/stopSession/listSessions/getSession）
