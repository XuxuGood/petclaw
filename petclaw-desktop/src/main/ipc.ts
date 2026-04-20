import { ipcMain, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { OpencLawProvider } from './ai/openclaw'
import Database from 'better-sqlite3'
import { saveMessage, getMessages, saveSetting, getSetting } from './data/db'
import { HookServer } from './hooks/server'
import { ConfigInstaller } from './hooks/installer'
import { checkEnvironment, checkGatewayConnectivity, installHooks } from './onboarding'

export function registerIpcHandlers(
  petWindow: BrowserWindow,
  chatWindow: BrowserWindow,
  aiProvider: OpencLawProvider,
  db: Database.Database,
  hookServer: HookServer,
  toggleChatWindow: () => void
): void {
  // Window move (pet window)
  ipcMain.on('window:move', (event, dx: number, dy: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + dx, y + dy)
  })

  // Toggle chat window
  ipcMain.on('chat:toggle', () => {
    toggleChatWindow()
  })

  // Forward hook events to both windows
  hookServer.onEvent((event) => {
    petWindow.webContents.send('hook:event', event)
    chatWindow.webContents.send('hook:event', event)
  })

  // Chat: send message and stream response
  ipcMain.handle('chat:send', async (_event, message: string) => {
    if (!aiProvider.isConnected()) {
      chatWindow.webContents.send('chat:error', 'AI 未连接，请检查 Openclaw Gateway 是否运行')
      return
    }

    saveMessage(db, { role: 'user', content: message })

    // Notify both windows
    petWindow.webContents.send('chat:ai-responding')
    chatWindow.webContents.send('chat:ai-responding')

    let fullResponse = ''
    try {
      for await (const chunk of aiProvider.chat(message)) {
        fullResponse += chunk
        chatWindow.webContents.send('chat:chunk', chunk)
        // Send to pet window for speech bubble
        petWindow.webContents.send('chat:chunk', chunk)
      }
      saveMessage(db, { role: 'assistant', content: fullResponse })
      petWindow.webContents.send('chat:done')
      chatWindow.webContents.send('chat:done')
    } catch (err) {
      const errMsg = (err as Error).message
      petWindow.webContents.send('chat:error', errMsg)
      chatWindow.webContents.send('chat:error', errMsg)
    }
  })

  // Chat: load history
  ipcMain.handle('chat:history', async (_event, limit: number) => {
    return getMessages(db, limit)
  })

  // Settings
  ipcMain.handle('settings:get', async (_event, key: string) => {
    return getSetting(db, key)
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    saveSetting(db, key, value)

    if (key === 'gatewayUrl') {
      aiProvider.disconnect()
      aiProvider.setGatewayUrl(value)
      aiProvider.connect().catch((err) => {
        console.warn('Failed to reconnect with new gateway URL:', err.message)
      })
    }
  })

  ipcMain.handle('app:version', async () => {
    return app.getVersion()
  })

  // Onboarding
  ipcMain.handle('onboarding:checkEnv', async () => {
    return checkEnvironment()
  })

  ipcMain.handle('onboarding:checkGateway', async (_event, url: string) => {
    return checkGatewayConnectivity(url)
  })

  ipcMain.handle('onboarding:installHooks', async () => {
    const settingsPath = join(app.getPath('home'), '.claude', 'settings.json')
    const bridgePath = join(app.getAppPath(), 'resources', 'petclaw-bridge')
    const installer = new ConfigInstaller(bridgePath)
    return installHooks(installer, settingsPath)
  })

  // Save onboarding results to ~/.petclaw config files
  ipcMain.handle(
    'onboarding:saveConfig',
    async (
      _event,
      data: {
        nickname: string
        roles: string[]
        selectedSkills: string[]
        voiceShortcut: string
        language: string
      }
    ) => {
      const petclawHome = join(app.getPath('home'), '.petclaw')
      const settingsPath = join(petclawHome, 'petclaw-settings.json')

      // Update petclaw-settings.json
      if (existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
          settings.onboardingComplete = true
          settings.sopComplete = true
          settings.language = data.language
          settings.voiceShortcut = data.voiceShortcut.split(' + ').map((k) => k.trim())
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
        } catch {
          // ignore
        }
      }

      // Write USER.md in workspace
      const workspacePath = join(petclawHome, 'workspace')
      const userMdPath = join(workspacePath, 'USER.md')
      if (!existsSync(userMdPath) || readFileSync(userMdPath, 'utf-8').includes('_(optional)_')) {
        const userMd = `## USER.md - About Your Human

- **Name:** ${data.nickname}
- **What to call them:** ${data.nickname}
- **Occupation:** ${data.roles.join(', ')}
- **Notes:**
`
        writeFileSync(userMdPath, userMd)
      }

      return { success: true }
    }
  )
}
