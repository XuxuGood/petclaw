import { registerChatIpcHandlers, type ChatIpcDeps } from './chat-ipc'
import { registerSettingsIpcHandlers, type SettingsIpcDeps } from './settings-ipc'
import { registerWindowIpcHandlers, type WindowIpcDeps } from './window-ipc'
import { registerBootIpcHandlers, type BootIpcDeps } from './boot-ipc'
import { registerPetIpcHandlers, type PetIpcDeps } from './pet-ipc'
import { registerAgentsIpcHandlers, type AgentsIpcDeps } from './agents-ipc'
import { registerModelsIpcHandlers, type ModelsIpcDeps } from './models-ipc'
import { registerSkillsIpcHandlers, type SkillsIpcDeps } from './skills-ipc'
import { registerMcpIpcHandlers, type McpIpcDeps } from './mcp-ipc'
import { registerMemoryIpcHandlers, type MemoryIpcDeps } from './memory-ipc'

// AllIpcDeps 合并全部模块的依赖接口，主进程统一注入
export type AllIpcDeps = ChatIpcDeps &
  SettingsIpcDeps &
  WindowIpcDeps &
  BootIpcDeps &
  PetIpcDeps &
  AgentsIpcDeps &
  ModelsIpcDeps &
  SkillsIpcDeps &
  McpIpcDeps &
  MemoryIpcDeps

export function registerAllIpcHandlers(deps: AllIpcDeps): void {
  registerChatIpcHandlers(deps)
  registerSettingsIpcHandlers(deps)
  registerWindowIpcHandlers(deps)
  registerBootIpcHandlers(deps)
  registerPetIpcHandlers(deps)
  // Phase 2: Manager IPC 模块
  registerAgentsIpcHandlers(deps)
  registerModelsIpcHandlers(deps)
  registerSkillsIpcHandlers(deps)
  registerMcpIpcHandlers(deps)
  registerMemoryIpcHandlers(deps)
}

export { registerBootIpcHandlers, registerSettingsIpcHandlers }
export type { BootIpcDeps, SettingsIpcDeps }
