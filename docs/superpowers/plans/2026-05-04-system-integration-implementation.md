# SystemIntegration 实施计划

> **For agentic workers:** 按任务顺序执行。每个任务开始前先运行对应
> `pnpm ai:prepare-change -- --target <target>`，核心 symbol 变更前查看影响面。
> 代码实现必须遵守 Electron 进程隔离红线：`nodeIntegration: false`、
> `contextIsolation: true`。

**Goal:** 按 `docs/架构设计/desktop/runtime/SystemIntegration架构设计.md` 落地第一版
SystemIntegration：macOS 不默认创建 Menu Bar Extra / Tray，新增标准 Application Menu
和 Dock Menu，统一系统动作，清理 Pet Context Menu，不让 Task Monitor 进入系统外壳。

**Architecture:** 主进程新增 `system-actions.ts` 和 `macos-integration.ts`。Dock Menu、
Application Menu、Pet Context Menu、renderer IPC 复用同一组系统动作。`tray.ts` 仅作为
非 macOS fallback，macOS 第一版不调用。

**Tech Stack:** Electron Main Process, TypeScript, safeHandle/safeOn IPC, Vitest

**Spec:** `docs/架构设计/desktop/runtime/SystemIntegration架构设计.md`

---

## 当前代码观察

- `src/main/index.ts` 在 `app:pet-ready` 后无条件调用 `createTray(...)`，macOS 会创建右上角
  Menu Bar Extra。
- `src/main/system/tray.ts` 使用 `nativeImage.createEmpty()` + `tray.setTitle('🐱')`，并包含
  `tray.monitor` / `panel:open monitor` 入口。
- `src/main/ipc/window-ipc.ts` 的 `pet:context-menu` 目前只有暂停和退出，没有 Open PetClaw、
  Hide Pet、Settings。
- `src/main/windows.ts` 已有 close-to-hide 和 `toggleMainWindow()`，但缺少显式
  `showMainWindow()` / `showSettings()` / `showPet()` / `hidePet()` 这类共享动作。
- `electron-builder.json` macOS icon 指向 `resources/icon.png`，但当前 `resources/` 目录未见
  图标资产；图标资产可作为独立设计/资源任务处理。

---

### Task 1: 建立系统动作边界

**Files:**
- Create: `petclaw-desktop/src/main/system/system-actions.ts`
- Modify: `petclaw-desktop/src/main/windows.ts`
- Test: `petclaw-desktop/tests/main/system/system-actions.test.ts`

- [ ] **Step 1: 影响分析**

Run:

```bash
pnpm ai:prepare-change -- --target toggleMainWindow
pnpm ai:prepare-change -- --target createMainWindow
```

关注 `windows.ts` 的上游调用方，尤其是 `index.ts`、`window-ipc.ts`、快捷键。

- [ ] **Step 2: 写失败测试**

覆盖：

- `openPetClaw()` 显示并聚焦主窗口。
- `showSettings()` 显示主窗口，并向 renderer 发送统一设置入口事件。
- `showPet()` / `hidePet()` 只影响 Pet Window 显示状态。
- `togglePet()` 根据当前可见状态切换。
- `quitPetClaw()` 调用显式退出动作，不直接复刻窗口关闭逻辑。

- [ ] **Step 3: 实现 system-actions**

建议接口：

```ts
export interface SystemActionDeps {
  app: Pick<Electron.App, 'quit'>
  getMainWindow: () => BrowserWindow | null
  getPetWindow: () => BrowserWindow | null
}

export function createSystemActions(deps: SystemActionDeps): SystemActions
```

实现规则：

- 函数内部必须处理 window 为 null / destroyed 的情况。
- settings 入口先显示主窗口，再发送 renderer 事件；事件名沿用现有导航机制或新增明确事件。
- 不在 action 内直接理解业务页面结构，避免系统层依赖 renderer 内部状态过深。

- [ ] **Step 4: 补齐 windows 显式函数**

在 `windows.ts` 中保留 `toggleMainWindow()`，并新增更明确的：

- `showMainWindow()`
- `focusMainWindow()`
- `showPetWindow()`
- `hidePetWindow()`

这些函数应复用现有 bounds 恢复逻辑，不复制分散逻辑。

- [ ] **Step 5: 验证**

```bash
pnpm --filter petclaw-desktop test -- tests/main/system/system-actions.test.ts
pnpm --filter petclaw-desktop typecheck
```

---

### Task 2: 新增 macOS Application Menu 和 Dock Menu

