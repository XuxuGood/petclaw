'use strict';

/**
 * 将版本级 patch 应用到 openclaw 源码树。
 *
 * patch 文件按 scripts/patches/<version>/ 目录组织，
 * <version> 对应 package.json 的 "openclaw.version" 字段（如 "v2026.4.14"）。
 * 只会应用当前锁定版本的 patch。
 *
 * 用法：
 *   node scripts/apply-openclaw-patches.cjs [openclaw-src-dir]
 *
 * 若未指定 openclaw-src-dir，默认使用项目根目录同级的 ../openclaw。
 *
 * 可安全重复运行——已应用的 patch 会自动跳过。
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const openclawSrc = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(rootDir, '..', 'openclaw');

// 从 package.json 读取锁定的 openclaw 版本
const pkg = require(path.join(rootDir, 'package.json'));
const openclawVersion = pkg.openclaw && pkg.openclaw.version;
if (!openclawVersion) {
  console.error('[apply-openclaw-patches] Missing "openclaw.version" in package.json.');
  process.exit(1);
}

const patchesDir = path.join(rootDir, 'scripts', 'patches', openclawVersion);

if (!fs.existsSync(openclawSrc)) {
  console.error(`[apply-openclaw-patches] openclaw source not found: ${openclawSrc}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(openclawSrc, 'package.json'))) {
  console.error(`[apply-openclaw-patches] Not an openclaw project: ${openclawSrc}`);
  process.exit(1);
}

if (!fs.existsSync(patchesDir)) {
  console.log(`[apply-openclaw-patches] No patches directory for ${openclawVersion}, nothing to do.`);
  process.exit(0);
}

const patchFiles = fs.readdirSync(patchesDir)
  .filter(f => f.endsWith('.patch'))
  .sort();

if (patchFiles.length === 0) {
  console.log(`[apply-openclaw-patches] No patches found for ${openclawVersion}, nothing to do.`);
  process.exit(0);
}

console.log(`[apply-openclaw-patches] Applying patches for openclaw ${openclawVersion} (${patchFiles.length} file(s))`);

// 打 patch 前先将 openclaw 源码重置到干净的 tag 状态，
// 移除其他分支可能遗留的旧 patch。
try {
  execFileSync('git', ['reset', 'HEAD', '.'], { cwd: openclawSrc, stdio: 'pipe' });
  execFileSync('git', ['checkout', '.'], { cwd: openclawSrc, stdio: 'pipe' });
  execFileSync('git', ['clean', '-fd'], { cwd: openclawSrc, stdio: 'pipe' });
  console.log('[apply-openclaw-patches] Reset openclaw source to clean state before patching.');
} catch (err) {
  console.warn(`[apply-openclaw-patches] Warning: failed to reset openclaw source: ${err.message}`);
}

let applied = 0;
let skipped = 0;

for (const patchFile of patchFiles) {
  const originalPatchPath = path.join(patchesDir, patchFile);

  // 统一行尾：去除 \r，避免 Windows CRLF 签出的 patch 文件
  // 导致 "corrupt patch" 错误（git apply 不接受 diff 中的 \r）。
  const raw = fs.readFileSync(originalPatchPath, 'utf8');
  const needsNormalize = raw.includes('\r');
  let patchPath = originalPatchPath;
  if (needsNormalize) {
    patchPath = path.join(os.tmpdir(), `petclaw-patch-${patchFile}`);
    fs.writeFileSync(patchPath, raw.replace(/\r/g, ''), 'utf8');
  }

  try {
    // 检测 patch 是否已经应用。
    //
    // 策略：
    //   1. 尝试 `git apply --check --reverse`——成功则 patch 已应用。
    //   2. 尝试 `git apply --check`（正向）——成功则 patch 未应用。
    //   3. 两者都失败，说明 patch 部分/全部已应用（如新文件已存在，
    //      或修改的 hunk 已匹配），视为已应用。
    //
    // 避免脆弱的 patch 内容正则解析，且不受行尾差异影响。

    let reverseOk = false;
    try {
      execFileSync('git', ['apply', '--check', '--reverse', '--ignore-whitespace', patchPath], {
        cwd: openclawSrc,
        stdio: 'pipe',
      });
      reverseOk = true;
    } catch {
      // 反向检查失败——patch 可能已应用也可能未应用
    }

    if (reverseOk) {
      console.log(`[apply-openclaw-patches] Already applied: ${patchFile}`);
      skipped++;
      continue;
    }

    // 尝试正向检查
    let forwardErr = null;
    try {
      execFileSync('git', ['apply', '--check', '--ignore-whitespace', patchPath], {
        cwd: openclawSrc,
        stdio: 'pipe',
      });
    } catch (err) {
      forwardErr = err;
    }

    if (forwardErr) {
      // 正向和反向检查都失败。通常意味着 patch 已应用但 git 无法干净地
      // 反转（如新文件是 untracked，或工作树已有这些更改但未提交）。
      const stderr = forwardErr.stderr ? forwardErr.stderr.toString() : '';
      const alreadyExists = stderr.includes('already exists in working directory');
      const patchDoesNotApply = stderr.includes('patch does not apply');

      if (alreadyExists || patchDoesNotApply) {
        console.log(`[apply-openclaw-patches] Already applied (forward check confirms): ${patchFile}`);
        skipped++;
        continue;
      }

      // 真的无法应用——报错退出
      console.error(`[apply-openclaw-patches] Patch does not apply cleanly: ${patchFile}`);
      console.error(`[apply-openclaw-patches] This usually means the openclaw version has changed.`);
      console.error(`[apply-openclaw-patches] Regenerate patches or update to match the new source.`);
      if (stderr) console.error(stderr);
      process.exit(1);
    }

    // 应用 patch
    try {
      execFileSync('git', ['apply', '--ignore-whitespace', patchPath], {
        cwd: openclawSrc,
        stdio: 'pipe',
      });
      console.log(`[apply-openclaw-patches] Applied: ${patchFile}`);
      applied++;
    } catch (err) {
      console.error(`[apply-openclaw-patches] Failed to apply: ${patchFile}`);
      const stderr = err.stderr ? err.stderr.toString() : '';
      if (stderr) console.error(stderr);
      process.exit(1);
    }
  } finally {
    // 清理临时的行尾规范化 patch 文件
    if (needsNormalize && fs.existsSync(patchPath)) {
      try { fs.unlinkSync(patchPath); } catch {}
    }
  }
}

console.log(`[apply-openclaw-patches] Done. Applied: ${applied}, Skipped (already applied): ${skipped}`);
