import { registerChatIpcHandlers, type ChatIpcDeps } from './chat-ipc'
import { registerSettingsIpcHandlers, type SettingsIpcDeps } from './settings-ipc'
import { registerWindowIpcHandlers, type WindowIpcDeps } from './window-ipc'
import { registerBootIpcHandlers, type BootIpcDeps } from './boot-ipc'
import { registerPetIpcHandlers, type PetIpcDeps } from './pet-ipc'

export type AllIpcDeps = ChatIpcDeps & SettingsIpcDeps & WindowIpcDeps & BootIpcDeps & PetIpcDeps

export function registerAllIpcHandlers(deps: AllIpcDeps): void {
  registerChatIpcHandlers(deps)
  registerSettingsIpcHandlers(deps)
  registerWindowIpcHandlers(deps)
  registerBootIpcHandlers(deps)
  registerPetIpcHandlers(deps)
}

export { registerBootIpcHandlers, registerSettingsIpcHandlers }
export type { BootIpcDeps, SettingsIpcDeps }
