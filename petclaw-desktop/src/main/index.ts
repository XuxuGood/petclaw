import { app, BrowserWindow, shell, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'
import { initDatabase, getSetting } from './data/db'
import { OpencLawProvider } from './ai/openclaw'
import { registerIpcHandlers } from './ipc'
import { HookServer } from './hooks/server'
import { createTray } from './system/tray'
import { registerShortcuts, unregisterShortcuts } from './system/shortcuts'
import { runBootCheck } from './bootcheck'
import { diagAppReady, diagBootResult, diagWindowLoad, diagError } from './diagnostics'

let petWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let db: Database.Database
let aiProvider: OpencLawProvider
let hookServer: HookServer

function createPetWindow(): void {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  petWindow = new BrowserWindow({
    width: 180,
    height: 145,
    x: screenWidth - 220,
    y: screenHeight - 185,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  petWindow.on('ready-to-show', () => {
    petWindow?.show()
  })

  petWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    petWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    petWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createChatWindow(): void {
  chatWindow = new BrowserWindow({
    width: 900,
    height: 650,
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#f8f8fa',
    show: false,
    minWidth: 600,
    minHeight: 400,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  chatWindow.on('close', (e) => {
    e.preventDefault()
    chatWindow?.hide()
  })

  chatWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    chatWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/chat.html')
  } else {
    chatWindow.loadFile(join(__dirname, '../renderer/chat.html'))
  }
}

function toggleChatWindow(): void {
  if (!chatWindow) return
  if (chatWindow.isVisible()) {
    chatWindow.hide()
  } else {
    chatWindow.show()
    chatWindow.focus()
  }
}

app.whenReady().then(async () => {
  diagAppReady()

  // Initialize database
  const dbPath = join(app.getPath('userData'), 'petclaw.db')
  db = new Database(dbPath)
  initDatabase(db)

  // Create chat window first — it shows BootCheck + Onboarding
  createChatWindow()
  chatWindow?.webContents.on('did-finish-load', () => {
    diagWindowLoad('chat-window', chatWindow?.webContents.getURL())
  })

  // Wait for chat window to be ready
  await new Promise<void>((resolve) => {
    if (chatWindow?.webContents.isLoading()) {
      chatWindow.webContents.on('did-finish-load', () => resolve())
    } else {
      resolve()
    }
  })

  // Show chat window for BootCheck
  chatWindow?.show()
  chatWindow?.focus()

  // Run BootCheck (progress pushed to chat window)
  const bootResult = await runBootCheck(chatWindow!)
  diagBootResult(bootResult.success)

  // Initialize AI provider
  const savedUrl = getSetting(db, 'gatewayUrl')
  const gatewayUrl = bootResult.gatewayUrl ?? savedUrl ?? 'ws://127.0.0.1:29890'
  const gatewayToken = bootResult.gatewayToken ?? ''
  aiProvider = new OpencLawProvider(gatewayUrl, gatewayToken)

  // Start hook server
  hookServer = new HookServer()
  hookServer.start().then((socketPath) => {
    console.warn('Hook server listening on:', socketPath)
  })

  // Notify chat window that boot is complete
  chatWindow?.webContents.send('boot:complete', bootResult.success)

  // Create pet window (small cat, bottom-right)
  createPetWindow()
  petWindow?.webContents.on('did-finish-load', () => {
    diagWindowLoad('pet-window', petWindow?.webContents.getURL())
  })

  // Register IPC handlers
  if (petWindow && chatWindow) {
    registerIpcHandlers(petWindow, chatWindow, aiProvider, db, hookServer, toggleChatWindow)
    createTray(petWindow, chatWindow, toggleChatWindow)
    registerShortcuts(petWindow, chatWindow, toggleChatWindow)
  }

  // Connect to Openclaw if boot succeeded
  if (bootResult.success) {
    aiProvider.connect().catch((err) => {
      console.warn('Openclaw connection failed after boot:', err.message)
    })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  chatWindow?.removeAllListeners('close')
  chatWindow?.close()

  aiProvider?.disconnect()
  db?.close()
  hookServer?.stop()
  unregisterShortcuts()
})

export { petWindow, chatWindow }

// Capture unhandled errors to diagnostics log
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason))
  diagError(err.message, err.stack)
})

process.on('uncaughtException', (err) => {
  diagError(err.message, err.stack)
})
