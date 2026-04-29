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
//   registerAllIpcHandlers → chat, window, directory, models,
//                            skills, mcp, memory, scheduler, im
//   + index.ts 中 app:pet-ready（依赖窗口创建编排）
//   + auto-updater.ts 中 updater:check, updater:download, updater:install
//
// 规则：
// 1. 所有注册必须通过 safeHandle / safeOn（ipc-registry.ts），禁止裸 ipcMain.handle/on
// 2. 仅依赖 db/managers 的 channel 放 Phase A，依赖 runtimeServices 的放 Phase B
// 3. 新增 channel 必须同步 preload/index.ts 暴露 + preload/index.d.ts 类型声明
// 4. Channel 命名：`模块:动作`，禁止驼峰

import { registerChatIpcHandlers, type ChatIpcDeps } from './chat-ipc'
import { registerSettingsIpcHandlers, type SettingsIpcDeps } from './settings-ipc'
import { registerWindowIpcHandlers, type WindowIpcDeps } from './window-ipc'
import { registerBootIpcHandlers, type BootIpcDeps } from './boot-ipc'
import { registerDirectoryIpcHandlers, type DirectoryIpcDeps } from './directory-ipc'
import { registerModelsIpcHandlers, type ModelsIpcDeps } from './models-ipc'
import { registerSkillsIpcHandlers, type SkillsIpcDeps } from './skills-ipc'
import { registerMcpIpcHandlers, type McpIpcDeps } from './mcp-ipc'
import { registerMemoryIpcHandlers, type MemoryIpcDeps } from './memory-ipc'
import { registerSchedulerIpcHandlers, type SchedulerIpcDeps } from './scheduler-ipc'
import { registerImIpcHandlers, type ImIpcDeps } from './im-ipc'

// AllIpcDeps 合并全部模块的依赖接口，主进程统一注入
export type AllIpcDeps = ChatIpcDeps &
  SettingsIpcDeps &
  WindowIpcDeps &
  BootIpcDeps &
  DirectoryIpcDeps &
  ModelsIpcDeps &
  SkillsIpcDeps &
  McpIpcDeps &
  MemoryIpcDeps &
  SchedulerIpcDeps &
  ImIpcDeps

export function registerAllIpcHandlers(deps: AllIpcDeps): void {
  // boot-ipc 和 settings-ipc 已在启动阶段由 index.ts 提前注册，
  // 这里不再重复调用，避免 ipcMain.handle 对同一 channel 二次注册报错
  registerChatIpcHandlers(deps)
  registerWindowIpcHandlers(deps)
  registerDirectoryIpcHandlers(deps)
  registerModelsIpcHandlers(deps)
  registerSkillsIpcHandlers(deps)
  registerMcpIpcHandlers(deps)
  registerMemoryIpcHandlers(deps)
  registerSchedulerIpcHandlers(deps)
  registerImIpcHandlers(deps)
}

export { registerBootIpcHandlers, registerSettingsIpcHandlers }
export type { BootIpcDeps, SettingsIpcDeps }
