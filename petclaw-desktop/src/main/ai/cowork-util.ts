// cowork-util.ts：环境变量构造和工具函数
// 负责构建 OpenClaw 引擎所需的完整进程环境，包括 PATH 解析、node shim、
// git-bash 检测（Windows）、系统代理注入等。

import { execSync, spawnSync } from 'child_process'
import { app } from 'electron'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'fs'
import { delimiter, dirname, join } from 'path'

import { buildEnvForConfig, getCurrentApiConfig, resolveRawApiConfig } from './claude-settings'
import {
  buildAnthropicMessagesUrl,
  buildGeminiGenerateContentUrl,
  CoworkModelProtocol,
  extractApiErrorSnippet,
  extractTextFromAnthropicResponse,
  extractTextFromGeminiResponse
} from './cowork-model-api'
import type { OpenAICompatProxyTarget } from './cowork-openai-compat-proxy'
import { appendPythonRuntimeToEnv } from './python-runtime'
import { isSystemProxyEnabled, resolveSystemProxyUrlForTargets } from './system-proxy'
import { getLogger } from '../logging/facade'
import { resolveUserDataPaths } from '../user-data-paths'

const logger = getLogger('CoworkUtil', 'cowork')

function appendEnvPath(current: string | undefined, additions: string[]): string | undefined {
  const items = new Set<string>()

  for (const entry of additions) {
    if (entry) {
      items.add(entry)
    }
  }

  if (current) {
    for (const entry of current.split(delimiter)) {
      if (entry) {
        items.add(entry)
      }
    }
  }

  return items.size > 0 ? Array.from(items).join(delimiter) : current
}

function hasCommandInEnv(command: string, env: Record<string, string | undefined>): boolean {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    const result = spawnSync(whichCmd, [command], {
      env: { ...env } as NodeJS.ProcessEnv,
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: process.platform === 'win32'
    })
    return result.status === 0
  } catch {
    return false
  }
}

let cachedElectronNodeRuntimePath: string | null = null

function resolveElectronNodeRuntimePath(): string {
  if (!app.isPackaged || process.platform !== 'darwin') {
    return process.execPath
  }

  try {
    const appName = app.getName()
    const frameworksDir = join(process.resourcesPath, '..', 'Frameworks')
    if (!existsSync(frameworksDir)) {
      return process.execPath
    }

    const helperApps = readdirSync(frameworksDir)
      .filter((entry) => entry.startsWith(`${appName} Helper`) && entry.endsWith('.app'))
      .sort((a, b) => {
        const score = (name: string): number => {
          if (name === `${appName} Helper.app`) return 0
          if (name === `${appName} Helper (Renderer).app`) return 1
          if (name === `${appName} Helper (Plugin).app`) return 2
          if (name === `${appName} Helper (GPU).app`) return 3
          return 10
        }
        return score(a) - score(b)
      })

    for (const helperApp of helperApps) {
      const helperExeName = helperApp.replace(/\.app$/, '')
      const helperExePath = join(frameworksDir, helperApp, 'Contents', 'MacOS', helperExeName)
      if (existsSync(helperExePath)) {
        logger.info('electronNodeRuntime.resolved', 'Electron helper runtime was resolved', {
          helperExePath
        })
        return helperExePath
      }
    }
  } catch (error) {
    logger.warn('electronNodeRuntime.resolve.failed', 'Failed to resolve Electron helper runtime', {
      errorMessage: error instanceof Error ? error.message : String(error)
    })
  }

  return process.execPath
}

export function getElectronNodeRuntimePath(): string {
  if (!cachedElectronNodeRuntimePath) {
    cachedElectronNodeRuntimePath = resolveElectronNodeRuntimePath()
  }
  return cachedElectronNodeRuntimePath
}

/**
 * 用户登录 shell 的 PATH 缓存。
 *
 * 解析 shell PATH 需要启动一次用户 shell，成本较高且可能触发用户 profile 中的脚本。
 * 这里缓存第一次解析结果，后续构造 Cowork 子进程环境时直接复用，避免反复启动 shell。
 */
let cachedUserShellPath: string | null | undefined

/**
 * 解析 macOS/Linux 用户登录 shell 中真实可用的 PATH。
 *
 * macOS 上从 Finder/Dock 启动的打包版 Electron 不会继承用户终端里的 shell profile。
 * 如果直接使用 `process.env.PATH`，用户通过 Homebrew、nvm、Volta 等安装的 node/npm
 * 或其他命令行工具可能不可见，导致 Cowork 执行工具时找不到命令。
 *
 * 因此这里显式启动一次登录 shell，读取用户 shell 初始化后的 PATH，再注入给子进程。
 */
function resolveUserShellPath(): string | null {
  if (cachedUserShellPath !== undefined) return cachedUserShellPath

  if (process.platform === 'win32') {
    cachedUserShellPath = null
    return null
  }

  try {
    const shell = process.env.SHELL || '/bin/bash'
    // 优先使用非交互式登录 shell，避免交互式启动脚本弹 GUI、阻塞或产生额外副作用。
    const pathProbes = [`${shell} -lc 'echo __PATH__=$PATH'`]

    let resolved: string | null = null
    for (const probe of pathProbes) {
      try {
        const result = execSync(probe, {
          encoding: 'utf-8',
          timeout: 5000,
          env: { ...process.env }
        })
        const match = result.match(/__PATH__=(.+)/)
        if (match?.[1]) {
          resolved = match[1].trim()
          break
        }
      } catch {
        // 当前探测失败时继续尝试下一个策略；这里保持静默，由最终 fallback 兜底。
      }
    }
    cachedUserShellPath = resolved
  } catch (error) {
    logger.warn('shellPath.resolve.failed', 'Failed to resolve user shell PATH', error)
    cachedUserShellPath = null
  }

  return cachedUserShellPath
}

/**
 * Windows 注册表 PATH 缓存。
 *
 * 注册表读取只需要做一次：同一次 App 生命周期内 PATH 不应频繁变化，缓存可以减少
 * Cowork 会话启动时的同步命令开销。
 */
let cachedWindowsRegistryPath: string | null | undefined

function readWindowsRegistryPathValue(registryKey: string): string {
  try {
    const output = execSync(`reg query "${registryKey}" /v Path`, {
      encoding: 'utf-8',
      timeout: 8000,
      windowsHide: true
    })

    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^\s*Path\s+REG_\w+\s+(.+)$/i)
      if (match?.[1]) {
        return match[1].trim()
      }
    }
  } catch {
    // 注册表键不存在或权限不足都不应阻断启动，缺失值由调用方按空字符串处理。
  }

  return ''
}

/**
 * 从 Windows 注册表读取最新的 Machine PATH + User PATH。
 *
 * 打包版 Electron 从开始菜单、桌面快捷方式或 Explorer 启动时，继承的是 Explorer
 * 进程启动那一刻的 PATH。如果用户之后安装了 Python、Node.js、npm、pip 等工具，
 * 但没有重启 Explorer，那么 `process.env.PATH` 仍是旧值。
 *
 * 这会造成一个典型问题：用户在新开的终端里能运行 `python` / `npm`，但 Cowork
 * 会话里找不到，因为终端读取了最新注册表，而 Electron 继承的是过期环境。
 *
 * 这里直接读注册表的 Machine/User PATH，得到和新终端更接近的最新值，再并入
 * Cowork 子进程环境。
 */
function resolveWindowsRegistryPath(): string | null {
  if (cachedWindowsRegistryPath !== undefined) return cachedWindowsRegistryPath

  if (process.platform !== 'win32') {
    cachedWindowsRegistryPath = null
    return null
  }

  try {
    const machinePath = readWindowsRegistryPathValue(
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
    )
    const userPath = readWindowsRegistryPathValue('HKCU\\Environment')
    const registryPath = [machinePath, userPath].filter(Boolean).join(';')
    if (registryPath.trim()) {
      // 去掉空项并保持去重，避免 PATH 过长或重复项影响命令解析顺序。
      const entries = registryPath
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
      const unique = Array.from(new Set(entries))
      cachedWindowsRegistryPath = unique.join(';')
      logger.info('windowsRegistryPath.resolved', 'Windows registry PATH was resolved', {
        pathEntryCount: unique.length
      })
    } else {
      cachedWindowsRegistryPath = null
    }
  } catch (error) {
    logger.warn('windowsRegistryPath.resolve.failed', 'Failed to read PATH from Windows registry', {
      errorMessage: error instanceof Error ? error.message : String(error)
    })
    cachedWindowsRegistryPath = null
  }

  return cachedWindowsRegistryPath
}

/**
 * 将 Windows 注册表中的最新 PATH 项补充到当前环境。
 *
 * 当前环境中可能已经有 PetClaw 自己注入的 Git 工具链、node shim 或其它覆盖项，
 * 这些项必须优先于用户注册表 PATH。因此这里只追加当前 PATH 缺失的注册表项，
 * 且追加在末尾，既补齐用户安装的 Python/Node/npm/pip，又不破坏前面已有优先级。
 */
