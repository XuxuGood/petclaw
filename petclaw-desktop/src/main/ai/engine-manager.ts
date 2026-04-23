import { type ChildProcess, spawn } from 'child_process'
import crypto from 'crypto'
import { app, type UtilityProcess, utilityProcess } from 'electron'
import { EventEmitter } from 'events'
import fs from 'fs'
import net from 'net'
import path from 'path'

import type { EnginePhase, EngineStatus, RuntimeMetadata } from './types'

// ── 类型 ──

type GatewayProcess = UtilityProcess | ChildProcess

interface EngineManagerEvents {
  status: (status: EngineStatus) => void
}

interface GatewayConnectionInfo {
  version: string | null
  port: number | null
  token: string | null
  url: string | null
}

// ── 常量 ──

const DEFAULT_OPENCLAW_VERSION = '2026.2.23'
const DEFAULT_GATEWAY_PORT = 18789
const GATEWAY_PORT_SCAN_LIMIT = 80
const GATEWAY_BOOT_TIMEOUT_MS = 300_000
const GATEWAY_MAX_RESTART_ATTEMPTS = 5
const GATEWAY_RESTART_DELAYS = [3_000, 5_000, 10_000, 20_000, 30_000]

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
    return await fetch(url, { method: 'GET', signal: controller.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timeout)
  }
}

// ── EngineManager 类 ──

export class OpenclawEngineManager extends EventEmitter {
  private readonly baseDir: string
  private readonly stateDir: string
  private readonly logsDir: string
  private readonly gatewayTokenPath: string
  private readonly gatewayPortPath: string
  private readonly gatewayLogPath: string
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
  private gatewaySpawnedAt: number | null = null

