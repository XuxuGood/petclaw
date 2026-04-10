import { ipcMain, BrowserWindow } from 'electron'
import { OpencLawProvider } from './ai/openclaw'
import Database from 'better-sqlite3'
import { saveMessage, getMessages } from './data/db'

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  aiProvider: OpencLawProvider,
  db: Database.Database
): void {
  // Window move
  ipcMain.on('window:move', (_event, dx: number, dy: number) => {
    const [x, y] = mainWindow.getPosition()
    mainWindow.setPosition(x + dx, y + dy)
  })

  // Chat: send message and stream response
  ipcMain.handle('chat:send', async (_event, message: string) => {
    saveMessage(db, { role: 'user', content: message })

    // Notify renderer that AI is responding
    mainWindow.webContents.send('chat:ai-responding')

    let fullResponse = ''
    try {
      for await (const chunk of aiProvider.chat(message)) {
        fullResponse += chunk
        mainWindow.webContents.send('chat:chunk', chunk)
      }
      saveMessage(db, { role: 'assistant', content: fullResponse })
      mainWindow.webContents.send('chat:done')
    } catch (err) {
      mainWindow.webContents.send('chat:error', (err as Error).message)
    }
  })

  // Chat: load history
  ipcMain.handle('chat:history', async (_event, limit: number) => {
    return getMessages(db, limit)
  })
}
