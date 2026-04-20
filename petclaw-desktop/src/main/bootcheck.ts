import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  accessSync,
  constants,
  mkdirSync,
  createWriteStream,
  chmodSync,
  openSync
} from 'fs'
import { execFile, spawn, ChildProcess } from 'child_process'
import { get as httpsGet } from 'https'
import { randomBytes } from 'crypto'
import WebSocket from 'ws'

export interface BootStep {
  id: 'env' | 'node' | 'runtime' | 'model' | 'gateway'
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
}

const PETCLAW_HOME = join(app.getPath('home'), '.petclaw')
const NODE_BIN = join(PETCLAW_HOME, 'node', 'bin', 'node')
const PETCLAW_CLI = join(PETCLAW_HOME, 'node', 'bin', 'petclaw')
const OPENCLAW_DIR = join(PETCLAW_HOME, 'node', 'lib', 'node_modules', 'openclaw')
const OPENCLAW_JSON = join(PETCLAW_HOME, 'openclaw.json')
const SETTINGS_JSON = join(PETCLAW_HOME, 'petclaw-settings.json')

function createSteps(): BootStep[] {
  return [
    { id: 'env', label: '检测环境', status: 'pending' },
    { id: 'node', label: '准备 Node.js', status: 'pending' },
    { id: 'runtime', label: '更新 PetClaw 运行时', status: 'pending' },
    { id: 'model', label: '配置 AI 大模型', status: 'pending' },
    { id: 'gateway', label: '启动并连接服务', status: 'pending' }
  ]
}

function sendSteps(win: BrowserWindow, steps: BootStep[]): void {
  win.webContents.send('boot:step-update', steps)
}

function updateStep(
  steps: BootStep[],
  id: string,
  status: BootStep['status'],
  error?: string
): void {
  const step = steps.find((s) => s.id === id)
  if (step) {
    step.status = status
    if (error) step.error = error
  }
}

/** Step 1: 检测环境 */
async function checkEnv(): Promise<void> {
  const platform = process.platform
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error(`不支持的操作系统: ${platform}`)
  }
}

const NODE_VERSION = 'v22.14.0'

/** Download a file from URL, following redirects */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string): void => {
      httpsGet(u, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          follow(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`下载失败: HTTP ${res.statusCode}`))
          return
        }
        const file = createWriteStream(destPath)
        res.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
        file.on('error', reject)
      }).on('error', reject)
    }
    follow(url)
  })
}

/** Extract .tar.gz to destination directory (strip 2 levels for nodejs.org format: ./node-vXX/bin → bin) */
function extractTarGz(tarPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tar', ['xzf', tarPath, '-C', destDir, '--strip-components=2'], (err) => {
      if (err) reject(new Error(`解压失败: ${err.message}`))
      else resolve()
    })
  })
}

/** Extract .tar.gz preserving directory structure */
function extractTarGzNoStrip(tarPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tar', ['xzf', tarPath, '-C', destDir], (err) => {
      if (err) reject(new Error(`解压失败: ${err.message}`))
      else resolve()
    })
  })
}

/** Step 2: 检查 Node.js，不存在则从 app 自带资源解压或提示 */
async function checkNode(): Promise<void> {
  if (existsSync(NODE_BIN)) {
    try {
      accessSync(NODE_BIN, constants.X_OK)
    } catch {
      throw new Error(`Node.js 不可执行: ${NODE_BIN}`)
    }
    return new Promise((resolve, reject) => {
      execFile(NODE_BIN, ['--version'], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          reject(new Error(`Node.js 版本检测失败: ${err.message}`))
          return
        }
        const version = stdout.trim()
        const major = parseInt(version.replace('v', '').split('.')[0], 10)
        if (major < 22) {
          reject(new Error(`Node.js 版本过低: ${version}，需要 v22+`))
          return
        }
        resolve()
      })
    })
  }

  // Try extracting from app-bundled resource (production build)
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const bundledTar = join(app.getAppPath(), 'resources', 'node', `darwin-${arch}.tar.gz`)
  const unpackedTar = join(
    app.getAppPath() + '.unpacked',
    'resources',
    'node',
    `darwin-${arch}.tar.gz`
  )

  const tarPath = [bundledTar, unpackedTar].find((p) => existsSync(p))

  const nodeDir = join(PETCLAW_HOME, 'node')
  mkdirSync(nodeDir, { recursive: true })

  if (tarPath) {
    await extractTarGz(tarPath, nodeDir)
  } else {
    // Dev fallback: download from nodejs.org
    const platform = process.platform === 'darwin' ? 'darwin' : 'win'
    const filename = `node-${NODE_VERSION}-${platform}-${arch}.tar.gz`
    const url = `https://nodejs.org/dist/${NODE_VERSION}/${filename}`
    const tmpFile = join(app.getPath('temp'), filename)
    await downloadFile(url, tmpFile)
    await extractTarGz(tmpFile, nodeDir)
  }

  if (!existsSync(NODE_BIN)) {
    throw new Error('Node.js 安装后未找到 node 二进制')
  }
  chmodSync(NODE_BIN, 0o755)
}

