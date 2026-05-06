'use strict';

// electron-builder-hooks.cjs
// 打包前/后钩子：同步 runtime、验证扩展/插件/bundle、Windows tar 打包、macOS 签名清理
// electron-builder 通过 beforePack/afterPack 字段引用本文件（module.exports 导出两个函数）

const path = require('path');
const { existsSync, readdirSync, statSync, mkdirSync, readFileSync, rmSync, cpSync } = require('fs');
const { spawnSync } = require('child_process');
const { syncLocalOpenClawExtensions } = require('./sync-local-openclaw-extensions.cjs');
const { precompileExtensions } = require('./precompile-openclaw-extensions.cjs');
const { packMultipleSources } = require('./pack-openclaw-tar.cjs');
const { ensurePortablePythonRuntime } = require('./setup-python-runtime.js');

// ── 平台/架构辅助 ────────────────────────────────────────────────────────────

function isWindowsTarget(context) {
  return context?.electronPlatformName === 'win32';
}

function isMacTarget(context) {
  return context?.electronPlatformName === 'darwin';
}

function resolveTargetArch(context) {
  if (context?.arch === 3) return 'arm64';
  if (context?.arch === 0) return 'ia32';
  if (context?.arch === 1) return 'x64';
  if (process.arch === 'arm64') return 'arm64';
  if (process.arch === 'ia32') return 'ia32';
  return 'x64';
}

function resolveOpenClawRuntimeTargetId(context) {
  const platform = context?.electronPlatformName;
  const arch = resolveTargetArch(context);

  if (platform === 'darwin') return arch === 'x64' ? 'mac-x64' : 'mac-arm64';
  if (platform === 'win32') return arch === 'arm64' ? 'win-arm64' : 'win-x64';
  if (platform === 'linux') return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';

  return null;
}

function getOpenClawRuntimeBuildHint(targetId) {
  if (!targetId) return 'npm run openclaw:runtime:host';
  return `npm run openclaw:runtime:${targetId}`;
}

// ── Runtime current 同步 ─────────────────────────────────────────────────────

