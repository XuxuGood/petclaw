// scripts/prune-openclaw-runtime.cjs
// 裁剪 openclaw runtime 体积：删除未用扩展、stub 大包、清理无用文件

'use strict'

const fs = require('fs')
const path = require('path')

// ─── 策略 1：文件清理模式（正则匹配，比字符串更准确） ───

const PATTERNS_TO_DELETE = [
  // Source map 文件
  /\.map$/i,
  // TypeScript 类型声明（运行时不需要）
  /\.d\.ts$/i,
  /\.d\.cts$/i,
  /\.d\.mts$/i,
  // 文档文件
  /^readme(\.(md|txt|rst))?$/i,
  /^changelog(\.(md|txt|rst))?$/i,
  /^history(\.(md|txt|rst))?$/i,
  /^license(\.(md|txt))?$/i,
  /^licence(\.(md|txt))?$/i,
  /^authors(\.(md|txt))?$/i,
  /^contributors(\.(md|txt))?$/i,
  // 运行时不需要的配置文件
  /^\.eslintrc/i,
  /^\.prettierrc/i,
  /^\.editorconfig$/i,
  /^\.npmignore$/i,
  /^\.gitignore$/i,
  /^\.gitattributes$/i,
  /^tsconfig(\..+)?\.json$/i,
  /^jest\.config/i,
  /^vitest\.config/i,
  /^\.babelrc/i,
  /^babel\.config/i,
  // 测试文件
  /\.test\.\w+$/i,
  /\.spec\.\w+$/i,
]

const DIRS_TO_DELETE = new Set([
  'test', 'tests', '__tests__', '__mocks__',
  '.github', 'example', 'examples', 'coverage',
])

// ─── 策略 2：保留的 bundled extensions 白名单 ───
// OpenClaw 启动时扫描 dist/extensions/ 下所有目录，即使被 deny 也要读取 manifest。
// 在 Windows NTFS 上这会导致 ~30s 的同步 I/O，物理删除是唯一规避方式。
// 使用白名单策略：runtime 升级带来的新扩展自动被裁剪，除非显式加入白名单。

const BUNDLED_EXTENSIONS_TO_KEEP = new Set([
  // Providers（LLM 提供商）
  'anthropic', 'deepseek', 'google', 'kimi-coding', 'minimax', 'moonshot',
  'ollama', 'openai', 'openrouter', 'qianfan', 'qwen', 'stepfun', 'volcengine',
  // Channels（IM 渠道）
  'telegram', 'discord', 'feishu', 'qqbot',
  // Core（核心功能）
  'browser', 'memory-core', 'llm-task', 'zai',
  // Media / Voice（媒体处理，可能被 agent 调用）
  'image-generation-core', 'media-understanding-core', 'speech-core', 'talk-voice',
  // Internal（内部扩展）
  'acpx', 'thread-ownership', 'memory-lancedb', 'memory-wiki',
])

function shouldKeepBundledExtension(extensionId) {
  return BUNDLED_EXTENSIONS_TO_KEEP.has(extensionId)
}

// ─── 策略 3：Stub 替换大型不需要的包 ───
// 替换后 require/import 仍然成功，但调用时抛出错误。
// 调用方已有 try-catch 保护，不影响正常启动。

const PACKAGES_TO_STUB = [
  'koffi',                  // Windows FFI / PTY 终端，gateway 模式不需要
  '@tloncorp/tlon-skill',   // Tlon 渠道扩展，PetClaw 不使用
  '@lancedb',               // 向量数据库，运行时由 stub 替代
  '@jimp',                  // 图像处理，运行时不需要
  '@napi-rs',               // 原生 Node.js 绑定，平台包过大
  'pdfjs-dist',             // PDF 解析，占用较大
  '@matrix-org',            // Matrix 协议，PetClaw 不使用
]

// CJS stub：兼容 require()，同时处理 __esModule/default/then 属性
const GENERIC_STUB_INDEX_CJS = `// Stub (CJS)：此包在当前构建中不可用
module.exports = new Proxy({}, {
  get(_, prop) {
    if (prop === '__esModule') return false;
    if (prop === 'default') return module.exports;
    if (prop === 'then') return undefined; // 防止 await import() 误判为 Promise
    return function() {
      throw new Error(require('./package.json').name + ' is not available in this build');
    };
  }
});
`

// ESM stub：兼容 import，同时导出常见命名导出以防 named import 报错
const GENERIC_STUB_INDEX_ESM = `// Stub (ESM)：此包在当前构建中不可用
const handler = {
  get(_, prop) {
    if (prop === 'then') return undefined; // 防止 await import() 误判为 Promise
    return function() {
      throw new Error('This package is not available in this build (stub)');
    };
  }
};
const stub = new Proxy({}, handler);
export default stub;
export const version = '0.0.0-stub';
`

/**
 * 将指定包目录替换为轻量 stub（CJS + ESM 双格式）
 * @param {string} pkgDir - 包目录绝对路径
 * @param {string} pkgName - 包名（用于 package.json 和错误信息）
 * @param {object} stats - 统计对象
 */