/** Step 3: 检查 Openclaw 运行时，不存在则从 app 资源解压或 npm 安装 */
async function checkRuntime(): Promise<void> {
  // Check if already installed
  if (existsSync(join(OPENCLAW_DIR, 'openclaw.mjs')) || existsSync(join(OPENCLAW_DIR, 'dist'))) {
    return
  }

  // Try extracting from app-bundled resource (production build)
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const bundledTar = join(app.getAppPath(), 'resources', 'openclaw', `darwin-${arch}.tar.gz`)
  const unpackedTar = join(
    app.getAppPath() + '.unpacked',
    'resources',
    'openclaw',
    `darwin-${arch}.tar.gz`
  )

  const tarPath = [bundledTar, unpackedTar].find((p) => existsSync(p))

  if (tarPath) {
    // tar.gz contains node_modules/ dir, extract to ~/.petclaw/node/lib/
    const libDir = join(PETCLAW_HOME, 'node', 'lib')
    mkdirSync(libDir, { recursive: true })
    await extractTarGzNoStrip(tarPath, libDir)
    return
  }

  // Dev fallback: npm install -g openclaw
  const npmBin = join(PETCLAW_HOME, 'node', 'bin', 'npm')
  if (!existsSync(npmBin)) {
    throw new Error('npm 不存在，Node.js 安装可能不完整')
  }

  return new Promise((resolve, reject) => {
    execFile(
      NODE_BIN,
      [npmBin, 'install', '-g', 'openclaw'],
      {
        timeout: 180_000,
        env: {
          ...process.env,
          PATH: join(PETCLAW_HOME, 'node', 'bin') + ':' + (process.env.PATH ?? ''),
          HOME: app.getPath('home')
        }
      },
      (err) => {
        if (err) {
          reject(new Error(`Openclaw 安装失败: ${err.message}`))
          return
        }
        resolve()
      }
    )
  })
}

/** Generate a unique device ID */
function generateDeviceId(): string {
  return randomBytes(32).toString('hex')
}

