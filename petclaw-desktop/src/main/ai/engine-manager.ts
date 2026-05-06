import { type ChildProcess, spawn } from 'child_process'
import crypto from 'crypto'
import { app, type UtilityProcess, utilityProcess } from 'electron'
import { EventEmitter } from 'events'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'

import type { EnginePhase, EngineStatus, GatewayConnectionInfo, RuntimeMetadata } from './types'
import { t } from '../i18n'
import { resolveUserDataPaths } from '../user-data-paths'
import { ensureElectronNodeShim, getElectronNodeRuntimePath, getSkillsRoot } from './cowork-util'
import {
  cleanupStaleThirdPartyPluginsFromBundledDir,
  listLocalOpenClawExtensionIds,
  syncLocalOpenClawExtensionsIntoRuntime
} from './openclaw-local-extensions'
import { appendPythonRuntimeToEnv } from './python-runtime'
import { isSystemProxyEnabled, resolveSystemProxyUrlForTargets } from './system-proxy'
import {
  attachProcessLogger,
  getLogger,
  getLoggingPlatform,
  type ProcessLogStream
} from '../logging'

// ── 类型 ──

type GatewayProcess = UtilityProcess | ChildProcess

interface EngineManagerEvents {
  status: (status: EngineStatus) => void
}

// ── 常量 ──

const DEFAULT_OPENCLAW_VERSION = '2026.2.23'
const DEFAULT_GATEWAY_PORT = 18789
const GATEWAY_PORT_SCAN_LIMIT = 80
const GATEWAY_BOOT_TIMEOUT_MS = 300_000
const GATEWAY_MAX_RESTART_ATTEMPTS = 5
const GATEWAY_RESTART_DELAYS = [3_000, 5_000, 10_000, 20_000, 30_000]
const logger = getLogger('OpenClaw', 'runtime')

// ── 可测试纯函数 ──

/** 安全解析 JSON 文件，失败返回 null */
export function parseJsonFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 返回候选路径中第一个存在的，全部不存在返回 null */
export function findPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/** 检测端口是否可用（未被占用） */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

/** 检测目标地址端口是否可连接 */
export function isPortReachable(host: string, port: number, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const done = (result: boolean) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        /* 忽略 */
      }
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, host)
  })
}

// ── 内部工具 ──

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true })
}

