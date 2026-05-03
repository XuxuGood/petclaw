const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { existsSync } = require('node:fs')
const { readFileSync } = require('node:fs')
const { basename, join } = require('node:path')

// AI 工具链共享工具模块。
// 这里集中处理路径、命令探测、GitNexus 命令解析和 Git 状态检查，避免各脚本各写一套 shell 逻辑。
// 所有函数都以“可降级”为原则：AI 上下文工具缺失时提醒开发者，而不是轻易阻断日常开发。
const PROJECT_ROOT = join(__dirname, '..', '..')
const AI_TOOLS_DIR = join(PROJECT_ROOT, '.petclaw', 'ai-tools')
const PROJECT_MCP_CONFIG = join(PROJECT_ROOT, '.mcp.json')
let cachedGitNexusRepoName = null
let cachedGitNexusList = null
let cachedGitNexusListResult = null

function createMcpServersConfig() {
  // 项目级 .mcp.json 和各客户端模板共用同一份 server 定义，避免 GitNexus / Serena 启动命令漂移。
  // GitNexus 在 bootstrap 阶段完成安装，MCP 启动时直接使用本机命令，避免客户端每次启动都通过 npx 联网下载。
  // Serena 显式从当前仓库识别项目，确保同一份模板复制到不同仓库后仍能绑定正确工作目录。
  return {
    mcpServers: {
      gitnexus: {
        command: 'gitnexus',
        args: ['mcp']
      },
      serena: {
        command: 'serena',
        args: ['start-mcp-server', '--project-from-cwd', '--open-web-dashboard=false']
      }
    }
  }
}

function logInfo(message) {
  console.log(`[AI Context] ${message}`)
}

function logWarn(message) {
  console.warn(`[AI Context] ${message}`)
}

function hasCommand(command) {
  // Git hook 中不直接执行 npx 下载依赖，先判断本机是否已有可用命令，避免提交时被网络或安装过程卡住。
  // 这里使用 shell 的 command -v，是为了同时识别全局命令、用户 PATH 和 npm/uv 暴露的 shim。
  const result = spawnSync('sh', ['-lc', `command -v ${command}`], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })

  return result.status === 0 && result.stdout.trim().length > 0
}

function runCommand(command, args, options = {}) {
  // 统一封装外部命令执行，调用方只关心退出码和输出；需要展示安装/分析过程时再继承 stdio。
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error
  }
}