function stubPackage(pkgDir, pkgName, stats) {
  if (!fs.existsSync(pkgDir)) return

  // 保留原始版本号，方便排查版本依赖问题
  let version = '0.0.0-stub'
  try {
    const origPkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
    version = origPkg.version || version
  } catch { /* 读不到就用默认版本 */ }

  // 删除原始内容后重建 stub 目录
  fs.rmSync(pkgDir, { recursive: true, force: true })
  fs.mkdirSync(pkgDir, { recursive: true })

  // 写入 CJS + ESM 双格式 stub
  fs.writeFileSync(path.join(pkgDir, 'index.js'), GENERIC_STUB_INDEX_CJS, 'utf8')
  fs.writeFileSync(path.join(pkgDir, 'index.mjs'), GENERIC_STUB_INDEX_ESM, 'utf8')

  // package.json exports 字段同时声明 CJS/ESM 入口
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
    name: pkgName,
    version,
    main: 'index.js',
    exports: {
      '.': {
        import: './index.mjs',
        require: './index.js',
        default: './index.js',
      },
    },
  }, null, 2) + '\n', 'utf8')

  stats.stubbed.push(pkgName)
}

// ─── 文件清理 ───

function shouldDeleteFile(filename) {
  return PATTERNS_TO_DELETE.some((pattern) => pattern.test(filename))
}

/**
 * 递归清理目录中的无用文件和目录
 * @param {string} dirPath - 目标目录
 * @param {object} stats - 统计对象
 */
function cleanDir(dirPath, stats) {
  let entries
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      if (DIRS_TO_DELETE.has(entry.name.toLowerCase())) {
        // 整个目录一并删除（test、coverage 等）
        fs.rmSync(fullPath, { recursive: true, force: true })
        stats.dirsRemoved++
        continue
      }
      cleanDir(fullPath, stats)
      // 清理后若目录已空，顺手删除空目录
      try {
        const remaining = fs.readdirSync(fullPath)
        if (remaining.length === 0) {
          fs.rmdirSync(fullPath)
        }
      } catch { /* ignore */ }
    } else if (entry.isFile() && shouldDeleteFile(entry.name)) {
      try {
        const size = fs.statSync(fullPath).size
        fs.unlinkSync(fullPath)
        stats.filesRemoved++
        stats.bytesFreed += size
      } catch { /* ignore */ }
    }
  }
}

// ─── 工具函数 ───

function getDirSize(dirPath) {
  let total = 0
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        total += getDirSize(fullPath)
      } else {
        try { total += fs.statSync(fullPath).size } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return total
}

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

// ─── 主流程 ───

