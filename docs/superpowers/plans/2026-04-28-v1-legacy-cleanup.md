# V1 遗留代码清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理 v3 架构下已废弃的 v1 遗留代码，修复 IPC 双重注册 bug，移除死代码和无效数据源。

**Architecture:** index.ts 启动序列中 autoLaunch 初始化读取错误数据源（旧 JSON 文件），需改为从 SQLite 读取；IPC handler 的 boot/settings 模块在启动阶段提前注册后又被 registerAllIpcHandlers 重复注册导致运行时报错，需拆分为"早期 IPC"和"完整 IPC"两批注册；app-settings.ts 中大量 v1 遗留函数和接口字段需精简；死组件 SettingsView.tsx 需删除。

**Tech Stack:** Electron, TypeScript, better-sqlite3, Vitest

---

## 变更范围

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/main/index.ts` | 修改 | 移除 autoLaunch 旧 JSON 读取，改用 kvGet；移除提前注册的 registerBootIpcHandlers + registerSettingsIpcHandlers |
| `src/main/ipc/index.ts` | 修改 | registerAllIpcHandlers 保持不变；移除 registerBootIpcHandlers/registerSettingsIpcHandlers 的 re-export |
| `src/main/app-settings.ts` | 修改 | 删除 5 个死函数 + 精简 PetclawSettings 接口 + 删除 DEFAULT_GATEWAY_PORT/URL 常量 |
| `src/renderer/src/components/SettingsView.tsx` | 删除 | 死组件，无任何导入方 |
| `tests/main/app-settings.test.ts` | 修改 | 删除已废弃函数的测试 |

## 不变更

- `windows.ts` 仍使用 `readAppSettings`/`writeAppSettings`/`PetclawSettings.windowBounds`/`PetclawSettings.petPosition`，保留。
- `window-layout.ts` 仍引用 `PetclawSettings` 类型，保留。

---

### Task 1: 修复 IPC 双重注册 bug

**问题：** `index.ts` 第 174-175 行提前注册 `registerBootIpcHandlers` + `registerSettingsIpcHandlers`，第 248 行 `registerAllIpcHandlers` 内部又注册同样的 channels，`ipcMain.handle` 不允许对同一 channel 注册两次，会抛 `Error: Attempted to register a second handler`。

**方案：** 从 `registerAllIpcHandlers` 中移除 boot 和 settings 的注册（因为它们需要在 boot 阶段提前可用），保留 index.ts 中的提前注册。同时更新 ipc/index.ts 的 re-export。

**Files:**
- Modify: `petclaw-desktop/src/main/ipc/index.ts`
- Modify: `petclaw-desktop/src/main/index.ts`（仅验证）

- [ ] **Step 1: 修改 registerAllIpcHandlers，移除 boot 和 settings 的注册**

`petclaw-desktop/src/main/ipc/index.ts` 中，`registerAllIpcHandlers` 不再调用 `registerBootIpcHandlers` 和 `registerSettingsIpcHandlers`（它们已在启动阶段由 index.ts 提前注册）：

```typescript
export function registerAllIpcHandlers(deps: AllIpcDeps): void {
  // boot-ipc 和 settings-ipc 已在启动阶段提前注册（index.ts），
  // 这里不再重复调用，避免 ipcMain.handle 对同一 channel 二次注册报错
  registerChatIpcHandlers(deps)
  registerWindowIpcHandlers(deps)
  registerPetIpcHandlers(deps)
  registerDirectoryIpcHandlers(deps)
  registerModelsIpcHandlers(deps)
  registerSkillsIpcHandlers(deps)
  registerMcpIpcHandlers(deps)
  registerMemoryIpcHandlers(deps)
  registerSchedulerIpcHandlers(deps)
  registerImIpcHandlers(deps)
}
```

同时清理不再需要的 import（`registerBootIpcHandlers` 和 `registerSettingsIpcHandlers` 的类型导入如果仅在函数体内使用可移除）。但由于 index.ts 通过 `from './ipc'` 导入这两个函数，re-export 保留。

- [ ] **Step 2: typecheck 验证**

```bash
pnpm --filter petclaw-desktop typecheck
```

- [ ] **Step 3: 提交**

```bash
git add petclaw-desktop/src/main/ipc/index.ts
git commit -m "fix: 移除 registerAllIpcHandlers 中 boot/settings 的重复注册，避免 ipcMain.handle 二次注册报错"
```

---

### Task 2: 修复 autoLaunch 初始化数据源

**问题：** `index.ts` 第 160-165 行从旧 JSON 文件 `petclaw-settings.json` 读取 autoLaunch，但 v3 用户设置存在 SQLite `app_config` 表。当 JSON 文件不存在时此代码无效；当存在时可能用旧值覆盖系统设置。

**方案：** 改为从 `kvGet(db, 'autoLaunch')` 读取。系统的 login item 状态本身会持久化，但首次启动或用户手动清除 login items 后需要同步一次。

**Files:**
- Modify: `petclaw-desktop/src/main/index.ts`

- [ ] **Step 1: 替换 autoLaunch 初始化代码**

将 index.ts 中：
```typescript
// 7. 同步 auto-launch 设置到系统
const initSettingsPath = path.join(app.getPath('home'), '.petclaw', 'petclaw-settings.json')
const initSettings = readAppSettings(initSettingsPath)
if (initSettings.autoLaunch !== undefined) {
  app.setLoginItemSettings({ openAtLogin: initSettings.autoLaunch })
}
```

替换为：
```typescript
// 7. 同步 auto-launch 设置到系统（从 SQLite 读取，与 settings-ipc 中的 autoLaunch 写入保持一致）
const savedAutoLaunch = kvGet(db, 'autoLaunch')
if (savedAutoLaunch !== null) {
  app.setLoginItemSettings({ openAtLogin: savedAutoLaunch === 'true' })
}
```

- [ ] **Step 2: 清理不再需要的 import**

`readAppSettings` 在 index.ts 中不再使用（仅此处一次调用），移除 import：
```typescript
// 删除这行
import { readAppSettings } from './app-settings'
```

- [ ] **Step 3: 添加 kvGet import（如果尚未导入）**

确认 index.ts 是否已导入 `kvGet`，如未导入则添加：
```typescript
import { kvGet } from './data/db'
```

- [ ] **Step 4: typecheck 验证**

```bash
pnpm --filter petclaw-desktop typecheck
```

- [ ] **Step 5: 提交**

```bash
git add petclaw-desktop/src/main/index.ts
git commit -m "fix: autoLaunch 初始化改为从 SQLite 读取，移除对旧 JSON 文件的依赖"
```

---

### Task 3: 精简 app-settings.ts（移除 v1 死代码）

**问题：** `app-settings.ts` 中 5 个导出函数在生产代码无调用方（仅测试引用），`PetclawSettings` 接口含大量废弃字段，`DEFAULT_GATEWAY_PORT`/`DEFAULT_GATEWAY_URL` 常量无运行引用且与 engine-manager.ts 中的值冲突。

**保留项：** `readAppSettings`、`writeAppSettings`、`PetclawSettings`（精简后）——`windows.ts` 仍用于窗口位置持久化。

**Files:**
- Modify: `petclaw-desktop/src/main/app-settings.ts`
- Modify: `petclaw-desktop/tests/main/app-settings.test.ts`

- [ ] **Step 1: 精简 PetclawSettings 接口**

只保留仍被 `windows.ts` 活跃使用的字段，以及 `autoLaunch`（虽然 index.ts 不再从 JSON 读取，但 JSON 文件可能仍存在，`readAppSettings` 返回时需要类型兼容）：

```typescript
export interface PetclawSettings {
  windowBounds?: { x: number; y: number; width: number; height: number }
  petPosition?: { x: number; y: number }
  // 以下字段为 v1 遗留，JSON 文件中可能仍存在，保留类型声明以兼容 readAppSettings 反序列化
  [key: string]: unknown
}
```

- [ ] **Step 2: 删除死函数和常量**

删除以下导出（含函数体）：
- `DEFAULT_GATEWAY_PORT`
- `DEFAULT_GATEWAY_URL`
- `createDefaultSettings()`
- `mergeDefaults()`
- `OnboardingSettingsInput` 接口
- `getAppSetting()`
- `setAppSetting()`
- `saveOnboardingSettings()`
- `parseSettingValue()`（内部函数，仅被 setAppSetting 调用）
- `ensureParentDir()`（内部函数，仅被 writeAppSettings 调用——检查 writeAppSettings 是否还用）

注意：`ensureParentDir` 被 `writeAppSettings` 调用，而 `writeAppSettings` 仍被 `windows.ts` 使用，所以 `ensureParentDir` **保留**。

精简后的 `app-settings.ts` 应只包含：
```typescript
import fs from 'fs'
import path from 'path'