function readRuntimeBuildInfo(runtimeRoot) {
  const buildInfoPath = path.join(runtimeRoot, 'runtime-build-info.json');
  if (!existsSync(buildInfoPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 确保 vendor/openclaw-runtime/current 指向目标平台目录。
 * sync-openclaw-runtime-current.cjs 用 require.main === module 判断，
 * 不能直接 require() 触发，所以这里内联同步逻辑。
 */
function syncCurrentOpenClawRuntimeForTarget(context) {
  const runtimeBase = path.join(__dirname, '..', 'vendor', 'openclaw-runtime');
  const currentRoot = path.join(runtimeBase, 'current');
  const targetId = resolveOpenClawRuntimeTargetId(context);

  if (!targetId) return { runtimeRoot: currentRoot, targetId: null };

  const targetRoot = path.join(runtimeBase, targetId);
  if (!existsSync(targetRoot)) {
    // 目标平台 runtime 不存在，保持 current 不变，后续验证会抛出清晰错误
    return { runtimeRoot: currentRoot, targetId };
  }

  const currentBuildInfo = readRuntimeBuildInfo(currentRoot);
  if (currentBuildInfo?.target !== targetId) {
    // current 与目标平台不匹配，重新复制
    rmSync(currentRoot, { recursive: true, force: true });
    cpSync(targetRoot, currentRoot, { recursive: true, force: true });
    console.log(`[electron-builder-hooks] Synced OpenClaw runtime ${targetId} -> current`);
  }

  return { runtimeRoot: currentRoot, targetId };
}

// ── 本地扩展编译检查 ─────────────────────────────────────────────────────────

function hasCompiledLocalExtension(runtimeRoot, extensionId) {
  const pluginDir = path.join(runtimeRoot, 'third-party-extensions', extensionId);
  return existsSync(path.join(pluginDir, 'openclaw.plugin.json'))
    && existsSync(path.join(pluginDir, 'index.js'));
}

/**
 * 检查必要的本地扩展是否已编译，若缺失则同步 + 预编译。
 */
async function ensureBundledLocalExtensions(runtimeRoot, buildHint) {
  const requiredLocalExtensions = ['mcp-bridge', 'ask-user-question'];
  const missingCompiled = requiredLocalExtensions.filter(
    (id) => !hasCompiledLocalExtension(runtimeRoot, id),
  );

  if (missingCompiled.length === 0) return;

  console.log(
    '[electron-builder-hooks] 恢复本地 OpenClaw 扩展（打包前）: '
    + missingCompiled.join(', '),
  );
  syncLocalOpenClawExtensions(runtimeRoot);
  await precompileExtensions(runtimeRoot);

  const stillMissing = requiredLocalExtensions.filter(
    (id) => !hasCompiledLocalExtension(runtimeRoot, id),
  );
  if (stillMissing.length > 0) {
    throw new Error(
      '[electron-builder-hooks] Runtime 缺少编译后的本地扩展: '
      + stillMissing.join(', ')
      + `。请先执行 \`${buildHint}\`。`,
    );
  }
}

// ── 预装插件验证 ─────────────────────────────────────────────────────────────

function verifyPreinstalledPlugins(runtimeRoot, buildHint) {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  let plugins = [];
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    plugins = (pkg.openclaw && pkg.openclaw.plugins) || [];
  } catch {
    return; // 无法读取 package.json，跳过校验
  }

  if (!Array.isArray(plugins) || plugins.length === 0) return;

  const extensionsDir = path.join(runtimeRoot, 'third-party-extensions');
  const missing = [];

  for (const plugin of plugins) {
    if (!plugin.id) continue;
    if (!existsSync(path.join(extensionsDir, plugin.id))) {
      missing.push(plugin.id);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      '[electron-builder-hooks] 以下预装插件在 runtime 中缺失: '
      + missing.join(', ')
      + `。请先执行 \`${buildHint}\`（含 openclaw:plugins）。`,
    );
  }

  console.log(`[electron-builder-hooks] 已校验 ${plugins.length} 个预装插件。`);
}

// ── skills 依赖安装 ──────────────────────────────────────────────────────────

function hasCommand(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * 遍历 skills/ 目录，对有 package.json 但没有 node_modules 的技能执行 npm install。
 */
function installSkillDependencies() {
  if (!hasCommand('npm')) {
    console.warn('[electron-builder-hooks] npm 不在 PATH 中，跳过 skill 依赖安装');
    return;
  }

  const skillsDir = path.join(__dirname, '..', 'skills');
  if (!existsSync(skillsDir)) {
    console.log('[electron-builder-hooks] skills 目录不存在，跳过依赖安装');
    return;
  }

  console.log('[electron-builder-hooks] 安装 skill 依赖...');

  const entries = readdirSync(skillsDir);
  let installed = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of entries) {
    const skillPath = path.join(skillsDir, entry);
    if (!statSync(skillPath).isDirectory()) continue;

    const packageJsonPath = path.join(skillPath, 'package.json');
    const nodeModulesPath = path.join(skillPath, 'node_modules');

    if (!existsSync(packageJsonPath)) continue;
    if (existsSync(nodeModulesPath)) {
      console.log(`[electron-builder-hooks]   ${entry}: node_modules 已存在，跳过`);
      skipped++;
      continue;
    }

    console.log(`[electron-builder-hooks]   ${entry}: 安装依赖...`);
    const isWin = process.platform === 'win32';
    const result = spawnSync('npm', ['install'], {
      cwd: skillPath,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5 * 60 * 1000,
      shell: isWin,
    });

    if (result.status === 0) {
      console.log(`[electron-builder-hooks]   ${entry}: ✓ 已安装`);
      installed++;
    } else {
      console.error(`[electron-builder-hooks]   ${entry}: ✗ 安装失败`);
      if (result.error) console.error(`[electron-builder-hooks]     错误: ${result.error.message}`);
      if (result.stderr) console.error(`[electron-builder-hooks]     ${result.stderr.substring(0, 200)}`);
      failed++;
    }
  }

  console.log(`[electron-builder-hooks] Skill 依赖: 已安装 ${installed}，已跳过 ${skipped}，失败 ${failed}`);
}

// ── macOS 打包后处理 ─────────────────────────────────────────────────────────

/**
 * 移除 petmind 树下所有 node_modules/.bin 目录。
 * macOS codesign 不接受 app bundle 内的符号链接，.bin/ 只含 CLI wrapper symlink，
 * 运行时不使用，可安全删除。
 */
function removeAllBinDirsInPetmind(appOutDir) {
  const petmindDir = path.join(appOutDir, 'Contents', 'Resources', 'petmind');

  if (!existsSync(petmindDir)) return;

  console.log('[electron-builder-hooks] 移除 petmind 下的 node_modules/.bin 目录...');

  let removedCount = 0;
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      // 仅删除 node_modules 直接子目录中名为 .bin 的目录
      if (entry.name === '.bin' && path.basename(path.dirname(full)) === 'node_modules') {
        rmSync(full, { recursive: true, force: true });
        removedCount++;
        continue;
      }
      walk(full);
    }
  };
  walk(petmindDir);

  console.log(`[electron-builder-hooks] ✓ 已移除 ${removedCount} 个 .bin 目录`);
}