function ensureWindowsRegistryPathEntries(env: Record<string, string | undefined>): void {
  const registryPath = resolveWindowsRegistryPath()
  if (!registryPath) return

  const currentPath = env.PATH || ''
  const currentEntriesLower = new Set(
    currentPath.split(delimiter).map((entry) => entry.toLowerCase().replace(/\\$/, ''))
  )

  const missingEntries: string[] = []
  for (const entry of registryPath.split(';')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    // 比较时去掉末尾反斜杠，避免 `C:\Foo` 与 `C:\Foo\` 被当成两个目录。
    const normalizedLower = trimmed.toLowerCase().replace(/\\$/, '')
    if (!currentEntriesLower.has(normalizedLower)) {
      missingEntries.push(trimmed)
      currentEntriesLower.add(normalizedLower) // 同批注册表项内部也要去重，避免重复追加。
    }
  }

  if (missingEntries.length > 0) {
    // 追加到末尾，确保前面已经注入的 Git、shim 等覆盖项仍然优先。
    env.PATH = currentPath
      ? `${currentPath}${delimiter}${missingEntries.join(delimiter)}`
      : missingEntries.join(delimiter)
    logger.info(
      'windowsRegistryPathEntries.injected',
      'Windows registry PATH entries were injected',
      {
        missingEntryCount: missingEntries.length,
        missingEntries
      }
    )
  }
}

/**
 * Windows git-bash 路径缓存。
 *
 * git-bash 探测会检查多个候选路径并执行健康检查，成本相对高；缓存后可避免每次
 * 构造环境都重复扫描注册表、PATH 和常见安装目录。
 */
let cachedGitBashPath: string | null | undefined
let cachedGitBashResolutionError: string | null | undefined

