'use strict';

/**
 * Windows 安装后资源 tar 解压脚本
 *
 * 由 NSIS nsis-installer.nsh 的 customInstall 宏通过 ELECTRON_RUN_AS_NODE=1 调用。
 * PetClaw.exe 在 ELECTRON_RUN_AS_NODE=1 模式下等价于 Node.js 运行时。
 *
 * 用法: PetClaw.exe <本脚本路径> <tarPath> <destDir> [installLogPath]
 *
 * 效果:
 *   输入: $INSTDIR/resources/win-resources.tar
 *   输出: $INSTDIR/resources/petmind/, SKILLs/
 *   tar 文件由 NSIS 脚本在解压成功后删除
 *
 * 依赖: 从 app.asar 内加载 tar npm 包（Electron 内置 ASAR 透明读取支持）
 */

const fs = require('fs');
const path = require('path');

const tarPath = process.argv[2];
const destDir = process.argv[3];
const installLogPath = process.argv[4];

if (!tarPath || !destDir) {
  console.error('[unpack-petmind] Usage: PetClaw.exe unpack-petmind.cjs <tarPath> <destDir>');
  process.exit(1);
}

if (!fs.existsSync(tarPath)) {
  console.error(`[unpack-petmind] tar file not found: ${tarPath}`);
  process.exit(1);
}

function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function stringifyError(error) {
  if (!error) return 'unknown error';
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

// 打开日志文件（追加模式），失败时降级为仅控制台输出
let logFd = null;
if (installLogPath) {
  try {
    fs.mkdirSync(path.dirname(installLogPath), { recursive: true });
    logFd = fs.openSync(installLogPath, 'a');
  } catch (error) {
    console.error(`[unpack-petmind] Failed to open install log: ${stringifyError(error)}`);
  }
}

function logLine(message) {
  const line = `${formatTimestamp()} ${message}`;
  console.log(line);
  if (logFd !== null) {
    try {
      fs.writeSync(logFd, `${line}\n`);
    } catch (error) {
      console.error(`${formatTimestamp()} [unpack-petmind] Failed to write install log: ${stringifyError(error)}`);
      // 写入失败后关闭，避免后续重复报错
      logFd = null;
    }
  }
}

function closeLogFile() {
  if (logFd === null) return;
  try { fs.closeSync(logFd); } catch { }
  logFd = null;
}

function formatMegabytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * 优先从 app.asar 内加载 tar 包（利用 Electron ASAR 透明读取），
 * 失败时尝试全局 require，两者都失败则退出。
 */
function loadTarModule() {
  const resourcesDir = path.dirname(tarPath);
  const appAsar = path.join(resourcesDir, 'app.asar');
  const asarTarPath = path.join(appAsar, 'node_modules', 'tar');
  try {
    return require(asarTarPath);
  } catch (e) {
    logLine(`[unpack-petmind] phase=load-tar-from-asar-failed error=${stringifyError(e)}`);
  }
  try {
    return require('tar');
  } catch { }
  logLine('[unpack-petmind] phase=load-tar-failed');
  logLine(`[unpack-petmind] phase=load-tar-tried path=${asarTarPath}`);
  process.exit(1);
}

try {
  logLine(`[unpack-petmind] phase=extract-open tar=${tarPath}`);
  logLine(`[unpack-petmind] phase=extract-destination dir=${destDir}`);

  const tar = loadTarModule();
  const t0 = Date.now();
  let extractedEntries = 0;
  let extractedBytes = 0;
  let currentRoot = '';
  // 每 25MB 输出一次全局进度日志，避免日志过于冗长
  let nextGlobalProgressBytes = 25 * 1024 * 1024;
  let nextRootProgressBytes = 25 * 1024 * 1024;
  const rootStats = new Map();

  fs.mkdirSync(destDir, { recursive: true });

  tar.extract({
    file: tarPath,
    cwd: destDir,
    sync: true,
    onentry: (entry) => {
      const entryPath = String(entry?.path || '');
      // 提取 tar 条目的根目录名，用于按目录分组统计
      const root = entryPath.split(/[\\/]/)[0] || '(root)';
      const size = Number(entry?.size || 0);
      extractedEntries += 1;
      extractedBytes += size;

      const stats = rootStats.get(root) || { entries: 0, bytes: 0, startedAtMs: Date.now() };
      stats.entries += 1;
      stats.bytes += size;
      rootStats.set(root, stats);

      // 切换根目录时记录一次 root-start 日志
      if (root !== currentRoot) {
        currentRoot = root;
        nextRootProgressBytes = stats.bytes + (25 * 1024 * 1024);
        logLine(`[unpack-petmind] phase=root-start root=${root} entry=${entryPath}`);
      }

      // 前 20 条目逐条记录，之后按 25MB 间隔记录
      if (extractedEntries <= 20 || extractedBytes >= nextGlobalProgressBytes) {
        const elapsedMs = Date.now() - t0;
        logLine(`[unpack-petmind] phase=extract-progress entries=${extractedEntries} bytes=${extractedBytes} mb=${formatMegabytes(extractedBytes)} elapsed_ms=${elapsedMs} current=${entryPath}`);
        while (extractedBytes >= nextGlobalProgressBytes) nextGlobalProgressBytes += 25 * 1024 * 1024;
      }

      if (stats.bytes >= nextRootProgressBytes) {
        const elapsedMs = Date.now() - stats.startedAtMs;
        logLine(`[unpack-petmind] phase=root-progress root=${root} entries=${stats.entries} bytes=${stats.bytes} mb=${formatMegabytes(stats.bytes)} elapsed_ms=${elapsedMs} current=${entryPath}`);
        while (stats.bytes >= nextRootProgressBytes) nextRootProgressBytes += 25 * 1024 * 1024;
      }
    },
  });

  const elapsedMs = Date.now() - t0;
  logLine(`[unpack-petmind] phase=extract-complete entries=${extractedEntries} bytes=${extractedBytes} elapsed_ms=${elapsedMs}`);

  // 输出每个根目录的汇总统计
  for (const [root, stats] of rootStats.entries()) {
    const rootElapsedMs = Date.now() - stats.startedAtMs;
    logLine(`[unpack-petmind] phase=root-summary root=${root} entries=${stats.entries} bytes=${stats.bytes} mb=${formatMegabytes(stats.bytes)} elapsed_ms=${rootElapsedMs}`);
  }

  // PetClaw 只验证 petmind + SKILLs（暂不打包 python-win）
  const expectedDirs = ['petmind', 'SKILLs'];
  for (const dir of expectedDirs) {
    const dirPath = path.join(destDir, dir);
    if (fs.existsSync(dirPath)) {
      logLine(`[unpack-petmind] phase=verify-ok dir=${dir}`);
    } else {
      logLine(`[unpack-petmind] phase=verify-missing dir=${dir}`);
    }
  }

  logLine('[unpack-petmind] phase=extract-ok');
  closeLogFile();
  process.exit(0);
} catch (err) {
  logLine(`[unpack-petmind] phase=extract-failed error=${stringifyError(err)}`);
  closeLogFile();
  process.exit(1);
}