  constructor() {
    super()

    const userDataPath = app.getPath('userData')
    this.baseDir = path.join(userDataPath, 'openclaw')
    this.stateDir = path.join(this.baseDir, 'state')
    this.logsDir = path.join(this.stateDir, 'logs')

    this.gatewayTokenPath = path.join(this.stateDir, 'gateway-token')
    this.gatewayPortPath = path.join(this.stateDir, 'gateway-port.json')
    this.gatewayLogPath = path.join(this.logsDir, 'gateway.log')
    this.configPath = path.join(this.stateDir, 'openclaw.json')

    ensureDir(this.baseDir)
    ensureDir(this.stateDir)
    ensureDir(this.logsDir)

    const runtime = this.resolveRuntimeMetadata()
    this.desiredVersion = runtime.version || DEFAULT_OPENCLAW_VERSION

    this.status = runtime.root
      ? {
          phase: 'ready' as EnginePhase,
          version: this.desiredVersion,
          message: 'OpenClaw 运行时就绪。',
          canRetry: false
        }
      : {
          phase: 'not_installed',
          version: null,
          message: `未找到 OpenClaw 运行时，预期路径：${runtime.expectedPathHint}`,
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
    return this.gatewayLogPath
  }

  getGatewayToken(): string | null {
    return this.readGatewayToken()
  }

  getGatewayConnectionInfo(): GatewayConnectionInfo {
    const runtime = this.resolveRuntimeMetadata()
    const port = this.gatewayPort ?? this.readGatewayPort()
    const token = this.readGatewayToken()

    return {
      version: runtime.version,
      port,
      token,
      url: port ? `ws://127.0.0.1:${port}` : null
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

  /** 确认运行时就绪 */
  async ensureReady(): Promise<EngineStatus> {
    const runtime = this.resolveRuntimeMetadata()
    this.desiredVersion = runtime.version || DEFAULT_OPENCLAW_VERSION

    if (!runtime.root) {
      this.setStatus({
        phase: 'not_installed',
        version: null,
        message: `未找到 OpenClaw 运行时，预期路径：${runtime.expectedPathHint}`,
        canRetry: true
      })
      return this.getStatus()
    }

    this.setStatus({
      phase: 'ready',
      version: this.desiredVersion,
      message: 'OpenClaw 运行时就绪。',
      canRetry: false
    })
    return this.getStatus()
  }

  /** 启动 Gateway 进程（去重：重复调用复用同一个 Promise） */
  async startGateway(): Promise<EngineStatus> {
    if (this.startGatewayPromise) {
      console.warn('[OpenClaw] startGateway: 已在启动中，复用现有 Promise')
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
      console.warn('[OpenClaw] 正在停止 gateway 进程...')
      await this.stopGatewayProcess(this.gatewayProcess)
      console.warn('[OpenClaw] gateway 进程已停止')
      this.gatewayProcess = null
    }

    const runtime = this.resolveRuntimeMetadata()
    this.setStatus({
      phase: runtime.root ? 'ready' : 'not_installed',
      version: runtime.version,
      message: runtime.root
        ? 'OpenClaw 运行时就绪，Gateway 已停止。'
        : `未找到 OpenClaw 运行时，预期路径：${runtime.expectedPathHint}`,
      canRetry: !runtime.root
    })
  }

  /** 重启 Gateway（先停后启，重置重启计数） */
  async restartGateway(): Promise<EngineStatus> {
    console.warn('[OpenClaw] restartGateway: 停止现有 gateway...')
    await this.stopGateway()
    this.gatewayRestartAttempt = 0
    console.warn('[OpenClaw] restartGateway: 启动新 gateway...')
    return this.startGateway()
  }

  // ── 私有方法 ──

  private async doStartGateway(): Promise<EngineStatus> {
    this.shutdownRequested = false
    const t0 = Date.now()
    const elapsed = () => `${Date.now() - t0}ms`

    const ensured = await this.ensureReady()
    console.warn(`[OpenClaw] startGateway: ensureReady 完成 (${elapsed()})，phase=${ensured.phase}`)
    if (ensured.phase !== 'ready') {
      return ensured
    }

    // 如果已有活跃进程，检查健康状态
    if (isGatewayProcessAlive(this.gatewayProcess)) {
      const port = this.gatewayPort ?? this.readGatewayPort()
      if (port) {
        const healthy = await this.isGatewayHealthy(port)
        console.warn(`[OpenClaw] 现有进程健康检查 (${elapsed()})，healthy=${healthy}`)
        if (healthy) {
          this.setStatus({
            phase: 'ready',
            version: this.desiredVersion,
            message: `OpenClaw gateway 运行中，端口 ${port}。`,
            canRetry: false
          })
          return this.getStatus()
        }
      }
      await this.stopGatewayProcess(this.gatewayProcess)
      this.gatewayProcess = null
    }

    const runtime = this.resolveRuntimeMetadata()
    console.warn(
      `[OpenClaw] resolveRuntimeMetadata 完成 (${elapsed()})，root=${runtime.root ? '找到' : '缺失'}`
    )
    if (!runtime.root) {
      this.setStatus({
        phase: 'not_installed',
        version: null,
        message: `未找到 OpenClaw 运行时，预期路径：${runtime.expectedPathHint}`,
        canRetry: true
      })
      return this.getStatus()
    }

    const openclawEntry = this.resolveOpenClawEntry(runtime.root)
    console.warn(`[OpenClaw] resolveOpenClawEntry 完成 (${elapsed()})，entry=${openclawEntry}`)
    if (!openclawEntry) {
      this.setStatus({
        phase: 'error',
        version: runtime.version,
        message: `运行时中缺少入口文件：${runtime.root}`,
        canRetry: true
      })
      return this.getStatus()
    }

    const token = this.ensureGatewayToken()
    console.warn(`[OpenClaw] ensureGatewayToken 完成 (${elapsed()})`)
    const port = await this.resolveGatewayPort()
    console.warn(`[OpenClaw] resolveGatewayPort 完成 (${elapsed()})，port=${port}`)
    this.gatewayPort = port
    this.writeGatewayPort(port)
    this.ensureConfigFile()

    this.setStatus({
      phase: 'starting',
      version: runtime.version,
      message: '正在启动 OpenClaw gateway...',
      canRetry: false
    })

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENCLAW_HOME: this.baseDir,
      OPENCLAW_STATE_DIR: this.stateDir,
      OPENCLAW_CONFIG_PATH: this.configPath,
      OPENCLAW_GATEWAY_TOKEN: token,
      OPENCLAW_GATEWAY_PORT: String(port),
      OPENCLAW_NO_RESPAWN: '1',
      OPENCLAW_ENGINE_VERSION: runtime.version || DEFAULT_OPENCLAW_VERSION,
      OPENCLAW_SKIP_MODEL_PRICING: '1',
      OPENCLAW_DISABLE_BONJOUR: '1',
      OPENCLAW_LOG_LEVEL: 'debug'
    }

    // macOS 注入时区
    if (!env.TZ) {
      const hostTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (hostTimezone) {
        env.TZ = hostTimezone
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
    console.warn(
      `[OpenClaw] 启动 gateway: entry=${openclawEntry}, cwd=${runtime.root}, port=${port}`
    )

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
    this.gatewaySpawnedAt = Date.now()
    this.attachGatewayProcessLogs(child)
    this.attachGatewayExitHandlers(child)

    child.once('spawn', () => {
      console.warn(`[OpenClaw] gateway 进程已 spawn (${elapsed()})，pid=${child.pid}`)
    })

    const ready = await this.waitForGatewayReady(port, GATEWAY_BOOT_TIMEOUT_MS)
    console.warn(`[OpenClaw] waitForGatewayReady 返回 (${elapsed()})，ready=${ready}`)
    if (!ready) {
      this.setStatus({
        phase: 'error',
        version: runtime.version,
        message: 'OpenClaw gateway 未能在超时时间内就绪。',
        canRetry: true
      })
      this.stopGatewayProcess(child)
      return this.getStatus()
    }

    this.gatewayRestartAttempt = 0
    this.setStatus({
      phase: 'ready',
      version: runtime.version,
      message: `OpenClaw gateway 运行中，端口 ${port}。`,
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

  /** 解析 gateway 入口文件（ESM 优先，Windows 走 CJS wrapper） */
  private resolveOpenClawEntry(runtimeRoot: string): string | null {
    const esmEntry = findPath([
      path.join(runtimeRoot, 'gateway-bundle.mjs'),
      path.join(runtimeRoot, 'openclaw.mjs'),
      path.join(runtimeRoot, 'dist', 'entry.js'),
      path.join(runtimeRoot, 'dist', 'entry.mjs')
    ])
    if (!esmEntry) return null

    // Windows: utilityProcess.fork 不能直接加载 ESM，需要 CJS wrapper
    if (process.platform === 'win32') {
      return this.ensureGatewayLauncherCjs(runtimeRoot, esmEntry)
    }
    return esmEntry
  }

  /** Windows ESM 兼容：生成 CJS wrapper 文件 */
  private ensureGatewayLauncherCjs(runtimeRoot: string, esmEntry: string): string {
    const launcherPath = path.join(runtimeRoot, 'gateway-launcher.cjs')
    const esmBasename = path.basename(esmEntry)
    const content =
      `// 自动生成的 CJS wrapper — Windows ESM 兼容\n` +
      `const { pathToFileURL } = require('node:url');\n` +
      `const path = require('node:path');\n` +
      `const esmEntry = path.join(__dirname, '${esmBasename}');\n` +
      `const _keepAlive = setInterval(() => {}, 30000);\n` +
      `const url = pathToFileURL(esmEntry).href;\n` +
      `import(url).catch((err) => { process.stderr.write(String(err.stack || err)); process.exit(1); });\n`

    try {
      const existing = fs.existsSync(launcherPath) ? fs.readFileSync(launcherPath, 'utf8') : ''
      if (existing !== content) {
        fs.writeFileSync(launcherPath, content, 'utf8')
      }
    } catch {
      return esmEntry
    }
    return launcherPath
  }

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

    throw new Error('没有可用的回环端口用于 OpenClaw gateway。')
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
      console.warn(`[OpenClaw] 健康探针详情: tcp=${tcpResult}, ${httpResults.join(', ')}`)
    }
    return healthy
  }

  /** 600ms 轮询等待 gateway 就绪 */
  private waitForGatewayReady(port: number, timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now()
    let pollCount = 0

    return new Promise((resolve) => {
      const tick = async () => {
        if (this.shutdownRequested) {
          console.warn('[OpenClaw] waitForGatewayReady: 收到关闭请求，放弃等待')
          resolve(false)
          return
        }

        if (!this.gatewayProcess) {
          console.warn('[OpenClaw] waitForGatewayReady: gateway 进程已退出，放弃等待')
          resolve(false)
          return
        }

        pollCount += 1
        const elapsedMs = Date.now() - startedAt
        const verboseProbe = pollCount % 10 === 0
        const healthy = await this.isGatewayHealthy(port, verboseProbe)

        if (healthy) {
          console.warn(
            `[OpenClaw] waitForGatewayReady: gateway 就绪，耗时 ${elapsedMs}ms（${pollCount} 次轮询）`
          )
          resolve(true)
          return
        }

        if (elapsedMs >= timeoutMs) {
          console.warn(`[OpenClaw] waitForGatewayReady: 超时 ${timeoutMs}ms（${pollCount} 次轮询）`)
          resolve(false)
          return
        }

        this.setStatus({
          phase: 'starting',
          version: this.status.version,
          message: `正在启动 OpenClaw gateway...（${Math.round(elapsedMs / 1000)}s）`,
          canRetry: false
        })

        setTimeout(() => {
          void tick()
        }, 600)
      }

      void tick()
    })
  }

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

      child.once('exit', done)

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

  /** 将 gateway 进程的 stdout/stderr 追加到日志文件 */
  private attachGatewayProcessLogs(child: GatewayProcess): void {
    ensureDir(path.dirname(this.gatewayLogPath))

    const appendLog = (chunk: Buffer | string, stream: 'stdout' | 'stderr') => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString()
      const line = `[${new Date().toISOString()}] [${stream}] ${text}`
      fs.appendFile(this.gatewayLogPath, line, () => {
        /* 尽力写入 */
      })
    }

    const logMilestone = (text: string) => {
      if (!this.gatewaySpawnedAt) return
      if (/\[gateway\]/.test(text)) {
        const elapsed = Date.now() - this.gatewaySpawnedAt
        const summary = text.replace(/\n+$/g, '').split('\n')[0].trim()
        console.warn(`[OpenClaw] 启动里程碑 (${elapsed}ms): ${summary}`)
      }
    }

    child.stdout?.on('data', (chunk) => {
      appendLog(chunk, 'stdout')
      const text = typeof chunk === 'string' ? chunk : chunk.toString()
      logMilestone(text)
      console.warn(`[OpenClaw stdout] ${text}`)
    })
    child.stderr?.on('data', (chunk) => {
      appendLog(chunk, 'stderr')
      const text = typeof chunk === 'string' ? chunk : chunk.toString()
      logMilestone(text)
      console.error(`[OpenClaw stderr] ${text}`)
    })
  }

  /** 进程退出后自动重启（指数退避，最多 5 次） */
  private attachGatewayExitHandlers(child: GatewayProcess): void {
    child.once('error', (...args: unknown[]) => {
      const errorMsg =
        args[0] instanceof Error ? args[0].message : `${args[0]}${args[1] ? ` (${args[1]})` : ''}`
      console.error(`[OpenClaw] gateway 进程错误: ${errorMsg}`)
      if (this.expectedGatewayExits.has(child)) return
      if (this.shutdownRequested) return
      this.setStatus({
        phase: 'error',
        version: this.status.version,
        message: `OpenClaw gateway 进程错误: ${errorMsg}`,
        canRetry: true
      })
    })

    child.once('exit', (code) => {
      console.warn(`[OpenClaw] gateway 进程退出，code=${code}`)
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
        message: `OpenClaw gateway 意外退出（code=${code ?? 'null'}）。`,
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
      console.error(
        `[OpenClaw] 自动重启次数已达上限（${GATEWAY_MAX_RESTART_ATTEMPTS} 次），放弃重启`
      )
      this.setStatus({
        phase: 'error',
        version: this.status.version,
        message: `OpenClaw gateway 在 ${GATEWAY_MAX_RESTART_ATTEMPTS} 次尝试后仍无法启动，请检查配置或手动重启。`,
        canRetry: true
      })
      return
    }

    const delay =
      GATEWAY_RESTART_DELAYS[
        Math.min(this.gatewayRestartAttempt, GATEWAY_RESTART_DELAYS.length - 1)
      ]
    this.gatewayRestartAttempt++
    console.warn(
      `[OpenClaw] 调度重启 #${this.gatewayRestartAttempt}/${GATEWAY_MAX_RESTART_ATTEMPTS}，延迟 ${delay}ms`
    )

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
