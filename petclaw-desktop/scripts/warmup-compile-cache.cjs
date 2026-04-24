'use strict';

/**
 * V8 编译缓存预热脚本。
 *
 * 加载 gateway-bundle.mjs（约 26MB），触发 V8 编译并将字节码写入
 * 编译缓存目录。后续 gateway 进程启动时跳过 V8 编译阶段，
 * 启动耗时从 ~35s 降至 ~5s。
 *
 * 使用方式（通过 ELECTRON_RUN_AS_NODE=1）：
 *   set ELECTRON_RUN_AS_NODE=1
 *   set NODE_COMPILE_CACHE=<cache-dir>
 *   PetClaw.exe <path-to>/warmup-compile-cache.cjs [--cache-dir <dir>]
 *
 * 或直接用 Node.js 执行（测试用途）：
 *   NODE_COMPILE_CACHE=<cache-dir> node warmup-compile-cache.cjs
 *
 * 退出码：
 *   0 — 预热完成（或已跳过/出错 — 不阻塞调用方）
 */

const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

const t0 = Date.now();
// 计算自脚本启动以来经过的时间
const elapsed = () => `${Date.now() - t0}ms`;

// 解析 --cache-dir 参数
let cacheDir = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cache-dir' && i + 1 < args.length) {
    cacheDir = args[i + 1];
    break;
  }
}

// 默认缓存目录：与运行时 engine manager 使用的路径保持一致，
// 使用 OPENCLAW_STATE_DIR 以便与 PetClaw engine manager 对齐
if (!cacheDir) {
  cacheDir = path.join(process.env.OPENCLAW_STATE_DIR || __dirname, '.compile-cache');
}

process.env.NODE_COMPILE_CACHE = cacheDir;

// 启用 V8 编译缓存，Node.js >= 22.8.0 支持
try {
  const { enableCompileCache, getCompileCacheDir } = require('node:module');
  enableCompileCache(cacheDir);
  const actualDir = getCompileCacheDir();
  process.stderr.write(`[warmup] compile-cache dir: ${actualDir}\n`);
} catch (err) {
  process.stderr.write(`[warmup] enableCompileCache: ${err.message}\n`);
}

// 查找 gateway bundle，优先当前目录，次选 petmind resources 目录
const bundleCandidates = [
  path.join(__dirname, 'gateway-bundle.mjs'),
  path.join(__dirname, '..', 'resources', 'petmind', 'gateway-bundle.mjs'),
];

let bundlePath = null;
for (const candidate of bundleCandidates) {
  if (fs.existsSync(candidate)) {
    bundlePath = candidate;
    break;
  }
}

if (!bundlePath) {
  process.stderr.write(`[warmup] 未找到 gateway-bundle.mjs，跳过预热。(${elapsed()})\n`);
  process.exit(0);
}

process.stderr.write(`[warmup] 正在加载 bundle: ${bundlePath} ...\n`);

// 动态 import 触发 V8 编译，完成后刷新缓存到磁盘；
// 即使 bundle 抛出初始化错误，字节码缓存仍会被写入，预热依然有效
const bundleUrl = pathToFileURL(bundlePath).href;
import(bundleUrl)
  .then(() => {
    try { require('node:module').flushCompileCache(); } catch (_) {}
    process.stderr.write(`[warmup] Bundle 加载成功，缓存已写入。(${elapsed()})\n`);
    process.exit(0);
  })
  .catch((err) => {
    try { require('node:module').flushCompileCache(); } catch (_) {}
    process.stderr.write(`[warmup] Bundle 加载出错（缓存仍已写入）: ${err.message} (${elapsed()})\n`);
    process.exit(0);
  });