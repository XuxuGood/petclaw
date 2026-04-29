# IPC 注册架构重新规划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一管理 PetClaw 的 76 个 IPC channel 注册，消除散落注册、防止重复注册、明确生命周期分层。

**Tech Stack:** Electron, TypeScript, better-sqlite3, Vitest

---

## 现状问题

当前 76 个 IPC channel 的注册分散在 4 个时机、3 种方式：

| 问题 | 现状 | 影响 |
|---|---|---|
| **裸注册散落** | `index.ts` 中 4 个 channel 直接 `ipcMain.handle/on`，不在任何 `register*` 函数内 | 不可审计、不可测试、boot 逻辑和 IPC 注册耦合 |
| **注册时机不透明** | Phase A（boot 前）注册 10 个，Phase B（pet-ready 后）注册 58 个，auto-updater 注册 3 个，散落 4 个 | 新增 channel 不知道放哪个阶段 |
| **无防重复机制** | 之前 boot/settings 被 registerAll 重复注册会崩溃（已修） | 未来新增模块可能再犯 |
| **依赖注入靠 `!` 断言** | `runtimeServices!.coworkSessionManager` — boot 失败时是 null | 运行时可能 NPE |
| **死 channel** | `im:load-settings`、`im:save-settings` 已注册但 preload 未暴露 | 浪费 |

---

## 三个方案对比

### 方案 A：最小收拢（仅归位裸注册）

只把 index.ts 中 4 个 bare channel 收进对应的 register 函数，不改架构。

```text
改动：index.ts + boot-ipc.ts（或新建 app-ipc.ts）
约 2 个文件，30 行改动
```

| 优点 | 缺点 |
|---|---|
| 改动最小，风险最低 | 不解决防重复、依赖断言、死 channel 问题 |
| 10 分钟完成 | 架构债务仍在，下次加 channel 还是乱 |
| | 新人不知道 channel 该注册在哪个阶段 |

### 方案 B：两阶段 + 注册表守卫（推荐）

在现有模块化 handler 基础上增加三样东西：
1. **`ipc-registry.ts`** — `safeHandle` / `safeOn` 防重复注册 + channel 枚举审计
2. **裸注册归位** — 4 个散落 channel 收进 `boot-ipc.ts`
3. **死 channel 清理** — 删除 `im:load-settings` / `im:save-settings`
4. **注册时机文档化** — 在 `ipc/index.ts` 头部注释标注两阶段边界和规则

```text
改动：5 个文件
  新建: ipc/ipc-registry.ts（~30 行）
  修改: ipc/index.ts、index.ts、ipc/boot-ipc.ts、ipc/im-ipc.ts
约 100 行净改动
```

| 优点 | 缺点 |
|---|---|
| 防重复注册，运行时不会崩 | 不解决 `!` 断言问题（但这是 boot 失败的极端场景，UI 层已保证不触发） |
| 裸注册消除，所有 channel 可审计 | 不引入类型契约（但现有 preload 类型声明已覆盖） |
| 最小改动获得最大收益 | |
| 新增 channel 有明确规则可循 | |
| 不引入新依赖 | |

### 方案 C：全面重构（Service Container + Channel Map）

引入服务容器 + 共享类型契约 + 三层生命周期注册：

```text
Layer 0: app-core (version/boot/i18n/settings) — app.whenReady 后立即注册
Layer 1: managers (directory/models/skills/mcp/memory/im) — db 就绪后注册
Layer 2: runtime (cowork/scheduler) — runtime 就绪后注册

新建: shared/ipc-channel-map.ts、main/ipc/service-container.ts、main/ipc/ipc-registry.ts
修改: 所有 12 个 ipc/*.ts + index.ts + preload/index.ts
约 15+ 文件，500+ 行改动
```

| 优点 | 缺点 |
|---|---|
| 端到端类型安全 | 改动量大，回归风险高 |
| 服务容器解决 `!` 断言 | 引入新抽象层，学习成本 |
| 三层注册时机清晰 | 当前 76 个 channel 全部要改注册方式 |
| 业界大型应用标准做法 | 过度工程化：PetClaw 当前规模不需要 |
| | 需要同步改 preload 和 renderer 消费方 |

---

## 推荐：方案 B

**理由：** PetClaw 当前 76 个 channel、12 个模块的规模，方案 B 用最小改动解决了最痛的问题（散落、重复、不可审计），且为未来扩展留好了口子。等 channel 数量超过 150 或需要多窗口独立 IPC 时再考虑方案 C。

