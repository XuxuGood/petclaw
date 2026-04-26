import { ipcMain, type BrowserWindow } from 'electron'

import type { CoworkSessionManager } from '../ai/cowork-session-manager'
import type { CoworkController } from '../ai/cowork-controller'
import type { PermissionResult } from '../ai/types'

export interface ChatIpcDeps {
  coworkSessionManager: CoworkSessionManager
  coworkController: CoworkController
  getMainWindow: () => BrowserWindow | null
  getPetWindow: () => BrowserWindow | null
}

export function registerChatIpcHandlers(deps: ChatIpcDeps): void {
  const { coworkSessionManager, coworkController, getMainWindow } = deps

  ipcMain.handle('chat:send', async (_event, message: string, cwd: string) => {
    // agentId 不再由前端传入，CoworkSessionManager 内部通过 cwd 自动派生
    return coworkSessionManager.createAndStart('Chat', cwd, message)
  })

  ipcMain.handle('chat:continue', async (_event, sessionId: string, message: string) => {
    coworkSessionManager.continueSession(sessionId, message)
  })

  ipcMain.handle('chat:stop', async (_event, sessionId: string) => {
    coworkSessionManager.stopSession(sessionId)
  })

  ipcMain.handle('chat:sessions', async () => {
    return coworkSessionManager.getSessions()
  })

  ipcMain.handle('chat:session', async (_event, id: string) => {
    return coworkSessionManager.getSession(id)
  })

  ipcMain.handle('chat:delete-session', async (_event, id: string) => {
    coworkSessionManager.deleteSession(id)
  })

  ipcMain.handle(
    'cowork:permission:respond',
    async (_event, requestId: string, result: PermissionResult) => {
      coworkController.respondToPermission(requestId, result)
    }
  )

  coworkController.on('message', (sessionId: string, msg: unknown) => {
    getMainWindow()?.webContents.send('cowork:stream:message', { sessionId, message: msg })
  })

  coworkController.on('messageUpdate', (sessionId: string, msgId: string, content: string) => {
    getMainWindow()?.webContents.send('cowork:stream:message-update', {
      sessionId,
      messageId: msgId,
      content
    })
  })

  coworkController.on('permissionRequest', (sessionId: string, req: unknown) => {
    getMainWindow()?.webContents.send('cowork:stream:permission', { sessionId, request: req })
  })

  coworkController.on('complete', (sessionId: string) => {
    getMainWindow()?.webContents.send('cowork:stream:complete', { sessionId })
  })

  coworkController.on('error', (sessionId: string, error: string) => {
    getMainWindow()?.webContents.send('cowork:stream:error', { sessionId, error })
  })
}
