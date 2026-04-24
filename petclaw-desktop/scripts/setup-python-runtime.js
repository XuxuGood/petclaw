#!/usr/bin/env node
// scripts/setup-python-runtime.js
// 准备 Windows 便携式 Python 运行时（resources/python-win/）
//
// 功能：
//   - 支持离线存档（PETCLAW_PORTABLE_PYTHON_ARCHIVE 环境变量）
//   - 支持自定义镜像 URL（PETCLAW_PORTABLE_PYTHON_URL）
//   - 跨平台：macOS/Linux 可通过 --required 为 Windows 准备运行时
//   - 仅打包解释器运行时，不预装 skill 依赖

'use strict';

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { spawnSync } = require('child_process');
const extractZip = require('extract-zip');

// ── 路径常量 ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..');
// Python 运行时输出目录
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'resources', 'python-win');
// 缓存的 zip 存档路径（离线/已下载过的）
const DEFAULT_ARCHIVE_PATH = path.join(PROJECT_ROOT, 'resources', 'python-win-runtime.zip');

// ── Python 版本与下载 URL ─────────────────────────────────────────────────────

// 支持环境变量覆盖版本号，方便 CI/本地测试
const DEFAULT_WINDOWS_EMBED_PYTHON_VERSION = process.env.PETCLAW_WINDOWS_EMBED_PYTHON_VERSION || '3.11.9';
const DEFAULT_WINDOWS_EMBED_PYTHON_ZIP = `python-${DEFAULT_WINDOWS_EMBED_PYTHON_VERSION}-embed-amd64.zip`;
const DEFAULT_WINDOWS_EMBED_PYTHON_URL = process.env.PETCLAW_WINDOWS_EMBED_PYTHON_URL
  || `https://www.python.org/ftp/python/${DEFAULT_WINDOWS_EMBED_PYTHON_VERSION}/${DEFAULT_WINDOWS_EMBED_PYTHON_ZIP}`;
// pip bootstrap 工具 URL，可通过环境变量指向内网镜像
const DEFAULT_GET_PIP_URL = process.env.PETCLAW_WINDOWS_GET_PIP_URL || 'https://bootstrap.pypa.io/get-pip.py';
const DEFAULT_PIP_PYZ_URL = process.env.PETCLAW_WINDOWS_PIP_PYZ_URL || 'https://bootstrap.pypa.io/pip/pip.pyz';
const DEFAULT_RUNTIME_URL = DEFAULT_WINDOWS_EMBED_PYTHON_URL;

// ── 健康检查所需文件 ──────────────────────────────────────────────────────────

// 健康检查必须存在的可执行文件
const REQUIRED_FILES = [
  'python.exe',
  'python3.exe', // 我们手动创建的别名，保证 python3 命令可用
];
// pip 可执行文件候选列表（跨平台兼容）
const PIP_EXECUTABLE_CANDIDATES = [
  path.join('Scripts', 'pip.exe'),
  path.join('Scripts', 'pip3.exe'),
  path.join('Scripts', 'pip.cmd'),
  path.join('Scripts', 'pip3.cmd'),
  path.join('Scripts', 'pip'),
  path.join('Scripts', 'pip3'),
];
// pip.pyz 存档在运行时目录内的相对路径（bootstrap 策略 2 用）
const PIP_RUNTIME_ARCHIVE_REL_PATH = path.join('tools', 'pip.pyz');
// pip 模块入口文件相对路径（健康检查用）
const PIP_MODULE_MAIN_REL_PATH = path.join('Lib', 'site-packages', 'pip', '__main__.py');
const PIP_MODULE_INIT_REL_PATH = path.join('Lib', 'site-packages', 'pip', '__init__.py');

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 检查运行时目录中是否存在任意 pip 可执行文件 */
function hasPipCommand(rootDir) {
  return PIP_EXECUTABLE_CANDIDATES.some((relPath) => fs.existsSync(path.join(rootDir, relPath)));
}

/** 检查运行时目录中是否存在 pip Python 模块 */
function hasPipModule(rootDir) {
  return fs.existsSync(path.join(rootDir, PIP_MODULE_MAIN_REL_PATH))
    || fs.existsSync(path.join(rootDir, PIP_MODULE_INIT_REL_PATH));
}

/** 解析 CLI 参数，当前只关心 --required 标志 */
function parseArgs(argv) {
  return {
    required: argv.includes('--required'),
  };
}

