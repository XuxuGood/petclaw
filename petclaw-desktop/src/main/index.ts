import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'
import { initDatabase } from './data/db'
import { OpencLawProvider } from './ai/openclaw'
import { registerIpcHandlers } from './ipc'

let mainWindow: BrowserWindow | null = null
let db: Database.Database
let aiProvider: OpencLawProvider

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 300,
    height: 350,
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

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Initialize database
  const dbPath = join(app.getPath('userData'), 'petclaw.db')
  db = new Database(dbPath)
  initDatabase(db)

  // Initialize AI provider
  aiProvider = new OpencLawProvider()

  // Create window
  createWindow()

  // Register IPC handlers
  if (mainWindow) {
    registerIpcHandlers(mainWindow, aiProvider, db)
  }

  // Attempt to connect to Openclaw (non-blocking)
  aiProvider.connect().catch((err) => {
    console.warn('Openclaw not available:', err.message)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  aiProvider?.disconnect()
  db?.close()
})

export { mainWindow }
