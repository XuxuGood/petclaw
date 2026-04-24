'use strict';

/**
 * OpenClaw 运行时打包辅助工具。
 *
 * 提供常量和工具函数，供其他打包脚本（如 electron-builder hooks、
 * finalize-openclaw-runtime 等）调用，统一管理运行时目录结构约定。
 */

const fs = require('fs');
const path = require('path');

// 构建产物根目录
const DIST_DIR = 'dist';

// OpenClaw 主入口文件名
const OPENCLAW_ENTRY = 'openclaw.mjs';

// control-ui 的 HTML 入口，用于验证 asar 包完整性
const DIST_CONTROL_UI_INDEX = path.join(DIST_DIR, 'control-ui', 'index.html');

// gateway 入口：支持 .js 和 .mjs 两种格式
const DIST_ENTRY_JS = path.join(DIST_DIR, 'entry.js');
const DIST_ENTRY_MJS = path.join(DIST_DIR, 'entry.mjs');

// 扩展插件目录
const DIST_EXTENSIONS_DIR = path.join(DIST_DIR, 'extensions');

// diffs 扩展目录（打包时需裁剪，避免包体积膨胀）
const DIST_DIFFS_EXTENSION_DIR = path.join(DIST_EXTENSIONS_DIR, 'diffs');

// 裸发行版 dist 顶层目录中需要保留的子目录白名单
const BARE_DIST_TOP_LEVEL_TO_KEEP = new Set(['control-ui', 'extensions']);

/**
 * 规范化 asar 条目路径，统一使用正斜杠（兼容 Windows 路径分隔符）。
 */
function normalizeAsarEntry(entry) {
  return entry.replace(/\\/g, '/');
}

/**
 * 汇总 gateway asar 包内的关键条目是否存在。
 * 返回结构用于打包校验，缺少关键文件时可提前报错。
 */
function summarizeGatewayAsarEntries(entries) {
  const normalizedEntries = Array.from(entries, normalizeAsarEntry);
  const entrySet = new Set(normalizedEntries);

  return {
    // OpenClaw 主入口是否存在
    hasOpenClawEntry: entrySet.has(`/${OPENCLAW_ENTRY}`),
    // control-ui index.html 是否存在
    hasControlUiIndex: entrySet.has(`/${DIST_CONTROL_UI_INDEX.replace(/\\/g, '/')}`),
    // gateway 入口（.js 或 .mjs）是否存在
    hasGatewayEntry: entrySet.has(`/${DIST_ENTRY_JS.replace(/\\/g, '/')}`)
      || entrySet.has(`/${DIST_ENTRY_MJS.replace(/\\/g, '/')}`),
    // 扩展插件目录是否存在
    hasBundledExtensions: normalizedEntries.some((entry) => entry === '/dist/extensions' || entry.startsWith('/dist/extensions/')),
  };
}

/**
 * 清理 gateway asar 打包暂存目录中的扩展插件目录。
 * extensions 会单独打包，暂存目录中不应包含，避免重复打入 asar。
 */
function pruneGatewayAsarStage(stageRoot) {
  const extensionsDir = path.join(stageRoot, DIST_EXTENSIONS_DIR);
  if (fs.existsSync(extensionsDir)) {
    fs.rmSync(extensionsDir, { recursive: true, force: true });
  }
}

/**
 * gateway 打包完成后裁剪裸发行版的 dist 目录。
 * 只保留白名单目录（control-ui、extensions），同时删除 diffs 扩展，
 * 减小最终发行包体积。
 */
function pruneBareDistAfterGatewayPack(runtimeRoot) {
  const distDir = path.join(runtimeRoot, DIST_DIR);
  if (!fs.existsSync(distDir)) return;

  // 遍历 dist 顶层条目，删除不在白名单中的内容
  for (const entry of fs.readdirSync(distDir)) {
    if (BARE_DIST_TOP_LEVEL_TO_KEEP.has(entry)) continue;
    fs.rmSync(path.join(distDir, entry), { recursive: true, force: true });
  }

  // 单独删除 diffs 扩展目录
  const diffsExtensionDir = path.join(runtimeRoot, DIST_DIFFS_EXTENSION_DIR);
  if (fs.existsSync(diffsExtensionDir)) {
    fs.rmSync(diffsExtensionDir, { recursive: true, force: true });
  }
}

module.exports = {
  DIST_CONTROL_UI_INDEX,
  DIST_DIFFS_EXTENSION_DIR,
  DIST_ENTRY_JS,
  DIST_ENTRY_MJS,
  DIST_EXTENSIONS_DIR,
  OPENCLAW_ENTRY,
  pruneBareDistAfterGatewayPack,
  pruneGatewayAsarStage,
  summarizeGatewayAsarEntries,
};