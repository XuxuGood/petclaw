import { ipcMain, type BrowserWindow } from 'electron'

import type { SessionManager } from '../ai/session-manager'
import type { CoworkController } from '../ai/cowork-controller'
import type { PermissionResult } from '../ai/types'

export interface ChatIpcDeps {
  sessionManager: SessionManager
  coworkController: CoworkController
  getChatWindow: () => BrowserWindow | null
  getPetWindow: () => BrowserWindow | null
}

export function registerChatIpcHandlers(deps: ChatIpcDeps): void {
  const { sessionManager, coworkController, getChatWindow } = deps

  ipcMain.handle('chat:send', async (_event, message: string, cwd: string) => {
    return sessionManager.createAndStart('Chat', cwd, message)
  })

  ipcMain.handle('chat:continue', async (_event, sessionId: string, message: string) => {
    sessionManager.continueSession(sessionId, message)
  })

  ipcMain.handle('chat:stop', async (_event, sessionId: string) => {
    sessionManager.stopSession(sessionId)
  })

  ipcMain.handle('chat:sessions', async () => {
    return sessionManager.getSessions()
  })

  ipcMain.handle('chat:session', async (_event, id: string) => {
    return sessionManager.getSession(id)
  })

  ipcMain.handle('chat:delete-session', async (_event, id: string) => {
    sessionManager.deleteSession(id)
  })

  ipcMain.handle(
    'cowork:permission:respond',
    async (_event, requestId: string, result: PermissionResult) => {
      coworkController.respondToPermission(requestId, result)
    }
  )

  coworkController.on('message', (sessionId: string, msg: unknown) => {
    getChatWindow()?.webContents.send('cowork:stream:message', { sessionId, message: msg })
  })

  coworkController.on('messageUpdate', (sessionId: string, msgId: string, content: string) => {
    getChatWindow()?.webContents.send('cowork:stream:message-update', {
      sessionId,
      messageId: msgId,
      content
    })
  })

  coworkController.on('permissionRequest', (sessionId: string, req: unknown) => {
    getChatWindow()?.webContents.send('cowork:stream:permission', { sessionId, request: req })
  })

  coworkController.on('complete', (sessionId: string) => {
    getChatWindow()?.webContents.send('cowork:stream:complete', { sessionId })
  })

  coworkController.on('error', (sessionId: string, error: string) => {
    getChatWindow()?.webContents.send('cowork:stream:error', { sessionId, error })
  })
}