export interface PetclawSettings {
  windowBounds?: { x: number; y: number; width: number; height: number }
  petPosition?: { x: number; y: number }
  // v1 遗留字段兼容：JSON 文件中可能仍存在其他字段，允许反序列化
  [key: string]: unknown
}

function ensureParentDir(settingsPath: string): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
}

export function readAppSettings(settingsPath: string): PetclawSettings {
  if (!fs.existsSync(settingsPath)) return {}
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as PetclawSettings
  } catch {
    return {}
  }
}

export function writeAppSettings(settingsPath: string, settings: PetclawSettings): void {
  ensureParentDir(settingsPath)
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}
```

- [ ] **Step 3: 更新测试文件**

`tests/main/app-settings.test.ts` 中删除已废弃函数的测试用例，只保留 `readAppSettings`/`writeAppSettings` 的测试。

- [ ] **Step 4: 检查 window-layout.ts 对 PetclawSettings 的引用**

`window-layout.ts` import 了 `PetclawSettings` 类型，确认精简后接口仍兼容（只用了 `petPosition` 字段，接口保留了）。

```bash
pnpm --filter petclaw-desktop typecheck
```

- [ ] **Step 5: 运行测试**

```bash
pnpm --filter petclaw-desktop test
```

- [ ] **Step 6: 提交**

```bash
git add petclaw-desktop/src/main/app-settings.ts petclaw-desktop/tests/main/app-settings.test.ts
git commit -m "refactor: 精简 app-settings.ts，移除 v1 遗留死函数和废弃接口字段"
```

---

### Task 4: 删除死组件 SettingsView.tsx

**问题：** `SettingsView.tsx` 是 v1 遗留组件，操作 `gatewayUrl` 设置，无任何文件导入。

**Files:**
- Delete: `petclaw-desktop/src/renderer/src/components/SettingsView.tsx`

- [ ] **Step 1: 删除文件**

```bash
rm petclaw-desktop/src/renderer/src/components/SettingsView.tsx
```

- [ ] **Step 2: typecheck + 测试验证**

```bash
pnpm --filter petclaw-desktop typecheck && pnpm --filter petclaw-desktop test
```

- [ ] **Step 3: 提交**

```bash
git add petclaw-desktop/src/renderer/src/components/SettingsView.tsx
git commit -m "refactor: 删除 v1 遗留死组件 SettingsView.tsx"
```

---

## 验证

全部完成后运行：

```bash
npm run typecheck && npm test
```

确认无类型错误、无测试失败。
