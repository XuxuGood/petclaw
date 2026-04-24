'use strict'

/**
 * 确保 package.json#openclaw.plugins 声明的第三方插件已下载并放置到运行时扩展目录。
 *
 * 使用 OpenClaw CLI（openclaw plugins install）处理下载、依赖解析和模块安装。
 *
 * 每个插件的安装流程：
 *   1. 检查本地缓存 vendor/openclaw-plugins/{id}/
 *   2. 若缓存版本不匹配则通过 `openclaw plugins install` 重新下载
 *   3. 将插件复制到 vendor/openclaw-runtime/current/third-party-extensions/{id}/
 *
 * 支持的插件来源（通过 npm 字段声明）：
 *   - npm registry：普通包名（如 openclaw-xxx@1.0.0）
 *   - 私有 registry：配合 plugin.registry 字段
 *   - Git/GitHub：git+https://、github:、git@github.com: 等
 *   - 本地路径：file:、./ 等
 *
 * 环境变量：
 *   OPENCLAW_SKIP_PLUGINS          – 设为 "1" 完全跳过本脚本
 *   OPENCLAW_FORCE_PLUGIN_INSTALL  – 设为 "1" 强制重新下载所有插件
 */

const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

const rootDir = path.resolve(__dirname, '..')

function log(msg) {
  console.log(`[openclaw-plugins] ${msg}`)
}

function die(msg) {
  console.error(`[openclaw-plugins] ERROR: ${msg}`)
  process.exit(1)
}

function copyDirRecursive(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true })
}

/**
 * 修复 node_modules/.bin/ 中因复制 staging 目录而产生的绝对路径 symlink。
 *
 * npm 在 `openclaw plugins install` 时会创建指向 staging 临时目录的绝对 symlink，
 * 复制出 staging 后这些 symlink 就失效了。本函数将其重写为正确的相对路径。
 * 例如：/tmp/.../extensions/plugin/node_modules/foo/bin/foo -> ../foo/bin/foo
 */
function fixBinSymlinks(baseDir) {
  const walk = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isSymbolicLink()) {
        const binDir = path.dirname(full)
        // 只处理 .bin 目录下的 symlink
        if (path.basename(binDir) !== '.bin') continue
        const target = fs.readlinkSync(full)
        if (!path.isAbsolute(target)) continue
        // 从绝对路径中提取相对于 node_modules/ 的路径片段
        // 如："/tmp/.../extensions/plugin/node_modules/qrcode/bin/qrcode"
        //  -> "qrcode/bin/qrcode"
        const nmSegment = '/node_modules/'
        const nmIdx = target.lastIndexOf(nmSegment)
        if (nmIdx === -1) continue
        const relToNm = target.slice(nmIdx + nmSegment.length) // "qrcode/bin/qrcode"
        const newTarget = path.join('..', relToNm)             // "../qrcode/bin/qrcode"
        try {
          fs.unlinkSync(full)
          fs.symlinkSync(newTarget, full)
        } catch {
          // 尽力修复，失败不中断流程
        }
      }
    }
  }
  walk(baseDir)
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

/**
 * 判断是否为本地路径 spec（file:、./、../、绝对路径、Windows 盘符路径）。
 */
function isLocalPathSpec(spec) {
  if (!spec || typeof spec !== 'string') return false
  if (spec.startsWith('file:')) return true
  if (path.isAbsolute(spec)) return true
  if (spec.startsWith('./') || spec.startsWith('../')) return true
  if (spec === '.' || spec === '..') return true
  // Windows 盘符路径，如 C:\foo\bar
  if (/^[a-zA-Z]:[\\/]/.test(spec)) return true
  return false
}

/**
 * 判断是否为 Git spec（git+、github:、git@github.com: 或 GitHub HTTPS URL）。
 */
