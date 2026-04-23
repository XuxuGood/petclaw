import type { BrowserWindow } from 'electron'

import type { HookServer } from '../hooks/server'

export interface PetIpcDeps {
  getPetWindow: () => BrowserWindow | null
  getChatWindow: () => BrowserWindow | null
  hookServer: HookServer | null
}

export function registerPetIpcHandlers(deps: PetIpcDeps): void {
  const { getPetWindow, getChatWindow, hookServer } = deps

  hookServer?.onEvent((event: unknown) => {
    getPetWindow()?.webContents.send('hook:event', event)
    getChatWindow()?.webContents.send('hook:event', event)
  })
}