---

## 实施计划

### Task 1: 新建 `ipc/ipc-registry.ts` — 安全注册工具

**Files:**
- Create: `petclaw-desktop/src/main/ipc/ipc-registry.ts`

- [ ] **Step 1: 创建 ipc-registry.ts**

```typescript
// 防重复注册守卫 + channel 审计工具。
// 所有 IPC 注册必须通过 safeHandle / safeOn，禁止直接调用 ipcMain.handle/on。
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron'

const registered = new Set<string>()

// handle 模式（invoke/handle 请求-响应），重复注册时跳过并告警
export function safeHandle(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  if (registered.has(channel)) {
    console.warn(`[IPC] channel "${channel}" already registered, skipping duplicate`)
    return
  }
  registered.add(channel)
  ipcMain.handle(channel, handler)
}

// on 模式（send/on 单向），重复注册时跳过并告警
export function safeOn(
  channel: string,
  listener: (event: IpcMainEvent, ...args: unknown[]) => void
): void {
  if (registered.has(channel)) {
    console.warn(`[IPC] channel "${channel}" already registered, skipping duplicate`)
    return
  }
  registered.add(channel)
  ipcMain.on(channel, listener)
}

// 调试用：返回所有已注册 channel 列表
export function getRegisteredChannels(): string[] {
  return [...registered].sort()
}
```

- [ ] **Step 2: typecheck 验证**

```bash
pnpm --filter petclaw-desktop typecheck
```

- [ ] **Step 3: 提交**

```bash
git add petclaw-desktop/src/main/ipc/ipc-registry.ts
git commit -m "feat: 新建 ipc-registry.ts，提供 safeHandle/safeOn 防重复注册"
```

---

### Task 2: 裸注册归位 — index.ts 中的 4 个散落 channel 收进 boot-ipc.ts

**Files:**
- Modify: `petclaw-desktop/src/main/ipc/boot-ipc.ts`
- Modify: `petclaw-desktop/src/main/index.ts`

**当前散落的 4 个 channel：**
- `app:version` — bare handle in index.ts:169
- `boot:status` — bare handle in index.ts:171（依赖闭包变量 `bootSuccess`）
- `boot:retry` — bare on in index.ts:191（依赖 `engineManager`, `configSync`, `initializeRuntimeServices`）
- `app:pet-ready` — bare on in index.ts:231（依赖窗口创建和完整 IPC 注册逻辑）

**分析：** `boot:status` 和 `boot:retry` 依赖 index.ts 的闭包状态（`bootSuccess`、`engineManager`、`initializeRuntimeServices`）；`app:pet-ready` 更是 index.ts 启动编排的核心。强行抽到独立文件反而增加依赖注入复杂度。

**务实方案：** 将 `app:version` 收进 `boot-ipc.ts`（它只需要 app.getVersion()），其余 3 个保留在 index.ts 但改用 `safeHandle`/`safeOn` 替代裸 `ipcMain.handle/on`，并加注释标注为什么留在这里。

- [ ] **Step 1: 将 `app:version` 移入 boot-ipc.ts**

在 `boot-ipc.ts` 的 `registerBootIpcHandlers` 函数开头添加：

```typescript
import { safeHandle } from './ipc-registry'

// ...在函数体内：
safeHandle('app:version', async () => app.getVersion())
```

- [ ] **Step 2: index.ts 中移除 `app:version` 裸注册，其余 3 个改用 safeHandle/safeOn**

```typescript
import { safeHandle, safeOn } from './ipc/ipc-registry'

// 移除：ipcMain.handle('app:version', ...)

// boot:status 和 boot:retry 依赖启动编排闭包状态，保留在 index.ts
let bootSuccess: boolean | null = null
safeHandle('boot:status', () => bootSuccess)

// boot:retry 改用 safeOn
safeOn('boot:retry', async () => { ... })

// app:pet-ready 改用 safeOn
safeOn('app:pet-ready', () => { ... })
```

- [ ] **Step 3: typecheck 验证**

```bash
pnpm --filter petclaw-desktop typecheck
```

- [ ] **Step 4: 提交**

```bash
git add petclaw-desktop/src/main/ipc/boot-ipc.ts petclaw-desktop/src/main/index.ts
git commit -m "refactor: app:version 收进 boot-ipc，散落 channel 改用 safeHandle/safeOn"
```