function isGitSpec(spec) {
  if (!spec || typeof spec !== 'string') return false
  if (spec.startsWith('git+')) return true
  if (spec.startsWith('github:')) return true
  if (/^git@github\.com:/i.test(spec)) return true
  if (/^https?:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?(?:#.+)?$/i.test(spec)) return true
  return false
}

/**
 * 若 spec 是 Git URL 且未包含 # 引用，则将 version 以 #version 形式追加。
 */
function resolveGitPackSpec(spec, version) {
  if (!isGitSpec(spec)) {
    return spec
  }
  if (!version || spec.includes('#')) {
    return spec
  }
  return `${spec}#${version}`
}

/**
 * 解析 Git spec 为 { cloneUrl, ref }。
 */
function parseGitSpec(spec, version) {
  if (!isGitSpec(spec)) {
    return null
  }

  const resolved = resolveGitPackSpec(spec, version)
  const hashIndex = resolved.lastIndexOf('#')
  const ref = hashIndex >= 0 ? resolved.slice(hashIndex + 1) : null
  const rawSource = hashIndex >= 0 ? resolved.slice(0, hashIndex) : resolved

  if (rawSource.startsWith('github:')) {
    return {
      cloneUrl: `https://github.com/${rawSource.slice('github:'.length)}.git`,
      ref,
    }
  }

  if (rawSource.startsWith('git+')) {
    return {
      cloneUrl: rawSource.slice(4),
      ref,
    }
  }

  return {
    cloneUrl: rawSource,
    ref,
  }
}

/**
 * 判断 ref 是否为 commit hash（7-40 位十六进制）。
 */
function isCommitHashRef(ref) {
  return typeof ref === 'string' && /^[0-9a-f]{7,40}$/i.test(ref)
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * 构建 npm pack 时使用的环境变量，清除离线/在线偏好以避免缓存冲突。
 */
function buildNpmPackEnv() {
  return {
    ...process.env,
    npm_config_prefer_offline: '',
    npm_config_prefer_online: '',
    NPM_CONFIG_PREFER_OFFLINE: '',
    NPM_CONFIG_PREFER_ONLINE: '',
  }
}

/**
 * 构建 git 操作时使用的环境变量，禁用终端交互提示。
 */
function buildGitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  }
}

/**
 * 调用运行时内置的 OpenClaw CLI（openclaw.mjs）。
 *
 * 通过 OPENCLAW_STATE_DIR 控制插件安装到 staging 目录，避免污染用户全局配置。
 */
function runOpenClawCli(args, opts = {}) {
  const openclawMjs = path.join(
    rootDir, 'vendor', 'openclaw-runtime', 'current', 'openclaw.mjs'
  )

  if (!fs.existsSync(openclawMjs)) {
    throw new Error(`OpenClaw CLI 未找到：${openclawMjs}`)
  }

  const result = spawnSync(process.execPath, [openclawMjs, ...args], {
    encoding: 'utf-8',
    stdio: opts.stdio || 'inherit',
    cwd: opts.cwd || rootDir,
    env: { ...process.env, ...opts.env },
    timeout: opts.timeout || 5 * 60 * 1000,
  })

  if (result.error) {
    throw new Error(`openclaw ${args.join(' ')} 失败：${result.error.message}`)
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim()
    throw new Error(
      `openclaw ${args.join(' ')} 退出码 ${result.status}` +
      (stderr ? `\n${stderr}` : '')
    )
  }

  return (result.stdout || '').trim()
}

/**
 * 用 npm pack 将插件打包为 .tgz，返回 tgz 文件路径。
 *
 * 先打包再安装可避免直接 npm install 时产生的 peerDep 冲突问题。
 */
function npmPack(packSpec, registry, outputDir) {
  const isWin = process.platform === 'win32'
  const npmBin = isWin ? 'npm.cmd' : 'npm'
  const args = ['pack', packSpec, '--pack-destination', outputDir]
  if (registry) {
    args.push(`--registry=${registry}`)
  }

  const result = spawnSync(npmBin, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: outputDir,
    env: buildNpmPackEnv(),
    shell: isWin,
    timeout: 3 * 60 * 1000,
    windowsVerbatimArguments: isWin,
  })

  if (result.error) {
    throw new Error(`npm pack ${packSpec} 失败：${result.error.message}`)
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim()
    throw new Error(
      `npm pack ${packSpec} 退出码 ${result.status}` +
      (stderr ? `\n${stderr}` : '')
    )
  }

  // npm pack 会将 tgz 文件名输出到 stdout
  const tgzName = (result.stdout || '').trim().split('\n').pop()
  return path.join(outputDir, tgzName)
}