/** Step 4: 检查大模型配置，不存在则生成完整默认配置 */
async function checkModelConfig(): Promise<{ gatewayPort: number; gatewayToken: string }> {
  let port = 29890
  let token = ''

  // Ensure petclaw CLI script exists
  ensurePetclawCli()

  // Ensure directories
  mkdirSync(join(PETCLAW_HOME, 'workspace'), { recursive: true })
  mkdirSync(join(PETCLAW_HOME, 'agents', 'main', 'agent'), { recursive: true })
  mkdirSync(join(PETCLAW_HOME, 'agents', 'main', 'sessions'), { recursive: true })
  mkdirSync(join(PETCLAW_HOME, 'logs'), { recursive: true })

  // Read existing settings if any
  if (existsSync(SETTINGS_JSON)) {
    try {
      const settings = JSON.parse(readFileSync(SETTINGS_JSON, 'utf-8'))
      if (settings.gatewayPort) port = settings.gatewayPort
      if (settings.gatewayToken) token = settings.gatewayToken
    } catch {
      // corrupt, will regenerate
    }
  }

  if (!token) {
    token = 'petclaw-gw-' + Math.random().toString(36).slice(2, 26)
  }

  // ── openclaw.json ──
  if (!existsSync(OPENCLAW_JSON)) {
    const config = {
      models: {
        mode: 'merge',
        providers: {
          llm: {
            baseUrl: 'https://petclaw.ai/api/v1',
            apiKey: '',
            api: 'openai-completions',
            models: [
              {
                id: 'petclaw-fast',
                name: 'petclaw-fast',
                reasoning: false,
                input: ['text', 'image'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 200000,
                maxTokens: 65536,
                compat: { supportsDeveloperRole: false }
              }
            ]
          }
        }
      },
      agents: {
        defaults: {
          workspace: join(PETCLAW_HOME, 'workspace'),
          model: { primary: 'llm/petclaw-fast' },
          compaction: { memoryFlush: { enabled: false } }
        }
      },
      hooks: {
        internal: {
          entries: { 'session-memory': { enabled: false } }
        }
      },
      gateway: {
        mode: 'local',
        auth: { mode: 'token', token },
        remote: { token },
        bind: 'loopback',
        port
      }
    }
    writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2))
  } else {
    // Validate existing config
    try {
      const config = JSON.parse(readFileSync(OPENCLAW_JSON, 'utf-8'))
      if (!config.models?.providers?.llm) {
        throw new Error('openclaw.json 中缺少 LLM provider 配置')
      }
      // Ensure gateway port matches
      if (config.gateway) {
        port = config.gateway.port ?? port
        token = config.gateway.auth?.token ?? token
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`openclaw.json 格式错误: ${err.message}`)
      }
      throw err
    }
  }

  // ── petclaw-settings.json ──
  if (!existsSync(SETTINGS_JSON)) {
    const settings = {
      language: 'zh',
      brainApiUrl: 'https://petclaw.ai/api/v1',
      brainModel: 'petclaw-fast',
      brainApiKey: '',
      runtimeMode: 'chat',
      region: 'china',
      gatewayPort: port,
      gatewayUrl: `ws://127.0.0.1:${port}`,
      gatewayToken: token,
      deviceId: generateDeviceId(),
      userEmail: '',
      userToken: '',
      inviteCode: '',
      theme: 'light',
      voiceShortcut: ['Meta', 'd'],
      voiceInputDevice: 'default',
      sopComplete: false,
      onboardingComplete: false,
      lastLaunchedVersion: app.getVersion(),
      userCredits: 0,
      modelTier: 'free',
      membershipTier: 'free',
      autoLaunchExplicitlySet: false
    }
    writeFileSync(SETTINGS_JSON, JSON.stringify(settings, null, 2))
  } else {
    // Update lastLaunchedVersion on every startup
    try {
      const settings = JSON.parse(readFileSync(SETTINGS_JSON, 'utf-8'))
      settings.lastLaunchedVersion = app.getVersion()
      if (!settings.deviceId) settings.deviceId = generateDeviceId()
      if (!settings.runtimeMode) settings.runtimeMode = 'chat'
      if (!settings.voiceShortcut) settings.voiceShortcut = ['Meta', 'd']
      if (!settings.voiceInputDevice) settings.voiceInputDevice = 'default'
      writeFileSync(SETTINGS_JSON, JSON.stringify(settings, null, 2))
      port = settings.gatewayPort ?? port
      token = settings.gatewayToken ?? token
    } catch {
      // corrupt, keep defaults
    }
  }

  return { gatewayPort: port, gatewayToken: token }
}

/** Generate petclaw CLI shell script */
function ensurePetclawCli(): void {
  if (existsSync(PETCLAW_CLI)) return

  const script = `#!/bin/sh
export OPENCLAW_HOME="${PETCLAW_HOME}"
export OPENCLAW_STATE_DIR="${PETCLAW_HOME}"
export OPENCLAW_CONFIG_PATH="${OPENCLAW_JSON}"
export OPENCLAW_WORKSPACE_DIR="${join(PETCLAW_HOME, 'workspace')}"
export OPENCLAW_AGENT_DIR="${join(PETCLAW_HOME, 'agents', 'main', 'agent')}"
exec "${NODE_BIN}" "${join(OPENCLAW_DIR, 'openclaw.mjs')}" "$@"
`
  mkdirSync(join(PETCLAW_HOME, 'node', 'bin'), { recursive: true })
  writeFileSync(PETCLAW_CLI, script, { mode: 0o755 })
}