---

### Task 3: 全部 register 函数迁移到 safeHandle/safeOn

**Files:**
- Modify: `petclaw-desktop/src/main/ipc/boot-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/settings-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/chat-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/window-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/directory-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/models-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/skills-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/mcp-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/memory-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/scheduler-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/im-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/pet-ipc.ts`

每个文件批量替换 `ipcMain.handle` → `safeHandle`，`ipcMain.on` → `safeOn`，并更新 import。

- [ ] **Step 1: 批量替换所有 12 个 ipc handler 文件**

对每个文件：
1. 添加 `import { safeHandle, safeOn } from './ipc-registry'`
2. 将 `ipcMain.handle(` 替换为 `safeHandle(`
3. 将 `ipcMain.on(` 替���为 `safeOn(`
4. 移除不再需要的 `ipcMain` import（如果文件中不再直接使用）

- [ ] **Step 2: typecheck + 测试验证**

```bash
pnpm --filter petclaw-desktop typecheck && pnpm --filter petclaw-desktop test
```

- [ ] **Step 3: 提交**

```bash
git add petclaw-desktop/src/main/ipc/
git commit -m "refactor: 全部 IPC 注册迁移到 safeHandle/safeOn，统一防重复守卫"
```

---

### Task 4: 标注预留 channel + 文档化注册规则

**Files:**
- Modify: `petclaw-desktop/src/main/ipc/im-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/index.ts`

- [ ] **Step 1: 标注 im-ipc.ts 中的预留 channel**

`im:load-settings` 和 `im:save-settings` 当前为空实现（preload 未暴露），保留作为 IM 设置功能预留，改用 `safeHandle` 并补注释说明用途：

```typescript
// IM 设置的独立 load/save — 前端尚未适配，预留 channel
safeHandle('im:load-settings', async () => ({}))
safeHandle('im:save-settings', async () => {})
```

- [ ] **Step 2: 在 ipc/index.ts 头部添加注册架构注释**

```typescript
// ── IPC 注册架构 ──
//
// PetClaw IPC 分两阶段注册，由 index.ts 编排：
//
// Phase A — Boot 前（db 就绪后、runBootCheck 前）：
//   registerBootIpcHandlers   → onboarding:*, i18n:*, app:version
//   registerSettingsIpcHandlers → settings:get, settings:set
//   + index.ts 中 boot:status, boot:retry（依赖启动闭包状态）
//
// Phase B — Pet-ready 后（双窗口 + runtime 就绪）：
//   registerAllIpcHandlers → chat, window, pet, directory, models,
//                            skills, mcp, memory, scheduler, im
//   + index.ts 中 app:pet-ready（依赖窗口创建编排）
//
// 规则：
// 1. 所有注册必须通过 safeHandle / safeOn（ipc-registry.ts），禁止裸 ipcMain.handle/on
// 2. 仅依赖 db/managers 的 channel 放 Phase A，依赖 runtimeServices 的放 Phase B
// 3. 新增 channel 必须同步 preload/index.ts 暴露 + preload/index.d.ts 类型声明
// 4. Channel 命名：`模块:动作`，禁止驼峰
```

- [ ] **Step 3: typecheck + 测试验证**

```bash
pnpm --filter petclaw-desktop typecheck && pnpm --filter petclaw-desktop test
```

- [ ] **Step 4: 提交**

```bash
git add petclaw-desktop/src/main/ipc/
git commit -m "refactor: 标注预留 channel，文档化 IPC 两阶段注册架构"
```

---

### Task 5: 同步 CLAUDE.md / AGENTS.md IPC 规则

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: 在 § 8 IPC 章节补充注册规则**

在现有 IPC 规则后追加：
```markdown
- 所有 IPC 注册必须通过 `safeHandle` / `safeOn`（`src/main/ipc/ipc-registry.ts`），禁止裸 `ipcMain.handle/on`。
- IPC 分两阶段注册（见 `ipc/index.ts` 头部注释）：Phase A（boot 前，仅依赖 db）、Phase B（pet-ready 后，依赖 runtimeServices）。
- 新增 IPC channel 必须同步三处：`src/main/ipc/*.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`。
```

- [ ] **Step 2: 提交**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: 同步 IPC 两阶段注册架构规则到 CLAUDE.md / AGENTS.md"
```

---

## 验证

全部完成后运行：

```bash
npm run typecheck && npm test
```

确认无类型错误、无测试失败。