function readPlistRawValue(infoPlistPath, key) {
  const result = spawnSync('plutil', ['-extract', key, 'raw', infoPlistPath], {
    encoding: 'utf-8',
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

/**
 * macOS 正式包图标以 electron-builder 的 mac.icon 为唯一事实源。
 * 这里只校验 builder 生成的 icon.icns / CFBundleIconFile，并刷新 bundle 元数据。
 */
function verifyMacIconBundle(appPath) {
  console.log('[electron-builder-hooks] 校验 macOS 图标资源...');

  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const iconPath = path.join(resourcesPath, 'icon.icns');

  if (!existsSync(infoPlistPath)) {
    console.warn(`[electron-builder-hooks] Info.plist 不存在: ${infoPlistPath}`);
    return;
  }
  if (!existsSync(iconPath)) {
    console.warn(`[electron-builder-hooks] icon.icns 不存在: ${iconPath}`);
    return;
  }

  const iconFile = readPlistRawValue(infoPlistPath, 'CFBundleIconFile');
  if (iconFile !== 'icon.icns') {
    console.warn(`[electron-builder-hooks] CFBundleIconFile 异常: ${iconFile || '<missing>'}`);
  } else {
    console.log('[electron-builder-hooks] ✓ CFBundleIconFile 指向 icon.icns');
  }

  // 清除扩展属性，避免签名时出错
  spawnSync('xattr', ['-cr', appPath], { encoding: 'utf-8' });
  spawnSync('touch', [appPath], { encoding: 'utf-8' });
  spawnSync('touch', [resourcesPath], { encoding: 'utf-8' });

  console.log('[electron-builder-hooks] ✓ macOS 图标资源校验完成');
}

// ── 主钩子 ───────────────────────────────────────────────────────────────────

async function beforePack(context) {
  // 1. 同步目标平台 runtime 到 current/
  const { runtimeRoot, targetId } = syncCurrentOpenClawRuntimeForTarget(context);
  const buildHint = getOpenClawRuntimeBuildHint(targetId);

  // 2. 确保本地扩展已编译（mcp-bridge、ask-user-question）
  await ensureBundledLocalExtensions(runtimeRoot, buildHint);

  // 3. 验证 package.json#openclaw.plugins 中声明的插件都在 runtime 里
  verifyPreinstalledPlugins(runtimeRoot, buildHint);

  // 4. 验证 gateway-bundle.mjs 存在且体积合理（> 1MB）
  // 缺失会导致 Windows 首次启动加载 ~1100 个 ESM 模块，耗时 80-100s
  const gatewayBundlePath = path.join(runtimeRoot, 'gateway-bundle.mjs');
  if (!existsSync(gatewayBundlePath)) {
    throw new Error(
      `[electron-builder-hooks] gateway-bundle.mjs 不存在于 ${runtimeRoot}。`
      + ' 请先执行 `npm run openclaw:bundle`。',
    );
  }
  const bundleStat = statSync(gatewayBundlePath);
  if (bundleStat.size < 1_000_000) {
    throw new Error(
      `[electron-builder-hooks] gateway-bundle.mjs 体积异常（${bundleStat.size} 字节，预期 > 1MB）。`
      + ' 请重新执行 `npm run openclaw:bundle`。',
    );
  }

  // 5. 验证 node_modules 存在
  if (!existsSync(path.join(runtimeRoot, 'node_modules'))) {
    throw new Error(
      `[electron-builder-hooks] runtime node_modules 不存在于 ${runtimeRoot}。`
      + ` 请先执行 \`${buildHint}\`。`,
    );
  }

  // 6. 安装 skills 依赖
  installSkillDependencies();

  // 7. Windows：设置便携式 Python 运行时（resources/python-win/）
  // required: true 确保非 Windows 宿主机也必须准备好（跨平台打包场景）
  if (isWindowsTarget(context)) {
    console.log('[electron-builder-hooks] 设置 Windows Python 运行时...');
    await ensurePortablePythonRuntime({ required: true });
  }

  // 8. Windows：打包 runtime + skills + python-win 为单个 tar，加速 NSIS 解压
  if (isWindowsTarget(context)) {
    const projectRoot = path.join(__dirname, '..');
    const buildTarDir = path.join(projectRoot, 'build-tar');
    mkdirSync(buildTarDir, { recursive: true });
    const outputTar = path.join(buildTarDir, 'win-resources.tar');
    // 先删除旧文件，防止 tar.replace 追加到过期内容
    if (existsSync(outputTar)) {
      const { unlinkSync } = require('fs');
      unlinkSync(outputTar);
    }
    console.log('[electron-builder-hooks] 打包 Windows tar...');
    // 三个来源：OpenClaw runtime（petmind）、技能包（skills）、Python 运行时（python-win）
    const sources = [
      { dir: path.join(projectRoot, 'vendor', 'openclaw-runtime', 'current'), prefix: 'petmind' },
      { dir: path.join(projectRoot, 'skills'), prefix: 'skills' },
      { dir: path.join(projectRoot, 'resources', 'python-win'), prefix: 'python-win' },
    ];
    packMultipleSources(sources, outputTar);
  }
}

async function afterPack(context) {
  if (isMacTarget(context)) {
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(context.appOutDir, `${appName}.app`);

    if (existsSync(appPath)) {
      // 移除 .bin 符号链接目录（codesign 不接受 app bundle 内的 symlink）
      removeAllBinDirsInPetmind(appPath);
      verifyMacIconBundle(appPath);
    } else {
      console.warn(`[electron-builder-hooks] App 不存在于 ${appPath}，跳过 macOS 后处理`);
    }
  }
}

module.exports = { beforePack, afterPack };
