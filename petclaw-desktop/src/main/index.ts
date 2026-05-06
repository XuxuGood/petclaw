import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

import { app } from 'electron'
import type { Tray } from 'electron'
import { is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'

import type { ImGatewayManager } from './im/im-gateway-manager'

import { initDatabase, kvGet } from './data/db'
import { OpenclawEngineManager } from './ai/engine-manager'
import { ConfigSync } from './ai/config-sync'
import { CoworkStore } from './data/cowork-store'
import { CoworkConfigStore } from './data/cowork-config-store'
import { DirectoryStore } from './data/directory-store'
import { ImStore } from './data/im-store'
import { McpStore } from './data/mcp-store'
import { DirectoryManager } from './ai/directory-manager'
import { ProviderRegistry } from '../shared/models/provider-registry'
import { ModelConfigStore } from './models/model-config-store'
import { ModelRegistry } from './models/model-registry'
import { SkillManager } from './skills/skill-manager'
import { McpManager } from './mcp/mcp-manager'
import { McpServerManager } from './mcp/mcp-server-manager'
import { McpBridgeServer } from './mcp/mcp-bridge-server'
import { MemoryManager } from './memory/memory-manager'
import { MemorySearchConfigStore } from './memory/memory-search-config-store'
import { PetEventBridge } from './pet/pet-event-bridge'
import {
  registerAllIpcHandlers,
  registerBootIpcHandlers,
  registerLoggingIpcHandlers,
  registerSettingsIpcHandlers
} from './ipc'
import { safeHandle, safeOn } from './ipc/ipc-registry'
import { HookServer } from './hooks/server'
import {
  initializeMacosApplicationIdentity,
  initializeMacosIntegration,
  refreshMacosMenus
} from './system/macos-integration'
import { activateMainWindow } from './system/window-activation'
import { createSystemActions } from './system/system-actions'
import { createTray, shouldCreateFallbackTray, updateTrayMenu } from './system/tray'
import { registerShortcuts, unregisterShortcuts } from './system/shortcuts'
import { runBootCheck } from './bootcheck'
import { diagAppReady, diagBootResult, diagWindowLoad, diagError } from './diagnostics'
import { resolveDatabasePath } from './database-path'
import { initAutoUpdater } from './auto-updater'
import { initI18n } from './i18n'
import { initLogger } from './logger'
import { getSkillsRoot } from './ai/cowork-util'
import { GatewayRestartScheduler } from './ai/gateway-restart-scheduler'
import { setupRuntimeServices, type RuntimeServices } from './runtime-services'
import { resolveUserDataPaths } from './user-data-paths'
import {
  closeMainWindowForQuit,
  createMainWindow,
  createPetWindow,
  getMainWindow,
  getPetWindow,
  toggleMainWindow,
  updatePetWindowComposerAnchor
} from './windows'

let db: Database.Database
let engineManager: OpenclawEngineManager
let configSync: ConfigSync
let coworkStore: CoworkStore
let coworkConfigStore: CoworkConfigStore
let runtimeServices: RuntimeServices | null = null
let runtimeIpcRegistered = false

// Manager 实例声明（在 app.whenReady 中初始化）
let directoryManager: DirectoryManager
let modelRegistry: ModelRegistry
let skillManager: SkillManager
let mcpManager: McpManager
let mcpServerManager: McpServerManager
let mcpBridgeServer: McpBridgeServer
const mcpBridgeSecret: string = crypto.randomUUID()
let memoryManager: MemoryManager
let imGatewayManager: ImGatewayManager
let workspacePath: string
let skillsDir: string

// 持有引用防止 GC，桥接器在构造时绑定事件
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let petEventBridge: PetEventBridge | null = null
let hookServer: HookServer
let restartScheduler: GatewayRestartScheduler

// Initialize logging before anything else
initLogger()

async function initializeRuntimeServices(): Promise<RuntimeServices> {
  runtimeServices = await setupRuntimeServices({
    db,
    engineManager,
    coworkStore,
    directoryManager,
    modelRegistry
  })

  return runtimeServices
}

function resolveBundledSkillsRoot(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'skills'), path.join(app.getAppPath(), 'skills')]
    : [path.join(app.getAppPath(), 'skills'), path.join(process.cwd(), 'skills')]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