**Files:**
- Create: `petclaw-desktop/src/main/system/macos-integration.ts`
- Test: `petclaw-desktop/tests/main/system/macos-integration.test.ts`
- Modify: `petclaw-shared/src/i18n/locales/zh.ts`
- Modify: `petclaw-shared/src/i18n/locales/en.ts`

- [ ] **Step 1: 影响分析**

Run:

```bash
pnpm ai:prepare-change -- --target createTray
pnpm ai:prepare-change -- --target registerWindowIpcHandlers
```

虽然本任务新增模块，但会替代部分 tray 和窗口 IPC 行为，需要确认入口影响。

- [ ] **Step 2: 写失败测试**

覆盖：

- `buildDockMenuTemplate()` 只包含 `Open PetClaw`、`Show/Hide Pet`、`Settings...`、
  `Quit PetClaw`。
- `buildApplicationMenuTemplate()` 包含标准 macOS 项和核心业务项。
- 模板不包含 Task Monitor、Runtime Monitor、模型、技能、目录、IM、Cron。
- 非 macOS 调用初始化函数时 no-op。

- [ ] **Step 3: 实现 macos-integration**

建议导出：

```ts
export function initializeMacosIntegration(options: {
  actions: SystemActions
}): void
```

实现范围：

- `Menu.setApplicationMenu(...)`
- `app.dock?.setMenu(...)`
- `app.on('activate', actions.openPetClaw)`

注意：

- `activate` 不应切换宠物显示，只恢复主窗口。
- Dock Menu 不放 Task Monitor。
- Application Menu 不承载复杂业务导航。

- [ ] **Step 4: i18n key**

新增中英文同步 key：

- `system.openPetClaw`
- `system.showPet`
- `system.hidePet`
- `system.settings`
- `system.quit`
- `system.about`
- `system.pausePet`
- `system.resumePet`

如已有含义完全一致 key，可保留旧 key 兼容，但 macOS 新菜单应使用 `system.*`。

- [ ] **Step 5: 验证**

```bash
pnpm --filter petclaw-desktop test -- tests/main/system/macos-integration.test.ts
pnpm --filter petclaw-desktop typecheck
```

---

### Task 3: macOS 去除默认 Menu Bar Extra / Tray

**Files:**
- Modify: `petclaw-desktop/src/main/index.ts`
- Modify: `petclaw-desktop/src/main/system/tray.ts`
- Test: `petclaw-desktop/tests/main/system/tray.test.ts`

- [ ] **Step 1: 影响分析**

Run:

```bash
pnpm ai:prepare-change -- --target createTray
pnpm ai:prepare-change -- --target app:pet-ready
```

- [ ] **Step 2: 写失败测试**

覆盖：

- macOS 平台不调用 `createTray()`。
- 非 macOS 平台仍可创建 fallback tray。
- fallback tray 不包含 Task Monitor。
- fallback tray 不使用 emoji title 作为品牌入口。

- [ ] **Step 3: 修改 index 编排**

在 `app:pet-ready` 中：

- 创建 `SystemActions`。
- macOS：调用 `initializeMacosIntegration(...)`。
- 非 macOS：按 fallback 策略调用 `createTray(...)`。
- 快捷键注册继续保留，但应尽量复用 `SystemActions`，不要再传散落窗口函数。

- [ ] **Step 4: 清理 tray fallback**

`tray.ts` 作为非 macOS fallback：

- 删除 `tray.monitor` 入口。
- 删除 emoji title。
- 使用平台可接受的 fallback 图标或保持可测试的空图标，但不在 macOS 使用。

- [ ] **Step 5: 验证**

```bash
pnpm --filter petclaw-desktop test -- tests/main/system/tray.test.ts
pnpm --filter petclaw-desktop typecheck
```

---

### Task 4: 清理 Pet Context Menu

**Files:**
- Modify: `petclaw-desktop/src/main/ipc/window-ipc.ts`
- Test: `petclaw-desktop/tests/main/ipc/window-ipc.test.ts`

- [ ] **Step 1: 影响分析**

Run:

```bash
pnpm ai:prepare-change -- --target registerWindowIpcHandlers
```

- [ ] **Step 2: 写失败测试**

覆盖：

- Pet Context Menu 包含 Open PetClaw、Hide/Show Pet、Pause/Resume Pet、Settings...、Quit。
- 不包含 Task Monitor / Runtime Monitor / 模型 / 技能 / 目录 / IM / Cron。
- Pause/Resume 只发送 `pet:toggle-pause`，不停止 runtime。

- [ ] **Step 3: 改造 IPC deps**

`registerWindowIpcHandlers` 注入 `SystemActions`，让 pet 右键菜单复用统一动作：

```ts
export interface WindowIpcDeps {
  getPetWindow: () => BrowserWindow | null
  actions: SystemActions
}
```