/**
 * Git clone 后再 npm pack，返回 tgz 路径。
 *
 * 对 commit hash ref 使用 fetch --depth 1 单提交拉取，避免全量 clone。
 */
function gitCloneAndPack(spec, version, outputDir) {
  const parsed = parseGitSpec(spec, version)
  if (!parsed) {
    throw new Error(`不支持的 git spec：${spec}`)
  }

  const sourceDir = path.join(outputDir, 'git-source')
  const gitEnv = buildGitEnv()

  if (parsed.ref && isCommitHashRef(parsed.ref)) {
    // commit hash：先 init 再 fetch 单个提交，避免拉取全部历史
    fs.mkdirSync(sourceDir, { recursive: true })

    const runGit = (args, desc) => {
      const r = spawnSync('git', args, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: sourceDir,
        env: gitEnv,
        timeout: 5 * 60 * 1000,
      })
      if (r.error) throw new Error(`${desc} 失败：${r.error.message}`)
      if (r.status !== 0) {
        const stderr = (r.stderr || '').trim()
        throw new Error(`${desc} 退出码 ${r.status}${stderr ? `\n${stderr}` : ''}`)
      }
      return r
    }

    runGit(['init'], `git init ${sourceDir}`)
    runGit(['remote', 'add', 'origin', parsed.cloneUrl], `git remote add origin ${parsed.cloneUrl}`)
    runGit(['fetch', '--depth', '1', 'origin', parsed.ref], `git fetch ${parsed.cloneUrl} ${parsed.ref}`)
    runGit(['checkout', '--detach', 'FETCH_HEAD'], 'git checkout FETCH_HEAD')
  } else {
    // 分支/tag：直接 clone --depth 1
    const cloneArgs = ['clone', '--depth', '1']
    if (parsed.ref) {
      cloneArgs.push('--branch', parsed.ref)
    }
    cloneArgs.push(parsed.cloneUrl, sourceDir)

    const cloneResult = spawnSync('git', cloneArgs, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: outputDir,
      env: gitEnv,
      timeout: 5 * 60 * 1000,
    })

    if (cloneResult.error) {
      throw new Error(`git clone ${parsed.cloneUrl} 失败：${cloneResult.error.message}`)
    }
    if (cloneResult.status !== 0) {
      const stderr = (cloneResult.stderr || '').trim()
      throw new Error(
        `git clone ${parsed.cloneUrl} 退出码 ${cloneResult.status}` +
        (stderr ? `\n${stderr}` : '')
      )
    }
  }

  return npmPack(sourceDir, null, outputDir)
}

/**
 * 根据 plugin 配置解析安装来源，返回带 kind 标记的对象：
 *   - 'packed'：自定义 registry，通过 npm pack 下载 tgz
 *   - 'git'：Git URL，通过 git clone + npm pack
 *   - 'direct'：本地路径或标准 npm spec，直接传给 openclaw CLI
 */