/**
 * 将字符串解析为绝对路径。
 * 相对路径基于当前工作目录解析。
 */
function resolveInputPath(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

/** 判断路径是否为非空文件 */
function isNonEmptyFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/** 递归统计目录总大小（字节） */
function getDirSize(dir) {
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(full);
    } else {
      size += fs.statSync(full).size;
    }
  }
  return size;
}

// ── 健康检查 ──────────────────────────────────────────────────────────────────

/**
 * 检查 Python 运行时目录健康状态。
 * @param {string} rootDir - 运行时根目录
 * @param {{ requirePython3Alias?: boolean, requirePip?: boolean }} options
 * @returns {{ ok: boolean, missing: string[] }}
 */
function checkRuntimeHealth(rootDir, options = {}) {
  const requirePython3Alias = options.requirePython3Alias !== false;
  const requirePip = options.requirePip !== false;
  const missing = [];

  for (const relPath of REQUIRED_FILES) {
    // python3.exe 是我们创建的别名，可选跳过（用于早期检查阶段）
    if (!requirePython3Alias && relPath === 'python3.exe') {
      continue;
    }
    const fullPath = path.join(rootDir, relPath);
    if (!fs.existsSync(fullPath)) {
      missing.push(relPath);
    }
  }

  if (requirePip) {
    if (!hasPipCommand(rootDir)) {
      missing.push('Scripts/pip.exe (or Scripts/pip3.exe/pip.cmd/pip3.cmd)');
    }
    if (!hasPipModule(rootDir)) {
      missing.push(PIP_MODULE_MAIN_REL_PATH.replace(/\\/g, '/'));
    }
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

// ── 文件写入工具 ──────────────────────────────────────────────────────────────

/** 仅在内容变化时写入文件，避免不必要的磁盘 IO */
function writeFileIfChanged(filePath, content) {
  try {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
      return;
    }
  } catch {
    // 忽略读取失败，直接覆写
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

// ── pip wrapper 脚本 ──────────────────────────────────────────────────────────

/**
 * 在 Scripts/ 目录下创建 pip wrapper 脚本（.cmd 和 bash 版本）。
 * wrapper 调用嵌入式 python.exe -m pip，确保使用正确的解释器。
 */
function createPipWrappers(rootDir) {
  const scriptsDir = path.join(rootDir, 'Scripts');
  // Windows .cmd wrapper：通过 %~dp0.. 定位到 python.exe
  const pipCmd = [
    '@echo off',
    'setlocal',
    'set "PYROOT=%~dp0.."',
    '"%PYROOT%\\python.exe" -m pip %*',
    '',
  ].join('\r\n');
  // bash wrapper（跨平台兼容，macOS/Linux 上测试 pip 时使用）
  const pipSh = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'PYROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"',
    'exec "${PYROOT}/python.exe" -m pip "$@"',
    '',
  ].join('\n');

  writeFileIfChanged(path.join(scriptsDir, 'pip.cmd'), pipCmd);
  writeFileIfChanged(path.join(scriptsDir, 'pip3.cmd'), pipCmd);
  writeFileIfChanged(path.join(scriptsDir, 'pip'), pipSh);
  writeFileIfChanged(path.join(scriptsDir, 'pip3'), pipSh);
  try {
    // chmod 在非 POSIX 文件系统（Windows NTFS）上会失败，安全忽略
    fs.chmodSync(path.join(scriptsDir, 'pip'), 0o755);
    fs.chmodSync(path.join(scriptsDir, 'pip3'), 0o755);
  } catch {
    // 忽略 chmod 失败
  }
}

// ── pip bootstrap：策略 1 - 从宿主 Python 复制 ───────────────────────────────

/**
 * 尝试从宿主机 python3/python 复制 pip 包到嵌入式运行时。
 * 构建机通常已安装 Python，此方法最快、无需网络。
 * @returns {{ ok: boolean, source?: string }}
 */
function tryCopyPipFromHostPython(rootDir) {
  const pythonCandidates = ['python3', 'python'];
  for (const candidate of pythonCandidates) {
    // 通过宿主 Python 自省 pip 包路径
    const probe = spawnSync(candidate, [
      '-c',
      [
        'import importlib.util, json, pathlib',
        "spec = importlib.util.find_spec('pip')",
        'if spec is None or not spec.origin:',
        "  raise SystemExit(2)",
        'pip_dir = pathlib.Path(spec.origin).resolve().parent',
        'site_dir = pip_dir.parent',
        "dist_info = [str(p) for p in site_dir.glob('pip-*.dist-info')]",
        "print(json.dumps({'pip_dir': str(pip_dir), 'dist_info': dist_info}))",
      ].join('\n'),
    ], {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 20_000,
    });

    if (probe.status !== 0 || !probe.stdout) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(probe.stdout.trim());
    } catch {
      continue;
    }

    if (!parsed || typeof parsed.pip_dir !== 'string' || !parsed.pip_dir) {
      continue;
    }

    const pipDir = parsed.pip_dir;
    if (!fs.existsSync(pipDir)) {
      continue;
    }

    // 将 pip 包目录复制到嵌入式运行时的 site-packages
    const targetSitePackages = path.join(rootDir, 'Lib', 'site-packages');
    const targetPipDir = path.join(targetSitePackages, 'pip');
    fs.mkdirSync(targetSitePackages, { recursive: true });
    fs.cpSync(pipDir, targetPipDir, {
      recursive: true,
      force: true,
      errorOnExist: false,
      dereference: true,
    });

    // 同时复制 pip dist-info 目录（供版本查询）
    if (Array.isArray(parsed.dist_info)) {
      for (const entry of parsed.dist_info) {
        if (typeof entry !== 'string' || !entry) continue;
        if (!fs.existsSync(entry)) continue;
        const targetEntry = path.join(targetSitePackages, path.basename(entry));
        fs.cpSync(entry, targetEntry, {
          recursive: true,
          force: true,
          errorOnExist: false,
          dereference: true,
        });
      }
    }

    return { ok: true, source: candidate };
  }

  return { ok: false };
}

// ── pip bootstrap：策略 2/3 - pip.pyz / get-pip.py ──────────────────────────

/**
 * 确保运行时目录中存在可用的 pip。
 * 按优先级尝试 3 种策略：
 *   1. 从宿主 Python 复制（最快，无需网络）
 *   2. 下载 pip.pyz 并创建 shim 模块（次选，较小）
 *   3. 运行 get-pip.py（仅 Windows 宿主，作为 fallback）
 */
async function ensurePipPayload(rootDir, options = {}) {
  const required = options.required !== false;

  // 已有完整 pip 则直接返回
  const existingPipHealth = checkRuntimeHealth(rootDir, { requirePip: true });
  if (existingPipHealth.ok) {
    return;
  }

  // 策略 1：从宿主 Python 复制 pip 包
  const copyResult = tryCopyPipFromHostPython(rootDir);
  if (copyResult.ok) {
    console.log(`[setup-python-runtime] 从宿主 ${copyResult.source} 复制 pip 包`);
    createPipWrappers(rootDir);
    const copiedHealth = checkRuntimeHealth(rootDir, { requirePip: true });
    if (copiedHealth.ok) {
      return;
    }
  }

  // 策略 2：下载 pip.pyz 并创建 shim 模块
  const pipPyzPath = path.join(rootDir, PIP_RUNTIME_ARCHIVE_REL_PATH);
  if (!isNonEmptyFile(pipPyzPath)) {
    try {
      console.log(`[setup-python-runtime] 下载 pip runtime: ${DEFAULT_PIP_PYZ_URL}`);
      await downloadArchive(DEFAULT_PIP_PYZ_URL, pipPyzPath);
      const fileSizeKB = (fs.statSync(pipPyzPath).size / 1024).toFixed(0);
      console.log(`[setup-python-runtime] 下载完成 pip runtime (${fileSizeKB} KB): ${pipPyzPath}`);
    } catch (error) {
      if (required) {
        throw new Error(
          '无法获取 pip runtime 存档（pip.pyz）。'
          + '如需内网镜像，请设置 PETCLAW_WINDOWS_PIP_PYZ_URL。'
          + `原始错误: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      console.warn(
        '[setup-python-runtime] pip runtime 存档不可用，跳过 pip 安装。'
        + `原因: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
  }

  // 创建 shim __main__.py，让 `python -m pip` 加载 pip.pyz
  const pipModuleDir = path.join(rootDir, 'Lib', 'site-packages', 'pip');
  const pipInitPath = path.join(pipModuleDir, '__init__.py');
  const pipMainPath = path.join(pipModuleDir, '__main__.py');
  // shim 代码：在运行时将 pip.pyz 插入 sys.path，然后转发到真正的 pip 主模块
  const pipMain = [
    'import pathlib',
    'import runpy',
    'import sys',
    '',
    'root = pathlib.Path(__file__).resolve().parents[3]',
    "pip_pyz = root / 'tools' / 'pip.pyz'",
    'if not pip_pyz.exists():',
    "    raise SystemExit(f'pip runtime archive missing: {pip_pyz}')",
    '',
    '# 确保 pip 导入从 pip.pyz 解析，而非当前 shim 包',
    'sys.path.insert(0, str(pip_pyz))',
    'for name in list(sys.modules):',
    "    if name == 'pip' or name.startswith('pip.'):",
    '        del sys.modules[name]',
    '',
    "sys.argv[0] = 'pip'",
    "runpy.run_module('pip', run_name='__main__', alter_sys=True)",
    '',
  ].join('\n');

  writeFileIfChanged(pipInitPath, '');
  writeFileIfChanged(pipMainPath, pipMain);
  createPipWrappers(rootDir);

  const finalHealth = checkRuntimeHealth(rootDir, { requirePip: true });
  if (!finalHealth.ok && required) {
    throw new Error(`pip payload 准备失败。缺失: ${finalHealth.missing.join(', ')}`);
  }
}

// ── python3.exe 别名 ──────────────────────────────────────────────────────────

/**
 * 若 python3.exe 不存在则从 python.exe 复制一份。
 * 保证 `python3` 命令在 Windows 上可用（embed Python 默认只有 python.exe）。
 */
function ensurePython3Alias(rootDir) {
  const pythonExe = path.join(rootDir, 'python.exe');
  const python3Exe = path.join(rootDir, 'python3.exe');
  if (fs.existsSync(python3Exe) || !fs.existsSync(pythonExe)) {
    return;
  }
  fs.copyFileSync(pythonExe, python3Exe);
}

// ── 运行时根目录查找 ──────────────────────────────────────────────────────────

/**
 * BFS 搜索包含 python.exe 的目录（解压后可能有嵌套结构）。
 * @param {string} baseDir - 搜索起点
 * @returns {string | null}
 */
function findRuntimeRoot(baseDir) {
  // 先检查 baseDir 本身
  const directHealth = checkRuntimeHealth(baseDir, { requirePython3Alias: false, requirePip: false });
  if (directHealth.ok) {
    return baseDir;
  }

  const queue = [baseDir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    const health = checkRuntimeHealth(current, { requirePython3Alias: false, requirePip: false });
    if (health.ok) {
      return current;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      queue.push(path.join(current, entry.name));
    }
  }

  return null;
}

// ── 下载工具 ──────────────────────────────────────────────────────────────────

/**
 * 从 URL 下载文件到指定路径（原子写入：先写临时文件再 rename）。
 * 使用 Node.js 内置 fetch（v18+），无需额外依赖。
 */
async function downloadArchive(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`下载失败 (${response.status} ${response.statusText}): ${url}`);
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const tmpFile = `${destination}.download`;
  try {
    const stream = fs.createWriteStream(tmpFile);
    await pipeline(Readable.fromWeb(response.body), stream);

    if (!isNonEmptyFile(tmpFile)) {
      throw new Error('下载的存档为空。');
    }
    // 原子替换：rename 保证部分写入不污染目标文件
    fs.renameSync(tmpFile, destination);
  } catch (error) {
    try {
      fs.rmSync(tmpFile, { force: true });
    } catch {
      // 忽略清理错误
    }
    throw error;
  }
}

// ── 存档解析（环境变量 / 缓存 / 下载）──────────────────────────────────────────

/**
 * 按优先级解析 Python 运行时存档来源：
 *   1. PETCLAW_PORTABLE_PYTHON_ARCHIVE 环境变量（本地离线包）
 *   2. 已缓存的 resources/python-win-runtime.zip
 *   3. 从 python.org 下载（或 PETCLAW_PORTABLE_PYTHON_URL 镜像）
 */
async function resolveArchive(required) {
  // 优先使用离线存档（适合无网络的 CI 环境）
  const envArchive = resolveInputPath(process.env.PETCLAW_PORTABLE_PYTHON_ARCHIVE);
  if (envArchive) {
    if (!isNonEmptyFile(envArchive)) {
      throw new Error(`PETCLAW_PORTABLE_PYTHON_ARCHIVE 指向无效文件: ${envArchive}`);
    }
    console.log(`[setup-python-runtime] 使用本地存档（PETCLAW_PORTABLE_PYTHON_ARCHIVE）: ${envArchive}`);
    return { archivePath: envArchive, source: 'env-archive' };
  }

  // 使用已缓存的存档
  if (isNonEmptyFile(DEFAULT_ARCHIVE_PATH)) {
    console.log(`[setup-python-runtime] 使用缓存存档: ${DEFAULT_ARCHIVE_PATH}`);
    return { archivePath: DEFAULT_ARCHIVE_PATH, source: 'cache' };
  }

  // 确定下载 URL（环境变量优先，默认 python.org）
  const urlFromEnv = typeof process.env.PETCLAW_PORTABLE_PYTHON_URL === 'string'
    ? process.env.PETCLAW_PORTABLE_PYTHON_URL.trim()
    : '';
  const downloadUrl = urlFromEnv || DEFAULT_RUNTIME_URL;

  if (!downloadUrl) {
    if (required) {
      throw new Error(
        '便携式 Python 存档不可用。'
        + '请设置 PETCLAW_PORTABLE_PYTHON_ARCHIVE 指向本地包，'
        + '或设置 PETCLAW_PORTABLE_PYTHON_URL 指向可下载的运行时存档。'
      );
    }
    console.warn('[setup-python-runtime] 未配置存档 URL，跳过（未设置 --required）。');
    return null;
  }

  try {
    console.log(`[setup-python-runtime] 下载运行时: ${downloadUrl}`);
    await downloadArchive(downloadUrl, DEFAULT_ARCHIVE_PATH);
    const fileSizeMB = (fs.statSync(DEFAULT_ARCHIVE_PATH).size / 1024 / 1024).toFixed(1);
    console.log(`[setup-python-runtime] 下载完成 (${fileSizeMB} MB): ${DEFAULT_ARCHIVE_PATH}`);
    return { archivePath: DEFAULT_ARCHIVE_PATH, source: 'download' };
  } catch (error) {
    if (required) {
      throw new Error(
        '无法获取便携式 Python 运行时存档。'
        + '请设置 PETCLAW_PORTABLE_PYTHON_ARCHIVE 指向本地离线包，'
        + '或设置 PETCLAW_PORTABLE_PYTHON_URL 指向可访问的镜像。'
        + `原始错误: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    console.warn(
      '[setup-python-runtime] 运行时存档不可用，跳过（未设置 --required）。'
      + `原因: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

// ── 运行时目录操作 ────────────────────────────────────────────────────────────

/**
 * 将提取的运行时树复制到目标目录（先删除旧版本）。
 */
function copyRuntimeTree(sourceRoot, destRoot) {
  if (fs.existsSync(destRoot)) {
    fs.rmSync(destRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(destRoot, { recursive: true });
  fs.cpSync(sourceRoot, destRoot, {
    recursive: true,
    dereference: true,
    force: true,
    errorOnExist: false,
  });
}

/**
 * 通过 spawnSync 运行外部命令，失败则抛出异常。
 */
function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: options.timeout || 5 * 60 * 1000,
    env: options.env || process.env,
  });

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`命令失败: ${command} ${args.join(' ')}${detail ? `\n${detail}` : ''}`);
  }
}

// ── site-packages 启用 ────────────────────────────────────────────────────────

/**
 * 修改 embed Python 的 ._pth 文件，启用 site-packages。
 * embed Python 默认禁用 site，需手动在 ._pth 中添加：
 *   Lib\site-packages
 *   import site
 */
function enableSitePackages(rootDir) {
  const pthCandidates = fs.readdirSync(rootDir).filter((name) => name.endsWith('._pth'));
  if (pthCandidates.length === 0) {
    throw new Error('在运行时目录中未找到 Python ._pth 文件。');
  }

  const pthPath = path.join(rootDir, pthCandidates[0]);
  const raw = fs.readFileSync(pthPath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  const updated = [];
  let hasSitePackages = false;
  let hasImportSite = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // 将被注释的 `#import site` 替换为有效的 `import site`
    if (trimmed === 'import site' || trimmed === '#import site') {
      updated.push('import site');
      hasImportSite = true;
      continue;
    }
    // 统一写为 Windows 路径格式
    if (trimmed.toLowerCase() === 'lib\\site-packages' || trimmed.toLowerCase() === 'lib/site-packages') {
      updated.push('Lib\\site-packages');
      hasSitePackages = true;
      continue;
    }
    updated.push(line);
  }

  // 若 ._pth 文件中原本没有这两行，追加到末尾
  if (!hasSitePackages) {
    updated.push('Lib\\site-packages');
  }
  if (!hasImportSite) {
    updated.push('import site');
  }

  fs.writeFileSync(pthPath, `${updated.join('\n').replace(/\n+$/g, '')}\n`, 'utf8');
}

// ── Windows 宿主 bootstrap ────────────────────────────────────────────────────

/**
 * 在 Windows 宿主机上从 python.org 直接下载 embed Python 并 bootstrap。
 * 此路径仅在 Windows 上执行，macOS/Linux 需提供预构建存档。
 */
async function bootstrapRuntimeOnWindows() {
  if (process.platform !== 'win32') {
    throw new Error('Windows bootstrap 仅支持在 Windows 宿主机上运行。');
  }

  console.log('[setup-python-runtime] 未提供预构建存档，在 Windows 宿主机上从 python.org bootstrap...');
  const tempRoot = fs.mkdtempSync(path.join(PROJECT_ROOT, 'tmp-python-bootstrap-'));
  try {
    const embedZipPath = path.join(tempRoot, DEFAULT_WINDOWS_EMBED_PYTHON_ZIP);
    await downloadArchive(DEFAULT_WINDOWS_EMBED_PYTHON_URL, embedZipPath);
    await extractArchiveToRuntime(embedZipPath);

    enableSitePackages(OUTPUT_DIR);
    ensurePython3Alias(OUTPUT_DIR);

    const pythonExe = path.join(OUTPUT_DIR, 'python.exe');
    if (!fs.existsSync(pythonExe)) {
      throw new Error('解压后未找到 python.exe。');
    }

    // 尝试通过 get-pip.py 安装 pip（可能失败，降级为 pip.pyz 策略）
    const pipExe = path.join(OUTPUT_DIR, 'Scripts', 'pip.exe');
    if (!fs.existsSync(pipExe)) {
      try {
        const getPipPath = path.join(tempRoot, 'get-pip.py');
        await downloadArchive(DEFAULT_GET_PIP_URL, getPipPath);
        runCommand(pythonExe, [getPipPath], { timeout: 3 * 60 * 1000 });
      } catch (error) {
        console.warn(
          '[setup-python-runtime] Windows 宿主机 get-pip.py 安装失败，Python 运行时仍可用。'
          + `原因: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    await ensurePipPayload(OUTPUT_DIR, { required: true });
    const health = checkRuntimeHealth(OUTPUT_DIR, { requirePip: true });
    if (!health.ok) {
      throw new Error(`Bootstrap 运行时健康检查失败，缺失: ${health.missing.join(', ')}`);
    }

    console.log('[setup-python-runtime] Windows bootstrap 完成');
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // 忽略临时目录清理错误
    }
  }
}

// ── 存档提取 ──────────────────────────────────────────────────────────────────

/**
 * 解压 Python 存档到临时目录，找到运行时根目录后复制到 OUTPUT_DIR。
 * 完成后启用 site-packages、创建 python3.exe 别名、bootstrap pip。
 */
async function extractArchiveToRuntime(archivePath) {
  const tempRoot = fs.mkdtempSync(path.join(PROJECT_ROOT, 'tmp-python-runtime-'));
  try {
    await extractZip(archivePath, { dir: tempRoot });
    const runtimeRoot = findRuntimeRoot(tempRoot);
    if (!runtimeRoot) {
      throw new Error('解压后无法定位 Python 运行时根目录。');
    }

    copyRuntimeTree(runtimeRoot, OUTPUT_DIR);
    enableSitePackages(OUTPUT_DIR);
    ensurePython3Alias(OUTPUT_DIR);
    await ensurePipPayload(OUTPUT_DIR, { required: true });

    const health = checkRuntimeHealth(OUTPUT_DIR, { requirePip: true });
    if (!health.ok) {
      throw new Error(
        `运行时健康检查失败，缺失: ${health.missing.join(', ')}。`
        + '请提供有效的 Python 运行时存档。'
      );
    }
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
}

// ── 可执行文件查找 ────────────────────────────────────────────────────────────

/**
 * 在指定目录中查找 python.exe 或 python3.exe。
 * @param {string} [baseDir] - 搜索目录，默认为 OUTPUT_DIR
 * @returns {string | null}
 */
function findPortablePythonExecutable(baseDir = OUTPUT_DIR) {
  const candidates = [
    path.join(baseDir, 'python.exe'),
    path.join(baseDir, 'python3.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// ── 主入口 ────────────────────────────────────────────────────────────────────

/**
 * 确保便携式 Python 运行时已就绪。
 *
 * 逻辑流程：
 *   1. 非 Windows 且无 --required/强制标志 → 跳过（仅打 Windows 包时才需要）
 *   2. 运行时已存在且健康 → 确保 pip 可用后直接返回
 *   3. 解析存档（离线/缓存/下载）→ 解压
 *   4. Windows 宿主上解压失败 → fallback 到 bootstrap
 *
 * @param {{ required?: boolean }} options
 */
async function ensurePortablePythonRuntime(options = {}) {
  const required = Boolean(options.required);
  // 非 Windows 宿主机默认跳过，除非明确要求（如打包 Windows 安装包时）
  const shouldRun = process.platform === 'win32'
    || required
    || process.env.PETCLAW_SETUP_PYTHON_RUNTIME_FORCE === '1';

  if (!shouldRun) {
    console.log('[setup-python-runtime] 非 Windows 宿主机，跳过（传入 --required 可强制跨平台准备）。');
    return { ok: true, skipped: true, pythonPath: null };
  }

  // 检查现有运行时（仅验证 python.exe 存在，不要求 pip）
  const existingBaseHealth = checkRuntimeHealth(OUTPUT_DIR, { requirePip: false });
  if (existingBaseHealth.ok) {
    await ensurePipPayload(OUTPUT_DIR, { required: true });
    const existingFullHealth = checkRuntimeHealth(OUTPUT_DIR, { requirePip: true });
    if (existingFullHealth.ok) {
      const pythonPath = findPortablePythonExecutable(OUTPUT_DIR);
      console.log(`[setup-python-runtime] 运行时已就绪: ${pythonPath || OUTPUT_DIR}`);
      return { ok: true, skipped: false, pythonPath };
    }
    console.warn(
      '[setup-python-runtime] 现有运行时 pip 支持不完整，'
      + `缺失: ${existingFullHealth.missing.join(', ')}，重新提取...`
    );
  }

  // 解析存档来源（required && 非 Windows 时必须成功）
  const archive = await resolveArchive(required && process.platform !== 'win32');
  if (archive) {
    console.log(`[setup-python-runtime] 正在提取运行时存档（来源: ${archive.source}）...`);
    try {
      await extractArchiveToRuntime(archive.archivePath);
    } catch (error) {
      if (process.platform !== 'win32') {
        // 非 Windows 宿主机没有 bootstrap fallback
        throw error;
      }
      console.warn(
        '[setup-python-runtime] 存档提取失败，回退到 Windows bootstrap。'
        + `原因: ${error instanceof Error ? error.message : String(error)}`
      );
      await bootstrapRuntimeOnWindows();
    }
  } else if (process.platform === 'win32') {
    // Windows 宿主机且无存档，直接 bootstrap
    await bootstrapRuntimeOnWindows();
  } else if (required) {
    throw new Error(
      '非 Windows 宿主机无法获取便携式 Python 存档。'
      + '请设置 PETCLAW_PORTABLE_PYTHON_ARCHIVE 指向本地包，'
      + '或设置 PETCLAW_PORTABLE_PYTHON_URL 指向可下载的运行时存档。'
    );
  } else {
    return { ok: true, skipped: true, pythonPath: null };
  }

  const pythonPath = findPortablePythonExecutable(OUTPUT_DIR);
  const finalHealth = checkRuntimeHealth(OUTPUT_DIR, { requirePip: true });
  if (!finalHealth.ok) {
    throw new Error(
      '便携式 Python 运行时准备完成后仍缺少 pip 组件: '
      + finalHealth.missing.join(', ')
    );
  }
  const finalSize = getDirSize(OUTPUT_DIR);
  console.log(`[setup-python-runtime] 便携式 Python 运行时就绪: ${pythonPath || OUTPUT_DIR}`);
  console.log(`[setup-python-runtime] 总大小: ~${(finalSize / 1024 / 1024).toFixed(1)} MB`);

  return { ok: true, skipped: false, pythonPath };
}

// ── CLI 模式 ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensurePortablePythonRuntime({ required: args.required });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[setup-python-runtime] ERROR:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  ensurePortablePythonRuntime,
  findPortablePythonExecutable,
  checkRuntimeHealth,
};