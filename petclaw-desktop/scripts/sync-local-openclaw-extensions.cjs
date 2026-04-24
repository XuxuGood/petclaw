'use strict';

// scripts/sync-local-openclaw-extensions.cjs
// 将 openclaw-extensions/ 目录下的本地扩展同步到 runtime 的 third-party-extensions/
// 用于开发阶段和打包前将自定义扩展注入到 runtime 中

const fs = require('fs');
const path = require('path');

/**
 * 同步本地 OpenClaw 扩展到 runtime 的 third-party-extensions/ 目录。
 *
 * @param {string} [runtimeRoot] - runtime 根目录路径，默认为 vendor/openclaw-runtime/current
 * @returns {{ sourceDir: string, targetRoot: string, copied: string[] }}
 */
function syncLocalOpenClawExtensions(runtimeRoot) {
  const rootDir = path.resolve(__dirname, '..');
  const sourceDir = path.join(rootDir, 'openclaw-extensions');
  const targetRoot = runtimeRoot
    ? path.resolve(runtimeRoot)
    : path.join(rootDir, 'vendor', 'openclaw-runtime', 'current');
  const targetExtensionsDir = path.join(targetRoot, 'third-party-extensions');

  if (!fs.existsSync(sourceDir)) {
    return { sourceDir, targetRoot, copied: [] };
  }

  if (!fs.existsSync(targetExtensionsDir)) {
    throw new Error(`Runtime 扩展目录不存在: ${targetExtensionsDir}`);
  }

  const copied = [];
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const src = path.join(sourceDir, entry.name);
    const dest = path.join(targetExtensionsDir, entry.name);

    // 直接覆盖写入，不先删除（保留目标中可能存在的 node_modules 等）
    fs.cpSync(src, dest, { recursive: true, force: true });
    copied.push(entry.name);
  }

  return { sourceDir, targetRoot, copied };
}

function main() {
  try {
    const runtimeRoot = (process.argv[2] || '').trim() || undefined;
    const result = syncLocalOpenClawExtensions(runtimeRoot);

    if (result.copied.length === 0) {
      console.log('[sync-local-openclaw-extensions] 没有需要同步的本地扩展');
      return;
    }

    console.log(
      `[sync-local-openclaw-extensions] 已同步 ${result.copied.join(', ')} -> ${path.join(result.targetRoot, 'third-party-extensions')}`,
    );
  } catch (error) {
    console.error(
      `[sync-local-openclaw-extensions] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  syncLocalOpenClawExtensions,
};
