import path from 'path'
import { app, BrowserWindow, shell, screen, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'

import { initDatabase } from './data/db'
import { OpenclawEngineManager } from './ai/engine-manager'
import { ConfigSync } from './ai/config-sync'
import { OpenclawGateway } from './ai/gateway'
import { CoworkController } from './ai/cowork-controller'
import { CoworkStore } from './ai/cowork-store'
import { SessionManager } from './ai/session-manager'
import { PetEventBridge } from './pet/pet-event-bridge'
import { registerChatIpcHandlers } from './ipc/chat-ipc'
import { registerSettingsIpcHandlers } from './ipc/settings-ipc'
import { registerWindowIpcHandlers } from './ipc/window-ipc'
import { registerBootIpcHandlers } from './ipc/boot-ipc'
import { registerPetIpcHandlers } from './ipc/pet-ipc'
import { HookServer } from './hooks/server'
import { createTray } from './system/tray'
import { registerShortcuts, unregisterShortcuts } from './system/shortcuts'
import { runBootCheck } from './bootcheck'
import { diagAppReady, diagBootResult, diagWindowLoad, diagError } from './diagnostics'
import { readAppSettings, writeAppSettings } from './app-settings'
import { resolveDatabasePath } from './database-path'

let petWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let db: Database.Database
let engineManager: OpenclawEngineManager
let configSync: ConfigSync
let coworkStore: CoworkStore
let gateway: OpenclawGateway | null = null
let coworkController: CoworkController | null = null
let sessionManager: SessionManager | null = null
// 持有引用防止 GC，桥接器在构造时绑定事件
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let petEventBridge: PetEventBridge | null = null
let hookServer: HookServer

/* ── Window sizing constants ── */
const PET_W = 180
const PET_H = 145
// Pet 贴靠 chat 窗口的偏移（右下角内侧，输入框上方）
const PET_ANCHOR_OFFSET_X = 150
const PET_ANCHOR_OFFSET_Y = 200
// Pet 无 chat 时的屏幕边距
const PET_SCREEN_MARGIN_X = 220
const PET_SCREEN_MARGIN_Y = 185

// Chat Window 动态尺寸：screenW * RATIO，clamp(MIN, MAX)
const CHAT_W_RATIO = 0.55
const CHAT_W_MIN = 800
const CHAT_W_MAX = 1200
const CHAT_H_RATIO = 0.7
const CHAT_H_MIN = 560
const CHAT_H_MAX = 900

function createPetWindow(): void {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  // Priority: saved position > chat window anchor > screen corner fallback
  const petSettingsPath = path.join(app.getPath('home'), '.petclaw', 'petclaw-settings.json')
  const savedPetPos = readAppSettings(petSettingsPath).petPosition

  let petX = screenWidth - PET_SCREEN_MARGIN_X
  let petY = screenHeight - PET_SCREEN_MARGIN_Y

  if (
    savedPetPos &&
    savedPetPos.x >= 0 &&
    savedPetPos.y >= 0 &&
    savedPetPos.x <= screenWidth - PET_W &&
    savedPetPos.y <= screenHeight - PET_H
  ) {
    petX = savedPetPos.x
    petY = savedPetPos.y
  } else if (chatWindow && chatWindow.isVisible()) {
    const chatBounds = chatWindow.getBounds()
    petX = chatBounds.x + chatBounds.width - PET_ANCHOR_OFFSET_X
    petY = chatBounds.y + chatBounds.height - PET_ANCHOR_OFFSET_Y

    petX = Math.min(petX, screenWidth - PET_W)
    petY = Math.min(petY, screenHeight - PET_H)
    petX = Math.max(petX, 0)
    petY = Math.max(petY, 0)
  }

  petWindow = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: petX,
    y: petY,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: is.dev
    }
  })

  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  petWindow.setAlwaysOnTop(true, 'floating')

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
    petWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Persist pet position on move (debounced)
  let petPosTimer: ReturnType<typeof setTimeout> | null = null
  petWindow.on('move', () => {
    if (petPosTimer) clearTimeout(petPosTimer)
    petPosTimer = setTimeout(() => {
      if (!petWindow || petWindow.isDestroyed()) return
      const [x, y] = petWindow.getPosition()
      const settings = readAppSettings(petSettingsPath)
      settings.petPosition = { x, y }
      writeAppSettings(petSettingsPath, settings)
    }, 500)
  })
}