保留 `window:move` 和 `chat:toggle` 的兼容入口，但内部调用 actions。

- [ ] **Step 4: 验证**

```bash
pnpm --filter petclaw-desktop test -- tests/main/ipc/window-ipc.test.ts
pnpm --filter petclaw-desktop typecheck
```

---

### Task 5: 系统设置入口和文案收口

**Files:**
- Modify: `petclaw-desktop/src/renderer/src/App.tsx`
- Modify: `petclaw-desktop/src/preload/index.ts`
- Modify: `petclaw-desktop/src/preload/index.d.ts`
- Modify: `petclaw-shared/src/i18n/locales/zh.ts`
- Modify: `petclaw-shared/src/i18n/locales/en.ts`

- [ ] **Step 1: 影响分析**

Run:

```bash
pnpm ai:prepare-change -- --target App
pnpm ai:prepare-change -- --target preload
```

- [ ] **Step 2: 确认现有导航事件**

先用 `rg "settings|panel:open|view"` 查 renderer 入口。若已有事件可复用，优先复用；否则新增
明确 IPC push，例如 `app:open-settings`。

- [ ] **Step 3: 同步 preload 类型**

若新增 IPC channel，必须同步：

- main IPC 注册
- preload 实现
- preload `.d.ts`
- renderer 调用方

- [ ] **Step 4: 文案检查**

确保系统外壳菜单没有继续使用 `tray.*` 表达 macOS 动作。旧 key 只用于非 macOS fallback。

- [ ] **Step 5: 验证**

```bash
pnpm --filter petclaw-desktop typecheck
pnpm --filter petclaw-desktop test -- tests/main/system
```

---

### Task 6: App Icon 资源接入

**Files:**
- Add/Modify: `petclaw-desktop/resources/icon.png`
- Optional Add: `petclaw-desktop/resources/icon.icns`
- Modify: `petclaw-desktop/electron-builder.json`
- Optional Add: `docs/设计/app-icon/`

- [ ] **Step 1: 资产确认**

确认图标源文件是否已存在。方向必须符合架构文档：

- 抽象爪痕 + AI 光点。
- 不用真实猫脸。
- 不用 `PC` 文字。
- 不用机器人头或复杂代码符号。

- [ ] **Step 2: 资源接入**

如果只有 PNG，先保证 `electron-builder.json` 指向真实存在路径。若产出 `.icns`，优先使用
macOS 原生 `.icns`。

- [ ] **Step 3: 尺寸人工检查**

检查 16、32、128、512/1024px。小尺寸必须仍能识别爪痕轮廓。

- [ ] **Step 4: 验证**

```bash
pnpm --filter petclaw-desktop build
```

如环境无法完成完整构建，至少验证资源路径存在且 typecheck 通过。

---

### Task 7: 架构文档和旧入口清理

**Files:**
- Modify: `docs/架构设计/PetClaw总体架构设计.md`
- Modify: `docs/架构设计/desktop/runtime/SystemIntegration架构设计.md` if needed
- Modify: `AGENTS.md` / `CLAUDE.md` only if workflow rules变化

- [ ] **Step 1: 文档引用检查**

Run:

```bash
rg -n "tray|Menu Bar Extra|Task Monitor|SystemIntegration|system-actions|macos-integration" docs AGENTS.md CLAUDE.md
```

- [ ] **Step 2: 同步总体架构**

总体架构只写仍然有效的高频事实：

- macOS 第一版不创建 Menu Bar Extra。
- SystemIntegration 管理 Dock/Application/Pet Context Menu、窗口恢复、快捷键、更新和系统权限。
- Task Monitor 不进入系统外壳。

- [ ] **Step 3: 验证**

```bash
pnpm --filter petclaw-desktop typecheck
```

---

## 最终验收

实现完成后必须运行：

```bash
npm run typecheck
npm test
```

针对性验证：

```bash
pnpm --filter petclaw-desktop test -- tests/main/system
pnpm --filter petclaw-desktop test -- tests/main/ipc/window-ipc.test.ts
pnpm --filter petclaw-desktop typecheck
```

手动验证：

- macOS 不出现右上角 Menu Bar Extra。
- Dock 点击恢复/聚焦主窗口。
- Dock Menu 只包含允许项。
- Application Menu 符合 macOS 结构。
- Pet Context Menu 不包含 Task Monitor。
- 主窗口 close 隐藏，不退出。
- `Quit PetClaw` 真正退出 runtime 和窗口。

提交前：

```bash
pnpm ai:impact
gitnexus_detect_changes(scope: "staged")
```

