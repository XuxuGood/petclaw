'use strict';

// scripts/precompile-openclaw-extensions.cjs
// 使用 esbuild 预编译 third-party-extensions/ 下的 TS 扩展为 JS
// 消除 jiti/Babel 运行时编译开销（首次启动可节省 ~135s）
// jiti 发现 .js 文件时直接加载，跳过 Babel 编译，同时仍保留模块别名解析
//
// 用法:
//   node scripts/precompile-openclaw-extensions.cjs [runtime-dir]
//   默认 runtime-dir 为 vendor/openclaw-runtime/current

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

// SDK 导入必须保持 external — jiti 在运行时通过别名解析这些模块
const SDK_EXTERNALS = [
  'openclaw/plugin-sdk',
  'openclaw/plugin-sdk/*',
  'clawdbot/plugin-sdk',
  'clawdbot/plugin-sdk/*',
];

// esbuild 插件：将指向 openclaw 核心源码的相对导入（../../../src/...）标记为 external
// 这些导入只存在于完整的 openclaw 源码树中，运行时由 jiti 解析
const openclawInternalsPlugin = {
  name: 'externalize-openclaw-internals',
  setup(build) {
    build.onResolve({ filter: /^\.\.\/.*\/src\// }, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

let esbuild;
try {
  esbuild = require('esbuild');
} catch {
  // require 时不退出 — 只在实际调用编译时才报错
  esbuild = null;
}

/**
 * 解析插件目录的 TypeScript 入口点。
 * 如果插件已经编译（.js）或没有 TS 入口，返回 null。
 */
function resolvePluginEntry(pluginDir) {
  const pkgPath = path.join(pluginDir, 'package.json');

  // 策略 1：从 package.json → openclaw.extensions 读取入口
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const entries = pkg.openclaw?.extensions;
      if (Array.isArray(entries) && entries.length > 0) {
        const entry = entries[0]; // 第一个入口为主入口
        // 已经是 JS 文件，无需编译
        if (entry.endsWith('.js') || entry.endsWith('.mjs') || entry.endsWith('.cjs')) {
          return null;
        }
        const abs = path.resolve(pluginDir, entry);
        if (fs.existsSync(abs)) {
          return { entryAbs: abs, entryRel: entry, hasPkg: true };
        }
      }
    } catch {
      // package.json 解析失败，降级到约定入口
    }
  }

  // 策略 2：约定入口 index.ts
  const indexTs = path.join(pluginDir, 'index.ts');
  if (fs.existsSync(indexTs)) {
    return { entryAbs: indexTs, entryRel: './index.ts', hasPkg: fs.existsSync(pkgPath) };
  }

  return null;
}

function ensureEsbuild() {
  if (!esbuild) {
    console.error('[precompile-extensions] esbuild 未找到。请执行: npm install --save-dev esbuild');
    throw new Error('esbuild not available');
  }
}

/**
 * 编译指定扩展目录下的所有 TS 插件。
 *
 * @param {string} targetDir - third-party-extensions/ 目录的绝对路径
 */
async function compileExtensionsInDir(targetDir) {
  ensureEsbuild();

  const t0 = Date.now();
  const dirs = fs.readdirSync(targetDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  let compiled = 0;
  let skipped = 0;
  let errors = 0;

  for (const name of dirs) {
    const pluginDir = path.join(targetDir, name);
    const entry = resolvePluginEntry(pluginDir);

    if (!entry) {
      skipped++;
      continue;
    }

    const outFile = entry.entryAbs.replace(/\.tsx?$/, '.js');
    const outRel = entry.entryRel.replace(/\.tsx?$/, '.js');

    try {
      await esbuild.build({
        entryPoints: [entry.entryAbs],
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'es2023',
        outfile: outFile,
        packages: 'external', // 所有 node_modules 依赖保持 external
        external: SDK_EXTERNALS,
        plugins: [openclawInternalsPlugin],
        logLevel: 'warning',
      });

      // 更新 package.json 中的入口指向编译后的 .js 文件
      if (entry.hasPkg) {
        const pkgPath = path.join(pluginDir, 'package.json');
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (Array.isArray(pkg.openclaw?.extensions)) {
            pkg.openclaw.extensions = pkg.openclaw.extensions.map((e) =>
              e === entry.entryRel ? outRel : e,
            );
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
          }
        } catch {
          // 非关键错误 — jiti 仍可通过约定找到 index.js
        }
      }

      compiled++;
    } catch (err) {
      console.error(`[precompile-extensions] 编译失败 ${name}: ${err.message || err}`);
      errors++;
    }
  }

  const elapsed = Date.now() - t0;
  console.log(
    `[precompile-extensions] 完成 (${elapsed}ms): ` +
    `${compiled} 已编译, ${skipped} 已跳过, ${errors} 失败`,
  );

  if (errors > 0) {
    // 非致命 — 失败的插件将降级到 jiti 运行时编译
    console.warn('[precompile-extensions] 部分插件编译失败，将使用 jiti 运行时编译作为降级方案');
  }
}

/**
 * 预编译指定 runtime 目录下的扩展。
 * 供 electron-builder-hooks.cjs 调用。
 *
 * @param {string} [runtimeRoot] - runtime 根目录路径，默认为 vendor/openclaw-runtime/current
 */
async function precompileExtensions(runtimeRoot) {
  const targetRoot = runtimeRoot
    ? path.resolve(runtimeRoot)
    : path.join(rootDir, 'vendor', 'openclaw-runtime', 'current');
  const targetDir = path.join(targetRoot, 'third-party-extensions');

  if (!fs.existsSync(targetDir)) {
    console.log('[precompile-extensions] 未找到扩展目录，跳过');
    return;
  }

  await compileExtensionsInDir(targetDir);
}

if (require.main === module) {
  const runtimeDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(rootDir, 'vendor', 'openclaw-runtime', 'current');

  const extDir = path.join(runtimeDir, 'third-party-extensions');
  if (!fs.existsSync(extDir)) {
    console.log('[precompile-extensions] 未找到扩展目录，跳过');
    process.exit(0);
  }

  compileExtensionsInDir(extDir).catch((err) => {
    console.error(`[precompile-extensions] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { precompileExtensions };