function createChatWindow(): void {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const chatW = Math.round(Math.min(Math.max(screenW * CHAT_W_RATIO, CHAT_W_MIN), CHAT_W_MAX))
  const chatH = Math.round(Math.min(Math.max(screenH * CHAT_H_RATIO, CHAT_H_MIN), CHAT_H_MAX))

  // Restore saved window bounds (if valid and within current screen)
  const settingsPath = path.join(app.getPath('home'), '.petclaw', 'petclaw-settings.json')
  const saved = readAppSettings(settingsPath).windowBounds
  let initialW = chatW
  let initialH = chatH
  let initialX: number | undefined
  let initialY: number | undefined

  if (saved && saved.width >= CHAT_W_MIN && saved.height >= CHAT_H_MIN) {
    // Ensure saved position is within current screen bounds
    if (
      saved.x >= 0 &&
      saved.y >= 0 &&
      saved.x + saved.width <= screenW + 100 &&
      saved.y + saved.height <= screenH + 100
    ) {
      initialW = saved.width
      initialH = saved.height
      initialX = saved.x
      initialY = saved.y
    } else {
      // Position off-screen, only restore size
      initialW = Math.min(saved.width, screenW)
      initialH = Math.min(saved.height, screenH)
    }
  }

  chatWindow = new BrowserWindow({
    width: initialW,
    height: initialH,
    ...(initialX !== undefined && initialY !== undefined ? { x: initialX, y: initialY } : {}),
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#f8f8fa',
    show: false,
    minWidth: chatW,
    minHeight: chatH,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: is.dev
    }
  })

  // Persist window bounds on resize and move (debounced)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  const saveBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!chatWindow || chatWindow.isDestroyed()) return
      const bounds = chatWindow.getBounds()
      const settings = readAppSettings(settingsPath)
      settings.windowBounds = bounds
      writeAppSettings(settingsPath, settings)
    }, 500)
  }
  chatWindow.on('resize', saveBounds)
  chatWindow.on('move', saveBounds)

  chatWindow.on('close', (e) => {
    e.preventDefault()
    chatWindow?.hide()
  })

  // Prevent accidental resize from top edge (overlaps with drag region)
  chatWindow.on('will-resize', (e, _newBounds, details) => {
    if (details.edge === 'top-left' || details.edge === 'top-right') {
      e.preventDefault()
    }
  })

  chatWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    chatWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/chat.html')
  } else {
    chatWindow.loadFile(path.join(__dirname, '../renderer/chat.html'))
  }
}

let chatBoundsBeforeHide: Electron.Rectangle | null = null

function toggleChatWindow(): void {
  if (!chatWindow) return
  if (chatWindow.isVisible()) {
    chatBoundsBeforeHide = chatWindow.getBounds()
    chatWindow.hide()
  } else {
    if (chatBoundsBeforeHide) {
      chatWindow.setBounds(chatBoundsBeforeHide)
    }
    chatWindow.show()
    chatWindow.focus()
  }
}

/**
 * v3 启动后初始化运行时：创建 Gateway 连接 + CoworkController + SessionManager
 * 只有 boot 成功后（拿到 port/token）才会调用
 */
async function setupV3Runtime(port: number, token: string): Promise<void> {
  gateway = new OpenclawGateway(port, token)

  // 从 EngineManager 获取运行时根目录，用于 GatewayClient 动态加载
  const runtimeRoot = engineManager.getRuntimeRoot()
  if (runtimeRoot) {
    try {
      await gateway.connect(runtimeRoot)
    } catch (err) {
      console.warn('Gateway 连接失败:', err instanceof Error ? err.message : err)
    }
  }

  // 创建 CoworkController（事件路由）和 SessionManager（会话门面）
  coworkController = new CoworkController(gateway, coworkStore)
  sessionManager = new SessionManager(coworkStore, coworkController)
}