/** Step 5: 确保 Gateway 运行并连接 */
async function startAndConnect(
  port: number,
  token: string
): Promise<{ gatewayUrl: string; gatewayProcess: ChildProcess | null }> {
  // Try connecting to already-running gateway
  const url = `ws://127.0.0.1:${port}`
  const connected = await tryConnect(url, token)
  if (connected) {
    return { gatewayUrl: url, gatewayProcess: null }
  }

  // No running gateway found — start one
  if (!existsSync(PETCLAW_CLI)) {
    throw new Error(`PetClaw CLI 不存在: ${PETCLAW_CLI}`)
  }

  const logsDir = join(PETCLAW_HOME, 'logs')
  mkdirSync(logsDir, { recursive: true })
  const logFd = openSync(join(logsDir, 'petclaw-gateway.log'), 'a')

  const gatewayProcess = spawn(PETCLAW_CLI, ['gateway', 'run'], {
    stdio: ['ignore', logFd, logFd],
    detached: true,
    env: {
      ...process.env,
      OPENCLAW_HOME: PETCLAW_HOME,
      OPENCLAW_STATE_DIR: PETCLAW_HOME,
      OPENCLAW_CONFIG_PATH: OPENCLAW_JSON,
      OPENCLAW_WORKSPACE_DIR: join(PETCLAW_HOME, 'workspace'),
      OPENCLAW_AGENT_DIR: join(PETCLAW_HOME, 'agents', 'main', 'agent')
    }
  })
  gatewayProcess.unref()

  // Wait for gateway to be ready (poll up to 15s)
  const maxWait = 15_000
  const interval = 500
  const startTime = Date.now()

  while (Date.now() - startTime < maxWait) {
    const ready = await tryConnect(url, token)
    if (ready) {
      return { gatewayUrl: url, gatewayProcess }
    }
    await new Promise((r) => setTimeout(r, interval))
  }

  throw new Error(`Gateway 启动超时（${maxWait / 1000}s），无法连接 ${url}`)
}

function tryConnect(url: string, _token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.close()
      resolve(false)
    }, 2000)

    const ws = new WebSocket(url)
    ws.on('open', () => {
      clearTimeout(timeout)
      ws.close()
      resolve(true)
    })
    ws.on('error', () => {
      clearTimeout(timeout)
      resolve(false)
    })
  })
}

/** Run all 5 boot check steps */
export async function runBootCheck(petWindow: BrowserWindow): Promise<{
  success: boolean
  gatewayUrl?: string
  gatewayPort?: number
  gatewayToken?: string
  gatewayProcess?: ChildProcess | null
}> {
  const steps = createSteps()
  sendSteps(petWindow, steps)

  // Step 1: 检测环境
  updateStep(steps, 'env', 'running')
  sendSteps(petWindow, steps)
  try {
    await checkEnv()
    updateStep(steps, 'env', 'done')
  } catch (err) {
    console.error('[BootCheck] Step 1 ❌', (err as Error).message)
    updateStep(steps, 'env', 'error', (err as Error).message)
    sendSteps(petWindow, steps)
    return { success: false }
  }
  sendSteps(petWindow, steps)

  // Step 2: 准备 Node.js
  updateStep(steps, 'node', 'running')
  sendSteps(petWindow, steps)
  try {
    await checkNode()
    updateStep(steps, 'node', 'done')
  } catch (err) {
    updateStep(steps, 'node', 'error', (err as Error).message)
    sendSteps(petWindow, steps)
    return { success: false }
  }
  sendSteps(petWindow, steps)

  // Step 3: 更新运行时
  updateStep(steps, 'runtime', 'running')
  sendSteps(petWindow, steps)
  try {
    await checkRuntime()
    updateStep(steps, 'runtime', 'done')
  } catch (err) {
    updateStep(steps, 'runtime', 'error', (err as Error).message)
    sendSteps(petWindow, steps)
    return { success: false }
  }
  sendSteps(petWindow, steps)

  // Step 4: 配置大模型
  updateStep(steps, 'model', 'running')
  sendSteps(petWindow, steps)
  let gatewayPort: number
  let gatewayToken: string
  try {
    const config = await checkModelConfig()
    gatewayPort = config.gatewayPort
    gatewayToken = config.gatewayToken
    updateStep(steps, 'model', 'done')
  } catch (err) {
    updateStep(steps, 'model', 'error', (err as Error).message)
    sendSteps(petWindow, steps)
    return { success: false }
  }
  sendSteps(petWindow, steps)

  // Step 5: 启动并连接服务
  updateStep(steps, 'gateway', 'running')
  sendSteps(petWindow, steps)
  try {
    const result = await startAndConnect(gatewayPort, gatewayToken)
    updateStep(steps, 'gateway', 'done')
    sendSteps(petWindow, steps)
    return {
      success: true,
      gatewayUrl: result.gatewayUrl,
      gatewayPort,
      gatewayToken,
      gatewayProcess: result.gatewayProcess
    }
  } catch (err) {
    updateStep(steps, 'gateway', 'error', (err as Error).message)
    sendSteps(petWindow, steps)
    return { success: false }
  }
}

export { PETCLAW_HOME }