function resolvePluginInstallSource(plugin) {
  const { npm: npmSpec, version, registry } = plugin

  if (registry) {
    return {
      kind: 'packed',
      packSpec: `${npmSpec}@${version}`,
      pinnedDisplaySpec: `${npmSpec}@${version}`,
      registry,
    }
  }

  if (isGitSpec(npmSpec)) {
    return {
      kind: 'git',
      gitSpec: resolveGitPackSpec(npmSpec, version),
      pinnedDisplaySpec: resolveGitPackSpec(npmSpec, version),
    }
  }

  if (isLocalPathSpec(npmSpec)) {
    return {
      kind: 'direct',
      installSpec: npmSpec,
      pinnedDisplaySpec: npmSpec,
    }
  }

  // 标准 npm registry 包
  return {
    kind: 'direct',
    installSpec: `${npmSpec}@${version}`,
    pinnedDisplaySpec: `${npmSpec}@${version}`,
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
  // 环境变量控制：完全跳过
  if (process.env.OPENCLAW_SKIP_PLUGINS === '1') {
    log('OPENCLAW_SKIP_PLUGINS=1，跳过插件安装。')
    process.exit(0)
  }

  // 读取 package.json 中的插件声明
  const pkg = require(path.join(rootDir, 'package.json'))
  const plugins = (pkg.openclaw && pkg.openclaw.plugins) || []

  if (!Array.isArray(plugins) || plugins.length === 0) {
    log('package.json 中未声明插件，无需处理。')
    process.exit(0)
  }

  // 校验插件声明必填字段
  for (const plugin of plugins) {
    if (!plugin.id || !plugin.npm || !plugin.version) {
      die(
        `插件声明无效：${JSON.stringify(plugin)}。` +
        '每个插件必须包含 "id"、"npm" 和 "version" 字段。'
      )
    }
  }

  // 环境变量控制：强制重装
  const forceInstall = process.env.OPENCLAW_FORCE_PLUGIN_INSTALL === '1'
  const pluginCacheBase = path.join(rootDir, 'vendor', 'openclaw-plugins')
  const runtimeCurrentDir = path.join(rootDir, 'vendor', 'openclaw-runtime', 'current')

  // third-party-extensions/ 是网关不会主动扫描的目录，通过 plugins.load.paths 配置加载，
  // 避免触发 bundled-channel-entry 契约检查导致加载失败。
  const runtimeExtensionsDir = path.join(runtimeCurrentDir, 'third-party-extensions')

  ensureDir(runtimeExtensionsDir)
  ensureDir(pluginCacheBase)

  log(`共 ${plugins.length} 个插件待处理...`)

  for (const plugin of plugins) {
    const { id, npm: npmSpec, version, optional } = plugin
    const cacheDir = path.join(pluginCacheBase, id)
    // 缓存元数据文件，包含 pluginId/npmSpec/version/installedAt
    const installInfoPath = path.join(cacheDir, 'plugin-install-info.json')
    const targetDir = path.join(runtimeExtensionsDir, id)

    log(`--- 插件：${id} (${npmSpec}@${version}) ---`)

    // 检查缓存命中
    let needsDownload = true
    if (!forceInstall && fs.existsSync(installInfoPath)) {
      const info = readJsonFile(installInfoPath)
      if (info && info.version === version && info.npmSpec === npmSpec) {
        log(`缓存命中（version=${version}），跳过下载。`)
        needsDownload = false
      } else {
        log(`缓存版本不匹配（已缓存=${info?.version || '无'}，需要=${version}）。`)
      }
    }

    if (needsDownload) {
      const source = resolvePluginInstallSource(plugin)
      log(`正在安装 ${source.pinnedDisplaySpec}（通过 OpenClaw CLI）...`)

      // 使用 os.tmpdir() 临时目录作为 OPENCLAW_STATE_DIR，
      // 确保 CLI 安装到 staging 而非用户全局配置目录。
      const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-plugin-staging-'))

      try {
        let installSpec

        if (source.kind === 'git') {
          log('  从 Git 来源 clone 并打包...')
          installSpec = gitCloneAndPack(npmSpec, version, stagingDir)
        } else if (source.kind === 'packed') {
          if (source.registry) {
            log(`  从私有 registry 打包：${source.registry}`)
          }
          installSpec = npmPack(source.packSpec, source.registry, stagingDir)
        } else {
          // 直接 spec（本地路径或标准 npm）
          installSpec = source.installSpec
        }

        runOpenClawCli(
          ['plugins', 'install', installSpec, '--force', '--dangerously-force-unsafe-install'],
          {
            env: {
              OPENCLAW_STATE_DIR: stagingDir,
              // 禁止 npm v7+ 自动安装 peerDependencies。
              // 插件将 openclaw 声明为 peerDep，运行时网关已在运行时提供 SDK，
              // 不传此参数 npm 会将完整 openclaw SDK（~738 MB）装入每个插件。
              npm_config_legacy_peer_deps: 'true',
            },
            stdio: 'inherit',
          }
        )

        // CLI 将插件安装到 {OPENCLAW_STATE_DIR}/extensions/{pluginId}/
        const installedDir = path.join(stagingDir, 'extensions', id)
        if (!fs.existsSync(installedDir)) {
          // 部分插件的目录名与声明的 id 不同，扫描 extensions/ 找到实际目录
          const extDir = path.join(stagingDir, 'extensions')
          const entries = fs.existsSync(extDir) ? fs.readdirSync(extDir) : []
          if (entries.length === 0) {
            throw new Error('安装完成后 staging 目录中未找到任何插件')
          }
          const actualDir = path.join(extDir, entries[0])
          if (
            !fs.existsSync(path.join(actualDir, 'openclaw.plugin.json')) &&
            !fs.existsSync(path.join(actualDir, 'package.json'))
          ) {
            throw new Error(`安装后的插件目录 ${entries[0]} 缺少插件 manifest`)
          }
          // 复制到缓存
          if (fs.existsSync(cacheDir)) {
            fs.rmSync(cacheDir, { recursive: true, force: true })
          }
          ensureDir(path.dirname(cacheDir))
          copyDirRecursive(actualDir, cacheDir)
          fixBinSymlinks(cacheDir)
        } else {
          // 替换缓存
          if (fs.existsSync(cacheDir)) {
            fs.rmSync(cacheDir, { recursive: true, force: true })
          }
          ensureDir(path.dirname(cacheDir))
          copyDirRecursive(installedDir, cacheDir)
          fixBinSymlinks(cacheDir)
        }

        // 写入缓存元数据，供下次构建判断是否命中
        fs.writeFileSync(
          installInfoPath,
          JSON.stringify(
            {
              pluginId: id,
              npmSpec,
              version,
              installedAt: new Date().toISOString(),
            },
            null,
            2
          ) + '\n',
          'utf-8'
        )

        log(`${id}@${version} 已下载并缓存。`)
      } catch (err) {
        if (optional) {
          // optional 插件失败优雅跳过，不中断整体构建
          log(`警告：可选插件 ${id} 安装失败，跳过：${err.message}`)
          log(`跳过 ${id}（可能无法从当前网络访问）。`)
          continue
        }
        die(`插件 ${id} 安装失败：${err.message}`)
      } finally {
        // 清理 staging 临时目录
        try {
          fs.rmSync(stagingDir, { recursive: true, force: true })
        } catch {
          // 尽力清理，失败不影响主流程
        }
      }
    }

    // 将缓存复制到运行时扩展目录
    if (!fs.existsSync(cacheDir)) {
      if (optional) {
        log(`跳过 ${id}（可选插件缓存不存在）。`)
        continue
      }
      die(`插件缓存目录安装后仍不存在：${cacheDir}`)
    }

    // 清除旧版本后重新复制
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
    copyDirRecursive(cacheDir, targetDir)

    // 移除目标目录中的缓存元数据文件（仅用于缓存校验，不应进入运行时）
    const targetInfoPath = path.join(targetDir, 'plugin-install-info.json')
    if (fs.existsSync(targetInfoPath)) {
      fs.unlinkSync(targetInfoPath)
    }

    log(`${id} 已安装 -> ${path.relative(rootDir, targetDir)}`)
  }

  log(`全部 ${plugins.length} 个插件安装完成。`)
}

if (require.main === module) {
  main()
}

module.exports = {
  buildNpmPackEnv,
  buildGitEnv,
  gitCloneAndPack,
  isGitSpec,
  isLocalPathSpec,
  main,
  npmPack,
  parseGitSpec,
  resolveGitPackSpec,
  resolvePluginInstallSource,
}