function normalizeWindowsPath(input: string | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim().replace(/\r/g, '')
  if (!trimmed) return null

  const unquoted = trimmed.replace(/^["']+|["']+$/g, '')
  if (!unquoted) return null

  return unquoted.replace(/\//g, '\\')
}

function listWindowsCommandPaths(command: string): string[] {
  try {
    const output = execSync(command, { encoding: 'utf-8', timeout: 5000 })
    const parsed = output
      .split(/\r?\n/)
      .map((line) => normalizeWindowsPath(line))
      .filter((line): line is string => Boolean(line && existsSync(line)))
    return Array.from(new Set(parsed))
  } catch {
    return []
  }
}

function listGitInstallPathsFromRegistry(): string[] {
  const registryKeys = [
    'HKCU\\Software\\GitForWindows',
    'HKLM\\Software\\GitForWindows',
    'HKLM\\Software\\WOW6432Node\\GitForWindows'
  ]

  const installRoots: string[] = []

  for (const key of registryKeys) {
    try {
      const output = execSync(`reg query "${key}" /v InstallPath`, {
        encoding: 'utf-8',
        timeout: 5000
      })
      for (const line of output.split(/\r?\n/)) {
        const match = line.match(/InstallPath\s+REG_\w+\s+(.+)$/i)
        const root = normalizeWindowsPath(match?.[1])
        if (root) {
          installRoots.push(root)
        }
      }
    } catch {
      // 某些机器没有安装 Git 或对应注册表键不存在，跳过即可。
    }
  }

  return Array.from(new Set(installRoots))
}

function getBundledGitBashCandidates(): string[] {
  const bundledRoots = app.isPackaged
    ? [join(process.resourcesPath, 'mingit')]
    : [
        join(__dirname, '..', '..', 'resources', 'mingit'),
        join(process.cwd(), 'resources', 'mingit')
      ]

  const candidates: string[] = []
  for (const root of bundledRoots) {
    // Windows 下优先使用 bin/bash.exe；直接调用 usr/bin/bash.exe 可能缺少 Git 工具链 PATH。
    candidates.push(join(root, 'bin', 'bash.exe'))
    candidates.push(join(root, 'usr', 'bin', 'bash.exe'))
  }

  return candidates
}

function checkWindowsGitBashHealth(bashPath: string): { ok: boolean; reason?: string } {
  try {
    if (!existsSync(bashPath)) {
      return { ok: false, reason: 'path does not exist' }
    }

    // 健康检查只传最小环境，避免 BASH_ENV、MSYS2_PATH_TYPE 等变量影响启动速度或行为。
    // SYSTEMROOT 对 Windows DLL 加载是必要的，HOME 则避免部分 Git Bash 初始化脚本报错。
    const healthEnv: Record<string, string> = {
      PATH: process.env.PATH || '',
      SYSTEMROOT: process.env.SYSTEMROOT || process.env.SystemRoot || 'C:\\Windows',
      HOME: process.env.HOME || process.env.USERPROFILE || ''
    }

    // 先用非登录 shell，避免读取 /etc/profile 带来的慢启动。
    // cygpath 通常是独立二进制，不需要登录 shell 初始化即可运行。
    const fastResult = spawnSync(bashPath, ['-c', 'cygpath -u "C:\\\\Windows"'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
      env: healthEnv
    })

    const result =
      fastResult.error || (typeof fastResult.status === 'number' && fastResult.status !== 0)
        ? // 非登录 shell 失败时再退回登录 shell，并给更长超时时间。
          // 部分 Git Bash 发行版需要 /etc/profile 初始化 PATH 后才能找到 cygpath。
          spawnSync(bashPath, ['-lc', 'cygpath -u "C:\\\\Windows"'], {
            encoding: 'utf-8',
            timeout: 15000,
            windowsHide: true,
            env: healthEnv
          })
        : fastResult

    if (result.error) {
      return { ok: false, reason: result.error.message }
    }

    if (typeof result.status === 'number' && result.status !== 0) {
      const stderr = (result.stderr || '').trim()
      const stdout = (result.stdout || '').trim()
      return {
        ok: false,
        reason: `exit ${result.status}${stderr ? `, stderr: ${stderr}` : ''}${stdout ? `, stdout: ${stdout}` : ''}`
      }
    }

    const stdout = (result.stdout || '').trim()
    const stderr = (result.stderr || '').trim()
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const lastNonEmptyLine = lines.length > 0 ? lines[lines.length - 1] : ''

    // 某些 Git Bash 会先打印运行时警告，再输出真正的 cygpath 结果。
    // 只要最后一个非空行是合法 POSIX 路径，就认为 bash 可用。
    if (!/^\/[a-zA-Z]\//.test(lastNonEmptyLine)) {
      const diagnosticStdout = truncateDiagnostic(stdout || '(empty)')
      const diagnosticStderr = stderr ? `, stderr: ${truncateDiagnostic(stderr)}` : ''
      return {
        ok: false,
        reason: `unexpected cygpath output: ${diagnosticStdout}${diagnosticStderr}`
      }
    }

    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

function truncateDiagnostic(message: string, maxLength = 500): string {
  if (message.length <= maxLength) return message
  return `${message.slice(0, maxLength - 3)}...`
}

function getWindowsGitToolDirs(bashPath: string): string[] {
  const normalized = bashPath.replace(/\//g, '\\')
  const lower = normalized.toLowerCase()
  let gitRoot: string | null = null

  if (lower.endsWith('\\usr\\bin\\bash.exe')) {
    gitRoot = normalized.slice(0, -'\\usr\\bin\\bash.exe'.length)
  } else if (lower.endsWith('\\bin\\bash.exe')) {
    gitRoot = normalized.slice(0, -'\\bin\\bash.exe'.length)
  }

  if (!gitRoot) {
    const bashDir = dirname(normalized)
    return [bashDir].filter((dir) => existsSync(dir))
  }

  const candidates = [
    join(gitRoot, 'cmd'),
    join(gitRoot, 'mingw64', 'bin'),
    join(gitRoot, 'usr', 'bin'),
    join(gitRoot, 'bin')
  ]

  return candidates.filter((dir) => existsSync(dir))
}

export function ensureElectronNodeShim(electronPath: string, npmBinDir?: string): string | null {
  try {
    const shimDir = resolveUserDataPaths(app.getPath('userData')).coworkShimBin
    mkdirSync(shimDir, { recursive: true })
    logger.info('nodeShim.directory.resolved', 'Electron Node shim directory was resolved', {
      shimDir,
      electronPath,
      npmBinDir
    })

    // --- node shim ---
    // 生成 bash 版本的 node 包装器，供 macOS/Linux 以及 Windows git-bash 使用。
    // 通过 ELECTRON_RUN_AS_NODE=1 让 Electron 可执行文件临时表现为 Node.js。
    const nodeSh = join(shimDir, 'node')
    const nodeShContent = [
      '#!/usr/bin/env bash',
      'if [ -z "${PETCLAW_ELECTRON_PATH:-}" ]; then',
      '  echo "PETCLAW_ELECTRON_PATH is not set" >&2',
      '  exit 127',
      'fi',
      'exec env ELECTRON_RUN_AS_NODE=1 "${PETCLAW_ELECTRON_PATH}" "$@"',
      ''
    ].join('\n')

    writeFileSync(nodeSh, nodeShContent, 'utf8')
    try {
      chmodSync(nodeSh, 0o755)
    } catch {
      // 某些文件系统不支持 POSIX 权限位，写入成功即可，不因 chmod 失败中断。
    }
    logger.info('nodeShim.node.generated', 'Node bash shim was generated', { shimPath: nodeSh })

    // Windows cmd 包装器只在 Windows 原生命令环境中需要。
    if (process.platform === 'win32') {
      const nodeCmd = join(shimDir, 'node.cmd')
      const nodeCmdContent = [
        '@echo off',
        'if "%PETCLAW_ELECTRON_PATH%"=="" (',
        '  echo PETCLAW_ELECTRON_PATH is not set 1>&2',
        '  exit /b 127',
        ')',
        'set ELECTRON_RUN_AS_NODE=1',
        '"%PETCLAW_ELECTRON_PATH%" %*',
        ''
      ].join('\r\n')
      writeFileSync(nodeCmd, nodeCmdContent, 'utf8')
      logger.info('nodeShim.nodeCmd.generated', 'Node command shim was generated', {
        shimPath: nodeCmd
      })
    }

    // --- npx / npm shims ---
    // npx/npm 不直接依赖 node_modules/.bin 中的符号链接；跨平台打包时这些链接在
    // Windows 上并不可靠。这里显式指向随应用打包的 npm cli 文件，并通过上面的
    // node shim 执行，确保打包版没有系统 Node.js 时也能运行 npm/npx。
    if (npmBinDir && existsSync(npmBinDir)) {
      const npxCliJs = join(npmBinDir, 'npx-cli.js')
      const npmCliJs = join(npmBinDir, 'npm-cli.js')

      // bash 脚本在 Windows git-bash 下执行时需要 POSIX 风格路径。
      const npxCliJsPosix = npxCliJs.replace(/\\/g, '/')
      const npmCliJsPosix = npmCliJs.replace(/\\/g, '/')

      logger.info('nodeShim.npmBin.resolved', 'Node shim npm bin directory was resolved', {
        npmBinDir,
        hasNpxCli: existsSync(npxCliJs),
        hasNpmCli: existsSync(npmCliJs)
      })

      if (existsSync(npxCliJs)) {
        // npx 的 bash 包装器，供 POSIX shell / git-bash 路径解析使用。
        const npxSh = join(shimDir, 'npx')
        const npxShContent = [
          '#!/usr/bin/env bash',
          'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
          `exec "$SCRIPT_DIR/node" "${npxCliJsPosix}" "$@"`,
          ''
        ].join('\n')
        writeFileSync(npxSh, npxShContent, 'utf8')
        try {
          chmodSync(npxSh, 0o755)
        } catch {
          /* 忽略不支持 POSIX 权限位的文件系统 */
        }
        logger.info('nodeShim.npx.generated', 'Npx bash shim was generated', {
          shimPath: npxSh,
          cliPath: npxCliJsPosix
        })

        // Windows .cmd 版本通过环境变量引用 npm bin 目录，避免把可能含中文的路径
        // 直接写进批处理文件；GBK code page 下硬编码非 ASCII 路径容易被 cmd.exe 误解。
        if (process.platform === 'win32') {
          const npxCmd = join(shimDir, 'npx.cmd')
          const npxCmdContent = [
            '@echo off',
            '"%~dp0node.cmd" "%PETCLAW_NPM_BIN_DIR%\\npx-cli.js" %*',
            ''
          ].join('\r\n')
          writeFileSync(npxCmd, npxCmdContent, 'utf8')
          logger.info('nodeShim.npxCmd.generated', 'Npx command shim was generated', {
            shimPath: npxCmd,
            cliEnvVar: 'PETCLAW_NPM_BIN_DIR'
          })
        }
      } else {
        logger.warn('nodeShim.npxCli.missing', 'Npx CLI file was missing', { cliPath: npxCliJs })
      }

      if (existsSync(npmCliJs)) {
        // npm 的 bash 包装器，逻辑与 npx 保持一致。
        const npmSh = join(shimDir, 'npm')
        const npmShContent = [
          '#!/usr/bin/env bash',
          'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
          `exec "$SCRIPT_DIR/node" "${npmCliJsPosix}" "$@"`,
          ''
        ].join('\n')
        writeFileSync(npmSh, npmShContent, 'utf8')
        try {
          chmodSync(npmSh, 0o755)
        } catch {
          /* 忽略不支持 POSIX 权限位的文件系统 */
        }
        logger.info('nodeShim.npm.generated', 'Npm bash shim was generated', {
          shimPath: npmSh,
          cliPath: npmCliJsPosix
        })

        // Windows .cmd 版本同样通过环境变量引用 npm bin 目录，避免非 ASCII 路径编码问题。
        if (process.platform === 'win32') {
          const npmCmd = join(shimDir, 'npm.cmd')
          const npmCmdContent = [
            '@echo off',
            '"%~dp0node.cmd" "%PETCLAW_NPM_BIN_DIR%\\npm-cli.js" %*',
            ''
          ].join('\r\n')
          writeFileSync(npmCmd, npmCmdContent, 'utf8')
          logger.info('nodeShim.npmCmd.generated', 'Npm command shim was generated', {
            shimPath: npmCmd,
            cliEnvVar: 'PETCLAW_NPM_BIN_DIR'
          })
        }
      } else {
        logger.warn('nodeShim.npmCli.missing', 'Npm CLI file was missing', { cliPath: npmCliJs })
      }

      logger.info('nodeShim.packageManagers.generated', 'Npx and npm shims were generated', {
        npmBinDir
      })
    } else {
      logger.warn('nodeShim.npmBin.missing', 'Node shim npm bin directory was missing', {
        npmBinDir,
        exists: npmBinDir ? existsSync(npmBinDir) : false
      })
    }

    // 写完后做一次轻量校验，日志里记录路径、权限和大小，方便定位用户机器上的
    // 打包资源缺失或文件系统权限问题。
    const shimFiles = ['node', 'npx', 'npm']
    for (const name of shimFiles) {
      const shimPath = join(shimDir, name)
      const shimExists = existsSync(shimPath)
      if (shimExists) {
        try {
          const stat = statSync(shimPath)
          logger.info('nodeShim.file.resolved', 'Node shim file was resolved', {
            name,
            shimPath,
            mode: `0o${stat.mode.toString(8)}`,
            size: stat.size
          })
        } catch (e) {
          logger.warn('nodeShim.file.stat.failed', 'Failed to stat node shim file', {
            name,
            shimPath,
            errorMessage: e instanceof Error ? e.message : String(e)
          })
        }
      } else {
        logger.warn('nodeShim.file.missing', 'Node shim file was missing', { name, shimPath })
      }
    }

    return shimDir
  } catch (error) {
    logger.warn('nodeShim.prepare.failed', 'Failed to prepare Electron Node shim', {
      errorMessage: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

/**
 * 解析 Windows 上可用的 git-bash 路径。
 *
 * Claude Code CLI 的 shell 工具依赖 git-bash 执行 Unix 风格命令。这里按确定优先级
 * 查找：用户显式环境变量 > PetClaw 打包的 PortableGit > 系统安装的 Git > PATH 查询。
 * 每个候选都必须通过 `cygpath -u` 健康检查，避免把损坏或初始化异常的 bash 注入
 * 到 Cowork 会话。
 */
function resolveWindowsGitBashPath(): string | null {
  if (cachedGitBashPath !== undefined) return cachedGitBashPath

  if (process.platform !== 'win32') {
    cachedGitBashPath = null
    cachedGitBashResolutionError = null
    return null
  }

  const candidates: Array<{ path: string; source: string }> = []
  const seen = new Set<string>()
  const failedCandidates: string[] = []

  const pushCandidate = (candidatePath: string | null, source: string): void => {
    if (!candidatePath) return
    const normalized = normalizeWindowsPath(candidatePath)
    if (!normalized) return
    const key = normalized.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({ path: normalized, source })
  }

  // 1. 用户显式环境变量，优先级最高，便于高级用户或测试环境指定自定义 bash。
  pushCandidate(process.env.CLAUDE_CODE_GIT_BASH_PATH ?? null, 'env:CLAUDE_CODE_GIT_BASH_PATH')

  // 2. PetClaw 打包的 PortableGit，是生产环境最可控的默认来源。
  for (const bundledCandidate of getBundledGitBashCandidates()) {
    pushCandidate(bundledCandidate, 'bundled:resources/mingit')
  }

  // 3. Git for Windows 的常见安装位置，覆盖 Program Files、用户目录和 scoop。
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const localAppData = process.env.LOCALAPPDATA || ''
  const userProfile = process.env.USERPROFILE || ''

  const installCandidates = [
    join(programFiles, 'Git', 'bin', 'bash.exe'),
    join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
    join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    join(programFilesX86, 'Git', 'usr', 'bin', 'bash.exe'),
    join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
    join(localAppData, 'Programs', 'Git', 'usr', 'bin', 'bash.exe'),
    join(userProfile, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
    join(userProfile, 'scoop', 'apps', 'git', 'current', 'usr', 'bin', 'bash.exe'),
    'C:\\Git\\bin\\bash.exe',
    'C:\\Git\\usr\\bin\\bash.exe'
  ]

  for (const installCandidate of installCandidates) {
    pushCandidate(installCandidate, 'installed:common-paths')
  }

  // 4. 从注册表读取 Git for Windows 安装根目录，覆盖用户自定义安装路径。
  const registryInstallRoots = listGitInstallPathsFromRegistry()
  for (const installRoot of registryInstallRoots) {
    const registryCandidates = [
      join(installRoot, 'bin', 'bash.exe'),
      join(installRoot, 'usr', 'bin', 'bash.exe')
    ]
    for (const registryCandidate of registryCandidates) {
      pushCandidate(registryCandidate, `registry:${installRoot}`)
    }
  }

  // 5. 查询 PATH 中可见的 bash.exe。
  const bashPaths = listWindowsCommandPaths('where bash')
  for (const bashPath of bashPaths) {
    if (bashPath.toLowerCase().endsWith('\\bash.exe')) {
      pushCandidate(bashPath, 'path:where bash')
    }
  }

  // 6. 查询 PATH 中可见的 git.exe，并从 Git 安装根目录反推出 bash.exe。
  const gitPaths = listWindowsCommandPaths('where git')
  for (const gitPath of gitPaths) {
    const gitRoot = dirname(dirname(gitPath))
    const bashCandidates = [
      join(gitRoot, 'bin', 'bash.exe'),
      join(gitRoot, 'usr', 'bin', 'bash.exe')
    ]
    for (const bashCandidate of bashCandidates) {
      pushCandidate(bashCandidate, `path:where git (${gitPath})`)
    }
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) {
      continue
    }

    const health = checkWindowsGitBashHealth(candidate.path)
    if (health.ok) {
      logger.info('gitBash.resolved', 'Git Bash was resolved', {
        source: candidate.source,
        bashPath: candidate.path
      })
      cachedGitBashPath = candidate.path
      cachedGitBashResolutionError = null
      return candidate.path
    }

    const failure = `${candidate.path} [${candidate.source}] failed health check (${health.reason || 'unknown reason'})`
    failedCandidates.push(failure)
    logger.warn('gitBash.healthCheck.failed', 'Git Bash candidate health check failed', {
      bashPath: candidate.path,
      source: candidate.source,
      reason: health.reason
    })
  }

  const diagnostic =
    failedCandidates.length > 0
      ? `No healthy git-bash found. Failures: ${failedCandidates.join('; ')}`
      : 'No git-bash candidates found on this system'
  logger.warn('gitBash.resolve.failed', 'Failed to resolve Git Bash', {
    failureCount: failedCandidates.length,
    failures: failedCandidates,
    diagnostic
  })
  cachedGitBashPath = null
  cachedGitBashResolutionError = truncateDiagnostic(diagnostic)
  return null
}

/**
 * Windows 内置命令依赖的系统目录。
 *
 * ipconfig、systeminfo、netstat、ping、nslookup 等命令不在用户工具目录里，
 * 如果 System32 等系统目录从 PATH 中丢失，shell 工具会表现为“命令不存在”。
 */
const WINDOWS_SYSTEM_PATH_ENTRIES = [
  'System32',
  'System32\\Wbem',
  'System32\\WindowsPowerShell\\v1.0',
  'System32\\OpenSSH'
]

/**
 * Windows 系统命令和 DLL 加载依赖的关键环境变量。
 *
 * 即使 System32 已在 PATH 中，缺少 SystemRoot、windir、COMSPEC 等变量时，
 * cmd.exe 或部分系统命令仍可能启动失败。
 */
const WINDOWS_CRITICAL_ENV_VARS: Record<string, () => string | undefined> = {
  SystemRoot: () => process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\windows',
  windir: () =>
    process.env.windir ||
    process.env.WINDIR ||
    process.env.SystemRoot ||
    process.env.SYSTEMROOT ||
    'C:\\windows',
  COMSPEC: () => process.env.COMSPEC || process.env.comspec || 'C:\\windows\\system32\\cmd.exe',
  SYSTEMDRIVE: () => process.env.SYSTEMDRIVE || process.env.SystemDrive || 'C:'
}

/**
 * 确保 Cowork 子进程环境中存在 Windows 关键系统变量。
 *
 * 打包版 Electron 或某些启动上下文可能会剥离 SystemRoot、windir、COMSPEC、
 * SYSTEMDRIVE 等变量。很多 Windows 系统命令和 DLL 解析依赖这些变量定位系统资源。
 *
 * Claude Agent SDK 还会通过 `shell: true` 执行 shell snapshot，在 Windows 上这会走
 * cmd.exe。如果关键系统变量缺失，snapshot 捕获到的 PATH 可能已经损坏，后续命令
 * 可能静默失败或表现为命令不存在。
 */
function ensureWindowsSystemEnvVars(env: Record<string, string | undefined>): void {
  const injected: string[] = []

  for (const [key, resolver] of Object.entries(WINDOWS_CRITICAL_ENV_VARS)) {
    // Windows 环境变量大小写不敏感，但 Node.js 会保留原始 casing；这里按目标键补齐。
    if (!env[key]) {
      const value = resolver()
      if (value) {
        env[key] = value
        injected.push(`${key}=${value}`)
      }
    }
  }

  if (injected.length > 0) {
    logger.info('windowsSystemEnv.injected', 'Windows system environment variables were injected', {
      injected
    })
  }
}

/**
 * 确保 Windows 系统目录始终存在于 PATH。
 *
 * Electron 启动时 `process.env.PATH` 通常包含 System32，但 Claude Agent SDK 会通过
 * git-bash 登录 shell 创建 shell snapshot。git-bash 的 `/etc/profile` 会基于
 * MSYS2_PATH_TYPE 和 ORIGINAL_PATH 重建 PATH；如果继承环境里已经缺少 System32，
 * snapshot 中也会继续缺失。
 *
 * 在把环境交给 SDK 前主动补齐系统目录，可以保证 Windows 内置命令在 Cowork 会话里
 * 稳定可用。
 */
function ensureWindowsSystemPathEntries(env: Record<string, string | undefined>): void {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\windows'
  const currentPath = env.PATH || ''
  const currentEntries = currentPath.split(delimiter).map((entry) => entry.toLowerCase())

  const missingDirs: string[] = []
  for (const relDir of WINDOWS_SYSTEM_PATH_ENTRIES) {
    const fullDir = join(systemRoot, relDir)
    if (!currentEntries.includes(fullDir.toLowerCase()) && existsSync(fullDir)) {
      missingDirs.push(fullDir)
    }
  }

  // 系统根目录自身也可能被部分内置命令或 DLL 搜索路径使用，和 System32 一起补齐。
  if (!currentEntries.includes(systemRoot.toLowerCase()) && existsSync(systemRoot)) {
    missingDirs.push(systemRoot)
  }

  if (missingDirs.length > 0) {
    // 追加到末尾，避免系统目录覆盖用户安装的同名工具。
    env.PATH = currentPath
      ? `${currentPath}${delimiter}${missingDirs.join(delimiter)}`
      : missingDirs.join(delimiter)
    logger.info('windowsSystemPath.injected', 'Windows system PATH entries were injected', {
      missingDirs
    })
  }
}

/**
 * 为非登录 git-bash 调用补上核心 MSYS 命令搜索路径。
 *
 * Claude Agent SDK 在 Windows 路径规范化时会通过 `execSync(..., { shell: bash.exe })`
 * 调用 `cygpath`，这条路径不一定会启动登录 shell。此时 bash 可能直接继承 Windows
 * 格式的 PATH，而 Windows PATH 使用分号分隔，bash 无法按冒号规则解析，进而找不到
 * `cygpath`。
 *
 * 在 PATH 前面放入 `/usr/bin:/bin`，给 bash 一个合法的冒号分隔起始段，同时保留后续
 * Windows PATH 语义，避免 `/bin/bash: cygpath: command not found`。
 */
function ensureWindowsBashBootstrapPath(env: Record<string, string | undefined>): void {
  const currentPath = env.PATH || ''
  if (!currentPath) return

  const bootstrapToken = '/usr/bin:/bin'
  const entries = currentPath
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (entries.some((entry) => entry === bootstrapToken)) {
    return
  }

  env.PATH = `${bootstrapToken}${delimiter}${currentPath}`
  logger.info('windowsBashBootstrapPath.injected', 'Windows Bash bootstrap PATH was injected', {
    bootstrapToken
  })
}

/**
 * 将单个 Windows 路径转换成 MSYS2/POSIX 路径。
 *
 * 当路径包含中文用户名等非 ASCII 字符时，如果 MSYS2 在 LANG=C.UTF-8 生效前执行
 * 自动 Windows→POSIX 转换，路径可能被错误解码。提前转为 `/c/Users/...` 这种
 * POSIX 形式后，MSYS2 会把它识别为已转换路径，并直接交给内部 wide-char 文件 API，
 * 从而规避编码损坏。
 */
function singleWindowsPathToPosix(windowsPath: string): string {
  if (!windowsPath) return windowsPath
  const driveMatch = windowsPath.match(/^([A-Za-z]):[/\\](.*)/)
  if (driveMatch) {
    const driveLetter = driveMatch[1].toLowerCase()
    const rest = driveMatch[2].replace(/\\/g, '/').replace(/\/+$/, '')
    return `/${driveLetter}${rest ? '/' + rest : ''}`
  }
  return windowsPath.replace(/\\/g, '/')
}

/**
 * 将 Windows PATH 字符串转换成 git-bash 可解析的 MSYS2/POSIX PATH。
 *
 * Windows PATH 用分号分隔，并使用 `C:\...` 形式；MSYS2 bash 需要冒号分隔和
 * `/c/...` 形式。Node.js fork 子进程时不会自动转换 PATH，如果 CLI 再启动 git-bash，
 * `/etc/profile` 会把 ORIGINAL_PATH 追加到 PATH。此时分号仍留在字符串里，bash 会把
 * 多个 Windows 路径当成一个巨大的无效路径项。
 *
 * 这里逐项转换分号分隔的 Windows 路径，保证 git-bash 能按冒号正确解析每个目录。
 */
function convertWindowsPathToMsys(windowsPath: string): string {
  if (!windowsPath) return windowsPath

  const entries = windowsPath.split(';').filter(Boolean)
  const converted: string[] = []

  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!trimmed) continue

    // 转换盘符路径：C:\foo\bar 或 C:/foo/bar → /c/foo/bar。
    const driveMatch = trimmed.match(/^([A-Za-z]):[/\\](.*)/)
    if (driveMatch) {
      const driveLetter = driveMatch[1].toLowerCase()
      const rest = driveMatch[2].replace(/\\/g, '/').replace(/\/+$/, '')
      converted.push(`/${driveLetter}${rest ? '/' + rest : ''}`)
    } else if (trimmed.startsWith('/')) {
      // 已经是 POSIX 风格，保持原样。
      converted.push(trimmed)
    } else {
      // 相对路径或未知格式只替换反斜杠，尽量保留原路径语义。
      converted.push(trimmed.replace(/\\/g, '/'))
    }
  }

  return converted.join(':')
}

/**
 * 预先设置 git-bash 会继承的 ORIGINAL_PATH。
 *
 * git-bash 的 `/etc/profile` 在 MSYS2_PATH_TYPE=inherit 时会读取 ORIGINAL_PATH，
 * 并把它追加到 MSYS2 PATH。若 ORIGINAL_PATH 仍是 Windows 格式（分号和反斜杠），
 * bash 会把它当成一个无效的大路径项。
 *
 * 因此这里用 POSIX 转换后的 PATH 覆盖 ORIGINAL_PATH，让 `/etc/profile` 后续追加的
 * 是格式正确的冒号分隔路径。
 */
function ensureWindowsOriginalPath(env: Record<string, string | undefined>): void {
  const currentPath = env.PATH || ''
  if (!currentPath) return

  const posixPath = convertWindowsPathToMsys(currentPath)
  env.ORIGINAL_PATH = posixPath
  logger.info('windowsOriginalPath.injected', 'Windows ORIGINAL_PATH was injected', {
    pathEntryCount: posixPath.split(':').length
  })
}

/**
 * 创建 git-bash 非交互会话的 UTF-8 初始化脚本。
 *
 * 中文 Windows 默认控制台 code page 常见为 GBK(936)。当 git-bash 执行 dir、
 * ipconfig、systeminfo、net、type 等 Windows 原生命令时，这些命令会按当前控制台
 * code page 输出字节；Claude Agent SDK 按 UTF-8 读取时就会乱码。
 *
 * 通过 BASH_ENV 指向该脚本，可以让 SDK 每次启动非交互 bash 前先执行 `chcp 65001`，
 * 将 Windows 原生命令输出切到 UTF-8。
 */
function ensureWindowsBashUtf8InitScript(): string | null {
  try {
    const initDir = resolveUserDataPaths(app.getPath('userData')).coworkShimBin
    mkdirSync(initDir, { recursive: true })

    const initScript = join(initDir, 'bash_utf8_init.sh')
    const content = [
      '#!/usr/bin/env bash',
      '# PetClaw 自动生成：将 Windows 控制台 code page 切换为 UTF-8',
      '# 用于避免 Windows 原生命令输出被 SDK 按 UTF-8 读取时出现乱码。',
      'if command -v chcp.com >/dev/null 2>&1; then',
      '  chcp.com 65001 >/dev/null 2>&1',
      'fi',
      ''
    ].join('\n')

    writeFileSync(initScript, content, 'utf8')
    try {
      chmodSync(initScript, 0o755)
    } catch {
      // 某些文件系统不支持 POSIX 权限位，chmod 失败不影响脚本被 bash 读取。
    }

    return initScript
  } catch (error) {
    logger.warn(
      'windowsBashUtf8InitScript.create.failed',
      'Failed to create Bash UTF-8 init script',
      { errorMessage: error instanceof Error ? error.message : String(error) }
    )
    return null
  }
}

function applyPackagedEnvOverrides(env: Record<string, string | undefined>): void {
  const electronNodeRuntimePath = getElectronNodeRuntimePath()

  if (app.isPackaged && !env.PETCLAW_ELECTRON_PATH) {
    env.PETCLAW_ELECTRON_PATH = electronNodeRuntimePath
  }

  // Windows 需要先解析 git-bash，并把 Git 工具链目录补进 PATH，供 shell 工具执行。
  if (process.platform === 'win32') {
    env.PETCLAW_ELECTRON_PATH = electronNodeRuntimePath

    // 强制 MSYS2/git-bash 使用 UTF-8。
    //
    // 中文 Windows 等非拉丁系统区域设置下，默认编码通常是 GBK(936) 或类似 legacy
    // code page。如果不显式设置 locale，MSYS2 工具和 git-bash 环境可能输出 legacy
    // 编码，Claude Agent SDK 按 UTF-8 解读后会出现乱码。
    //
    // LANG/LC_ALL=C.UTF-8 会要求 MSYS2 runtime 在 coreutils（ls/cat/grep 等）文本
    // 输入输出中使用 UTF-8。
    if (!env.LANG) {
      env.LANG = 'C.UTF-8'
    }
    if (!env.LC_ALL) {
      env.LC_ALL = 'C.UTF-8'
    }

    // 强制 Python 使用 UTF-8 模式（PEP 540，Python 3.7+）。
    // 否则中文 Windows 上 Python 的 stdin/stdout/stderr 和文件 I/O 可能默认 GBK，
    // SDK 按 UTF-8 读取时会乱码。
    if (!env.PYTHONUTF8) {
      env.PYTHONUTF8 = '1'
    }
    if (!env.PYTHONIOENCODING) {
      env.PYTHONIOENCODING = 'utf-8'
    }

    // 强制 less 和 git pager 输出使用 UTF-8，避免分页器内容乱码。
    if (!env.LESSCHARSET) {
      env.LESSCHARSET = 'utf-8'
    }

    // 通过 BASH_ENV 注入初始化脚本，让 SDK 创建的每个非交互 bash 会话在执行命令前
    // 先把 Windows 控制台 code page 切到 UTF-8，保证 dir/ipconfig/systeminfo/type
    // 等原生命令输出 UTF-8 而不是 GBK。
    if (!env.BASH_ENV) {
      const initScript = ensureWindowsBashUtf8InitScript()
      if (initScript) {
        // BASH_ENV 路径提前转换成 MSYS2 POSIX 格式，避免中文用户名等非 ASCII 路径在
        // LANG=C.UTF-8 生效前被 MSYS2 自动转换逻辑错误解码。
        env.BASH_ENV = singleWindowsPathToPosix(initScript)
        logger.info('windowsBashEnv.injected', 'Windows Bash UTF-8 environment was injected', {
          bashEnv: env.BASH_ENV
        })
      }
    }

    // 补齐 Windows 关键系统变量，避免打包版或特殊启动上下文缺少 SystemRoot 等变量，
    // 导致 git-bash 内部执行 ipconfig、systeminfo、netstat 等系统命令失败。
    ensureWindowsSystemEnvVars(env)

    // 补齐 System32 等系统目录。SDK 的 shell snapshot 会固化 PATH；如果此时缺失系统
    // 目录，后续会话中的内置命令也会一直不可见。
    ensureWindowsSystemPathEntries(env)

    // 合并注册表里的最新 Machine/User PATH。Explorer 启动的 Electron 可能继承旧 PATH，
    // 导致用户后来安装的 Python/Node/npm 不可见；注册表值更接近新打开终端看到的环境。
    ensureWindowsRegistryPathEntries(env)

    const configuredBashPath = normalizeWindowsPath(env.CLAUDE_CODE_GIT_BASH_PATH)
    let bashPath =
      configuredBashPath && existsSync(configuredBashPath)
        ? configuredBashPath
        : resolveWindowsGitBashPath()

    if (configuredBashPath && bashPath === configuredBashPath) {
      const configuredHealth = checkWindowsGitBashHealth(configuredBashPath)
      if (!configuredHealth.ok) {
        const fallbackPath = resolveWindowsGitBashPath()
        if (fallbackPath && fallbackPath !== configuredBashPath) {
          logger.warn('gitBash.configured.unhealthy', 'Configured Git Bash was unhealthy', {
            configuredBashPath,
            reason: configuredHealth.reason,
            fallbackPath
          })
          bashPath = fallbackPath
        } else {
          const diagnostic = truncateDiagnostic(
            `Configured bash is unhealthy (${configuredBashPath}): ${configuredHealth.reason || 'unknown reason'}`
          )
          env.PETCLAW_GIT_BASH_RESOLUTION_ERROR = diagnostic
          logger.warn('gitBash.configured.unhealthy', 'Configured Git Bash was unhealthy', {
            configuredBashPath,
            reason: configuredHealth.reason,
            diagnostic
          })
          bashPath = null
        }
      }
    }

    if (bashPath) {
      env.CLAUDE_CODE_GIT_BASH_PATH = bashPath
      delete env.PETCLAW_GIT_BASH_RESOLUTION_ERROR
      logger.info('gitBash.used', 'Windows Git Bash was used', { bashPath })
      const gitToolDirs = getWindowsGitToolDirs(bashPath)
      env.PATH = appendEnvPath(env.PATH, gitToolDirs)
      logger.info('gitToolchainPath.injected', 'Windows Git toolchain PATH entries were injected', {
        gitToolDirs
      })
      ensureWindowsBashBootstrapPath(env)
    } else {
      const diagnostic =
        cachedGitBashResolutionError || 'git-bash not found or failed health checks'
      env.PETCLAW_GIT_BASH_RESOLUTION_ERROR = truncateDiagnostic(diagnostic)
    }

    appendPythonRuntimeToEnv(env)

    // 要求 git-bash 继承父进程 PATH，而不是从头构造最小 PATH。
    // 否则登录 shell 的 /etc/profile 可能只保留 Windows 系统目录和 MSYS2 工具，
    // 丢掉上面补齐的 Python、Node.js、npm、pip 等用户工具路径。
    if (!env.MSYS2_PATH_TYPE) {
      env.MSYS2_PATH_TYPE = 'inherit'
      logger.info('msys2PathType.injected', 'MSYS2 PATH type was injected', {
        value: 'inherit'
      })
    }

    // 预先把 ORIGINAL_PATH 设置为 POSIX 格式，供 git-bash 的 /etc/profile 使用。
    //
    // 根因：Windows 下 Node.js 环境里的 PATH 使用分号和反斜杠。SDK 启动 git-bash 后，
    // /etc/profile 会读取 ORIGINAL_PATH="${ORIGINAL_PATH:-${PATH}}" 并用冒号追加。
    // 如果仍是 `C:\nodejs;C:\python`，bash 会把它看成一个无效路径项，导致 npm、
    // python、pip 等命令找不到。
    //
    // 必须在所有 PATH 修改完成后再转换，确保 ORIGINAL_PATH 捕获的是完整最终 PATH。
    ensureWindowsOriginalPath(env)
  }

  if (!app.isPackaged) {
    // 开发模式优先使用项目 node_modules/.bin，保证没有全局 Node.js/npm 的机器也能
    // 解析到本项目依赖提供的命令。
    const devBinDir = join(app.getAppPath(), 'node_modules', '.bin')
    if (existsSync(devBinDir)) {
      env.PATH = [devBinDir, env.PATH].filter(Boolean).join(delimiter)
      logger.info('devBinPath.injected', 'Development node_modules bin path was injected', {
        devBinDir
      })
    }

    // 开发模式把 Openclaw runtime 的 node_modules 加到 NODE_PATH，使 exec 工具能访问
    // sharp 等 runtime 共享依赖。
    const devRuntimeNodeModules = (() => {
      const runtimeCandidates = [
        join(app.getAppPath(), 'vendor', 'openclaw-runtime', 'current', 'node_modules'),
        join(process.cwd(), 'vendor', 'openclaw-runtime', 'current', 'node_modules')
      ]
      for (const c of runtimeCandidates) {
        try {
          const resolved = realpathSync(c)
          if (existsSync(resolved)) return resolved
        } catch {
          /* symlink 目标不存在时跳过，继续检查下一个候选路径 */
        }
      }
      return null
    })()
    if (devRuntimeNodeModules) {
      env.NODE_PATH = appendEnvPath(env.NODE_PATH, [devRuntimeNodeModules])
      logger.info(
        'devRuntimeNodePath.injected',
        'Development runtime node_modules path was injected',
        { devRuntimeNodeModules }
      )
    }
    return
  }

  if (!env.HOME) {
    env.HOME = app.getPath('home')
  }

  // 打包模式下解析用户 shell PATH，确保 node/npm 及用户安装的工具可被子进程找到。
  const userPath = resolveUserShellPath()
  if (userPath) {
    env.PATH = userPath
    logger.info('userShellPath.resolved', 'User shell PATH was resolved', {
      pathEntryCount: userPath.split(delimiter).length
    })
    for (const entry of userPath.split(delimiter)) {
      logger.info('userShellPath.entry.resolved', 'User shell PATH entry was resolved', {
        entry,
        exists: existsSync(entry)
      })
    }
  } else {
    // shell PATH 解析失败时追加常见 Node.js 安装目录，作为弱兜底。
    const home = env.HOME || app.getPath('home')
    const commonPaths = [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      `${home}/.nvm/current/bin`,
      `${home}/.volta/bin`,
      `${home}/.fnm/current/bin`
    ]
    env.PATH = [env.PATH, ...commonPaths].filter(Boolean).join(delimiter)
    logger.warn('userShellPath.resolve.failed', 'Failed to resolve user shell PATH', {
      commonPaths
    })
  }

  const resourcesPath = process.resourcesPath
  logger.info('packagedResources.resolved', 'Packaged resources path was resolved', {
    resourcesPath
  })

  // 创建 node/npx/npm shim：用 ELECTRON_RUN_AS_NODE=1 让 Electron 充当 Node.js runtime，
  // 并让 npx/npm 指向打包进来的 npm 包。这样无需依赖系统 Node.js，也规避 Windows
  // 跨平台构建中 node_modules/.bin 符号链接不可用的问题。
  const npmBinDir = join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'npm', 'bin')
  logger.info('packagedNpmBin.resolved', 'Packaged npm bin directory was resolved', {
    npmBinDir,
    exists: existsSync(npmBinDir)
  })

  // .cmd shim 通过环境变量引用 npmBinDir，避免把含中文的绝对路径硬编码进批处理文件。
  // 在 GBK code page 下，硬编码非 ASCII 路径容易被 cmd.exe 误读。
  env.PETCLAW_NPM_BIN_DIR = npmBinDir

  const hasSystemNode = hasCommandInEnv('node', env)
  const hasSystemNpx = hasCommandInEnv('npx', env)
  const hasSystemNpm = hasCommandInEnv('npm', env)
  const shouldForcePackagedDarwinShim = app.isPackaged && process.platform === 'darwin'
  const shouldInjectShim =
    shouldForcePackagedDarwinShim ||
    process.platform === 'win32' ||
    !(hasSystemNode && hasSystemNpx && hasSystemNpm)
  if (shouldInjectShim) {
    const shimDir = ensureElectronNodeShim(electronNodeRuntimePath, npmBinDir)
    if (shimDir) {
      env.PATH = [shimDir, env.PATH].filter(Boolean).join(delimiter)
      env.PETCLAW_NODE_SHIM_ACTIVE = '1'
      logger.info('nodeShimPath.injected', 'Electron Node shim PATH entry was injected', {
        shimDir
      })
      if (shouldForcePackagedDarwinShim) {
        logger.info('nodeShim.macos.used', 'Bundled macOS Node shims were used')
      }

      // shim 注入后重新计算 ORIGINAL_PATH，确保 git-bash 也能看到内置 node/npx/npm。
      if (process.platform === 'win32') {
        ensureWindowsOriginalPath(env)
      }
    }
  } else {
    delete env.PETCLAW_NODE_SHIM_ACTIVE
    logger.info('nodeShim.inject.skipped', 'Electron Node shim injection was skipped', {
      hasSystemNode,
      hasSystemNpx,
      hasSystemNpm
    })
  }

  const nodePaths = [
    join(resourcesPath, 'app.asar', 'node_modules'),
    join(resourcesPath, 'app.asar.unpacked', 'node_modules'),
    join(resourcesPath, 'petmind', 'node_modules')
  ].filter((nodePath) => existsSync(nodePath))

  if (nodePaths.length > 0) {
    env.NODE_PATH = appendEnvPath(env.NODE_PATH, nodePaths)
  }

  // 最后验证构造后的环境能解析 node/npx/npm，便于排查用户机器上的命令缺失。
  verifyNodeEnvironment(env)
}

/**
 * 验证构造后的 PATH 是否能解析 node/npx/npm。
 *
 * 该函数只输出诊断日志，不改变环境。主要用于定位打包版 macOS 或用户机器上 MCP
 * 服务器启动失败时，到底是 PATH、shim 还是 npm 包路径出了问题。
 */
function verifyNodeEnvironment(env: Record<string, string | undefined>): void {
  const tag = 'verifyNodeEnv'
  const pathValue = env.PATH || ''

  // 逐项记录最终 PATH，方便从日志判断目录是否存在、顺序是否符合预期。
  const pathEntries = pathValue.split(delimiter)
  logger.info('nodeEnvironment.path.resolved', 'Node environment PATH was resolved', {
    tag,
    pathEntryCount: pathEntries.length
  })
  for (let i = 0; i < pathEntries.length; i++) {
    const entry = pathEntries[i]
    const entryExists = entry ? existsSync(entry) : false
    logger.info('nodeEnvironment.pathEntry.resolved', 'Node environment PATH entry was resolved', {
      tag,
      index: i,
      entry,
      exists: entryExists
    })
  }

  // 使用平台原生命令解析 node/npx/npm：macOS/Linux 用 which，Windows 用 where。
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  for (const tool of ['node', 'npx', 'npm']) {
    try {
      const result = spawnSync(whichCmd, [tool], {
        env: { ...env } as NodeJS.ProcessEnv,
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: process.platform === 'win32'
      })
      if (result.status === 0 && result.stdout) {
        const resolved = result.stdout.trim()
        logger.info('nodeEnvironment.tool.resolved', 'Node environment tool was resolved', {
          tag,
          whichCmd,
          tool,
          resolved
        })
        const resolvedCandidates = resolved
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        const resolvedForExec =
          process.platform === 'win32'
            ? resolvedCandidates.find((candidate) => /\.(cmd|exe|bat)$/i.test(candidate)) ||
              resolvedCandidates[0]
            : resolvedCandidates[0]

        // node 能解析时进一步执行 --version，确认 shim 或真实 node 可以正常启动。
        if (tool === 'node' && resolvedForExec) {
          try {
            let execTarget = resolvedForExec
            if (process.platform === 'win32' && /\.cmd$/i.test(resolvedForExec)) {
              execTarget = env.PETCLAW_ELECTRON_PATH || process.execPath
            }
            const versionResult = spawnSync(execTarget, ['--version'], {
              env: { ...env, ELECTRON_RUN_AS_NODE: '1' } as NodeJS.ProcessEnv,
              encoding: 'utf-8',
              timeout: 5000,
              windowsHide: process.platform === 'win32'
            })
            logger.info('nodeEnvironment.version.resolved', 'Node version was resolved', {
              tag,
              execTarget,
              stdout: (versionResult.stdout || '').trim(),
              status: versionResult.status
            })
            if (versionResult.error) {
              logger.warn('nodeEnvironment.version.failed', 'Node version spawn failed', {
                tag,
                errorMessage: versionResult.error.message
              })
            }
            if (versionResult.stderr) {
              logger.warn('nodeEnvironment.version.stderr', 'Node version wrote to stderr', {
                tag,
                stderr: versionResult.stderr.trim()
              })
            }
          } catch (e) {
            logger.warn('nodeEnvironment.version.failed', 'Node version check failed', {
              tag,
              errorMessage: e instanceof Error ? e.message : String(e)
            })
          }
        }
      } else {
        logger.warn('nodeEnvironment.tool.missing', 'Node environment tool was missing', {
          tag,
          whichCmd,
          tool,
          status: result.status,
          stderr: (result.stderr || '').trim()
        })
      }
    } catch (e) {
      logger.warn('nodeEnvironment.tool.failed', 'Node environment tool lookup failed', {
        tag,
        whichCmd,
        tool,
        errorMessage: e instanceof Error ? e.message : String(e)
      })
    }
  }

  // 记录关键环境变量，便于和 PATH 解析结果一起排查。
  logger.info('nodeEnvironment.env.resolved', 'Node environment variables were resolved', {
    tag,
    nodePath: env.NODE_PATH,
    petclawElectronPath: env.PETCLAW_ELECTRON_PATH,
    petclawNpmBinDir: env.PETCLAW_NPM_BIN_DIR,
    home: env.HOME
  })
}

/**
 * 获取 skills 根目录。
 *
 * 生产环境的技能会复制到 userData，开发环境则优先从项目目录或显式环境变量查找，
 * 以兼容 electron-vite 输出目录变化和本地调试场景。
 */
export function getSkillsRoot(): string {
  if (app.isPackaged) {
    // 生产环境运行时只读 Resources，用户可写的技能目录统一放在 userData。
    return resolveUserDataPaths(app.getPath('userData')).skillsRoot
  }

  // 开发环境下 __dirname 会随构建输出目录变化（例如 dist-electron/ 或 dist-electron/libs/）。
  // 因此从环境变量、app path、cwd 和相对目录多个稳定锚点查找，选第一个存在的目录。
  const envRoots = [process.env.PETCLAW_SKILLS_ROOT, process.env.SKILLS_ROOT]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
  const skillCandidates = [
    ...envRoots,
    join(app.getAppPath(), 'skills'),
    join(process.cwd(), 'skills'),
    join(__dirname, '..', 'skills'),
    join(__dirname, '..', '..', 'skills')
  ]

  for (const candidate of skillCandidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  // 首次开发启动时 Resources/skills 可能还没同步，最终回退到 app path 下的预期位置。
  return join(app.getAppPath(), 'skills')
}

/**
 * 构造 Cowork 子进程使用的增强环境变量。
 *
 * 这里会合并模型配置环境、打包/开发模式 PATH 修正、skills 路径，以及系统代理。
 * 代理解析是异步的，所以该函数保持 async。
 */
export async function getEnhancedEnv(
  target: OpenAICompatProxyTarget = 'local'
): Promise<Record<string, string | undefined>> {
  const config = await getCurrentApiConfig(target)
  const env = config ? buildEnvForConfig(config) : { ...process.env }

  applyPackagedEnvOverrides(env)

  // 注入技能目录路径，供 skill 脚本和 Openclaw 执行环境读取。
  // Windows 下统一使用正斜杠：Node.js 可以识别，bash 也不会把反斜杠当转义字符。
  const skillsRoot = getSkillsRoot().replace(/\\/g, '/')
  env.SKILLS_ROOT = skillsRoot
  env.PETCLAW_SKILLS_ROOT = skillsRoot // Alternative name for clarity
  if (process.platform === 'win32' || env.PETCLAW_NODE_SHIM_ACTIVE === '1') {
    env.PETCLAW_ELECTRON_PATH = getElectronNodeRuntimePath().replace(/\\/g, '/')
  } else {
    delete env.PETCLAW_ELECTRON_PATH
  }

  // 如果模型配置或外部环境已经显式设置代理，则尊重现有值，不再覆盖。
  if (env.http_proxy || env.HTTP_PROXY || env.https_proxy || env.HTTPS_PROXY) {
    return env
  }

  // 用户可在设置中关闭系统代理注入；关闭后 Cowork 子进程不继承系统代理。
  if (!isSystemProxyEnabled()) {
    return env
  }

  // 从系统网络设置解析代理，并同时写入大小写两套变量以兼容不同 CLI。
  const { proxyUrl, targetUrl } = await resolveSystemProxyUrlForTargets()
  if (proxyUrl) {
    env.http_proxy = proxyUrl
    env.https_proxy = proxyUrl
    env.HTTP_PROXY = proxyUrl
    env.HTTPS_PROXY = proxyUrl
    logger.warn('systemProxy.injected', 'System proxy was injected into cowork environment', {
      targetUrl
    })
  }

  return env
}

/**
 * 确保工作目录下存在 Cowork 临时目录。
 *
 * Claude Agent SDK 会创建临时文件。把临时文件放在用户当前工作目录下的 `.cowork-temp`
 * 可以避免写入系统临时目录带来的权限、沙盒或跨磁盘清理问题。
 *
 * @param cwd 用户当前工作目录
 * @returns 可用的临时目录路径；创建失败时回退到 cwd
 */
export function ensureCoworkTempDir(cwd: string): string {
  const tempDir = join(cwd, '.cowork-temp')
  if (!existsSync(tempDir)) {
    try {
      mkdirSync(tempDir, { recursive: true })
      logger.info('tempDir.created', 'Cowork temporary directory was created', { tempDir })
    } catch (error) {
      logger.error(
        'tempDir.create.failed',
        'Failed to create cowork temporary directory',
        { tempDir },
        error
      )
      // 临时目录创建失败时不阻断会话启动，回退到 cwd 让 SDK 仍有可写位置。
      return cwd
    }
  }
  return tempDir
}

/**
 * 构造增强环境，并把各平台临时目录变量指向 `.cowork-temp`。
 *
 * macOS/Linux 使用 TMPDIR，Windows 常用 TMP/TEMP。三者都设置可以覆盖不同工具链的
 * 读取习惯，确保 SDK 及其子进程都把临时文件落在当前工作目录内。
 *
 * @param cwd 用户当前工作目录
 */
export async function getEnhancedEnvWithTmpdir(
  cwd: string,
  target: OpenAICompatProxyTarget = 'local'
): Promise<Record<string, string | undefined>> {
  const env = await getEnhancedEnv(target)
  const tempDir = ensureCoworkTempDir(cwd)

  // 同时设置三套变量，覆盖 POSIX 工具、Windows 原生命令和 Node/Python 等运行时。
  env.TMPDIR = tempDir
  env.TMP = tempDir
  env.TEMP = tempDir

  return env
}

const SESSION_TITLE_FALLBACK = 'New Session'
const SESSION_TITLE_MAX_CHARS = 50
const SESSION_TITLE_TIMEOUT_MS = 8000
const COWORK_MODEL_PROBE_TIMEOUT_MS = 20000

/**
 * 会话标题生成只走当前支持的直连协议。
 *
 * Anthropic 兼容协议和 Gemini 原生协议的请求体、鉴权头、响应解析都不同，
 * 因此在类型层面拆成两个分支，避免后续调用处用字符串判断拼错字段。
 */
type SessionTitleApiConfig =
  | {
      protocol: typeof CoworkModelProtocol.Anthropic
      apiKey: string
      baseURL: string
      model: string
    }
  | {
      protocol: typeof CoworkModelProtocol.GeminiNative
      apiKey: string
      baseURL: string
      model: string
    }

function resolveSessionTitleApiConfig(): { config: SessionTitleApiConfig | null; error?: string } {
  const rawResolution = resolveRawApiConfig()
  if (rawResolution.config && rawResolution.providerMetadata?.providerName === 'gemini') {
    return {
      config: {
        protocol: CoworkModelProtocol.GeminiNative,
        apiKey: rawResolution.config.apiKey,
        baseURL: rawResolution.config.baseURL,
        model: rawResolution.config.model
      }
    }
  }

  // resolveCurrentApiConfig 在 PetClaw 中是异步的，但 session title 需要同步解析。
  // 使用 resolveRawApiConfig（同步）替代，在此场景下功能等价。
  if (!rawResolution.config) {
    return {
      config: null,
      error: rawResolution.error
    }
  }

  return {
    config: {
      protocol: CoworkModelProtocol.Anthropic,
      apiKey: rawResolution.config.apiKey,
      baseURL: rawResolution.config.baseURL,
      model: rawResolution.config.model
    }
  }
}

/**
 * 将模型返回的标题清洗成适合 UI 展示的纯文本。
 *
 * 标题生成模型可能会“不听话”地返回 Markdown、代码块、引用、列表或 `Title:` 前缀。
 * 这里统一剥离这些格式，并限制最大长度，保证会话列表不会被异常标题撑破布局。
 */
function normalizeTitleToPlainText(value: string, fallback: string): string {
  if (!value.trim()) return fallback

  let title = value.trim()
  const fenced = /```(?:[\w-]+)?\s*([\s\S]*?)```/i.exec(title)
  if (fenced?.[1]) {
    title = fenced[1].trim()
  }

  title = title
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const labeledTitle = /^(?:title|标题)\s*[:：]\s*(.+)$/i.exec(title)
  if (labeledTitle?.[1]) {
    title = labeledTitle[1].trim()
  }

  title = title
    .replace(/^["'`\u201c\u201d\u2018\u2019]+/, '')
    .replace(/["'`\u201c\u201d\u2018\u2019]+$/, '')
    .trim()

  if (!title) return fallback
  if (title.length > SESSION_TITLE_MAX_CHARS) {
    title = title.slice(0, SESSION_TITLE_MAX_CHARS).trim()
  }
  return title || fallback
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * 根据用户第一条输入构造本地 fallback 标题。
 *
 * 标题生成依赖外部模型，可能因为网络、配置或限流失败。fallback 必须完全本地可用，
 * 这样新会话创建不会被标题生成阻塞。
 */
function buildFallbackSessionTitle(userIntent: string | null): string {
  const normalizedInput = typeof userIntent === 'string' ? userIntent.trim() : ''
  if (!normalizedInput) {
    return SESSION_TITLE_FALLBACK
  }
  const firstLine =
    normalizedInput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ''
  return normalizeTitleToPlainText(firstLine, SESSION_TITLE_FALLBACK)
}

export async function probeCoworkModelReadiness(
  timeoutMs = COWORK_MODEL_PROBE_TIMEOUT_MS
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { config, error } = resolveSessionTitleApiConfig()
  if (!config) {
    return {
      ok: false,
      error: error || 'API configuration not found.'
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // 用最小 token 的请求验证模型配置、鉴权和网络连通性。
    // 这里不关心模型具体回复内容，只要 API 返回 2xx 就认为当前配置可用于后续 Cowork 会话。
    const response = await fetch(
      config.protocol === CoworkModelProtocol.GeminiNative
        ? buildGeminiGenerateContentUrl(config.baseURL, config.model)
        : buildAnthropicMessagesUrl(config.baseURL),
      {
        method: 'POST',
        headers:
          config.protocol === CoworkModelProtocol.GeminiNative
            ? {
                'Content-Type': 'application/json',
                'x-goog-api-key': config.apiKey
              }
            : {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01'
              },
        body: JSON.stringify(
          config.protocol === CoworkModelProtocol.GeminiNative
            ? {
                contents: [{ role: 'user', parts: [{ text: 'Reply with "ok".' }] }],
                generationConfig: {
                  maxOutputTokens: 1,
                  temperature: 0
                }
              }
            : {
                model: config.model,
                max_tokens: 1,
                temperature: 0,
                messages: [{ role: 'user', content: 'Reply with "ok".' }]
              }
        ),
        signal: controller.signal
      }
    )

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      const errorSnippet = extractApiErrorSnippet(errorText)
      return {
        ok: false,
        error: errorSnippet
          ? `Model validation failed (${response.status}): ${errorSnippet}`
          : `Model validation failed with status ${response.status}.`
      }
    }

    return { ok: true }
  } catch (fetchError) {
    if (fetchError instanceof Error && fetchError.name === 'AbortError') {
      const timeoutSeconds = Math.ceil(timeoutMs / 1000)
      return {
        ok: false,
        error: `Model validation timed out after ${timeoutSeconds}s.`
      }
    }
    return {
      ok: false,
      error: `Model validation failed: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function generateSessionTitle(userIntent: string | null): Promise<string> {
  const normalizedInput = typeof userIntent === 'string' ? userIntent.trim() : ''
  const fallbackTitle = buildFallbackSessionTitle(normalizedInput)
  if (!normalizedInput) {
    return fallbackTitle
  }

  const { config, error } = resolveSessionTitleApiConfig()
  if (!config) {
    if (error) {
      logger.warn(
        'titleGeneration.skipped.missingApiConfig',
        'Session title generation was skipped because API config is missing',
        error
      )
    }
    return fallbackTitle
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SESSION_TITLE_TIMEOUT_MS)

  try {
    const url =
      config.protocol === CoworkModelProtocol.GeminiNative
        ? buildGeminiGenerateContentUrl(config.baseURL, config.model)
        : buildAnthropicMessagesUrl(config.baseURL)
    const prompt = `Generate a short title from this input, keep the same language, return plain text only (no markdown), and keep it within ${SESSION_TITLE_MAX_CHARS} characters: ${normalizedInput}`
    logger.debug('titleGeneration.request.started', 'Session title generation request started', {
      protocol: config.protocol,
      baseURL: config.baseURL,
      requestUrl: url,
      model: config.model
    })

    const response = await fetch(url, {
      method: 'POST',
      headers:
        config.protocol === CoworkModelProtocol.GeminiNative
          ? {
              'Content-Type': 'application/json',
              'x-goog-api-key': config.apiKey
            }
          : {
              'Content-Type': 'application/json',
              'x-api-key': config.apiKey,
              'anthropic-version': '2023-06-01'
            },
      body: JSON.stringify(
        config.protocol === CoworkModelProtocol.GeminiNative
          ? {
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                maxOutputTokens: 80,
                temperature: 0
              }
            }
          : {
              model: config.model,
              max_tokens: 80,
              temperature: 0,
              messages: [{ role: 'user', content: prompt }]
            }
      ),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.warn('titleGeneration.response.failed', 'Session title generation response failed', {
        status: response.status,
        errorSnippet: errorText.slice(0, 240)
      })
      return fallbackTitle
    }

    const payload = await response.json()
    logger.debug(
      'titleGeneration.response.received',
      'Session title generation response received',
      {
        payloadSize: JSON.stringify(payload).length
      }
    )
    // 不同协议的响应结构不同，解析后仍统一经过 normalizeTitleToPlainText 清洗。
    // 这样即使模型返回 Markdown 或超长文本，最终落到 UI 的标题也保持稳定。
    const llmTitle =
      config.protocol === CoworkModelProtocol.GeminiNative
        ? extractTextFromGeminiResponse(payload)
        : extractTextFromAnthropicResponse(payload)
    logger.debug('titleGeneration.title.extracted', 'Session title was extracted from response', {
      titleLength: llmTitle.length
    })
    return normalizeTitleToPlainText(llmTitle, fallbackTitle)
  } catch (titleError) {
    if (isAbortError(titleError)) {
      const timeoutSeconds = Math.ceil(SESSION_TITLE_TIMEOUT_MS / 1000)
      logger.warn('titleGeneration.timeout', 'Session title generation timed out', {
        timeoutSeconds
      })
      return fallbackTitle
    }
    logger.error('titleGeneration.failed', 'Failed to generate session title', titleError)
    return fallbackTitle
  } finally {
    clearTimeout(timeoutId)
  }
}