app.whenReady().then(async () => {
  initializeMacosApplicationIdentity()
  diagAppReady()

  // 1. 初始化数据库
  const userDataPath = app.getPath('userData')
  const userDataPaths = resolveUserDataPaths(userDataPath)
  const dbPath = resolveDatabasePath({ userDataPath })
  db = new Database(dbPath)
  initDatabase(db)
  // 初始化 i18n，读取系统语言偏好
  initI18n(db, app.getLocale())

  // 2. EngineManager 初始化，OpenClaw runtime root 由 userData/openclaw 承载
  engineManager = new OpenclawEngineManager()
  workspacePath = userDataPaths.openclawWorkspace
  fs.mkdirSync(workspacePath, { recursive: true })

  // 3. CoworkStore 防御性重置：上次崩溃遗留的 running 状态归零
  coworkStore = new CoworkStore(db)
  coworkConfigStore = new CoworkConfigStore(db, workspacePath)
  coworkStore.resetRunningSessions()

  // DirectoryManager：Directory CRUD，目录自动注册
  const directoryStore = new DirectoryStore(db)
  directoryManager = new DirectoryManager(directoryStore)

  // ModelRegistry：加载持久化的 Provider 配置和活跃模型
  modelRegistry = new ModelRegistry(new ModelConfigStore(db), new ProviderRegistry())
  modelRegistry.load()

  // SkillManager：扫描本地 skills 目录，首次运行时目录不存在需先创建
  skillsDir = getSkillsRoot()
  fs.mkdirSync(skillsDir, { recursive: true })
  skillManager = new SkillManager(db, skillsDir)
  if (app.isPackaged) {
    skillManager.syncBundledSkillsToUserData({ bundledRoot: resolveBundledSkillsRoot() })
  }
  await skillManager.scan()

  // McpManager：MCP 服务器 CRUD，数据持久化在 SQLite
  const mcpStore = new McpStore(db)
  mcpManager = new McpManager(mcpStore)

  // McpServerManager + McpBridgeServer：MCP SDK 连接管理 + HTTP callback server
  mcpServerManager = new McpServerManager()
  mcpBridgeServer = new McpBridgeServer(mcpServerManager, mcpBridgeSecret)

  // 启动 MCP servers（非阻塞，失败不影响 boot）
  const enabledServers = mcpManager.listEnabled()
  if (enabledServers.length > 0) {
    mcpServerManager
      .startServers(enabledServers)
      .catch((err) => console.error('[McpBridge] startup failed (non-fatal):', err))
  }
  // 始终启动 HTTP server（AskUser 也需要，即使没有 MCP servers）
  mcpBridgeServer
    .start()
    .catch((err) => console.error('[McpBridge] HTTP server start failed (non-fatal):', err))

  // AskUser 回调：ask-user-question 扩展通过 HTTP 请求到 McpBridgeServer，
  // 转发到 renderer 弹出确认弹窗，复用 cowork:stream:permission 通道。
  // sessionId 固定为 '__askuser__' 用于 renderer 区分 AskUser 和普通权限请求
  mcpBridgeServer.onAskUser((request) => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    try {
      mainWindow.webContents.send('cowork:stream:permission', {
        sessionId: '__askuser__',
        request: {
          requestId: request.requestId,
          toolName: 'AskUserQuestion',
          toolInput: { questions: request.questions }
        }
      })
    } catch (error) {
      console.error('[AskUser] failed to send permission request to window:', error)
    }
  })

  // AskUser 超时或已响应后通知 renderer 关闭弹窗
  mcpBridgeServer.onAskUserDismiss((requestId) => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    try {
      mainWindow.webContents.send('cowork:stream:permission-dismiss', { requestId })
    } catch {
      // ignore
    }
  })

  // MemoryManager：纯文件驱动，不依赖 db，无构造参数
  memoryManager = new MemoryManager()

  // MemorySearchConfigStore：全局记忆检索配置，默认 disabled
  const memorySearchConfigStore = new MemorySearchConfigStore(db)

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
    coworkConfigStore,
    directoryManager,
    modelRegistry,
    skillManager,
    mcpManager,
    imGatewayManager,
    memorySearchConfigStore,
    getRuntimeRoot: () => engineManager.getRuntimeRoot(),
    getMcpBridgeConfig: () => {
      if (!mcpBridgeServer.callbackUrl || !mcpBridgeServer.askUserCallbackUrl) return null
      return {
        callbackUrl: mcpBridgeServer.callbackUrl,
        askUserCallbackUrl: mcpBridgeServer.askUserCallbackUrl,
        secret: mcpBridgeSecret,
        tools: mcpServerManager.toolManifest
      }
    }
  })

  // 6. 初始化延迟重启调度器：活跃对话/定时任务执行期间不立即重启 gateway，
  // 轮询等待工作负载空闲后再执行，5 分钟硬超时兜底
  restartScheduler = new GatewayRestartScheduler({
    hasActiveWorkloads: () => {
      if (runtimeServices?.coworkController.hasActiveSessions()) return true
      try {
        if (runtimeServices?.cronJobService.hasRunningJobs()) return true
      } catch {
        // cronJobService 可能未初始化
      }
      return false
    },
    executeRestart: async (reason) => {
      console.warn(`[GatewayRestart] executing restart (reason: ${reason})`)
      await engineManager.restartGateway()
    }
  })

  // 7. 绑定 Manager change 事件 → 触发 ConfigSync 同步，保持 Openclaw 配置与状态一致
  // 每次 sync 后把最新的 secretEnvVars 推送给 engineManager，
  // 确保下次 gateway 重启时 spawn 的子进程拿到正确的 API Key 等明文值。
  // bindings 或 secretEnvVars 变更时通过 restartScheduler 延迟重启 gateway（热加载对它们无效）
  configSync.bindChangeListeners((reason, result) => {
    engineManager.setSecretEnvVars(configSync.collectSecretEnvVars())
    if (result.needsGatewayRestart && engineManager.getStatus().phase === 'running') {
      restartScheduler.requestRestart(reason)
    }
  })

  // 7.1 MCP Bridge 刷新：MCP CRUD 后需要先重建连接、发现 tools，再 sync 配置。
  // 使用 Promise 去重：并发触发只执行一次，后续请求等待同一 Promise
  let mcpRefreshPromise: Promise<void> | null = null

  async function refreshMcpBridge(): Promise<void> {
    try {
      console.log('[McpBridge] refreshing after config change...')
      getMainWindow()?.webContents.send('mcp:bridge:syncStart')

      // 1. 停止现有 MCP servers（HTTP callback server 保持运行，端口不变）
      await mcpServerManager.stopServers()

      // 2. 重新启动已启用的 servers 并发现 tools
      const servers = mcpManager.listEnabled()
      if (servers.length > 0) {
        await mcpServerManager.startServers(servers)
      }
      const toolCount = mcpServerManager.toolManifest.length
      console.log(`[McpBridge] refresh: ${toolCount} tools discovered`)

      // 3. sync openclaw.json —— mcp-bridge plugin config 变更会触发 needsGatewayRestart，
      // gateway 在启动时固化 plugin 配置快照，必须硬重启才能生效
      const result = configSync.sync('mcp-bridge-refresh')
      engineManager.setSecretEnvVars(configSync.collectSecretEnvVars())
      if (result.needsGatewayRestart && engineManager.getStatus().phase === 'running') {
        restartScheduler.requestRestart('mcp-bridge-changed')
      }

      console.log(
        `[McpBridge] refresh complete: ${toolCount} tools, changed=${result.changed}, needsRestart=${result.needsGatewayRestart}`
      )
      getMainWindow()?.webContents.send('mcp:bridge:syncDone', { tools: toolCount })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[McpBridge] refresh error:', msg)
      getMainWindow()?.webContents.send('mcp:bridge:syncDone', { tools: 0, error: msg })
    }
  }

  // MCP CRUD 变更 → 异步刷新 bridge（连接 → 发现 tools → sync → 可能重启 gateway）
  // ConfigSync.bindChangeListeners 中不监听 mcpManager.on('change')，
  // 因为 MCP CRUD 后需要先 refreshMcpBridge()（重建连接发现 tools）再 sync
  mcpManager.on('change', () => {
    if (mcpRefreshPromise) return
    mcpRefreshPromise = refreshMcpBridge().finally(() => {
      mcpRefreshPromise = null
    })
  })

  // 8. 同步 auto-launch 设置到系统（从 SQLite 读取，与 settings-ipc 中的 autoLaunch 写入保持一致）
  const savedAutoLaunch = kvGet(db, 'autoLaunch')
  if (savedAutoLaunch !== null) {
    app.setLoginItemSettings({ openAtLogin: savedAutoLaunch === 'true' })
  }

  // 9. 创建 chat 窗口（立即显示 BootCheck UI）
  const chatWindow = createMainWindow(db)
  const systemActions = createSystemActions({
    app,
    getMainWindow: () => getMainWindow(),
    getPetWindow: () => getPetWindow()
  })
  let fallbackTray: Tray | null = null

  function refreshSystemMenus(): void {
    if (fallbackTray) {
      updateTrayMenu(fallbackTray, systemActions)
      return
    }

    refreshMacosMenus({ actions: systemActions })
  }

  function registerRuntimeIpcHandlers(): void {
    if (runtimeIpcRegistered) return
    if (!runtimeServices) {
      throw new Error('[IPC] runtime services are not initialized')
    }

    registerAllIpcHandlers({
      db,
      coworkSessionManager: runtimeServices.coworkSessionManager,
      coworkController: runtimeServices.coworkController,
      coworkConfigStore,
      configSync,
      mcpBridgeServer,
      directoryManager,
      modelRegistry,
      skillManager,
      mcpManager,
      refreshMcpBridge,
      memoryManager,
      cronJobService: runtimeServices.cronJobService,
      imGatewayManager,
      getMainWindow: () => getMainWindow(),
      getPetWindow: () => getPetWindow(),
      actions: systemActions,
      toggleMainWindow,
      updatePetWindowComposerAnchor
    })
    runtimeIpcRegistered = true
  }

  // 桌面系统入口必须在启动页阶段就可用，不能等待 renderer 进入 main 后的 app:pet-ready。
  // pet 相关动作在宠物窗口创建前会安全 no-op；主窗口和退出动作可立即工作。
  if (shouldCreateFallbackTray()) {
    fallbackTray = createTray(systemActions)
  } else {
    initializeMacosIntegration({ actions: systemActions })
  }

  // 10. 注册启动阶段 IPC（boot 检查和设置查询，不依赖 petWindow）
  // app:version 已收入 registerBootIpcHandlers
  let bootSuccess: boolean | null = null
  safeHandle('boot:status', () => bootSuccess)
  registerBootIpcHandlers({ db, refreshSystemMenus })
  registerSettingsIpcHandlers({ db })
  registerLoggingIpcHandlers()

  chatWindow.webContents.on('did-finish-load', () => {
    diagWindowLoad('chat-window', chatWindow.webContents.getURL())
  })

  // 11. 等待 chat 窗口就绪（内容已绘制）
  await new Promise<void>((resolve) => {
    chatWindow.once('ready-to-show', () => resolve())
  })
  activateMainWindow({ app, window: chatWindow })

  // 12. 运行 BootCheck（环境 → 引擎 → 连接，进度推送到 chat 窗口）
  const bootResult = await runBootCheck(chatWindow, engineManager, configSync)
  diagBootResult(bootResult.success)

  // 13. 处理 boot 重试（renderer 发起）
  // boot:retry 依赖启动编排闭包状态（engineManager、configSync、initializeRuntimeServices），保留在 index.ts
  safeOn('boot:retry', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return
    const retryResult = await runBootCheck(mainWindow, engineManager, configSync)
    diagBootResult(retryResult.success)

    if (retryResult.success) {
      await initializeRuntimeServices()
      registerRuntimeIpcHandlers()
      await new Promise((r) => setTimeout(r, 1500))
      mainWindow.webContents.send('boot:complete', true)
    } else {
      mainWindow.webContents.send('boot:complete', false)
    }
  })

  // 14. Boot 成功 → 初始化运行时（Gateway + CoworkController + CoworkSessionManager）
  if (bootResult.success) {
    await initializeRuntimeServices()
    registerRuntimeIpcHandlers()
  }

  // 初始化自动更新（boot 成功后，生产环境延迟检查）
  if (!is.dev) {
    initAutoUpdater(chatWindow)
  }

  // 15. 启动 Hook Server
  hookServer = new HookServer()
  hookServer.start().then((socketPath) => {
    console.info('[HookServer] listening on:', socketPath)
  })

  // 16. chat 窗口进入主界面后创建 pet 窗口。
  // 完整 IPC 已在 runtime 就绪后、boot:complete 前注册；这里仅处理双窗口相关编排。
  // Pet Window 启动收尾不是用户主动打开主窗口的入口，不能复用强激活逻辑抢焦点。
  let petCreated = false
  safeOn('app:pet-ready', () => {
    if (petCreated) return
    petCreated = true

    const petWindow = createPetWindow(db)
    petWindow.webContents.on('did-finish-load', () => {
      diagWindowLoad('pet-window', petWindow.webContents.getURL())
    })

    if (petWindow && chatWindow && runtimeServices) {
      // 宠物事件桥接：聚合 CoworkController / HookServer 事件
      petEventBridge = new PetEventBridge(
        petWindow,
        runtimeServices.coworkController,
        hookServer,
        () => getMainWindow()
      )

      registerShortcuts(petWindow, chatWindow, toggleMainWindow)
    }
  })

  // 17. 通知 chat 窗口 boot 完成（成功时延迟 2s 用于动画编排）
  if (bootResult.success) {
    await new Promise((r) => setTimeout(r, 2000))
  }
  bootSuccess = bootResult.success
  chatWindow.webContents.send('boot:complete', bootSuccess)

  // 18. 引擎状态变更转发到 renderer
  engineManager.on('status', (status) => {
    getMainWindow()?.webContents.send('engine:status', status)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeMainWindowForQuit()

  // 取消待处理的延迟重启，避免退出过程中触发重启
  restartScheduler?.cancelPending()

  // 停止引擎进程 + 断开 gateway 连接
  engineManager?.stopGateway()
  runtimeServices?.gateway.disconnect()
  db?.close()
  hookServer?.stop()
  runtimeServices?.cronJobService.stopPolling()
  unregisterShortcuts()

  // 停止 MCP 连接和 HTTP callback server
  mcpServerManager
    ?.stopServers()
    .catch((err) =>
      console.error(
        '[McpBridge] stopServers error:',
        err instanceof Error ? err.message : String(err)
      )
    )
  mcpBridgeServer
    ?.stop()
    .catch((err) =>
      console.error(
        '[McpBridge] HTTP server stop error:',
        err instanceof Error ? err.message : String(err)
      )
    )
})

// Capture unhandled errors to diagnostics log
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason))
  diagError(err.message, err.stack)
})

process.on('uncaughtException', (err) => {
  diagError(err.message, err.stack)
})