app.whenReady().then(async () => {
  diagAppReady()

  // 1. 初始化数据库
  const dbPath = resolveDatabasePath({
    petclawHome: path.join(app.getPath('home'), '.petclaw'),
    legacyUserDataPath: app.getPath('userData')
  })
  db = new Database(dbPath)
  initDatabase(db)

  // 2. CoworkStore 防御性重置：上次崩溃遗留的 running 状态归零
  coworkStore = new CoworkStore(db)
  coworkStore.resetRunningSessions()

  // 3. EngineManager 初始化
  engineManager = new OpenclawEngineManager()

  // 4. ConfigSync 初始化（依赖 EngineManager 的路径）
  configSync = new ConfigSync({
    getConfigPath: () => engineManager.getConfigPath(),
    getStateDir: () => engineManager.getStateDir(),
    getModelConfig: () => ({
      primary: 'llm/petclaw-fast',
      providers: {}
    }),
    getSkillsExtraDirs: () => [],
    getWorkspacePath: () => path.join(engineManager.getBaseDir(), 'workspace'),
    collectSecretEnvVars: () => ({})
  })

  // 5. 同步 auto-launch 设置到系统
  const initSettingsPath = path.join(app.getPath('home'), '.petclaw', 'petclaw-settings.json')
  const initSettings = readAppSettings(initSettingsPath)
  if (initSettings.autoLaunch !== undefined) {
    app.setLoginItemSettings({ openAtLogin: initSettings.autoLaunch })
  }

  // 6. 创建 chat 窗口（立即显示 BootCheck UI）
  createChatWindow()

  // 7. 注册启动阶段 IPC（boot 检查和设置查询，不依赖 petWindow）
  ipcMain.handle('app:version', async () => app.getVersion())
  let bootSuccess: boolean | null = null
  ipcMain.handle('boot:status', () => bootSuccess)
  registerBootIpcHandlers({})
  registerSettingsIpcHandlers({ db })

  chatWindow?.webContents.on('did-finish-load', () => {
    diagWindowLoad('chat-window', chatWindow?.webContents.getURL())
  })

  // 8. 等待 chat 窗口就绪（内容已绘制）
  await new Promise<void>((resolve) => {
    chatWindow?.once('ready-to-show', () => resolve())
  })
  chatWindow?.show()
  chatWindow?.focus()

  // 9. 运行 BootCheck（v3：环境 → 引擎 → 连接，进度推送到 chat 窗口）
  const bootResult = await runBootCheck(chatWindow!, engineManager, configSync)
  diagBootResult(bootResult.success)

  // 10. 处理 boot 重试（renderer 发起）
  ipcMain.on('boot:retry', async () => {
    if (!chatWindow) return
    const retryResult = await runBootCheck(chatWindow, engineManager, configSync)
    diagBootResult(retryResult.success)

    if (retryResult.success) {
      await setupV3Runtime(retryResult.port!, retryResult.token!)
      await new Promise((r) => setTimeout(r, 1500))
      chatWindow.webContents.send('boot:complete', true)
    } else {
      chatWindow.webContents.send('boot:complete', false)
    }
  })

  // 11. Boot 成功 → 初始化 v3 运行时（Gateway + Controller + SessionManager）
  if (bootResult.success) {
    await setupV3Runtime(bootResult.port!, bootResult.token!)
  }

  // 12. 启动 Hook Server
  hookServer = new HookServer()
  hookServer.start().then((socketPath) => {
    console.warn('Hook server listening on:', socketPath)
  })

  // 13. 通知 chat 窗口 boot 完成（成功时延迟 2s 用于动画编排）
  if (bootResult.success) {
    await new Promise((r) => setTimeout(r, 2000))
  }
  bootSuccess = bootResult.success
  chatWindow?.webContents.send('boot:complete', bootSuccess)

  // 14. chat 窗口进入主界面后创建 pet 窗口并注册完整 IPC
  let petCreated = false
  ipcMain.on('app:pet-ready', () => {
    if (petCreated) return
    petCreated = true

    createPetWindow()
    petWindow?.webContents.on('did-finish-load', () => {
      diagWindowLoad('pet-window', petWindow?.webContents.getURL())
    })

    // 注册需要双窗口的 IPC 处理器
    if (petWindow && chatWindow) {
      // Chat IPC 需要 v3 运行时（sessionManager + coworkController），boot 失败时跳过
      if (sessionManager && coworkController) {
        registerChatIpcHandlers({
          sessionManager,
          coworkController,
          getChatWindow: () => chatWindow,
          getPetWindow: () => petWindow
        })
      }

      registerWindowIpcHandlers({
        getPetWindow: () => petWindow,
        toggleChatWindow
      })

      registerPetIpcHandlers({
        getPetWindow: () => petWindow,
        getChatWindow: () => chatWindow,
        hookServer
      })

      // 宠物事件桥接：将 CoworkController 事件转发为宠物动画事件
      if (coworkController) {
        petEventBridge = new PetEventBridge(petWindow, coworkController)
      }

      createTray(petWindow, chatWindow, toggleChatWindow)
      registerShortcuts(petWindow, chatWindow, toggleChatWindow)
    }
  })

  // 15. 引擎状态变更转发到 renderer
  engineManager.on('status', (status) => {
    chatWindow?.webContents.send('engine:status', status)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  chatWindow?.removeAllListeners('close')
  chatWindow?.close()

  // v3: 停止引擎进程 + 断开 gateway 连接
  engineManager?.stopGateway()
  gateway?.disconnect()
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