function sanitizeGitNexusRepoName(value) {
  // GitNexus repo alias 会出现在 CLI 参数和 MCP 资源里，因此只保留易读且 shell 友好的字符。
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function getPackageName() {
  try {
    const packageJson = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'))
    return typeof packageJson.name === 'string' && packageJson.name.trim() ? packageJson.name : null
  } catch {
    return null
  }
}

function getGitRemoteUrl() {
  const result = runCommand('git', ['config', '--get', 'remote.origin.url'])
  if (result.status !== 0) {
    return ''
  }

  return result.stdout.trim()
}

function normalizePathForCompare(path) {
  // GitNexus list 输出的是绝对路径；统一去掉末尾斜杠，避免 /repo 与 /repo/ 比较失败。
  return path.replace(/\/+$/g, '')
}

function parseGitNexusList(output) {
  const repos = []
  let current = null

  for (const line of output.split('\n')) {
    const aliasMatch = line.match(/^  ([^\s].*)$/)
    if (aliasMatch && !line.trim().includes(':') && !line.includes('Indexed Repositories')) {
      current = {
        alias: aliasMatch[1].trim(),
        path: ''
      }
      repos.push(current)
      continue
    }

    const pathMatch = line.match(/^\s+Path:\s+(.*)$/)
    if (pathMatch && current) {
      current.path = pathMatch[1].trim()
    }
  }

  return repos.filter((repo) => repo.alias && repo.path)
}

function getGitNexusListResult() {
  // registry 读取失败时，调用方需要知道失败原因，不能把“读不到 registry”误判成“仓库未注册”后继续 analyze 抢锁。
  if (cachedGitNexusListResult) {
    return cachedGitNexusListResult
  }

  const result = runGitNexus(['list'])
  cachedGitNexusListResult = result
  if (result.skipped || result.status !== 0) {
    cachedGitNexusList = []
    return cachedGitNexusListResult
  }

  cachedGitNexusList = parseGitNexusList(result.stdout)
  return cachedGitNexusListResult
}

function getGitNexusList() {
  // 多个调用会连续解析 alias / 注册状态，缓存 list 输出，避免一次 prepare-change 重复跑 gitnexus list。
  if (cachedGitNexusList) {
    return cachedGitNexusList
  }

  getGitNexusListResult()
  return cachedGitNexusList
}

function findRegisteredGitNexusRepoNameByPath() {
  const projectPath = normalizePathForCompare(PROJECT_ROOT)
  const match = getGitNexusList().find((repo) => normalizePathForCompare(repo.path) === projectPath)
  return match ? match.alias : null
}

function getGitNexusRepoName() {
  // 多仓库/多 clone 场景下，GitNexus 默认按目录名注册可能撞名。
  // 先复用当前路径在 registry 中已有的 alias，避免把历史索引 petclaw 切到 petclaw-<hash> 后查不到。
  // 如果当前路径从未注册，才生成“项目名 + remote/path hash”的唯一 alias。
  if (process.env.PETCLAW_GITNEXUS_REPO_NAME) {
    return sanitizeGitNexusRepoName(process.env.PETCLAW_GITNEXUS_REPO_NAME)
  }

  if (cachedGitNexusRepoName) {
    return cachedGitNexusRepoName
  }

  const registeredName = findRegisteredGitNexusRepoNameByPath()
  if (registeredName) {
    cachedGitNexusRepoName = registeredName
    return cachedGitNexusRepoName
  }

  const baseName = sanitizeGitNexusRepoName(getPackageName() || basename(PROJECT_ROOT) || 'petclaw')
  const identitySource = getGitRemoteUrl() || PROJECT_ROOT
  const identityHash = createHash('sha1').update(identitySource).digest('hex').slice(0, 8)
  cachedGitNexusRepoName = `${baseName}-${identityHash}`
  return cachedGitNexusRepoName
}

function hasGitNexusRepoArg(args) {
  return args.includes('-r') || args.includes('--repo')
}

function hasGitNexusNameArg(args) {
  return args.includes('--name')
}

function withGitNexusRepo(args) {
  const [command, ...rest] = args
  const repoName = getGitNexusRepoName()

  if (command === 'analyze') {
    // analyze 负责注册索引；显式 --name 让当前仓库拥有稳定唯一 alias，避免同名目录共用一个全局索引名。
    return hasGitNexusNameArg(rest) ? args : [command, '--name', repoName, ...rest]
  }

  if (['context', 'impact', 'query', 'cypher', 'detect_changes', 'detect-changes'].includes(command)) {
    // 查询类命令显式指定 -r，避免 GitNexus 在多个已索引仓库中按默认规则选错项目。
    return hasGitNexusRepoArg(rest) ? args : [command, '-r', repoName, ...rest]
  }

  return args
}

function getCommandVersion(command, args = ['--version']) {
  // 版本探测只用于状态展示，不参与核心业务判断；命令存在但不支持 --version 时仍视为已安装。
  if (!hasCommand(command)) {
    return null
  }

  const result = runCommand(command, args)
  if (result.status !== 0) {
    return 'installed'
  }

  return `${result.stdout}\n${result.stderr}`.trim() || 'installed'
}

function resolveGitNexusCommand() {
  // GitNexus 的来源按“显式配置 → 本地依赖 → 全局命令 → 显式 npx”排序。
  // 默认不走 npx，避免 Git hook 在提交/切分支时突然联网下载依赖。
  if (process.env.PETCLAW_SKIP_GITNEXUS === '1') {
    return null
  }

  if (process.env.PETCLAW_GITNEXUS_CMD) {
    return {
      command: process.env.PETCLAW_GITNEXUS_CMD,
      argsPrefix: []
    }
  }

  const localBin = join(PROJECT_ROOT, 'node_modules', '.bin', 'gitnexus')
  if (existsSync(localBin)) {
    return {
      command: localBin,
      argsPrefix: []
    }
  }

  if (hasCommand('gitnexus')) {
    return {
      command: 'gitnexus',
      argsPrefix: []
    }
  }

  if (process.env.PETCLAW_GITNEXUS_USE_NPX === '1') {
    return {
      command: 'npx',
      argsPrefix: ['--yes', 'gitnexus']
    }
  }

  return null
}

function getSerenaDashboardUrls() {
  // Serena dashboard 默认从 24282 起递增；这里用 lsof 只读发现正在监听的本机端口，不主动启动或打开浏览器。
  const result = runCommand('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'])
  if (result.status !== 0) {
    return []
  }

  const urls = []
  for (const line of result.stdout.split('\n')) {
    if (!/Python|serena/i.test(line)) {
      continue
    }

    const match = line.match(/127\.0\.0\.1:(2428\d)\s+\(LISTEN\)/)
    if (match) {
      urls.push(`http://127.0.0.1:${match[1]}/dashboard/`)
    }
  }

  return Array.from(new Set(urls)).sort()
}