function main() {
  // 支持通过命令行参数传入 runtime 根路径，方便 CI/CD 复用
  const runtimeRoot = process.argv[2]
    || path.join(__dirname, '..', 'vendor', 'openclaw-runtime', 'current')

  if (!fs.existsSync(runtimeRoot)) {
    console.log(`[prune] Runtime not found, skipping: ${runtimeRoot}`)
    process.exit(0)
  }

  const nodeModulesDir = path.join(runtimeRoot, 'node_modules')
  if (!fs.existsSync(nodeModulesDir)) {
    console.log('[prune] No node_modules found, skipping.')
    return
  }

  console.log(`[prune] Cleaning ${runtimeRoot} ...`)

  // 分类统计，方便定位裁剪效果
  const stats = {
    extensionsPruned: [],
    stubbed: [],
    filesRemoved: 0,
    dirsRemoved: 0,
    bytesFreed: 0,
  }

  const distExtDir = path.join(runtimeRoot, 'dist', 'extensions')
  const thirdPartyDir = path.join(runtimeRoot, 'third-party-extensions')

  // === Step 1：移除白名单以外的 bundled extensions ===
  if (fs.existsSync(distExtDir)) {
    try {
      for (const entry of fs.readdirSync(distExtDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        if (shouldKeepBundledExtension(entry.name)) continue
        const fullPath = path.join(distExtDir, entry.name)
        fs.rmSync(fullPath, { recursive: true, force: true })
        stats.extensionsPruned.push(entry.name)
      }
    } catch (err) {
      console.warn(`[prune] Failed to prune dist/extensions: ${err.message}`)
    }
  }

  // === Step 1a：外部 openclaw-lark 存在时，移除 bundled feishu（避免重复） ===
  // openclaw-lark 是飞书渠道的第三方实现，优先级高于 dist/extensions/feishu
  const externalLarkDir = path.join(thirdPartyDir, 'openclaw-lark')
  const bundledFeishuDir = path.join(distExtDir, 'feishu')
  if (fs.existsSync(externalLarkDir) && fs.existsSync(bundledFeishuDir)) {
    const size = getDirSize(bundledFeishuDir)
    fs.rmSync(bundledFeishuDir, { recursive: true, force: true })
    stats.bytesFreed += size
    stats.dirsRemoved++
    console.log(`[prune] Removed bundled feishu (openclaw-lark present) (${formatMB(size)})`)
  }

  // === Step 1b：移除旧版遗留的 external openclaw-qqbot（旧构建产物） ===
  const staleExternalQqbotDir = path.join(thirdPartyDir, 'openclaw-qqbot')
  if (fs.existsSync(staleExternalQqbotDir)) {
    const size = getDirSize(staleExternalQqbotDir)
    fs.rmSync(staleExternalQqbotDir, { recursive: true, force: true })
    stats.bytesFreed += size
    stats.dirsRemoved++
    console.log(`[prune] Removed stale external openclaw-qqbot (${formatMB(size)})`)
  }

  // === Step 2：Stub 大型不需要的包（保留 require/import 但调用时报错） ===
  for (const pkgName of PACKAGES_TO_STUB) {
    stubPackage(path.join(nodeModulesDir, pkgName), pkgName, stats)
  }

  // === Step 2a：清理孤儿平台二进制包（scoped 包 stub 后遗留的平台子包） ===
  // 例如 @tloncorp/tlon-skill stub 后，@tloncorp/tlon-skill-darwin-x64 变成孤儿
  for (const pkgName of PACKAGES_TO_STUB) {
    if (!pkgName.startsWith('@')) continue
    const [scope, base] = pkgName.split('/')
    const scopeDir = path.join(nodeModulesDir, scope)
    if (!fs.existsSync(scopeDir)) continue

    for (const entry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name === base) continue
      // 只清理 base 包的平台变体（如 base-darwin-x64、base-win32-x64）
      if (!entry.name.startsWith(base + '-')) continue

      const variantDir = path.join(scopeDir, entry.name)
      const size = getDirSize(variantDir)
      fs.rmSync(variantDir, { recursive: true, force: true })
      stats.bytesFreed += size
      stats.dirsRemoved++
      console.log(`[prune] Removed orphaned platform binary ${scope}/${entry.name} (${formatMB(size)})`)
    }
  }

  // === Step 2b：清理 .bin 中的断链 symlink（stub 后原目标已删除） ===
  const binDir = path.join(nodeModulesDir, '.bin')
  if (fs.existsSync(binDir)) {
    try {
      for (const entry of fs.readdirSync(binDir)) {
        const linkPath = path.join(binDir, entry)
        try {
          fs.statSync(linkPath) // 跟随 symlink，目标不存在时抛出
        } catch {
          // 目标已不存在，断链，删掉它
          fs.unlinkSync(linkPath)
          stats.filesRemoved++
        }
      }
    } catch { /* ignore */ }
  }

  // === Step 2c：清理 third-party-extensions 中重复的 openclaw SDK ===
  // npm v7+ 会把 peerDependency 自动装入插件的 node_modules（~226 MB）。
  // 运行时 gateway 已提供 SDK，插件内的副本是多余的。
  if (fs.existsSync(thirdPartyDir)) {
    try {
      for (const plugin of fs.readdirSync(thirdPartyDir, { withFileTypes: true })) {
        if (!plugin.isDirectory()) continue
        const dupeOC = path.join(thirdPartyDir, plugin.name, 'node_modules', 'openclaw')
        if (fs.existsSync(dupeOC)) {
          const size = getDirSize(dupeOC)
          fs.rmSync(dupeOC, { recursive: true, force: true })
          stats.bytesFreed += size
          stats.dirsRemoved++
          console.log(`[prune] Removed duplicate openclaw SDK from ${plugin.name} (${formatMB(size)})`)
        }
      }
    } catch (err) {
      console.warn(`[prune] Failed to prune openclaw from third-party-extensions: ${err.message}`)
    }
  }

  // === Step 3：清理 node_modules 中的无用文件 ===
  cleanDir(nodeModulesDir, stats)

  // === Step 4：清理 dist/extensions/*/node_modules 内的无用文件 ===
  // extensions 内的 node_modules 可能包含 .map、.d.ts 等开发文件
  if (fs.existsSync(distExtDir)) {
    try {
      for (const ext of fs.readdirSync(distExtDir, { withFileTypes: true })) {
        if (!ext.isDirectory()) continue
        const extNodeModules = path.join(distExtDir, ext.name, 'node_modules')
        if (fs.existsSync(extNodeModules)) {
          cleanDir(extNodeModules, stats)
        }
      }
    } catch { /* ignore */ }
  }

  // === 统计报表 ===
  console.log('')
  if (stats.extensionsPruned.length > 0) {
    console.log(`[prune] Extensions pruned: ${stats.extensionsPruned.length} (${stats.extensionsPruned.join(', ')})`)
  }
  console.log(`[prune] Packages stubbed: ${stats.stubbed.length > 0 ? stats.stubbed.join(', ') : 'none'}`)
  console.log(`[prune] Files removed: ${stats.filesRemoved}, Dirs removed: ${stats.dirsRemoved}`)
  console.log(`[prune] Total freed: ${formatMB(stats.bytesFreed)}`)
}

// ─── 模块导出（供其他脚本引用） ───
module.exports = {
  BUNDLED_EXTENSIONS_TO_KEEP,
  shouldKeepBundledExtension,
}

// 仅直接运行时执行 main（被 require 时不执行，避免副作用）
if (require.main === module) {
  main()
}