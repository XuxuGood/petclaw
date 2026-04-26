import type { BrowserWindow } from 'electron'

import type { HookServer } from '../hooks/server'

export interface PetIpcDeps {
  getPetWindow: () => BrowserWindow | null
  getMainWindow: () => BrowserWindow | null
  hookServer: HookServer | null
}

export function registerPetIpcHandlers(deps: PetIpcDeps): void {
  const { getPetWindow, getMainWindow, hookServer } = deps

  hookServer?.onEvent((event: unknown) => {
    getPetWindow()?.webContents.send('hook:event', event)
    getMainWindow()?.webContents.send('hook:event', event)
  })
}