function isGatewayProcessAlive(child: GatewayProcess | null): child is GatewayProcess {
  if (!child) return false
  if ('pid' in child && typeof child.pid === 'number') {
    if ('exitCode' in child && child.exitCode !== null) return false
    return true
  }
  return false
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { method: 'GET', signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function onceGatewayExit(child: GatewayProcess, listener: (code: number | null) => void): void {
  const emitter = child as EventEmitter
  emitter.once('exit', listener)
}

function onceGatewayError(child: GatewayProcess, listener: (...args: unknown[]) => void): void {
  const emitter = child as EventEmitter
  emitter.once('error', listener)
}

function toProcessLogStream(value: unknown): ProcessLogStream | null {
  if (typeof value !== 'object' || value === null || !('on' in value)) return null
  return value as ProcessLogStream
}

// ── EngineManager 类 ──

export class OpenclawEngineManager extends EventEmitter {
  private readonly baseDir: string
  private readonly stateDir: string
  private readonly gatewayTokenPath: string
  private readonly gatewayPortPath: string
  private readonly configPath: string

  private desiredVersion: string
  private status: EngineStatus
  private gatewayProcess: GatewayProcess | null = null
  private readonly expectedGatewayExits = new WeakSet<object>()
  private gatewayRestartTimer: NodeJS.Timeout | null = null
  private gatewayRestartAttempt = 0
  private shutdownRequested = false
  private gatewayPort: number | null = null
  private startGatewayPromise: Promise<EngineStatus> | null = null
  private secretEnvVars: Record<string, string> = {}

  constructor() {
    super()

    const userDataPaths = resolveUserDataPaths(app.getPath('userData'))
    this.baseDir = userDataPaths.openclawRoot
    this.stateDir = userDataPaths.openclawState

    this.gatewayTokenPath = path.join(this.stateDir, 'gateway-token')
    this.gatewayPortPath = path.join(this.stateDir, 'gateway-port.json')
    this.configPath = path.join(this.stateDir, 'openclaw.json')

    ensureDir(this.baseDir)
    ensureDir(this.stateDir)
    ensureDir(userDataPaths.openclawLogs)

    const runtime = this.resolveRuntimeMetadata()
    this.desiredVersion = runtime.version || DEFAULT_OPENCLAW_VERSION

    this.status = runtime.root
      ? {
          phase: 'ready' as EnginePhase,
          version: this.desiredVersion,
          message: t('engine.runtimeReady'),
          canRetry: false
        }
      : {
          phase: 'not_installed',
          version: null,
          message: t('engine.runtimeNotFound', { path: runtime.expectedPathHint }),
          canRetry: true
        }
  }

  // ── 类型安全的 EventEmitter 覆盖 ──

  override on<U extends keyof EngineManagerEvents>(
    event: U,
    listener: EngineManagerEvents[U]
  ): this {
    return super.on(event, listener)
  }

  override emit<U extends keyof EngineManagerEvents>(
    event: U,
    ...args: Parameters<EngineManagerEvents[U]>
  ): boolean {
    return super.emit(event, ...args)
  }

  // ── 公开 API ──

  /** 设置需要注入到 gateway 进程的秘密环境变量（用于 openclaw.json 中 ${VAR} 占位符的明文值） */
  setSecretEnvVars(vars: Record<string, string>): void {
    this.secretEnvVars = vars
  }

  /** 返回当前秘密环境变量快照（用于变更检测） */
  getSecretEnvVars(): Record<string, string> {
    return this.secretEnvVars
  }

  getStatus(): EngineStatus {
    return { ...this.status }
  }

  getDesiredVersion(): string {
    return this.desiredVersion
  }

  getBaseDir(): string {
    return this.baseDir
  }

  getStateDir(): string {
    return this.stateDir
  }

  getConfigPath(): string {
    return this.configPath
  }

  getGatewayLogPath(): string {
    return getLoggingPlatform().storage.getCurrentFile('gateway')
  }

  /**
   * 解析 OpenClaw gateway 写入每日滚动日志（openclaw-YYYY-MM-DD.log）的目录。
   * 未找到候选目录时返回 null。
   */
  getOpenClawDailyLogDir(): string | null {
    if (process.platform === 'win32') {
      const runtime = this.resolveRuntimeMetadata()
      if (runtime.root) {
        const drive = path.parse(runtime.root).root
        const preferred = path.join(drive, 'tmp', 'openclaw')
        if (fs.existsSync(preferred)) return preferred
      }
      const fallback = path.join(os.tmpdir(), 'openclaw')
      return fs.existsSync(fallback) ? fallback : null
    }

    // macOS / Linux
    if (fs.existsSync('/tmp/openclaw')) return '/tmp/openclaw'
    try {
      const uid = process.getuid?.()
      if (uid != null) {
        const fallback = path.join(os.tmpdir(), `openclaw-${uid}`)
        if (fs.existsSync(fallback)) return fallback
      }
    } catch {
      /* getuid 不可用 */
    }
    return null
  }

  /** 返回运行时根目录（用于 GatewayClient 动态加载），未安装时返回 null */
  getRuntimeRoot(): string | null {
    return this.resolveRuntimeMetadata().root
  }

  getGatewayToken(): string | null {
    return this.readGatewayToken()
  }

  getGatewayConnectionInfo(): GatewayConnectionInfo {
    const runtime = this.resolveRuntimeMetadata()
    const port = this.gatewayPort ?? this.readGatewayPort()
    const token = this.readGatewayToken()
    const clientEntryPath = runtime.root ? this.resolveGatewayClientEntry(runtime.root) : null

    return {
      version: runtime.version,
      port,
      token,
      url: port ? `ws://127.0.0.1:${port}` : null,
      clientEntryPath
    }
  }

  setExternalError(message: string): EngineStatus {
    const runtime = this.resolveRuntimeMetadata()
    this.setStatus({
      phase: 'error',
      version: runtime.version || this.status.version || null,
      message: message.slice(0, 500),
      canRetry: true
    })
    return this.getStatus()
  }

  /** 确认运行时就绪，同步本地扩展并清理过期插件 */
  async ensureReady(): Promise<EngineStatus> {
    const runtime = this.resolveRuntimeMetadata()
    this.desiredVersion = runtime.version || DEFAULT_OPENCLAW_VERSION

    if (!runtime.root) {
      this.setStatus({
        phase: 'not_installed',
        version: null,
        message: t('engine.runtimeNotFound', { path: runtime.expectedPathHint }),
        canRetry: true
      })
      return this.getStatus()
    }

    // 同步本地扩展到运行时目录
    const localExtensionSync = syncLocalOpenClawExtensionsIntoRuntime(runtime.root)
    if (localExtensionSync.copied.length > 0) {
      logger.info('localExtensions.synced', { copied: localExtensionSync.copied })
    }

    // 清理可能残留在 dist/extensions/ 中的过期第三方插件
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'))
      const thirdPartyIds: string[] = (pkg.openclaw?.plugins ?? [])
        .map((p: { id?: string }) => p.id)
        .filter((id: unknown): id is string => typeof id === 'string')
      const localIds = listLocalOpenClawExtensionIds()
      const renamedIds = ['feishu-openclaw-plugin']
      const allNonBundledIds = [...new Set([...thirdPartyIds, ...localIds, ...renamedIds])]
      const cleaned = cleanupStaleThirdPartyPluginsFromBundledDir(runtime.root, allNonBundledIds)
      if (cleaned.length > 0) {
        logger.info('thirdPartyPlugins.cleaned', { cleaned })
      }
    } catch {
      // 尽力清理，不阻塞启动
    }

    // 如果 gateway 已在运行中，不降级为 ready
    if (this.status.phase === 'running') {
      return this.getStatus()
    }

    this.setStatus({
      phase: 'ready',
      version: this.desiredVersion,
      message: t('engine.runtimeReady'),
      canRetry: false
    })
    return this.getStatus()
  }

  /** 启动 Gateway 进程（去重：重复调用复用同一个 Promise） */
  async startGateway(): Promise<EngineStatus> {
    if (this.startGatewayPromise) {
      logger.warn('gateway.start.reused')
      return this.startGatewayPromise
    }
    this.startGatewayPromise = this.doStartGateway().finally(() => {
      this.startGatewayPromise = null
    })
    return this.startGatewayPromise
  }

  /** 停止 Gateway 进程 */
  async stopGateway(): Promise<void> {
    this.shutdownRequested = true

    if (this.gatewayRestartTimer) {
      clearTimeout(this.gatewayRestartTimer)
      this.gatewayRestartTimer = null
    }

    if (this.gatewayProcess) {
      logger.warn('gateway.stop.started')
      await this.stopGatewayProcess(this.gatewayProcess)
      logger.warn('gateway.stop.completed')
      this.gatewayProcess = null
    }

    const runtime = this.resolveRuntimeMetadata()
    this.setStatus({
      phase: runtime.root ? 'ready' : 'not_installed',
      version: runtime.version,
      message: runtime.root
        ? t('engine.runtimeReadyGatewayStopped')
        : t('engine.runtimeNotFound', { path: runtime.expectedPathHint }),
      canRetry: !runtime.root
    })
  }

  /** 重启 Gateway（先停后启，重置重启计数） */
  async restartGateway(): Promise<EngineStatus> {
    logger.warn('gateway.restart.stopExisting.started')
    await this.stopGateway()
    this.gatewayRestartAttempt = 0
    logger.warn('gateway.restart.startNew.started')
    return this.startGateway()
  }

  // ── 私有方法 ──

  private async doStartGateway(): Promise<EngineStatus> {
    this.shutdownRequested = false
    const t0 = Date.now()

    const ensured = await this.ensureReady()
    logger.info('gateway.start.ensureReady.completed', {
      elapsedMs: Date.now() - t0,
      phase: ensured.phase
    })
    // 接受 ready 和 running（gateway 已在运行）两种状态
    if (ensured.phase !== 'ready' && ensured.phase !== 'running') {
      return ensured
    }

    // 如果已有活跃进程，检查健康状态
    if (isGatewayProcessAlive(this.gatewayProcess)) {
      const port = this.gatewayPort ?? this.readGatewayPort()
      if (port) {
        const healthy = await this.isGatewayHealthy(port)
        logger.info('gateway.existingProcess.healthChecked', {
          elapsedMs: Date.now() - t0,
          healthy,
          port
        })
        if (healthy) {
          if (this.status.phase !== 'running') {
            this.setStatus({
              phase: 'running',
              version: this.desiredVersion,
              progressPercent: 100,
              message: t('engine.gatewayRunning', { port: String(port) }),
              canRetry: false
            })
          }
          return this.getStatus()
        }
      }
      await this.stopGatewayProcess(this.gatewayProcess)
      this.gatewayProcess = null
    }

    const runtime = this.resolveRuntimeMetadata()
    logger.info('runtime.metadata.resolved', {
      elapsedMs: Date.now() - t0,
      hasRoot: Boolean(runtime.root)
    })
    if (!runtime.root) {
      this.setStatus({
        phase: 'not_installed',
        version: null,
        message: t('engine.runtimeNotFound', { path: runtime.expectedPathHint }),
        canRetry: true
      })
      return this.getStatus()
    }

    // asar 解压：确保入口文件和 control-ui 在磁盘上可用
    this.ensureBareEntryFiles(runtime.root)
    logger.info('runtime.bareEntryFiles.ensure.completed', { elapsedMs: Date.now() - t0 })

    const openclawEntry = this.resolveOpenClawEntry(runtime.root)
    logger.info('runtime.entry.resolved', { elapsedMs: Date.now() - t0, openclawEntry })
    if (!openclawEntry) {
      this.setStatus({
        phase: 'error',
        version: runtime.version,
        message: t('engine.entryMissing', { root: runtime.root }),
        canRetry: true
      })
      return this.getStatus()
    }

    const token = this.ensureGatewayToken()
    logger.info('gateway.token.ensure.completed', { elapsedMs: Date.now() - t0 })
    const port = await this.resolveGatewayPort()
    logger.info('gateway.port.resolved', { elapsedMs: Date.now() - t0, port })
    this.gatewayPort = port
    this.writeGatewayPort(port)
    this.ensureConfigFile()

    this.setStatus({
      phase: 'starting',
      version: runtime.version,
      progressPercent: 10,
      message: t('engine.gatewayStarting'),
      canRetry: false
    })

    // ── 构建完整环境变量 ──
    const compileCacheDir = path.join(this.stateDir, '.compile-cache')
    const electronNodeRuntimePath = getElectronNodeRuntimePath()
    const cliShimDir = this.ensureBundledCliShims()
    const skillsRoot = getSkillsRoot().replace(/\\/g, '/')

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Skills 路径
      SKILLS_ROOT: skillsRoot,
      PETCLAW_SKILLS_ROOT: skillsRoot,
      // OpenClaw 核心配置
      OPENCLAW_HOME: this.baseDir,
      OPENCLAW_STATE_DIR: this.stateDir,
      OPENCLAW_CONFIG_PATH: this.configPath,
      OPENCLAW_GATEWAY_TOKEN: token,
      OPENCLAW_GATEWAY_PORT: String(port),
      OPENCLAW_NO_RESPAWN: '1',
      OPENCLAW_ENGINE_VERSION: runtime.version || DEFAULT_OPENCLAW_VERSION,
      // 指向 dist/extensions 目录，用于运行时内置的插件发现
      OPENCLAW_BUNDLED_PLUGINS_DIR: path.join(runtime.root, 'dist', 'extensions'),
      // 跳过模型定价引导，避免启动延迟（gateway 会在启动时请求 openrouter.ai，可能超时）
      OPENCLAW_SKIP_MODEL_PRICING: '1',
      // 禁用 Bonjour/mDNS LAN 广播，桌面应用仅使用 loopback
      OPENCLAW_DISABLE_BONJOUR: '1',
      // 启用 debug 级别日志
      OPENCLAW_LOG_LEVEL: 'debug',
      // V8 编译缓存，加速后续启动（对 ESM import() 也生效）
      NODE_COMPILE_CACHE: compileCacheDir,
      // Electron 作为 Node 运行时的路径
      PETCLAW_ELECTRON_PATH: electronNodeRuntimePath.replace(/\\/g, '/'),
      // OpenClaw 入口文件路径
      PETCLAW_OPENCLAW_ENTRY: openclawEntry.replace(/\\/g, '/'),
      // 注入秘密环境变量（用于 openclaw.json 中 ${VAR} 占位符的明文值）
      ...this.secretEnvVars
    }

    // macOS 注入时区（macOS 默认不设置 TZ，utilityProcess 子进程可能回退到 UTC）
    if (!env.TZ) {
      const hostTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (hostTimezone) {
        env.TZ = hostTimezone
        logger.info('gateway.env.timezone.injected', { timezone: hostTimezone })
      }
    }

    // 注入 CLI shim 到 PATH
    if (cliShimDir) {
      const currentPath = env.PATH || env.Path || ''
      env.PATH = [cliShimDir, currentPath].filter(Boolean).join(path.delimiter)
    }

    // 注入 Python 运行时路径
    appendPythonRuntimeToEnv(env as Record<string, string | undefined>)

    // 注入 node/npm/npx shim，使 gateway exec 命令可以使用
    const npmBinDir = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'npm', 'bin')
      : undefined
    const nodeShimDir = ensureElectronNodeShim(electronNodeRuntimePath, npmBinDir)
    if (nodeShimDir) {
      const curPath = env.PATH || env.Path || ''
      env.PATH = [nodeShimDir, curPath].filter(Boolean).join(path.delimiter)
      env.PETCLAW_NPM_BIN_DIR = npmBinDir || ''
    }

    // 系统代理注入
    if (isSystemProxyEnabled()) {
      const { proxyUrl, targetUrl } = await resolveSystemProxyUrlForTargets()
      if (proxyUrl) {
        env.http_proxy = proxyUrl
        env.https_proxy = proxyUrl
        env.HTTP_PROXY = proxyUrl
        env.HTTPS_PROXY = proxyUrl
        logger.warn('gateway.env.systemProxy.injected', { targetUrl })
      }
    }

    const forkArgs = [
      'gateway',
      '--bind',
      'loopback',
      '--port',
      String(port),
      '--token',
      token,
      '--verbose'
    ]
    logger.warn('gateway.spawn.started', { openclawEntry, cwd: runtime.root, port })

    // Windows 使用 child_process.spawn + ELECTRON_RUN_AS_NODE，其他平台使用 utilityProcess.fork
    let child: GatewayProcess
    if (process.platform === 'win32') {
      child = spawn(process.execPath, [openclawEntry, ...forkArgs], {
        cwd: runtime.root,
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } else {
      child = utilityProcess.fork(openclawEntry, forkArgs, {
        cwd: runtime.root,
        env,
        stdio: 'pipe',
        serviceName: 'OpenClaw Gateway'
      })
    }

    this.gatewayProcess = child
    this.attachGatewayProcessLogs(child)
    this.attachGatewayExitHandlers(child)

    child.once('spawn', () => {
      logger.warn('gateway.spawn.completed', { elapsedMs: Date.now() - t0, pid: child.pid })
    })

    const ready = await this.waitForGatewayReady(port, GATEWAY_BOOT_TIMEOUT_MS)
    logger.warn('gateway.waitForReady.completed', { elapsedMs: Date.now() - t0, ready })
    if (!ready) {
      this.setStatus({
        phase: 'error',
        version: runtime.version,
        message: t('engine.gatewayTimeout'),
        canRetry: true
      })
      this.stopGatewayProcess(child)
      return this.getStatus()
    }

    this.gatewayRestartAttempt = 0
    this.setStatus({
      phase: 'running',
      version: runtime.version,
      progressPercent: 100,
      message: t('engine.gatewayRunning', { port: String(port) }),
      canRetry: false
    })

    return this.getStatus()
  }

  /** 解析运行时元数据：packaged → resourcesPath/petmind，dev → vendor/openclaw-runtime/current */
  private resolveRuntimeMetadata(): RuntimeMetadata {
    const candidateRoots = app.isPackaged
      ? [path.join(process.resourcesPath, 'petmind')]
      : [
          path.join(app.getAppPath(), 'vendor', 'openclaw-runtime', 'current'),
          path.join(process.cwd(), 'vendor', 'openclaw-runtime', 'current')
        ]

    const runtimeRoot = (() => {
      const found = findPath(candidateRoots)
      if (!found) return null
      try {
        return fs.realpathSync(found)
      } catch {
        return found
      }
    })()

    const expectedPathHint = app.isPackaged
      ? path.join(process.resourcesPath, 'petmind')
      : path.join(app.getAppPath(), 'vendor', 'openclaw-runtime', 'current')

    if (!runtimeRoot) {
      return { root: null, version: null, expectedPathHint }
    }

    return {
      root: runtimeRoot,
      version: this.readRuntimeVersion(runtimeRoot) || DEFAULT_OPENCLAW_VERSION,
      expectedPathHint
    }
  }

  /** 从 package.json / runtime-build-info.json 读取运行时版本 */
  private readRuntimeVersion(runtimeRoot: string): string | null {
    const fromRootPkg = parseJsonFile<{ version?: string }>(
      path.join(runtimeRoot, 'package.json')
    )?.version
    if (typeof fromRootPkg === 'string' && fromRootPkg.trim()) {
      return fromRootPkg.trim()
    }

    const fromOpenClawPkg = parseJsonFile<{ version?: string }>(
      path.join(runtimeRoot, 'node_modules', 'openclaw', 'package.json')
    )?.version
    if (typeof fromOpenClawPkg === 'string' && fromOpenClawPkg.trim()) {
      return fromOpenClawPkg.trim()
    }

    const fromBuildInfo = parseJsonFile<{ version?: string }>(
      path.join(runtimeRoot, 'runtime-build-info.json')
    )?.version
    if (typeof fromBuildInfo === 'string' && fromBuildInfo.trim()) {
      return fromBuildInfo.trim()
    }

    return null
  }

  // ── asar 解压 ──

  /**
   * 确保入口文件从 gateway.asar 中解压到磁盘。
   * 快速路径：如果 gateway-bundle.mjs 存在则跳过完整 dist 解压。
   */
  private ensureBareEntryFiles(runtimeRoot: string): void {
    const t0 = Date.now()

    // 快速路径：bundle 存在时只需确保 control-ui 可用
    const bundlePath = path.join(runtimeRoot, 'gateway-bundle.mjs')
    if (fs.existsSync(bundlePath)) {
      logger.info('runtime.bareEntryFiles.bundleFound')
      this.ensureControlUiFiles(runtimeRoot)
      logger.info('runtime.bareEntryFiles.ensure.completed', { elapsedMs: Date.now() - t0 })
      return
    }

    logger.info('runtime.bareEntryFiles.bundleMissing')
    const bareEntry = path.join(runtimeRoot, 'openclaw.mjs')
    const bareDistEntry = path.join(runtimeRoot, 'dist', 'entry.js')

    if (fs.existsSync(bareEntry) && fs.existsSync(bareDistEntry)) {
      return
    }

    const asarRoot = path.join(runtimeRoot, 'gateway.asar')
    const asarEntry = path.join(asarRoot, 'openclaw.mjs')
    if (!fs.existsSync(asarEntry)) {
      return
    }

    logger.warn('runtime.bareEntryFiles.extract.started')

    try {
      if (!fs.existsSync(bareEntry)) {
        fs.writeFileSync(bareEntry, fs.readFileSync(asarEntry))
        logger.info('runtime.bareEntryFiles.openclawEntry.extracted')
      }

      const asarDist = path.join(asarRoot, 'dist')
      const bareDist = path.join(runtimeRoot, 'dist')
      if (fs.existsSync(asarDist) && !fs.existsSync(bareDistEntry)) {
        this.copyDirFromAsar(asarDist, bareDist)
        logger.info('runtime.bareEntryFiles.dist.extracted')
      }

      logger.warn('runtime.bareEntryFiles.extract.completed')
    } catch (err) {
      logger.error('runtime.bareEntryFiles.extract.failed', { runtimeRoot }, err)
    }
  }

  /**
   * 仅从 gateway.asar 解压 dist/control-ui/（如果磁盘上不存在）。
   * control-ui 包含 gateway 管理界面的静态 HTML/CSS/JS 资源，必须以裸文件形式存在。
   */
  private ensureControlUiFiles(runtimeRoot: string): void {
    const controlUiIndex = path.join(runtimeRoot, 'dist', 'control-ui', 'index.html')
    if (fs.existsSync(controlUiIndex)) {
      return
    }

    const asarControlUi = path.join(runtimeRoot, 'gateway.asar', 'dist', 'control-ui')
    if (!fs.existsSync(asarControlUi)) {
      return
    }

    logger.warn('runtime.controlUi.extract.started')
    try {
      this.copyDirFromAsar(asarControlUi, path.join(runtimeRoot, 'dist', 'control-ui'))
      logger.warn('runtime.controlUi.extract.completed')
    } catch (err) {
      logger.error('runtime.controlUi.extract.failed', { runtimeRoot }, err)
    }
  }

  /** 递归复制 asar 内目录到磁盘 */
  private copyDirFromAsar(srcDir: string, destDir: string): void {
    fs.mkdirSync(destDir, { recursive: true })
    const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name)
      const destPath = path.join(destDir, entry.name)
      if (entry.isDirectory()) {
        this.copyDirFromAsar(srcPath, destPath)
      } else {
        fs.writeFileSync(destPath, fs.readFileSync(srcPath))
      }
    }
  }

  // ── CLI shim ──

  /**
   * 生成 openclaw/claw CLI shim 脚本，使 gateway exec 命令可以调用 OpenClaw CLI。
   * 通过 PETCLAW_ELECTRON_PATH 和 PETCLAW_OPENCLAW_ENTRY 环境变量定位运行时。
   */
  private ensureBundledCliShims(): string | null {
    const shimDir = path.join(this.stateDir, 'bin')
    const shellWrapper = [
      '#!/usr/bin/env bash',
      'if [ -z "${PETCLAW_OPENCLAW_ENTRY:-}" ]; then',
      '  echo "PETCLAW_OPENCLAW_ENTRY is not set" >&2',
      '  exit 127',
      'fi',
      'if [ -n "${PETCLAW_ELECTRON_PATH:-}" ]; then',
      '  exec env ELECTRON_RUN_AS_NODE=1 "${PETCLAW_ELECTRON_PATH}" "${PETCLAW_OPENCLAW_ENTRY}" "$@"',
      'fi',
      'if command -v node >/dev/null 2>&1; then',
      '  exec node "${PETCLAW_OPENCLAW_ENTRY}" "$@"',
      'fi',
      'echo "Neither PETCLAW_ELECTRON_PATH nor node is available for OpenClaw CLI." >&2',
      'exit 127',
      ''
    ].join('\n')
    const windowsWrapper = [
      '@echo off',
      'if "%PETCLAW_OPENCLAW_ENTRY%"=="" (',
      '  echo PETCLAW_OPENCLAW_ENTRY is not set 1>&2',
      '  exit /b 127',
      ')',
      'if not "%PETCLAW_ELECTRON_PATH%"=="" (',
      '  set ELECTRON_RUN_AS_NODE=1',
      '  "%PETCLAW_ELECTRON_PATH%" "%PETCLAW_OPENCLAW_ENTRY%" %*',
      '  exit /b %ERRORLEVEL%',
      ')',
      'node "%PETCLAW_OPENCLAW_ENTRY%" %*',
      ''
    ].join('\r\n')

    try {
      ensureDir(shimDir)
      for (const commandName of ['openclaw', 'claw']) {
        const shellPath = path.join(shimDir, commandName)
        const existingShell = fs.existsSync(shellPath) ? fs.readFileSync(shellPath, 'utf8') : ''
        if (existingShell !== shellWrapper) {
          fs.writeFileSync(shellPath, shellWrapper, 'utf8')
          fs.chmodSync(shellPath, 0o755)
        }

        if (process.platform === 'win32') {
          const cmdPath = path.join(shimDir, `${commandName}.cmd`)
          const existingCmd = fs.existsSync(cmdPath) ? fs.readFileSync(cmdPath, 'utf8') : ''
          if (existingCmd !== windowsWrapper) {
            fs.writeFileSync(cmdPath, windowsWrapper, 'utf8')
          }
        }
      }

      return shimDir
    } catch (error) {
      logger.error('cliShim.prepare.failed', undefined, error)
      return null
    }
  }

  // ── Gateway 入口解析 ──

  /** 解析 gateway 入口文件（ESM 优先，Windows 走 CJS wrapper） */
  private resolveOpenClawEntry(runtimeRoot: string): string | null {
    // Windows bundle 快速路径：直接用 CJS launcher 加载 gateway-bundle.mjs
    if (process.platform === 'win32') {
      const bundlePath = path.join(runtimeRoot, 'gateway-bundle.mjs')
      if (fs.existsSync(bundlePath)) {
        logger.info('runtime.entry.bundleFastPath.used', { runtimeRoot })
        return this.ensureGatewayLauncherCjsForBundle(runtimeRoot)
      }
    }

    const esmEntry = findPath([
      path.join(runtimeRoot, 'openclaw.mjs'),
      path.join(runtimeRoot, 'dist', 'entry.js'),
      path.join(runtimeRoot, 'dist', 'entry.mjs'),
      path.join(runtimeRoot, 'gateway.asar', 'openclaw.mjs')
    ])
    if (!esmEntry) return null

    // Windows: utilityProcess.fork 不能直接加载 ESM，需要 CJS wrapper
    if (process.platform === 'win32') {
      return this.ensureGatewayLauncherCjs(runtimeRoot, esmEntry)
    }
    return esmEntry
  }

  /**
   * Windows ESM 兼容：生成全功能 CJS wrapper（含 V8 编译缓存、argv 补丁、fallback）。
   * 策略 1: 尝试加载 gateway-bundle.mjs（esbuild 单文件 bundle）
   * 策略 2: 回退到多文件 dist/entry.js
   */
  private ensureGatewayLauncherCjs(runtimeRoot: string, esmEntry: string): string {
    const launcherPath = path.join(runtimeRoot, 'gateway-launcher.cjs')
    const esmBasename = path.basename(esmEntry)
    const expectedContent =
      `// 自动生成的 CJS wrapper — Windows ESM 兼容\n` +
      `// Windows 上 Electron utilityProcess.fork() 无法直接加载 ESM 模块\n` +
      `// 因为驱动器号（如 "D:"）被误解为 URL scheme。\n` +
      `const { pathToFileURL } = require('node:url');\n` +
      `const path = require('node:path');\n` +
      `const fs = require('node:fs');\n` +
      `// 启用 V8 编译缓存以加速后续启动\n` +
      `try {\n` +
      `  const { enableCompileCache } = require('node:module');\n` +
      `  const ccDir = path.join(process.env.OPENCLAW_STATE_DIR || __dirname, '.compile-cache');\n` +
      `  enableCompileCache(ccDir);\n` +
      `  process.stderr.write('[openclaw-launcher] compile-cache dir=' + require('node:module').getCompileCacheDir() + '\\n');\n` +
      `} catch (_) {}\n` +
      `const esmEntry = path.join(__dirname, '${esmBasename}');\n` +
      `// 补丁 argv，使 openclaw 的 isMainModule() 识别为主入口\n` +
      `const _realpath = (p) => { try { return fs.realpathSync(path.resolve(p)); } catch { return path.resolve(p); } };\n` +
      `const _launcherInArgv = process.argv[1] &&\n` +
      `  _realpath(process.argv[1]).toLowerCase() === _realpath(__filename).toLowerCase();\n` +
      `if (_launcherInArgv) {\n` +
      `  process.argv[1] = esmEntry;\n` +
      `} else {\n` +
      `  process.argv.splice(1, 0, esmEntry);\n` +
      `}\n` +
      `process.stderr.write('[openclaw-launcher] argv=' + JSON.stringify(process.argv) + '\\n');\n` +
      `process.stderr.write('[openclaw-launcher] node=' + process.versions.node + '\\n');\n` +
      `// 保持事件循环活跃，防止 utilityProcess 在异步加载完成前退出\n` +
      `const _keepAlive = setInterval(() => {}, 30000);\n` +
      `const t0 = Date.now();\n` +
      `// 策略 1: 尝试加载 esbuild 单文件 bundle\n` +
      `const bundlePath = path.join(__dirname, 'gateway-bundle.mjs');\n` +
      `if (fs.existsSync(bundlePath)) {\n` +
      `  process.argv[1] = bundlePath;\n` +
      `  process.stderr.write('[openclaw-launcher] argv(patched for bundle)=' + JSON.stringify(process.argv) + '\\n');\n` +
      `  const bundleUrl = pathToFileURL(bundlePath).href;\n` +
      `  process.stderr.write('[openclaw-launcher] loading bundle via import(): ' + bundleUrl + '\\n');\n` +
      `  import(bundleUrl).then(() => {\n` +
      `    process.stderr.write('[openclaw-launcher] import(gateway-bundle.mjs) ok (' + (Date.now() - t0) + 'ms)\\n');\n` +
      `    try { require('node:module').flushCompileCache(); } catch (_) {}\n` +
      `  }).catch((err) => {\n` +
      `    process.stderr.write('[openclaw-launcher] import(gateway-bundle.mjs) failed (' + (Date.now() - t0) + 'ms): ' + (err.stack || err) + '\\n');\n` +
      `    process.stderr.write('[openclaw-launcher] Falling back to multi-file dist...\\n');\n` +
      `    return _loadFallback();\n` +
      `  });\n` +
      `} else {\n` +
      `  _loadFallback();\n` +
      `}\n` +
      `// 回退：加载原始多文件 dist\n` +
      `function _loadFallback() {\n` +
      `  try {\n` +
      `    try {\n` +
      `      const wf = require('./dist/warning-filter.js');\n` +
      `      if (typeof wf.installProcessWarningFilter === 'function') {\n` +
      `        wf.installProcessWarningFilter();\n` +
      `      }\n` +
      `    } catch (_) {}\n` +
      `    require('./dist/entry.js');\n` +
      `    process.stderr.write('[openclaw-launcher] require(entry.js) ok (' + (Date.now() - t0) + 'ms)\\n');\n` +
      `    try { require('node:module').flushCompileCache(); } catch (_) {}\n` +
      `  } catch (err) {\n` +
      `    process.stderr.write('[openclaw-launcher] require(entry.js) failed (' + (Date.now() - t0) + 'ms): ' + err.message + '\\n');\n` +
      `    const entryPath = path.join(__dirname, 'dist', 'entry.js');\n` +
      `    const importUrl = pathToFileURL(entryPath).href;\n` +
      `    process.stderr.write('[openclaw-launcher] falling back to import(): ' + importUrl + '\\n');\n` +
      `    import(importUrl).then(() => {\n` +
      `      process.stderr.write('[openclaw-launcher] import() ok (' + (Date.now() - t0) + 'ms)\\n');\n` +
      `    }).catch((err2) => {\n` +
      `      process.stderr.write('[openclaw-launcher] ERROR (' + (Date.now() - t0) + 'ms): ' + (err2.stack || err2) + '\\n');\n` +
      `      process.exit(1);\n` +
      `    });\n` +
      `  }\n` +
      `}\n`

    try {
      const existing = fs.existsSync(launcherPath) ? fs.readFileSync(launcherPath, 'utf8') : ''
      if (existing !== expectedContent) {
        fs.writeFileSync(launcherPath, expectedContent, 'utf8')
        logger.info('gatewayLauncher.generated', { launcherPath, mode: 'esm-wrapper' })
      }
    } catch (err) {
      logger.error('gatewayLauncher.write.failed', { launcherPath }, err)
      return esmEntry
    }
    return launcherPath
  }

  /**
   * 生成简化版 CJS launcher，仅加载 gateway-bundle.mjs（无 dist/ 回退）。
   * 用于 bundle 文件确定存在的场景。
   */
  private ensureGatewayLauncherCjsForBundle(runtimeRoot: string): string {
    const launcherPath = path.join(runtimeRoot, 'gateway-launcher.cjs')
    const expectedContent =
      `// 自动生成的 CJS launcher — 仅 bundle 模式\n` +
      `// 直接加载 gateway-bundle.mjs，无 dist/ 回退。\n` +
      `const { pathToFileURL } = require('node:url');\n` +
      `const path = require('node:path');\n` +
      `const fs = require('node:fs');\n` +
      `const _log = (msg) => process.stderr.write('[openclaw-launcher] ' + msg + '\\n');\n` +
      `const _t0 = Date.now();\n` +
      `const _elapsed = () => (Date.now() - _t0) + 'ms';\n` +
      `// ─── 编译缓存设置 ───\n` +
      `try {\n` +
      `  const { enableCompileCache, getCompileCacheDir } = require('node:module');\n` +
      `  const _ccDir = path.join(process.env.OPENCLAW_STATE_DIR || __dirname, '.compile-cache');\n` +
      `  enableCompileCache(_ccDir);\n` +
      `  _log('compile-cache dir=' + getCompileCacheDir());\n` +
      `} catch (_) {}\n` +
      `// ─── 加载 bundle ───\n` +
      `const bundlePath = path.join(__dirname, 'gateway-bundle.mjs');\n` +
      `const _realpath = (p) => { try { return fs.realpathSync(path.resolve(p)); } catch { return path.resolve(p); } };\n` +
      `const _launcherInArgv = process.argv[1] &&\n` +
      `  _realpath(process.argv[1]).toLowerCase() === _realpath(__filename).toLowerCase();\n` +
      `if (_launcherInArgv) {\n` +
      `  process.argv[1] = bundlePath;\n` +
      `} else {\n` +
      `  process.argv.splice(1, 0, bundlePath);\n` +
      `}\n` +
      `const _keepAlive = setInterval(() => {}, 30000);\n` +
      `const bundleUrl = pathToFileURL(bundlePath).href;\n` +
      `try { const _sz = fs.statSync(bundlePath).size; _log('bundle size=' + (_sz / 1024 / 1024).toFixed(1) + 'MB'); } catch (_) {}\n` +
      `_log('loading bundle (' + _elapsed() + ')');\n` +
      `import(bundleUrl).then(() => {\n` +
      `  _log('import ok (' + _elapsed() + ')');\n` +
      `}).catch((err) => {\n` +
      `  _log('import failed (' + _elapsed() + '): ' + (err.stack || err));\n` +
      `  process.exit(1);\n` +
      `});\n`

    try {
      const existing = fs.existsSync(launcherPath) ? fs.readFileSync(launcherPath, 'utf8') : ''
      if (existing !== expectedContent) {
        if (existing) {
          logger.warn('gatewayLauncher.overwritten', { launcherPath, mode: 'bundle-only' })
        }
        fs.writeFileSync(launcherPath, expectedContent, 'utf8')
        logger.info('gatewayLauncher.generated', { launcherPath, mode: 'bundle-only' })
      }
    } catch (err) {
      logger.error('gatewayLauncher.write.failed', { launcherPath }, err)
      // 回退到旧版 launcher 生成
      const fallbackEsm = findPath([
        path.join(runtimeRoot, 'openclaw.mjs'),
        path.join(runtimeRoot, 'gateway.asar', 'openclaw.mjs')
      ])
      if (fallbackEsm) return this.ensureGatewayLauncherCjs(runtimeRoot, fallbackEsm)
      return launcherPath
    }
    return launcherPath
  }

  // ── GatewayClient 入口解析 ──

  /** 解析 GatewayClient 入口路径，用于 gateway 连接信息 */
  private resolveGatewayClientEntry(runtimeRoot: string): string | null {
    const distRoots = [
      path.join(runtimeRoot, 'dist'),
      path.join(runtimeRoot, 'gateway.asar', 'dist')
    ]

    for (const distRoot of distRoots) {
      const clientEntry = this.findGatewayClientEntryFromDistRoot(distRoot)
      if (clientEntry) {
        return clientEntry
      }
    }

    return null
  }

  /** 从指定 dist 根目录查找 GatewayClient 入口文件 */
  private findGatewayClientEntryFromDistRoot(distRoot: string): string | null {
    // v2026.4.5+: GatewayClient 通过 plugin-sdk 公共子路径导出
    const pluginSdkGatewayRuntime = path.join(distRoot, 'plugin-sdk', 'gateway-runtime.js')
    if (fs.existsSync(pluginSdkGatewayRuntime)) {
      return pluginSdkGatewayRuntime
    }

    // v2026.4.5 之前: GatewayClient 在 dist/ 下的独立文件中
    const gatewayClient = path.join(distRoot, 'gateway', 'client.js')
    if (fs.existsSync(gatewayClient)) {
      return gatewayClient
    }

    const directClient = path.join(distRoot, 'client.js')
    if (fs.existsSync(directClient)) {
      return directClient
    }

    // 最后手段：匹配 dist 根目录下任何 client-*.js 文件
    try {
      if (!fs.existsSync(distRoot) || !fs.statSync(distRoot).isDirectory()) {
        return null
      }

      const candidates = fs
        .readdirSync(distRoot)
        .filter((name) => /^client(?:-.*)?\.js$/i.test(name))
        .sort()
      if (candidates.length > 0) {
        return path.join(distRoot, candidates[0])
      }
    } catch {
      /* 忽略 */
    }

    return null
  }

  // ── Token / Port / Config ──

  /** 确保 gateway token 存在（48 字符 hex），持久化到文件 */
  private ensureGatewayToken(): string {
    try {
      const existing = fs.readFileSync(this.gatewayTokenPath, 'utf8').trim()
      if (existing) return existing
    } catch {
      /* 忽略 */
    }

    const token = crypto.randomBytes(24).toString('hex')
    ensureDir(path.dirname(this.gatewayTokenPath))
    fs.writeFileSync(this.gatewayTokenPath, token, 'utf8')
    return token
  }

  private readGatewayToken(): string | null {
    try {
      const token = fs.readFileSync(this.gatewayTokenPath, 'utf8').trim()
      return token || null
    } catch {
      return null
    }
  }

  /** 解析可用端口：默认 → 持久化 → 批量扫描 */
  private async resolveGatewayPort(): Promise<number> {
    const candidates: number[] = [DEFAULT_GATEWAY_PORT]
    if (this.gatewayPort) candidates.push(this.gatewayPort)
    const persisted = this.readGatewayPort()
    if (persisted) candidates.push(persisted)

    const unique = Array.from(new Set(candidates))
    for (const candidate of unique) {
      if (await isPortAvailable(candidate)) return candidate
    }

    // 批量扫描 10 个一组
    const BATCH_SIZE = 10
    for (let batch = 0; batch * BATCH_SIZE < GATEWAY_PORT_SCAN_LIMIT; batch += 1) {
      const batchStart = DEFAULT_GATEWAY_PORT + batch * BATCH_SIZE + 1
      const batchEnd = Math.min(
        batchStart + BATCH_SIZE,
        DEFAULT_GATEWAY_PORT + GATEWAY_PORT_SCAN_LIMIT + 1
      )
      const portBatch = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i)
      const results = await Promise.all(
        portBatch.map(async (p) => ((await isPortAvailable(p)) ? p : null))
      )
      const available = results.find((p) => p !== null)
      if (available != null) return available
    }

    throw new Error(t('engine.noAvailablePort'))
  }

  private writeGatewayPort(port: number): void {
    fs.writeFileSync(
      this.gatewayPortPath,
      JSON.stringify({ port, updatedAt: Date.now() }, null, 2),
      'utf8'
    )
  }

  private readGatewayPort(): number | null {
    const payload = parseJsonFile<{ port?: number }>(this.gatewayPortPath)
    if (!payload || typeof payload.port !== 'number' || !Number.isInteger(payload.port)) return null
    if (payload.port <= 0 || payload.port > 65535) return null
    return payload.port
  }

  /** 确保 openclaw.json 配置文件存在 */
  private ensureConfigFile(): void {
    ensureDir(path.dirname(this.configPath))
    if (!fs.existsSync(this.configPath)) {
      fs.writeFileSync(
        this.configPath,
        JSON.stringify({ gateway: { mode: 'local' } }, null, 2) + '\n',
        'utf8'
      )
      return
    }
    try {
      const raw = fs.readFileSync(this.configPath, 'utf8')
      const config = JSON.parse(raw)
      if (!config.gateway?.mode) {
        config.gateway = { ...config.gateway, mode: 'local' }
        fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
      }
    } catch {
      /* 忽略解析错误 */
    }
  }

  // ── 健康检查 ──

  /** 并行 HTTP + TCP 探针检测 gateway 健康状态 */
  private async isGatewayHealthy(port: number, verbose = false): Promise<boolean> {
    const probeUrls = [
      `http://127.0.0.1:${port}/health`,
      `http://127.0.0.1:${port}/healthz`,
      `http://127.0.0.1:${port}/ready`,
      `http://127.0.0.1:${port}/`
    ]

    const httpResults: string[] = []
    const httpProbes = probeUrls.map(async (url, i) => {
      try {
        const response = await fetchWithTimeout(url, 1500)
        if (verbose) httpResults[i] = `${url} → ${response.status}`
        if (response.status < 500) return true
      } catch (err) {
        if (verbose) httpResults[i] = `${url} → ${(err as Error).message || err}`
      }
      return false
    })

    const tcpProbe = isPortReachable('127.0.0.1', port, 1500)
    const results = await Promise.all([...httpProbes, tcpProbe])
    const healthy = results.some(Boolean)

    if (verbose && !healthy) {
      const tcpResult = results[results.length - 1] ? 'reachable' : 'unreachable'
      logger.warn('gateway.healthProbe.failed', { tcpResult, httpResults })
    }
    return healthy
  }

  /** 600ms 轮询等待 gateway 就绪，progressPercent 从 10→90 递增 */
  private waitForGatewayReady(port: number, timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now()
    let pollCount = 0

    return new Promise((resolve) => {
      const tick = async () => {
        if (this.shutdownRequested) {
          logger.warn('gateway.waitForReady.aborted.shutdownRequested')
          resolve(false)
          return
        }

        if (!this.gatewayProcess) {
          logger.warn('gateway.waitForReady.aborted.processExited')
          resolve(false)
          return
        }

        pollCount += 1
        const elapsedMs = Date.now() - startedAt
        const verboseProbe = pollCount % 10 === 0
        const healthy = await this.isGatewayHealthy(port, verboseProbe)

        if (healthy) {
          logger.warn('gateway.waitForReady.ready', { elapsedMs, pollCount })
          resolve(true)
          return
        }

        if (elapsedMs >= timeoutMs) {
          logger.warn('gateway.waitForReady.timeout', { timeoutMs, pollCount })
          resolve(false)
          return
        }

        // progressPercent 从 10% → 90% 线性递增
        const progress = Math.min(90, 10 + Math.round((elapsedMs / timeoutMs) * 80))
        this.setStatus({
          phase: 'starting',
          version: this.status.version,
          progressPercent: progress,
          message: t('engine.gatewayStartingProgress', {
            seconds: String(Math.round(elapsedMs / 1000))
          }),
          canRetry: false
        })

        if (pollCount % 5 === 0) {
          logger.info('gateway.waitForReady.poll', { pollCount, elapsedMs, progress })
        }

        setTimeout(() => {
          void tick()
        }, 600)
      }

      void tick()
    })
  }

  // ── 进程生命周期 ──

  /** 优雅关闭进程：kill → 1.2s 强杀 → 5s 硬超时 */
  private stopGatewayProcess(child: GatewayProcess): Promise<void> {
    this.expectedGatewayExits.add(child)

    return new Promise<void>((resolve) => {
      if ('exitCode' in child && child.exitCode !== null) {
        resolve()
        return
      }

      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        clearTimeout(forceTimer)
        resolve()
      }

      onceGatewayExit(child, done)

      // 第一次尝试：优雅 kill
      try {
        child.kill()
      } catch {
        /* 忽略 */
      }

      // 1.2s 后强制 kill
      const forceTimer = setTimeout(() => {
        try {
          if ('pid' in child && typeof child.pid === 'number') {
            child.kill()
          }
        } catch {
          /* 忽略 */
        }
        setTimeout(done, 2_000)
      }, 1_200)

      // 5s 硬超时保证不阻塞
      setTimeout(done, 5_000)
    })
  }

  // ── 日志 ──

  /**
   * 将 UTC 时间戳重写为本地时区。
   * 解决 Electron utilityProcess V8 隔离中 getTimezoneOffset() 返回 0 的问题。
   */
  static rewriteUtcTimestamps(text: string): string {
    return text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (utc) => {
      const d = new Date(utc)
      if (Number.isNaN(d.getTime())) return utc
      const pad = (n: number) => String(n).padStart(2, '0')
      const ms = String(d.getMilliseconds()).padStart(3, '0')
      const offsetMin = -d.getTimezoneOffset()
      const sign = offsetMin >= 0 ? '+' : '-'
      const absH = Math.floor(Math.abs(offsetMin) / 60)
      const absM = Math.abs(offsetMin) % 60
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}${sign}${pad(absH)}:${pad(absM)}`
    })
  }

  /** 将 gateway 进程的 stdout/stderr 写入统一日志平台。 */
  private attachGatewayProcessLogs(child: GatewayProcess): void {
    const platform = getLoggingPlatform()
    attachProcessLogger({
      platform,
      source: 'gateway',
      module: 'OpenClaw',
      stdout: toProcessLogStream(child.stdout),
      stderr: toProcessLogStream(child.stderr)
    })
  }

  /** 进程退出后自动重启（指数退避，最多 5 次） */
  private attachGatewayExitHandlers(child: GatewayProcess): void {
    onceGatewayError(child, (...args: unknown[]) => {
      const errorMsg =
        args[0] instanceof Error ? args[0].message : `${args[0]}${args[1] ? ` (${args[1]})` : ''}`
      logger.error('gateway.process.error', { errorMsg })
      if (this.expectedGatewayExits.has(child)) return
      if (this.shutdownRequested) return
      this.setStatus({
        phase: 'error',
        version: this.status.version,
        message: t('engine.gatewayProcessError', { error: errorMsg }),
        canRetry: true
      })
    })

    onceGatewayExit(child, (code) => {
      logger.warn('gateway.process.exited', { code })
      if (this.gatewayProcess === child) {
        this.gatewayProcess = null
      }
      if (this.expectedGatewayExits.has(child)) {
        this.expectedGatewayExits.delete(child)
        return
      }
      if (this.shutdownRequested) return

      this.setStatus({
        phase: 'error',
        version: this.status.version,
        message: t('engine.gatewayExited', { code: String(code ?? 'null') }),
        canRetry: true
      })
      this.scheduleGatewayRestart()
    })
  }

  /** 指数退避调度重启 */
  private scheduleGatewayRestart(): void {
    if (this.shutdownRequested) return
    if (this.gatewayRestartTimer) return

    if (this.gatewayRestartAttempt >= GATEWAY_MAX_RESTART_ATTEMPTS) {
      logger.error('gateway.restart.maxAttempts.reached', {
        maxAttempts: GATEWAY_MAX_RESTART_ATTEMPTS
      })
      this.setStatus({
        phase: 'error',
        version: this.status.version,
        message: t('engine.gatewayMaxRetries', { attempts: String(GATEWAY_MAX_RESTART_ATTEMPTS) }),
        canRetry: true
      })
      return
    }

    const delay =
      GATEWAY_RESTART_DELAYS[
        Math.min(this.gatewayRestartAttempt, GATEWAY_RESTART_DELAYS.length - 1)
      ]
    this.gatewayRestartAttempt++
    logger.warn('gateway.restart.scheduled', {
      attempt: this.gatewayRestartAttempt,
      maxAttempts: GATEWAY_MAX_RESTART_ATTEMPTS,
      delayMs: delay
    })

    this.gatewayRestartTimer = setTimeout(() => {
      this.gatewayRestartTimer = null
      if (this.shutdownRequested) return
      void this.startGateway()
    }, delay)
  }

  private setStatus(next: EngineStatus): void {
    this.status = {
      ...next,
      message: next.message ? next.message.slice(0, 500) : ''
    }
    this.emit('status', this.getStatus())
  }
}
