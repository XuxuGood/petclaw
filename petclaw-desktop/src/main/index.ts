import fs from 'fs'
import path from 'path'

import { app, BrowserWindow, shell, screen, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'

import type { CronJobService } from './scheduler/cron-job-service'
import type { ImGatewayManager } from './im/im-gateway-manager'

import { initDatabase } from './data/db'
import { OpenclawEngineManager } from './ai/engine-manager'
import { ConfigSync } from './ai/config-sync'
import { OpenclawGateway } from './ai/gateway'
import { CoworkController } from './ai/cowork-controller'
import { CoworkStore } from './data/cowork-store'
import { CoworkSessionManager } from './ai/cowork-session-manager'
import { DirectoryStore } from './data/directory-store'
import { ImStore } from './data/im-store'
import { McpStore } from './data/mcp-store'
import { ScheduledTaskMetaStore } from './data/scheduled-task-meta-store'
import { DirectoryManager } from './ai/directory-manager'
import { ModelRegistry } from './models/model-registry'
import { SkillManager } from './skills/skill-manager'
import { McpManager } from './mcp/mcp-manager'
import { MemoryManager } from './memory/memory-manager'
import { PetEventBridge } from './pet/pet-event-bridge'
import { registerAllIpcHandlers, registerBootIpcHandlers, registerSettingsIpcHandlers } from './ipc'
import { HookServer } from './hooks/server'
import { createTray } from './system/tray'
import { registerShortcuts, unregisterShortcuts } from './system/shortcuts'
import { runBootCheck } from './bootcheck'
import { diagAppReady, diagBootResult, diagWindowLoad, diagError } from './diagnostics'
import { readAppSettings, writeAppSettings } from './app-settings'
import { resolveDatabasePath } from './database-path'
import { initAutoUpdater } from './auto-updater'
import { initI18n } from './i18n'

let petWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
let db: Database.Database
let engineManager: OpenclawEngineManager
let configSync: ConfigSync
let coworkStore: CoworkStore
let gateway: OpenclawGateway | null = null
let coworkController: CoworkController | null = null
let coworkSessionManager: CoworkSessionManager | null = null

// Manager 实例声明（在 app.whenReady 中初始化）
let directoryManager: DirectoryManager
let modelRegistry: ModelRegistry
let skillManager: SkillManager
let mcpManager: McpManager
let memoryManager: MemoryManager
// 集成功能实例
let cronJobService: CronJobService | null = null
let imGatewayManager: ImGatewayManager
// workspacePath 在 whenReady 中确定，setupV3Runtime 需要引用
let workspacePath: string

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
  } else if (mainWindow && mainWindow.isVisible()) {
    const chatBounds = mainWindow.getBounds()
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
    petWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/pet.html')
  } else {
    petWindow.loadFile(path.join(__dirname, '../renderer/pet.html'))
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

function createMainWindow(): void {
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

  mainWindow = new BrowserWindow({
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
      if (!mainWindow || mainWindow.isDestroyed()) return
      const bounds = mainWindow.getBounds()
      const settings = readAppSettings(settingsPath)
      settings.windowBounds = bounds
      writeAppSettings(settingsPath, settings)
    }, 500)
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)

  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })

  // Prevent accidental resize from top edge (overlaps with drag region)
  mainWindow.on('will-resize', (e, _newBounds, details) => {
    if (details.edge === 'top-left' || details.edge === 'top-right') {
      e.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

let chatBoundsBeforeHide: Electron.Rectangle | null = null

function toggleMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isVisible()) {
    chatBoundsBeforeHide = mainWindow.getBounds()
    mainWindow.hide()
  } else {
    if (chatBoundsBeforeHide) {
      mainWindow.setBounds(chatBoundsBeforeHide)
    }
    mainWindow.show()
    mainWindow.focus()
  }
}

/**
 * 启动后初始化运行时：创建 Gateway 连接 + CoworkController + CoworkSessionManager
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

  // 创建 CoworkController（事件路由）和 CoworkSessionManager（会话门面）
  coworkController = new CoworkController(gateway, coworkStore)
  coworkSessionManager = new CoworkSessionManager(coworkStore, coworkController, directoryManager)

  // CronJobService — 定时任务 Gateway RPC 代理
  const { CronJobService: CronJobServiceClass } = await import('./scheduler/cron-job-service')
  const scheduledTaskMetaStore = new ScheduledTaskMetaStore(db)
  cronJobService = new CronJobServiceClass({
    // gateway 已在 boot 阶段建立连接，此处直接透传底层 client
    getGatewayClient: () => gateway?.getClient() ?? null,
    ensureGatewayReady: async () => {
      /* gateway 已在 boot 阶段就绪 */
    },
    metaStore: scheduledTaskMetaStore
  })
  cronJobService.startPolling()
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
  // 初始化 i18n，读取系统语言偏好
  initI18n(db, app.getLocale())

  // 2. CoworkStore 防御性重置：上次崩溃遗留的 running 状态归零
  coworkStore = new CoworkStore(db)
  coworkStore.resetRunningSessions()

  // 3. EngineManager 初始化
  engineManager = new OpenclawEngineManager()

  // 4. Manager 初始化（在 ConfigSync 之前，ConfigSync 直接依赖 Manager 实例）
  const petclawHome = path.join(app.getPath('home'), '.petclaw')
  workspacePath = path.join(petclawHome, 'workspace')

  // DirectoryManager：Directory CRUD，目录自动注册
  const directoryStore = new DirectoryStore(db)
  directoryManager = new DirectoryManager(directoryStore, workspacePath)

  // ModelRegistry：加载持久化的 Provider 配置和活跃模型
  modelRegistry = new ModelRegistry(db)
  modelRegistry.load()

  // SkillManager：扫描本地 skills 目录，首次运行时目录不存在需先创建
  const skillsDir = path.join(petclawHome, 'skills')
  fs.mkdirSync(skillsDir, { recursive: true })
  skillManager = new SkillManager(db, skillsDir)
  await skillManager.scan()

  // McpManager：MCP 服务器 CRUD，数据持久化在 SQLite
  const mcpStore = new McpStore(db)
  mcpManager = new McpManager(mcpStore)

  // MemoryManager：纯文件驱动，不依赖 db，无构造参数
  memoryManager = new MemoryManager()

  // ImGatewayManager — IM 平台配置管理（不依赖 Gateway 连接，仅操作本地 SQLite）
  const { ImGatewayManager: ImGatewayManagerClass } = await import('./im/im-gateway-manager')
  const imStore = new ImStore(db)
  imGatewayManager = new ImGatewayManagerClass(imStore)

  // 5. ConfigSync 初始化（新接口直接注入 Manager，移除旧函数注入方式）
  configSync = new ConfigSync({
    configPath: engineManager.getConfigPath(),
    stateDir: engineManager.getStateDir(),
    workspacePath,
    skillsDir,
    directoryManager,
    modelRegistry,
    skillManager,
    mcpManager
  })

  // 6. 绑定 Manager change 事件 → 触发 ConfigSync 同步，保持 Openclaw 配置与状态一致
  directoryManager.on('change', () => configSync.sync('directory-change'))
  modelRegistry.on('change', () => configSync.sync('model-change'))
  skillManager.on('change', () => configSync.sync('skill-change'))
  mcpManager.on('change', () => configSync.sync('mcp-change'))
  imGatewayManager.on('change', () => configSync.sync('im-change'))

  // 7. 同步 auto-launch 设置到系统
  const initSettingsPath = path.join(app.getPath('home'), '.petclaw', 'petclaw-settings.json')
  const initSettings = readAppSettings(initSettingsPath)
  if (initSettings.autoLaunch !== undefined) {
    app.setLoginItemSettings({ openAtLogin: initSettings.autoLaunch })
  }

  // 8. 创建 chat 窗口（立即显示 BootCheck UI）
  createMainWindow()

  // 9. 注册启动阶段 IPC（boot 检查和设置查询，不依赖 petWindow）
  ipcMain.handle('app:version', async () => app.getVersion())
  let bootSuccess: boolean | null = null
  ipcMain.handle('boot:status', () => bootSuccess)
  registerBootIpcHandlers({ db })
  registerSettingsIpcHandlers({ db })

  mainWindow?.webContents.on('did-finish-load', () => {
    diagWindowLoad('chat-window', mainWindow?.webContents.getURL())
  })

  // 10. 等待 chat 窗口就绪（内容已绘制）
  await new Promise<void>((resolve) => {
    mainWindow?.once('ready-to-show', () => resolve())
  })
  mainWindow?.show()
  mainWindow?.focus()

  // 11. 运行 BootCheck（环境 → 引擎 → 连接，进度推送到 chat 窗口）
  const bootResult = await runBootCheck(mainWindow!, engineManager, configSync)
  diagBootResult(bootResult.success)

  // 12. 处理 boot 重试（renderer 发起）
  ipcMain.on('boot:retry', async () => {
    if (!mainWindow) return
    const retryResult = await runBootCheck(mainWindow, engineManager, configSync)
    diagBootResult(retryResult.success)

    if (retryResult.success) {
      await setupV3Runtime(retryResult.port!, retryResult.token!)
      await new Promise((r) => setTimeout(r, 1500))
      mainWindow.webContents.send('boot:complete', true)
    } else {
      mainWindow.webContents.send('boot:complete', false)
    }
  })

  // 13. Boot 成功 → 初始化运行时（Gateway + CoworkController + CoworkSessionManager）
  if (bootResult.success) {
    await setupV3Runtime(bootResult.port!, bootResult.token!)
  }

  // 初始化自动更新（boot 成功后，生产环境延迟检查）
  if (!is.dev) {
    initAutoUpdater(mainWindow!)
  }

  // 14. 启动 Hook Server
  hookServer = new HookServer()
  hookServer.start().then((socketPath) => {
    console.warn('Hook server listening on:', socketPath)
  })

  // 15. 通知 chat 窗口 boot 完成（成功时延迟 2s 用于动画编排）
  if (bootResult.success) {
    await new Promise((r) => setTimeout(r, 2000))
  }
  bootSuccess = bootResult.success
  mainWindow?.webContents.send('boot:complete', bootSuccess)

  // 16. chat 窗口进入主界面后创建 pet 窗口并注册完整 IPC
  let petCreated = false
  ipcMain.on('app:pet-ready', () => {
    if (petCreated) return
    petCreated = true

    createPetWindow()
    petWindow?.webContents.on('did-finish-load', () => {
      diagWindowLoad('pet-window', petWindow?.webContents.getURL())
    })

    // 注册需要双窗口的 IPC 处理器
    if (petWindow && mainWindow) {
      // registerAllIpcHandlers 统一注册全部模块 IPC，
      // Chat/Session/Manager IPC 需要运行时（coworkSessionManager + coworkController），
      // boot 失败时 coworkSessionManager / coworkController 为 null，chat:send 等会报 500 错误，
      // 但 UI 层保证 boot 失败后不允许发送，所以这里以 null 断言传入
      registerAllIpcHandlers({
        db,
        coworkSessionManager: coworkSessionManager!,
        coworkController: coworkController!,
        directoryManager,
        modelRegistry,
        skillManager,
        mcpManager,
        memoryManager,
        cronJobService: cronJobService!,
        imGatewayManager,
        getMainWindow: () => mainWindow,
        getPetWindow: () => petWindow,
        toggleMainWindow,
        hookServer
      })

      // 宠物事件桥接：聚合 CoworkController / ImGateway / CronJob / HookServer 事件
      if (coworkController) {
        petEventBridge = new PetEventBridge(
          petWindow,
          coworkController,
          imGatewayManager,
          cronJobService ?? undefined,
          hookServer
        )
      }

      createTray(petWindow, mainWindow, toggleMainWindow)
      registerShortcuts(petWindow, mainWindow, toggleMainWindow)
    }
  })

  // 17. 引擎状态变更转发到 renderer
  engineManager.on('status', (status) => {
    mainWindow?.webContents.send('engine:status', status)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  mainWindow?.removeAllListeners('close')
  mainWindow?.close()

  // 停止引擎进程 + 断开 gateway 连接
  engineManager?.stopGateway()
  gateway?.disconnect()
  db?.close()
  hookServer?.stop()
  cronJobService?.stopPolling()
  unregisterShortcuts()
})

export { petWindow, mainWindow }

// Capture unhandled errors to diagnostics log
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason))
  diagError(err.message, err.stack)
})

process.on('uncaughtException', (err) => {
  diagError(err.message, err.stack)
})