function runGitNexus(args, options = {}) {
  // 所有 GitNexus 调用都经过这里，确保缺失工具时行为一致，也方便后续统一接入版本锁定或日志文件。
  // 调用方传入的是 GitNexus 子命令参数，不需要关心当前命令来自本地 bin、全局安装还是显式 npx fallback。
  const gitnexus = resolveGitNexusCommand()
  if (!gitnexus) {
    // 自动化脚本默认降级为提醒而不是失败，避免新机器尚未安装 GitNexus 时阻断正常开发。
    logWarn('GitNexus 未安装或未启用，已跳过。可安装 gitnexus，或设置 PETCLAW_GITNEXUS_USE_NPX=1 临时使用 npx。')
    return {
      skipped: true,
      status: 0,
      stdout: '',
      stderr: ''
    }
  }

  const result = spawnSync(gitnexus.command, [...gitnexus.argsPrefix, ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs
  })

  return {
    skipped: false,
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error
  }
}

function runGitNexusForRepo(args, options = {}) {
  // 面向项目索引的 GitNexus 调用统一走这里；status/list 这类当前仓库命令仍可直接使用 runGitNexus。
  return runGitNexus(withGitNexusRepo(args), options)
}

function isGitNexusEnvironmentError(result) {
  // 这些错误表示本地工具链不可用：索引库被 MCP/CLI 占用、registry 无法写入、沙箱限制 home 目录等。
  // 它们不代表业务代码有风险，因此脚本应该降级到本地搜索或宽松提示，而不是继续抢锁重建索引。
  if (!result || result.skipped || result.status === 0) {
    return false
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error ? result.error.message : ''}`
  return /(\.gitnexus|\.lbug|lbug|registry\.json|EACCES|EPERM|permission denied|operation not permitted|lock|locked|busy|resource temporarily unavailable|database is locked|failed to acquire|cannot acquire|unable to acquire|already in use)/i.test(output)
}

function describeGitNexusEnvironmentError(result) {
  // 日志只给出可行动的结论，不原样展开大量堆栈；需要细节时用户可以重新运行原命令查看 stderr。
  const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}\n${result?.error ? result.error.message : ''}`
  if (/registry\.json/i.test(output)) {
    return 'GitNexus 全局 registry 权限异常，已降级处理。可稍后运行 pnpm ai:tools:check 查看工具链状态。'
  }

  if (/(\.gitnexus|\.lbug|lbug|lock|locked|busy|database is locked|already in use)/i.test(output)) {
    return 'GitNexus 本地索引库被其它进程占用，已降级处理。可稍后关闭占用的 GitNexus MCP/CLI 后再运行 pnpm ai:index。'
  }

  return 'GitNexus 工具链环境异常，已降级处理。该问题不视为业务代码风险。'
}

function isGitNexusRepoRegistered() {
  const repoName = getGitNexusRepoName()
  return getGitNexusList().some((repo) => repo.alias === repoName)
}

function hasStagedChanges() {
  // pre-commit 阶段只分析已经进入暂存区的变更，避免把用户未准备提交的草稿也纳入风险报告。
  const result = spawnSync('git', ['diff', '--cached', '--quiet'], {
    cwd: PROJECT_ROOT,
    stdio: 'ignore'
  })

  return result.status === 1
}

function hasWorkingTreeChanges() {
  // prepare-change 阶段提醒 AI 注意已有草稿，避免它把用户未提交改动当成自己的上下文随手覆盖。
  const result = spawnSync('git', ['diff', '--quiet'], {
    cwd: PROJECT_ROOT,
    stdio: 'ignore'
  })

  return result.status === 1
}

function looksLikeStaleIndex(output, status) {
  if (status !== 0) {
    return true
  }

  // GitNexus 版本可能调整 status 文案，因此这里用宽松关键字判断 stale / missing / outdated 等常见状态。
  return /stale|outdated|missing|not indexed|no index|needs? analyze|需要|过期|未索引/i.test(output)
}

module.exports = {
  AI_TOOLS_DIR,
  PROJECT_MCP_CONFIG,
  PROJECT_ROOT,
  createMcpServersConfig,
  getCommandVersion,
  getGitNexusListResult,
  getGitNexusRepoName,
  getSerenaDashboardUrls,
  hasCommand,
  isGitNexusRepoRegistered,
  isGitNexusEnvironmentError,
  hasStagedChanges,
  hasWorkingTreeChanges,
  describeGitNexusEnvironmentError,
  logInfo,
  logWarn,
  looksLikeStaleIndex,
  resolveGitNexusCommand,
  runCommand,
  runGitNexus,
  runGitNexusForRepo
}
