# PetClaw v3 Phase 4 — 工程化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 PetClaw 的全平台打包、自动更新、CI/CD 和 Openclaw 版本管理，完成从开发到发布的工程化闭环。

**Architecture:** Openclaw runtime 通过 13 个构建脚本实现版本锁定→源码构建→网关 bundle→插件安装→体积裁剪完整流水线。electron-builder 配置从 package.json 迁移到独立 JSON 文件，通过 beforePack/afterPack hooks 集成 runtime 打包。electron-updater 实现 GitHub Releases 自动更新。GitHub Actions 三个工作流覆盖 CI lint/test/build 和全平台发布。

**Tech Stack:** electron-builder 25 · electron-updater · esbuild · GitHub Actions · Node.js CJS scripts

**参考实现:** LobsterAI `/Users/xiaoxuxuy/Desktop/工作/AI/开源项目/LobsterAI`（参考但不照抄，保持 PetClaw 特色）

**v3 Spec:** `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md` §20 + §25

---

## File Structure

### 新建文件

| 文件 | 职责 |
|------|------|
| `electron-builder.json` | electron-builder 全平台配置（从 package.json 迁出） |
| `scripts/ensure-openclaw-version.cjs` | git checkout 到锁定版本 tag |
| `scripts/run-build-openclaw-runtime.cjs` | 跨平台 bash 启动器 |
| `scripts/build-openclaw-runtime.sh` | 核心构建：pnpm install → tsc → asar → 入口 |
| `scripts/sync-openclaw-runtime-current.cjs` | symlink/junction → `current/` |
| `scripts/bundle-openclaw-gateway.cjs` | esbuild 单文件 bundle gateway |
| `scripts/openclaw-runtime-host.cjs` | 检测平台架构 |
| `scripts/ensure-openclaw-plugins.cjs` | npm registry 下载安装第三方插件 |
| `scripts/sync-local-openclaw-extensions.cjs` | 复制本地 extension 到 runtime |
| `scripts/precompile-openclaw-extensions.cjs` | esbuild 预编译 TS 扩展 |
| `scripts/install-openclaw-channel-deps.cjs` | 修复 channel 缺失依赖（临时） |
| `scripts/prune-openclaw-runtime.cjs` | 裁剪体积 |
| `scripts/pack-openclaw-tar.cjs` | Windows tar 打包加速 |
| `scripts/finalize-openclaw-runtime.cjs` | 开发模式 gateway.asar 重打包 |
| `scripts/electron-builder-hooks.cjs` | beforePack/afterPack 钩子 |
| `scripts/notarize.js` | macOS 公证脚本 |
| `scripts/nsis-installer.nsh` | Windows NSIS 自定义安装脚本 |
| `openclaw-extensions/ask-user-question/index.ts` | 本地扩展：结构化确认弹窗 |
| `openclaw-extensions/ask-user-question/package.json` | 扩展元数据 |
| `openclaw-extensions/mcp-bridge/index.ts` | 本地扩展：MCP 工具代理 |
| `openclaw-extensions/mcp-bridge/package.json` | 扩展元数据 |
| `build/entitlements.mac.plist` | macOS 签名权限 |
| `src/main/auto-updater.ts` | electron-updater 自动更新逻辑 |
| `.github/workflows/ci.yml` | CI 工作流（lint + test + build） |
| `.github/workflows/build-platforms.yml` | 全平台发布工作流 |
| `.github/workflows/openclaw-check.yml` | Openclaw 版本检查工作流 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `package.json` | 添加 openclaw 版本锁定、npm scripts、electron-updater 依赖；移除内联 build 配置 |
| `src/main/index.ts` | 集成 auto-updater 初始化 |
| `src/preload/index.ts` | 新增 updater IPC channels |
| `src/preload/index.d.ts` | 类型定义同步 |
| `.gitignore` | 添加 vendor/、build-tar/、dist/ 排除 |

---

## Task 1: package.json 版本锁定与 npm scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加 openclaw 版本锁定字段**

在 `package.json` 中添加 `openclaw` 字段（与 `build`/`scripts` 同级）：

```json
{
  "openclaw": {
    "version": "v2026.3.2",
    "repo": "https://github.com/openclaw/openclaw.git",
    "plugins": [
      { "id": "dingtalk-connector", "npm": "@dingtalk-real-ai/dingtalk-connector", "version": "0.8.16" },
      { "id": "openclaw-lark", "npm": "@larksuite/openclaw-lark", "version": "2026.4.7" },
      { "id": "wecom-openclaw-plugin", "npm": "@wecom/wecom-openclaw-plugin", "version": "2026.4.3" },
      { "id": "openclaw-weixin", "npm": "@tencent-weixin/openclaw-weixin", "version": "2.1.7" },
      { "id": "openclaw-nim-channel", "npm": "openclaw-nim-channel", "version": "1.1.1" },
      { "id": "clawemail-email", "npm": "@clawemail/email", "version": "0.9.12" }
    ]
  }
}
```

- [ ] **Step 2: 添加 openclaw npm scripts**

在 `scripts` 中追加：

```json
{
  "scripts": {
    "openclaw:ensure": "node scripts/ensure-openclaw-version.cjs",
    "openclaw:runtime:host": "node scripts/openclaw-runtime-host.cjs",
    "openclaw:runtime:mac-arm64": "node scripts/run-build-openclaw-runtime.cjs --target=mac-arm64",
    "openclaw:runtime:mac-x64": "node scripts/run-build-openclaw-runtime.cjs --target=mac-x64",
    "openclaw:runtime:win-x64": "node scripts/run-build-openclaw-runtime.cjs --target=win-x64",
    "openclaw:runtime:linux-x64": "node scripts/run-build-openclaw-runtime.cjs --target=linux-x64",
    "openclaw:bundle": "node scripts/bundle-openclaw-gateway.cjs",
    "openclaw:plugins": "node scripts/ensure-openclaw-plugins.cjs",
    "openclaw:extensions": "node scripts/sync-local-openclaw-extensions.cjs",
    "openclaw:precompile": "node scripts/precompile-openclaw-extensions.cjs",
    "openclaw:channel-deps": "node scripts/install-openclaw-channel-deps.cjs",
    "openclaw:prune": "node scripts/prune-openclaw-runtime.cjs",
    "openclaw:finalize": "node scripts/finalize-openclaw-runtime.cjs",
    "electron:dev": "electron-vite dev",
    "electron:dev:openclaw": "npm run openclaw:ensure && npm run openclaw:runtime:host && electron-vite dev"
  }
}
```

- [ ] **Step 3: 添加 electron-updater 依赖**

```json
{
  "dependencies": {
    "electron-updater": "^6.0.0"
  }
}
```

- [ ] **Step 4: 从 package.json 移除内联 build 配置**

删除 `package.json` 中的 `"build": { ... }` 整块（将迁移到 `electron-builder.json`）。保留 `"package"` script 不变。

- [ ] **Step 5: 更新 .gitignore**

在 `.gitignore` 中追加：

```
# Openclaw runtime build artifacts
vendor/openclaw-runtime/
build-tar/

# electron-builder output
dist/
release/
```

- [ ] **Step 6: 提交**

```bash
git add package.json .gitignore
git commit -m "chore: add openclaw version lock, npm scripts, and electron-updater dependency"
```

---

## Task 2: electron-builder.json 全平台配置

**Files:**
- Create: `electron-builder.json`
- Create: `build/entitlements.mac.plist`

- [ ] **Step 1: 创建 macOS 签名权限文件**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.automation.apple-events</key>
    <true/>
</dict>
</plist>
```

- [ ] **Step 2: 创建 electron-builder.json**

参考 LobsterAI `electron-builder.json`，PetClaw 定制版（`petmind` 替代 `cfmind`，无 Python 运行时，无 node-nim）：

```json
{
  "appId": "ai.petclaw.desktop",
  "productName": "PetClaw",
  "executableName": "PetClaw",
  "directories": {
    "output": "release"
  },
  "beforePack": "./scripts/electron-builder-hooks.cjs",
  "afterPack": "./scripts/electron-builder-hooks.cjs",
  "files": [
    "package.json",
    {
      "from": "out",
      "to": "out",
      "filter": ["**/*"]
    },
    "!**/*.map",
    "!**/*.d.ts",
    "!**/*.d.cts",
    "!**/*.d.mts",
    "!**/README.md",
    "!**/CHANGELOG.md",
    "!**/LICENSE",
    "!**/LICENSE.md",
    "!**/LICENSE.txt",
    "!**/.eslintrc*",
    "!**/.prettierrc*",
    "!**/tsconfig.json",
    "!**/tsconfig.*.json",
    "!**/*.test.*",
    "!**/*.spec.*",
    "!**/tests/**",
    "!**/test/**",
    "!**/__tests__/**"
  ],
  "extraResources": [
    {
      "from": "resources/tray",
      "to": "tray",
      "filter": ["**/*"]
    }
  ],
  "protocols": [
    {
      "name": "PetClaw",
      "schemes": ["petclaw"]
    }
  ],
  "publish": {
    "provider": "github",
    "owner": "xuxu03",
    "repo": "petclaw"
  },
  "mac": {
    "target": ["dmg", "zip"],
    "icon": "resources/icon.png",
    "category": "public.app-category.utilities",
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist",
    "extraResources": [
      {
        "from": "SKILLs",
        "to": "SKILLs",
        "filter": [
          "**/*",
          "!**/.env",
          "!**/.env.*",
          "!**/*.map",
          "!**/*.d.ts",
          "!**/README.md",
          "!**/CHANGELOG.md",
          "!**/LICENSE",
          "!**/tests/**",
          "!**/test/**",
          "!**/__tests__/**"
        ]
      },
      {
        "from": "vendor/openclaw-runtime/current",
        "to": "petmind",
        "filter": [
          "**/*",
          "!**/*.map",
          "!**/*.d.ts",
          "!**/README.md",
          "!**/CHANGELOG.md",
          "!**/LICENSE",
          "!**/tests/**",
          "!**/test/**",
          "!**/__tests__/**"
        ]
      }
    ]
  },
  "dmg": {
    "sign": false
  },
  "afterSign": "scripts/notarize.js",
  "win": {
    "target": ["nsis", "portable"],
    "icon": "resources/icon.png",
    "requestedExecutionLevel": "asInvoker",
    "extraResources": [
      {
        "from": "build-tar/win-resources.tar",
        "to": "win-resources.tar"
      },
      {
        "from": "scripts/unpack-petmind.cjs",
        "to": "unpack-petmind.cjs"
      }
    ]
  },
  "linux": {
    "target": ["AppImage", "deb"],
    "icon": "resources/icon.png",
    "category": "Utility",
    "extraResources": [
      {
        "from": "SKILLs",
        "to": "SKILLs",
        "filter": [
          "**/*",
          "!**/.env",
          "!**/.env.*",
          "!**/*.map",
          "!**/*.d.ts",
          "!**/README.md",
          "!**/CHANGELOG.md",
          "!**/LICENSE",
          "!**/tests/**",
          "!**/test/**",
          "!**/__tests__/**"
        ]
      },
      {
        "from": "vendor/openclaw-runtime/current",
        "to": "petmind",
        "filter": [
          "**/*",
          "!**/*.map",
          "!**/*.d.ts",
          "!**/README.md",
          "!**/CHANGELOG.md",
          "!**/LICENSE",
          "!**/tests/**",
          "!**/test/**",
          "!**/__tests__/**"
        ]
      }
    ],
    "desktop": {
      "Name": "PetClaw",
      "Comment": "AI Desktop Pet Assistant",
      "Terminal": "false"
    }
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "runAfterFinish": true,
    "deleteAppDataOnUninstall": true,
    "include": "scripts/nsis-installer.nsh"
  },
  "asarUnpack": [
    "node_modules/better-sqlite3/**"
  ],
  "asar": true,
  "npmRebuild": true,
  "nativeRebuilder": "sequential"
}
```

- [ ] **Step 3: 提交**

```bash
git add electron-builder.json build/entitlements.mac.plist
git commit -m "feat(build): add electron-builder.json with full platform config"
```

---

## Task 3: openclaw-runtime-host.cjs — 平台检测

**Files:**
- Create: `scripts/openclaw-runtime-host.cjs`

- [ ] **Step 1: 实现平台检测脚本**

参考 LobsterAI `scripts/openclaw-runtime-host.cjs`：

```javascript
// scripts/openclaw-runtime-host.cjs
// 检测当前平台架构，运行对应的 openclaw:runtime:<target> 命令

'use strict'

const { execSync } = require('child_process')

const PLATFORM_MAP = { darwin: 'mac', win32: 'win', linux: 'linux' }
const ARCH_MAP = { x64: 'x64', arm64: 'arm64', ia32: 'ia32' }

const platform = PLATFORM_MAP[process.platform]
const arch = ARCH_MAP[process.arch]

if (!platform || !arch) {
  console.error(`Unsupported platform: ${process.platform}-${process.arch}`)
  process.exit(1)
}

const targetId = `${platform}-${arch}`
const script = `openclaw:runtime:${targetId}`

console.log(`[openclaw-runtime-host] Detected platform: ${targetId}`)
console.log(`[openclaw-runtime-host] Running: npm run ${script}`)

try {
  execSync(`npm run ${script}`, { stdio: 'inherit', cwd: __dirname + '/..' })
} catch (err) {
  console.error(`[openclaw-runtime-host] Build failed for ${targetId}`)
  process.exit(1)
}
```

- [ ] **Step 2: 提交**

```bash
git add scripts/openclaw-runtime-host.cjs
git commit -m "feat(scripts): add openclaw-runtime-host platform detection"
```

---

## Task 4: ensure-openclaw-version.cjs — 版本锁定

**Files:**
- Create: `scripts/ensure-openclaw-version.cjs`

- [ ] **Step 1: 实现版本锁定脚本**

参考 LobsterAI `scripts/ensure-openclaw-version.cjs`，PetClaw 简化版（无 MinGit 检测）：

```javascript
// scripts/ensure-openclaw-version.cjs
// git checkout 到 package.json 中锁定的 openclaw 版本 tag
// 环境变量：OPENCLAW_SRC（默认 ../openclaw）、OPENCLAW_SKIP_ENSURE=1 跳过

'use strict'

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const ocConfig = pkg.openclaw
if (!ocConfig) {
  console.log('[ensure-openclaw-version] No openclaw config in package.json, skipping')
  process.exit(0)
}

const desiredTag = ocConfig.version
const repoUrl = ocConfig.repo
const srcDir = process.env.OPENCLAW_SRC || path.resolve(ROOT, '..', 'openclaw')

if (process.env.OPENCLAW_SKIP_ENSURE === '1') {
  console.log('[ensure-openclaw-version] OPENCLAW_SKIP_ENSURE=1, skipping version check')
  process.exit(0)
}

function git(args, opts = {}) {
  return execSync(`git ${args}`, {
    cwd: srcDir,
    encoding: 'utf8',
    stdio: opts.stdio || 'pipe',
    ...opts
  }).trim()
}

function getCurrentTag() {
  try {
    return git('describe --tags --exact-match HEAD')
  } catch {
    return null
  }
}

// 如果源码目录不存在，clone
if (!fs.existsSync(srcDir)) {
  console.log(`[ensure-openclaw-version] Cloning ${repoUrl} → ${srcDir} (tag: ${desiredTag})`)
  execSync(`git clone --branch ${desiredTag} --depth 1 ${repoUrl} "${srcDir}"`, {
    stdio: 'inherit'
  })
  console.log(`[ensure-openclaw-version] Done`)
  process.exit(0)
}

// 检查当前版本
const currentTag = getCurrentTag()
if (currentTag === desiredTag) {
  console.log(`[ensure-openclaw-version] Already at ${desiredTag}`)
  process.exit(0)
}

console.log(`[ensure-openclaw-version] Switching from ${currentTag || 'unknown'} → ${desiredTag}`)

// 获取 tag（可能需要 unshallow）
try {
  git('fetch --tags --depth 1', { stdio: 'inherit' })
} catch {
  try {
    git('fetch --unshallow --tags', { stdio: 'inherit' })
  } catch (e) {
    console.error(`[ensure-openclaw-version] Failed to fetch tags: ${e.message}`)
    process.exit(1)
  }
}

// 丢弃本地修改并 checkout
try {
  git('checkout -- .', { stdio: 'inherit' })
  git(`checkout ${desiredTag}`, { stdio: 'inherit' })
} catch (e) {
  console.error(`[ensure-openclaw-version] Failed to checkout ${desiredTag}: ${e.message}`)
  console.error('If you have local changes, set OPENCLAW_SKIP_ENSURE=1')
  process.exit(1)
}

console.log(`[ensure-openclaw-version] Now at ${desiredTag}`)
```

- [ ] **Step 2: 验证脚本语法**

Run: `cd petclaw-desktop && node -c scripts/ensure-openclaw-version.cjs`
Expected: 无输出（语法正确）

- [ ] **Step 3: 提交**

```bash
git add scripts/ensure-openclaw-version.cjs
git commit -m "feat(scripts): add ensure-openclaw-version for version locking"
```

---

## Task 5: run-build-openclaw-runtime.cjs — 跨平台启动器

**Files:**
- Create: `scripts/run-build-openclaw-runtime.cjs`

- [ ] **Step 1: 实现跨平台启动器**

参考 LobsterAI `scripts/run-build-openclaw-runtime.cjs`：

```javascript
// scripts/run-build-openclaw-runtime.cjs
// 跨平台启动 build-openclaw-runtime.sh
// 用法: node scripts/run-build-openclaw-runtime.cjs --target=mac-arm64

'use strict'

const path = require('path')
const { spawnSync, execSync } = require('child_process')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')

// 解析 --target 参数
let targetId = null
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--target=')) {
    targetId = arg.split('=')[1]
  }
}
if (!targetId) {
  console.error('Usage: node run-build-openclaw-runtime.cjs --target=<mac-arm64|mac-x64|win-x64|linux-x64>')
  process.exit(1)
}

const scriptPath = path.join(__dirname, 'build-openclaw-runtime.sh')
if (!fs.existsSync(scriptPath)) {
  console.error(`[run-build] build-openclaw-runtime.sh not found at ${scriptPath}`)
  process.exit(1)
}

// 查找 bash
let bashPath = 'bash'
if (process.platform === 'win32') {
  // Windows: 避免使用 WSL 的 bash，优先使用 Git Bash
  const gitBashCandidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
  ]
  for (const candidate of gitBashCandidates) {
    if (fs.existsSync(candidate)) {
      bashPath = candidate
      break
    }
  }
} else {
  try {
    bashPath = execSync('which bash', { encoding: 'utf8' }).trim()
  } catch {
    // 使用默认 'bash'
  }
}

console.log(`[run-build] bash: ${bashPath}`)
console.log(`[run-build] target: ${targetId}`)

// 构建环境变量
const env = { ...process.env }
if (process.platform === 'win32') {
  // Windows: 确保 Node.js 在 PATH 中
  const nodeDir = path.dirname(process.execPath)
  env.PATH = `${nodeDir};${env.PATH || env.Path || ''}`
}

const result = spawnSync(bashPath, [scriptPath, targetId], {
  cwd: ROOT,
  stdio: 'inherit',
  env
})

if (result.status !== 0) {
  console.error(`[run-build] Build failed with exit code ${result.status}`)
  process.exit(result.status || 1)
}
```

- [ ] **Step 2: 验证语法**

Run: `cd petclaw-desktop && node -c scripts/run-build-openclaw-runtime.cjs`

- [ ] **Step 3: 提交**

```bash
git add scripts/run-build-openclaw-runtime.cjs
git commit -m "feat(scripts): add run-build-openclaw-runtime cross-platform launcher"
```

---

## Task 6: build-openclaw-runtime.sh — 核心构建脚本

**Files:**
- Create: `scripts/build-openclaw-runtime.sh`

- [ ] **Step 1: 实现核心构建脚本**

参考 LobsterAI `scripts/build-openclaw-runtime.sh` 的 7 步流程，PetClaw 定制版（目录名 `petmind`，无 patches 步骤）：

```bash
#!/usr/bin/env bash
# scripts/build-openclaw-runtime.sh
# 核心构建脚本：将 Openclaw 源码构建为可分发的 runtime
# 用法: bash scripts/build-openclaw-runtime.sh <targetId>
# 示例: bash scripts/build-openclaw-runtime.sh mac-arm64

set -euo pipefail

TARGET_ID="${1:?Usage: build-openclaw-runtime.sh <targetId>}"

# 目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENCLAW_SRC="${OPENCLAW_SRC:-$(cd "$ROOT/.." && pwd)/openclaw}"
OUT_DIR="$ROOT/vendor/openclaw-runtime/$TARGET_ID"
TMP_DIR="$ROOT/vendor/openclaw-runtime/.tmp-$TARGET_ID"

# 解析平台和架构
IFS='-' read -r PLATFORM ARCH <<< "$TARGET_ID"
case "$PLATFORM" in
  mac) NPM_PLATFORM="darwin" ;;
  win) NPM_PLATFORM="win32" ;;
  linux) NPM_PLATFORM="linux" ;;
  *) echo "Unknown platform: $PLATFORM"; exit 1 ;;
esac

echo "============================================"
echo " PetClaw Openclaw Runtime Builder"
echo " Target: $TARGET_ID ($NPM_PLATFORM/$ARCH)"
echo " Source: $OPENCLAW_SRC"
echo " Output: $OUT_DIR"
echo "============================================"

# 检查源码目录
if [ ! -d "$OPENCLAW_SRC" ]; then
  echo "ERROR: Openclaw source not found at $OPENCLAW_SRC"
  echo "Run 'npm run openclaw:ensure' first"
  exit 1
fi

# 读取版本信息
OPENCLAW_VERSION=""
if [ -f "$OPENCLAW_SRC/package.json" ]; then
  OPENCLAW_VERSION=$(node -e "console.log(require('$OPENCLAW_SRC/package.json').version || '')")
fi
OPENCLAW_COMMIT=$(cd "$OPENCLAW_SRC" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# 构建缓存检查
BUILD_INFO_FILE="$OUT_DIR/runtime-build-info.json"
if [ -f "$BUILD_INFO_FILE" ] && [ "${OPENCLAW_FORCE_BUILD:-}" != "1" ]; then
  CACHED_VERSION=$(node -e "try{console.log(require('$BUILD_INFO_FILE').openclawVersion||'')}catch{console.log('')}")
  if [ "$CACHED_VERSION" = "$OPENCLAW_VERSION" ]; then
    echo "[cache] Version $OPENCLAW_VERSION unchanged, skipping build"
    echo "[cache] Set OPENCLAW_FORCE_BUILD=1 to force rebuild"
    exit 0
  fi
fi

# 清理临时目录
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

echo ""
echo "[1/7] Building Openclaw from source..."
cd "$OPENCLAW_SRC"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
  pnpm build
else
  npm install
  npm run build
fi

echo ""
echo "[2/7] Packing Openclaw..."
cd "$OPENCLAW_SRC"
OPENCLAW_PREPACK_PREPARED=1 npm pack --pack-destination "$TMP_DIR"
TARBALL=$(ls "$TMP_DIR"/*.tgz 2>/dev/null | head -1)
if [ -z "$TARBALL" ]; then
  echo "ERROR: npm pack produced no tarball"
  exit 1
fi

echo ""
echo "[3/7] Extracting to output..."
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
tar -xzf "$TARBALL" -C "$TMP_DIR"
cp -R "$TMP_DIR/package/." "$OUT_DIR/"

# 写入构建信息
node -e "
const fs = require('fs');
fs.writeFileSync('$BUILD_INFO_FILE', JSON.stringify({
  builtAt: new Date().toISOString(),
  source: '$OPENCLAW_SRC',
  target: '$TARGET_ID',
  openclawVersion: '$OPENCLAW_VERSION',
  openclawCommit: '$OPENCLAW_COMMIT'
}, null, 2));
"

echo ""
echo "[4/7] Installing production dependencies..."
cd "$OUT_DIR"
npm_config_platform="$NPM_PLATFORM" npm_config_arch="$ARCH" npm install --omit=dev

echo ""
echo "[5/7] Packing gateway.asar..."
# 将 openclaw.mjs + dist/ 打包到 gateway.asar（排除 dist/extensions/）
if [ -f "$OUT_DIR/openclaw.mjs" ] && [ -d "$OUT_DIR/dist" ]; then
  ASAR_STAGE="$TMP_DIR/asar-stage"
  mkdir -p "$ASAR_STAGE"
  cp "$OUT_DIR/openclaw.mjs" "$ASAR_STAGE/"
  cp -R "$OUT_DIR/dist" "$ASAR_STAGE/dist"
  # 移除 extensions（保留在外部）
  rm -rf "$ASAR_STAGE/dist/extensions"
  npx asar pack "$ASAR_STAGE" "$OUT_DIR/gateway.asar"
  # 清理已打包的源文件
  rm "$OUT_DIR/openclaw.mjs"
  # 保留 dist/extensions 和 dist/control-ui，删除其他
  find "$OUT_DIR/dist" -maxdepth 1 -not -name "dist" -not -name "extensions" -not -name "control-ui" -exec rm -rf {} +
  echo "gateway.asar created"
else
  echo "WARNING: openclaw.mjs or dist/ not found, skipping asar packing"
fi

echo ""
echo "[6/7] Verifying layout..."
ERRORS=0
[ -d "$OUT_DIR/node_modules" ] || { echo "FAIL: node_modules missing"; ERRORS=$((ERRORS+1)); }
if [ -f "$OUT_DIR/gateway.asar" ]; then
  [ ! -f "$OUT_DIR/openclaw.mjs" ] || { echo "FAIL: openclaw.mjs should be packed"; ERRORS=$((ERRORS+1)); }
fi
[ -f "$BUILD_INFO_FILE" ] || { echo "FAIL: runtime-build-info.json missing"; ERRORS=$((ERRORS+1)); }

if [ $ERRORS -gt 0 ]; then
  echo "Verification failed with $ERRORS error(s)"
  exit 1
fi

echo ""
echo "[7/7] Cleanup..."
rm -rf "$TMP_DIR"

echo ""
echo "============================================"
echo " Build complete: $OUT_DIR"
echo " Version: $OPENCLAW_VERSION ($OPENCLAW_COMMIT)"
echo "============================================"
```

- [ ] **Step 2: 设置可执行权限**

Run: `chmod +x petclaw-desktop/scripts/build-openclaw-runtime.sh`

- [ ] **Step 3: 提交**

```bash
git add scripts/build-openclaw-runtime.sh
git commit -m "feat(scripts): add build-openclaw-runtime.sh core build script"
```

---

## Task 7: sync-openclaw-runtime-current.cjs — symlink 管理

**Files:**
- Create: `scripts/sync-openclaw-runtime-current.cjs`

- [ ] **Step 1: 实现 symlink 管理**

参考 LobsterAI `scripts/sync-openclaw-runtime-current.cjs`：

```javascript
// scripts/sync-openclaw-runtime-current.cjs
// 将指定平台的 runtime 目录 symlink/junction 到 current/
// 用法: node scripts/sync-openclaw-runtime-current.cjs <targetId>
// 不传参数时自动检测当前平台

'use strict'

const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME_BASE = path.join(ROOT, 'vendor', 'openclaw-runtime')
const CURRENT = path.join(RUNTIME_BASE, 'current')

// 检测或使用传入的 targetId
let targetId = process.argv[2]
if (!targetId) {
  const platformMap = { darwin: 'mac', win32: 'win', linux: 'linux' }
  const platform = platformMap[process.platform]
  const arch = process.arch
  targetId = `${platform}-${arch}`
}

const targetDir = path.join(RUNTIME_BASE, targetId)

if (!fs.existsSync(targetDir)) {
  console.error(`[sync-current] Target not found: ${targetDir}`)
  console.error(`[sync-current] Run 'npm run openclaw:runtime:${targetId}' first`)
  process.exit(1)
}

// 移除旧链接
try {
  const stat = fs.lstatSync(CURRENT)
  if (stat.isSymbolicLink() || stat.isDirectory()) {
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(CURRENT)
    } else {
      // Windows junction or real directory
      fs.rmSync(CURRENT, { recursive: true, force: true })
    }
  }
} catch {
  // 不存在，忽略
}

// 创建链接
if (process.platform === 'win32') {
  // Windows: 使用 junction（不需要管理员权限）
  fs.symlinkSync(targetDir, CURRENT, 'junction')
} else {
  // Unix: 使用相对 symlink
  const relPath = path.relative(path.dirname(CURRENT), targetDir)
  fs.symlinkSync(relPath, CURRENT)
}

// 验证
const resolved = fs.realpathSync(CURRENT)
console.log(`[sync-current] ${CURRENT} → ${resolved}`)
```

- [ ] **Step 2: 验证语法**

Run: `cd petclaw-desktop && node -c scripts/sync-openclaw-runtime-current.cjs`

- [ ] **Step 3: 提交**

```bash
git add scripts/sync-openclaw-runtime-current.cjs
git commit -m "feat(scripts): add sync-openclaw-runtime-current symlink management"
```

---

## Task 8: bundle-openclaw-gateway.cjs — esbuild 打包

**Files:**
- Create: `scripts/bundle-openclaw-gateway.cjs`

- [ ] **Step 1: 安装 esbuild 开发依赖**

Run: `cd petclaw-desktop && npm install -D esbuild`

- [ ] **Step 2: 实现 gateway bundle 脚本**

参考 LobsterAI `scripts/bundle-openclaw-gateway.cjs`：

```javascript
// scripts/bundle-openclaw-gateway.cjs
// 将 gateway 入口打包为单文件 gateway-bundle.mjs（esbuild）
// 减少 1000+ ESM 模块冷启动到单文件加载

'use strict'

const path = require('path')
const fs = require('fs')

async function main() {
  const esbuild = require('esbuild')

  const ROOT = path.resolve(__dirname, '..')
  const RUNTIME = path.join(ROOT, 'vendor', 'openclaw-runtime', 'current')

  if (!fs.existsSync(RUNTIME)) {
    console.error('[bundle-gateway] Runtime not found at vendor/openclaw-runtime/current/')
    console.error('[bundle-gateway] Run openclaw:runtime:host first')
    process.exit(1)
  }

  // 查找入口文件
  const entryCandidates = [
    'dist/gateway-entry.js',
    'dist/gateway-entry.mjs',
    'dist/entry.js',
    'dist/entry.mjs'
  ]
  let entryFile = null
  // 先尝试从 gateway.asar 解包的情况（dist/ 已被清理）
  // 如果 gateway.asar 存在，需要从 asar 中提取入口
  for (const candidate of entryCandidates) {
    const fullPath = path.join(RUNTIME, candidate)
    if (fs.existsSync(fullPath)) {
      entryFile = fullPath
      break
    }
  }

  if (!entryFile) {
    // 尝试 openclaw.mjs 作为入口
    const oclawEntry = path.join(RUNTIME, 'openclaw.mjs')
    if (fs.existsSync(oclawEntry)) {
      entryFile = oclawEntry
    }
  }

  if (!entryFile) {
    console.error('[bundle-gateway] No gateway entry found')
    process.exit(1)
  }

  const outFile = path.join(RUNTIME, 'gateway-bundle.mjs')

  // 跳过检查：如果 bundle 比入口文件新，则跳过
  if (fs.existsSync(outFile)) {
    const bundleStat = fs.statSync(outFile)
    const entryStat = fs.statSync(entryFile)
    if (bundleStat.mtimeMs > entryStat.mtimeMs && process.env.OPENCLAW_FORCE_BUILD !== '1') {
      console.log('[bundle-gateway] gateway-bundle.mjs is up-to-date, skipping')
      return
    }
  }

  console.log(`[bundle-gateway] Bundling ${path.relative(RUNTIME, entryFile)} → gateway-bundle.mjs`)

  // 不打包进 bundle 的模块（原生模块、大型可选依赖）
  const external = [
    'sharp', '@img/*', '@lydell/*', '@mariozechner/*', '@napi-rs/*', '@snazzah/*',
    'koffi', 'electron', 'node-llama-cpp', 'ffmpeg-static',
    'chromium-bidi', 'playwright*', 'better-sqlite3', 'jiti'
  ]

  const startTime = Date.now()

  await esbuild.build({
    entryPoints: [entryFile],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    minify: true,
    treeShaking: true,
    external,
    // 注入 CJS 兼容（__filename/__dirname/require）
    banner: {
      js: [
        'import { createRequire as __petclaw_createRequire } from "module";',
        'import { fileURLToPath as __petclaw_fileURLToPath } from "url";',
        'import { dirname as __petclaw_dirname } from "path";',
        'const require = __petclaw_createRequire(import.meta.url);',
        'const __filename = __petclaw_fileURLToPath(import.meta.url);',
        'const __dirname = __petclaw_dirname(__filename);'
      ].join('\n')
    },
    logLevel: 'warning'
  })

  const stats = fs.statSync(outFile)
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1)
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log(`[bundle-gateway] Done: ${sizeMB} MB in ${elapsed}s`)
}

main().catch(err => {
  console.error('[bundle-gateway] Failed:', err.message)
  process.exit(1)
})
```

- [ ] **Step 3: 提交**

```bash
git add scripts/bundle-openclaw-gateway.cjs package.json
git commit -m "feat(scripts): add bundle-openclaw-gateway esbuild bundler"
```

---

## Task 9: ensure-openclaw-plugins.cjs — 插件安装

**Files:**
- Create: `scripts/ensure-openclaw-plugins.cjs`

- [ ] **Step 1: 实现插件安装脚本**

参考 LobsterAI `scripts/ensure-openclaw-plugins.cjs`，PetClaw 简化版（无 git 类型、无 post-install patches）：

```javascript
// scripts/ensure-openclaw-plugins.cjs
// 从 npm registry 安装 package.json#openclaw.plugins 声明的第三方插件
// 安装到 vendor/openclaw-runtime/current/third-party-extensions/

'use strict'

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const plugins = pkg.openclaw?.plugins || []

if (plugins.length === 0) {
  console.log('[ensure-plugins] No plugins declared, skipping')
  process.exit(0)
}

if (process.env.OPENCLAW_SKIP_PLUGINS === '1') {
  console.log('[ensure-plugins] OPENCLAW_SKIP_PLUGINS=1, skipping')
  process.exit(0)
}

const RUNTIME = path.join(ROOT, 'vendor', 'openclaw-runtime', 'current')
if (!fs.existsSync(RUNTIME)) {
  console.error('[ensure-plugins] Runtime not found at vendor/openclaw-runtime/current/')
  process.exit(1)
}

const EXTENSIONS_DIR = path.join(RUNTIME, 'third-party-extensions')
const CACHE_DIR = path.join(ROOT, 'vendor', 'openclaw-plugins')
fs.mkdirSync(EXTENSIONS_DIR, { recursive: true })
fs.mkdirSync(CACHE_DIR, { recursive: true })

for (const plugin of plugins) {
  const pluginDir = path.join(EXTENSIONS_DIR, plugin.id)
  const cacheKey = `${plugin.id}@${plugin.version}`
  const cacheDir = path.join(CACHE_DIR, plugin.id)
  const cacheMarker = path.join(cacheDir, '.version')

  // 检查缓存
  if (fs.existsSync(cacheMarker)) {
    const cachedVersion = fs.readFileSync(cacheMarker, 'utf8').trim()
    if (cachedVersion === cacheKey) {
      // 从缓存复制到 extensions
      if (!fs.existsSync(pluginDir)) {
        fs.cpSync(cacheDir, pluginDir, { recursive: true })
        console.log(`[ensure-plugins] ${plugin.id}@${plugin.version} (cached)`)
      } else {
        console.log(`[ensure-plugins] ${plugin.id}@${plugin.version} (already installed)`)
      }
      continue
    }
  }

  console.log(`[ensure-plugins] Installing ${plugin.id}@${plugin.version}...`)

  // 使用 openclaw CLI 安装（如果可用），否则 npm install
  const npmSpec = `${plugin.npm}@${plugin.version}`
  const stagingDir = path.join(ROOT, 'vendor', 'openclaw-plugins', '.staging', plugin.id)
  fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })

  try {
    const registryArgs = plugin.registry ? `--registry ${plugin.registry}` : ''
    execSync(`npm install ${npmSpec} ${registryArgs} --legacy-peer-deps --no-save`, {
      cwd: stagingDir,
      stdio: 'inherit',
      env: { ...process.env, npm_config_legacy_peer_deps: 'true' }
    })

    // 将安装结果复制到目标
    const installedDir = path.join(stagingDir, 'node_modules', plugin.npm.startsWith('@') ? plugin.npm : plugin.npm)
    if (fs.existsSync(installedDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true })
      fs.cpSync(installedDir, pluginDir, { recursive: true })
    } else {
      // npm install 可能把包装在不同路径
      fs.rmSync(pluginDir, { recursive: true, force: true })
      fs.cpSync(stagingDir, pluginDir, { recursive: true })
    }

    // 写入缓存
    fs.rmSync(cacheDir, { recursive: true, force: true })
    fs.cpSync(pluginDir, cacheDir, { recursive: true })
    fs.writeFileSync(cacheMarker, cacheKey)

    console.log(`[ensure-plugins] ${plugin.id}@${plugin.version} installed`)
  } catch (err) {
    if (plugin.optional) {
      console.warn(`[ensure-plugins] Optional plugin ${plugin.id} failed, skipping: ${err.message}`)
    } else {
      console.error(`[ensure-plugins] Failed to install ${plugin.id}: ${err.message}`)
      process.exit(1)
    }
  }

  // 清理 staging
  fs.rmSync(stagingDir, { recursive: true, force: true })
}

// 清理 staging 根目录
fs.rmSync(path.join(ROOT, 'vendor', 'openclaw-plugins', '.staging'), { recursive: true, force: true })

console.log(`[ensure-plugins] All ${plugins.length} plugins ready`)
```

- [ ] **Step 2: 提交**

```bash
git add scripts/ensure-openclaw-plugins.cjs
git commit -m "feat(scripts): add ensure-openclaw-plugins for plugin installation"
```

---

## Task 10: 本地扩展脚本 + openclaw-extensions/

**Files:**
- Create: `scripts/sync-local-openclaw-extensions.cjs`
- Create: `scripts/precompile-openclaw-extensions.cjs`
- Create: `openclaw-extensions/ask-user-question/package.json`
- Create: `openclaw-extensions/ask-user-question/index.ts`
- Create: `openclaw-extensions/mcp-bridge/package.json`
- Create: `openclaw-extensions/mcp-bridge/index.ts`

- [ ] **Step 1: 创建 ask-user-question 扩展骨架**

```json
// openclaw-extensions/ask-user-question/package.json
{
  "name": "petclaw-ask-user-question",
  "version": "1.0.0",
  "description": "PetClaw 本地扩展：结构化确认弹窗",
  "openclaw": {
    "extensions": ["index.ts"]
  }
}
```

```typescript
// openclaw-extensions/ask-user-question/index.ts
// 让 Agent 在执行危险操作前弹出结构化确认弹窗
// 通过 HTTP POST 回调 App（callbackUrl），携带 x-ask-user-secret 头
// App 在 Renderer 显示审批弹窗，用户选择后返回 { behavior: 'allow'|'deny', answers }
// 120s 超时自动 deny

export interface AskUserQuestionConfig {
  callbackUrl: string
  secret: string
  requestTimeoutMs?: number
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionInput {
  questions: Array<{
    question: string
    header: string
    options: QuestionOption[]
    multiSelect?: boolean
  }>
}

// 插件入口由 Openclaw plugin-sdk 约定
// 实际实现依赖 plugin-sdk 类型，此处仅提供骨架
// 完整实现参考 LobsterAI openclaw-extensions/ask-user-question/

export function register(sdk: unknown): void {
  // sdk.registerTool('AskUserQuestion', { ... })
  // tool handler:
  //   1. 构建 HTTP POST body: { requestId, questions }
  //   2. fetch(config.callbackUrl, { method: 'POST', headers: { 'x-ask-user-secret': config.secret }, body })
  //   3. 等待响应或 120s 超时
  //   4. 返回 { behavior, answers }
  console.log('[ask-user-question] Extension registered (skeleton)')
}
```

- [ ] **Step 2: 创建 mcp-bridge 扩展骨架**

```json
// openclaw-extensions/mcp-bridge/package.json
{
  "name": "petclaw-mcp-bridge",
  "version": "1.0.0",
  "description": "PetClaw 本地扩展：MCP 工具代理",
  "openclaw": {
    "extensions": ["index.ts"]
  }
}
```

```typescript
// openclaw-extensions/mcp-bridge/index.ts
// 将 App 管理的 MCP 服务器工具暴露为 Openclaw 原生工具
// 每个 MCP 工具注册一个代理 tool（名称格式 mcp_{server}_{tool}）
// Agent 调用代理 tool → HTTP POST 回调 App → App 调用实际 MCP → 返回结果

export interface McpBridgeConfig {
  callbackUrl: string
  secret: string
  requestTimeoutMs?: number
  tools: McpToolDescriptor[]
}

export interface McpToolDescriptor {
  server: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export function register(sdk: unknown): void {
  // sdk.registerTool('mcp_{server}_{tool}', { ... }) for each tool
  // tool handler:
  //   1. fetch(config.callbackUrl, { method: 'POST', headers: { 'x-ask-user-secret': config.secret }, body: { server, tool, input } })
  //   2. 等待响应或 requestTimeoutMs 超时
  //   3. 返回结果
  console.log('[mcp-bridge] Extension registered (skeleton)')
}
```

- [ ] **Step 3: 实现 sync-local-openclaw-extensions.cjs**

参考 LobsterAI `scripts/sync-local-openclaw-extensions.cjs`：

```javascript
// scripts/sync-local-openclaw-extensions.cjs
// 复制 openclaw-extensions/ 下所有子目录到 runtime 的 third-party-extensions/

'use strict'

const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const EXTENSIONS_SRC = path.join(ROOT, 'openclaw-extensions')
const runtimeRoot = process.argv[2] || path.join(ROOT, 'vendor', 'openclaw-runtime', 'current')
const EXTENSIONS_DEST = path.join(runtimeRoot, 'third-party-extensions')

function syncLocalOpenClawExtensions(destRoot) {
  const dest = destRoot || EXTENSIONS_DEST

  if (!fs.existsSync(EXTENSIONS_SRC)) {
    console.log('[sync-extensions] No openclaw-extensions/ directory, skipping')
    return
  }

  fs.mkdirSync(dest, { recursive: true })

  const entries = fs.readdirSync(EXTENSIONS_SRC, { withFileTypes: true })
  let count = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const src = path.join(EXTENSIONS_SRC, entry.name)
    const target = path.join(dest, entry.name)

    fs.rmSync(target, { recursive: true, force: true })
    fs.cpSync(src, target, { recursive: true })
    count++
    console.log(`[sync-extensions] ${entry.name} → ${path.relative(ROOT, target)}`)
  }

  console.log(`[sync-extensions] Synced ${count} local extension(s)`)
}

// 导出供 electron-builder-hooks.cjs 使用
module.exports = { syncLocalOpenClawExtensions }

// 直接运行时执行
if (require.main === module) {
  syncLocalOpenClawExtensions()
}
```

- [ ] **Step 4: 实现 precompile-openclaw-extensions.cjs**

参考 LobsterAI `scripts/precompile-openclaw-extensions.cjs`：

```javascript
// scripts/precompile-openclaw-extensions.cjs
// 使用 esbuild 预编译 TS 扩展为 JS，消除 jiti 运行时编译开销

'use strict'

const path = require('path')
const fs = require('fs')

async function precompileExtensions(runtimeRoot) {
  const esbuild = require('esbuild')

  const root = runtimeRoot || path.join(__dirname, '..', 'vendor', 'openclaw-runtime', 'current')
  const extDir = path.join(root, 'third-party-extensions')

  if (!fs.existsSync(extDir)) {
    console.log('[precompile] No third-party-extensions/ directory, skipping')
    return
  }

  const entries = fs.readdirSync(extDir, { withFileTypes: true })
  let compiled = 0
  let skipped = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const pluginDir = path.join(extDir, entry.name)
    const pkgPath = path.join(pluginDir, 'package.json')

    if (!fs.existsSync(pkgPath)) {
      skipped++
      continue
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const extensions = pkg.openclaw?.extensions || []

    for (const ext of extensions) {
      if (!ext.endsWith('.ts')) {
        skipped++
        continue
      }

      const tsFile = path.join(pluginDir, ext)
      if (!fs.existsSync(tsFile)) {
        console.warn(`[precompile] ${entry.name}: ${ext} not found, skipping`)
        skipped++
        continue
      }

      const jsFile = tsFile.replace(/\.ts$/, '.js')

      try {
        await esbuild.build({
          entryPoints: [tsFile],
          outfile: jsFile,
          bundle: true,
          format: 'cjs',
          platform: 'node',
          packages: 'external',
          external: ['openclaw/plugin-sdk', 'clawdbot/plugin-sdk'],
          logLevel: 'warning'
        })

        // 更新 package.json 中的入口
        const idx = extensions.indexOf(ext)
        extensions[idx] = ext.replace(/\.ts$/, '.js')
        pkg.openclaw.extensions = extensions
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

        compiled++
        console.log(`[precompile] ${entry.name}/${ext} → ${path.basename(jsFile)}`)
      } catch (err) {
        console.warn(`[precompile] ${entry.name}/${ext} failed (will use jiti fallback): ${err.message}`)
      }
    }
  }

  console.log(`[precompile] Done: ${compiled} compiled, ${skipped} skipped`)
}

module.exports = { precompileExtensions }

if (require.main === module) {
  precompileExtensions().catch(err => {
    console.error('[precompile] Failed:', err.message)
    process.exit(1)
  })
}
```

- [ ] **Step 5: 提交**

```bash
git add scripts/sync-local-openclaw-extensions.cjs scripts/precompile-openclaw-extensions.cjs openclaw-extensions/
git commit -m "feat(scripts): add local extension sync, precompile, and extension skeletons"
```

---

## Task 11: install-openclaw-channel-deps.cjs — channel 依赖修复

**Files:**
- Create: `scripts/install-openclaw-channel-deps.cjs`

- [ ] **Step 1: 实现 channel 依赖修复脚本**

参考 LobsterAI `scripts/install-openclaw-channel-deps.cjs`（临时脚本，Openclaw 修复后可移除）：

```javascript
// scripts/install-openclaw-channel-deps.cjs
// 临时修复：安装 channel 缺失的 bare specifier 依赖
// Openclaw v2026.4.5-v2026.4.8 打包 bug 导致 dist chunks 引用了 channel 内部依赖
// 此脚本在升级到修复版本后可移除

'use strict'

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'vendor', 'openclaw-runtime', 'current')

if (!fs.existsSync(RUNTIME)) {
  console.log('[channel-deps] Runtime not found, skipping')
  process.exit(0)
}

// 需要补装的依赖列表
const DEPS = [
  '@buape/carbon',
  '@larksuiteoapi/node-sdk',
  'grammy',
  '@grammyjs/runner',
  '@grammyjs/transformer-throttler'
]

// 检查哪些依赖缺失
const missing = DEPS.filter(dep => {
  try {
    const depDir = path.join(RUNTIME, 'node_modules', dep)
    return !fs.existsSync(depDir)
  } catch {
    return true
  }
})

if (missing.length === 0) {
  console.log('[channel-deps] All channel dependencies present')
  process.exit(0)
}

console.log(`[channel-deps] Installing ${missing.length} missing deps: ${missing.join(', ')}`)

try {
  execSync(`npm install ${missing.join(' ')} --no-save --legacy-peer-deps`, {
    cwd: RUNTIME,
    stdio: 'inherit',
    env: { ...process.env, npm_config_legacy_peer_deps: 'true' }
  })
  console.log('[channel-deps] Done')
} catch (err) {
  console.warn(`[channel-deps] Some deps failed (non-fatal): ${err.message}`)
}
```

- [ ] **Step 2: 提交**

```bash
git add scripts/install-openclaw-channel-deps.cjs
git commit -m "feat(scripts): add install-openclaw-channel-deps (temp workaround)"
```

---

## Task 12: prune-openclaw-runtime.cjs — 体积裁剪

**Files:**
- Create: `scripts/prune-openclaw-runtime.cjs`

- [ ] **Step 1: 实现体积裁剪脚本**

参考 LobsterAI `scripts/prune-openclaw-runtime.cjs`，PetClaw 简化版（保留的扩展列表不同）：

```javascript
// scripts/prune-openclaw-runtime.cjs
// 裁剪 runtime 体积：删除未用扩展、stub 大包、清理文件模式

'use strict'

const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'vendor', 'openclaw-runtime', 'current')

if (!fs.existsSync(RUNTIME)) {
  console.log('[prune] Runtime not found, skipping')
  process.exit(0)
}

let totalSaved = 0

// === 1. 移除未使用的 bundled extensions ===

const BUNDLED_EXTENSIONS_TO_KEEP = [
  // Providers
  'anthropic', 'deepseek', 'google', 'openai', 'openrouter',
  'qwen', 'moonshot', 'volcengine', 'kimi-coding',
  // Channels
  'telegram', 'discord', 'feishu', 'qqbot',
  // Core
  'browser', 'memory-core',
  // Media
  'image-generation-core', 'media-understanding-core'
]

const bundledExtDir = path.join(RUNTIME, 'dist', 'extensions')
if (fs.existsSync(bundledExtDir)) {
  const entries = fs.readdirSync(bundledExtDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (BUNDLED_EXTENSIONS_TO_KEEP.includes(entry.name)) continue
    const dirPath = path.join(bundledExtDir, entry.name)
    const size = getDirSize(dirPath)
    fs.rmSync(dirPath, { recursive: true, force: true })
    totalSaved += size
    console.log(`[prune] Removed bundled extension: ${entry.name} (${formatSize(size)})`)
  }
}

// === 2. Stub 大型未使用包 ===

const PACKAGES_TO_STUB = [
  'koffi', '@lancedb', '@jimp', '@napi-rs', 'pdfjs-dist', '@matrix-org'
]

const nodeModules = path.join(RUNTIME, 'node_modules')
if (fs.existsSync(nodeModules)) {
  for (const pkgPattern of PACKAGES_TO_STUB) {
    const pkgDir = path.join(nodeModules, pkgPattern)
    if (!fs.existsSync(pkgDir)) continue

    const size = getDirSize(pkgDir)
    fs.rmSync(pkgDir, { recursive: true, force: true })

    // 创建 stub
    fs.mkdirSync(pkgDir, { recursive: true })
    const stubPkg = { name: pkgPattern, version: '0.0.0-stub', main: 'index.js' }
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(stubPkg))
    fs.writeFileSync(path.join(pkgDir, 'index.js'),
      `module.exports = new Proxy({}, { get: () => { throw new Error('${pkgPattern} is stubbed') } });\n`)

    totalSaved += size
    console.log(`[prune] Stubbed: ${pkgPattern} (${formatSize(size)})`)
  }
}

// === 3. 移除 openclaw SDK 重复 ===

const thirdPartyDir = path.join(RUNTIME, 'third-party-extensions')
if (fs.existsSync(thirdPartyDir)) {
  const entries = fs.readdirSync(thirdPartyDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const sdkDir = path.join(thirdPartyDir, entry.name, 'node_modules', 'openclaw')
    if (fs.existsSync(sdkDir)) {
      const size = getDirSize(sdkDir)
      fs.rmSync(sdkDir, { recursive: true, force: true })
      totalSaved += size
      console.log(`[prune] Removed SDK duplicate in ${entry.name} (${formatSize(size)})`)
    }
  }
}

// === 4. 清理文件模式 ===

const CLEAN_PATTERNS = ['.map', '.d.ts', '.d.cts', '.d.mts']
const CLEAN_FILES = ['README.md', 'readme.md', 'CHANGELOG.md', 'HISTORY.md', 'LICENSE.md', 'LICENSE.txt']
const CLEAN_DIRS = ['test', 'tests', '__tests__', '.github', 'examples', 'coverage', 'docs']

function cleanDir(dir, depth = 0) {
  if (depth > 10) return // 防止无限递归
  if (!fs.existsSync(dir)) return

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isFile()) {
      const shouldClean = CLEAN_PATTERNS.some(p => entry.name.endsWith(p)) ||
        CLEAN_FILES.includes(entry.name)
      if (shouldClean) {
        const size = fs.statSync(fullPath).size
        fs.unlinkSync(fullPath)
        totalSaved += size
      }
    } else if (entry.isDirectory()) {
      if (CLEAN_DIRS.includes(entry.name)) {
        const size = getDirSize(fullPath)
        fs.rmSync(fullPath, { recursive: true, force: true })
        totalSaved += size
      } else if (entry.name !== '.bin') {
        cleanDir(fullPath, depth + 1)
      }
    }
  }
}

if (fs.existsSync(nodeModules)) {
  cleanDir(nodeModules)
}

console.log(`\n[prune] Total saved: ${formatSize(totalSaved)}`)

// === 工具函数 ===

function getDirSize(dir) {
  let size = 0
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile()) {
        size += fs.statSync(fullPath).size
      } else if (entry.isDirectory()) {
        size += getDirSize(fullPath)
      }
    }
  } catch {
    // ignore
  }
  return size
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
```

- [ ] **Step 2: 提交**

```bash
git add scripts/prune-openclaw-runtime.cjs
git commit -m "feat(scripts): add prune-openclaw-runtime for size optimization"
```

---

## Task 13: pack-openclaw-tar.cjs + finalize-openclaw-runtime.cjs

**Files:**
- Create: `scripts/pack-openclaw-tar.cjs`
- Create: `scripts/finalize-openclaw-runtime.cjs`

- [ ] **Step 1: 实现 tar 打包脚本**

参考 LobsterAI `scripts/pack-openclaw-tar.cjs`：

```javascript
// scripts/pack-openclaw-tar.cjs
// Windows NSIS 优化：将 runtime + SKILLs 打包为单个 tar 加速安装解压
// 用法: node scripts/pack-openclaw-tar.cjs --win-combined

'use strict'

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')

function packSingleSource(sourceDir, outputTar, prefix) {
  if (!fs.existsSync(sourceDir)) {
    console.error(`[pack-tar] Source not found: ${sourceDir}`)
    process.exit(1)
  }

  const outputDir = path.dirname(outputTar)
  fs.mkdirSync(outputDir, { recursive: true })

  // 使用 tar 命令（跨平台，node tar 包也可以）
  const relSource = path.relative(path.dirname(sourceDir), sourceDir)
  execSync(
    `tar -cf "${outputTar}" --exclude=".bin" --exclude="*.map" --exclude="*.d.ts" -C "${path.dirname(sourceDir)}" "${relSource}"`,
    { stdio: 'inherit' }
  )

  const stats = fs.statSync(outputTar)
  console.log(`[pack-tar] ${path.basename(outputTar)}: ${(stats.size / 1024 / 1024).toFixed(1)} MB`)
}

function packWinCombined() {
  const outputTar = path.join(ROOT, 'build-tar', 'win-resources.tar')
  const sources = [
    { dir: path.join(ROOT, 'vendor', 'openclaw-runtime', 'current'), prefix: 'petmind', label: 'runtime' },
    { dir: path.join(ROOT, 'SKILLs'), prefix: 'SKILLs', label: 'skills' }
  ]

  const outputDir = path.dirname(outputTar)
  fs.mkdirSync(outputDir, { recursive: true })

  // 创建空 tar 然后追加
  let first = true
  for (const source of sources) {
    if (!fs.existsSync(source.dir)) {
      console.warn(`[pack-tar] ${source.label} not found at ${source.dir}, skipping`)
      continue
    }

    const flag = first ? '-cf' : '-rf'
    first = false

    execSync(
      `tar ${flag} "${outputTar}" --exclude=".bin" --exclude="*.map" --exclude="*.d.ts" -C "${path.dirname(source.dir)}" "${path.basename(source.dir)}"`,
      { stdio: 'inherit' }
    )
    console.log(`[pack-tar] Added ${source.label}`)
  }

  if (fs.existsSync(outputTar)) {
    const stats = fs.statSync(outputTar)
    console.log(`[pack-tar] win-resources.tar: ${(stats.size / 1024 / 1024).toFixed(1)} MB`)
  }
}

// 命令行入口
const args = process.argv.slice(2)
if (args.includes('--win-combined')) {
  packWinCombined()
} else {
  console.log('Usage: node pack-openclaw-tar.cjs --win-combined')
}

module.exports = { packSingleSource, packWinCombined }
```

- [ ] **Step 2: 实现 finalize 脚本**

```javascript
// scripts/finalize-openclaw-runtime.cjs
// 开发模式下重新打包 gateway.asar（修改 dist/ 后调用）

'use strict'

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'vendor', 'openclaw-runtime', 'current')

if (!fs.existsSync(RUNTIME)) {
  console.log('[finalize] Runtime not found, skipping')
  process.exit(0)
}

const gatewayAsar = path.join(RUNTIME, 'gateway.asar')
const oclawMjs = path.join(RUNTIME, 'openclaw.mjs')
const distDir = path.join(RUNTIME, 'dist')

// 如果已经有 gateway.asar 并且 openclaw.mjs 不在外面，说明已打包
if (fs.existsSync(gatewayAsar) && !fs.existsSync(oclawMjs)) {
  console.log('[finalize] gateway.asar already packed, nothing to do')
  console.log('[finalize] Delete gateway.asar to rebuild')
  process.exit(0)
}

if (!fs.existsSync(oclawMjs) || !fs.existsSync(distDir)) {
  console.log('[finalize] openclaw.mjs or dist/ not found, nothing to pack')
  process.exit(0)
}

// 创建 asar 打包临时目录
const tmpDir = path.join(RUNTIME, '.asar-stage')
fs.rmSync(tmpDir, { recursive: true, force: true })
fs.mkdirSync(tmpDir, { recursive: true })

// 复制入口和 dist（排除 extensions）
fs.copyFileSync(oclawMjs, path.join(tmpDir, 'openclaw.mjs'))
fs.cpSync(distDir, path.join(tmpDir, 'dist'), { recursive: true })
fs.rmSync(path.join(tmpDir, 'dist', 'extensions'), { recursive: true, force: true })

// 打包
execSync(`npx asar pack "${tmpDir}" "${gatewayAsar}"`, { stdio: 'inherit', cwd: ROOT })

// 清理
fs.rmSync(tmpDir, { recursive: true, force: true })
fs.unlinkSync(oclawMjs)

// 保留 dist/extensions 和 dist/control-ui
const distEntries = fs.readdirSync(distDir, { withFileTypes: true })
for (const entry of distEntries) {
  if (entry.name !== 'extensions' && entry.name !== 'control-ui') {
    fs.rmSync(path.join(distDir, entry.name), { recursive: true, force: true })
  }
}

console.log('[finalize] gateway.asar repacked')
```

- [ ] **Step 3: 提交**

```bash
git add scripts/pack-openclaw-tar.cjs scripts/finalize-openclaw-runtime.cjs
git commit -m "feat(scripts): add pack-openclaw-tar and finalize-openclaw-runtime"
```

---

## Task 14: electron-builder-hooks.cjs — 打包钩子

**Files:**
- Create: `scripts/electron-builder-hooks.cjs`
- Create: `scripts/nsis-installer.nsh`
- Create: `scripts/notarize.js`

- [ ] **Step 1: 实现 builder hooks**

参考 LobsterAI `scripts/electron-builder-hooks.cjs`，PetClaw 定制版（`petmind` 替代 `cfmind`，无 Python）：

```javascript
// scripts/electron-builder-hooks.cjs
// electron-builder beforePack/afterPack 生命周期钩子

'use strict'

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')

// === beforePack ===

async function ensureBundledRuntime(context) {
  const { electronPlatformName, arch } = context
  const platformMap = { darwin: 'mac', win32: 'win', linux: 'linux' }
  const archMap = { 1: 'x64', 3: 'arm64', 2: 'ia32' } // electron-builder arch enum
  const platform = platformMap[electronPlatformName]
  const archName = typeof arch === 'number' ? archMap[arch] : arch
  const targetId = `${platform}-${archName}`

  console.log(`[builder-hooks] beforePack: target=${targetId}`)

  const runtimeDir = path.join(ROOT, 'vendor', 'openclaw-runtime', 'current')

  // 确保 current/ 指向正确平台
  const targetDir = path.join(ROOT, 'vendor', 'openclaw-runtime', targetId)
  if (fs.existsSync(targetDir)) {
    const { syncLocalOpenClawExtensions } = require('./sync-local-openclaw-extensions.cjs')
    const { precompileExtensions } = require('./precompile-openclaw-extensions.cjs')

    // sync current → target
    require('./sync-openclaw-runtime-current.cjs')

    // 确保本地扩展已编译
    const localExts = ['mcp-bridge', 'ask-user-question']
    const extDir = path.join(runtimeDir, 'third-party-extensions')
    let needSync = false

    for (const ext of localExts) {
      const extPath = path.join(extDir, ext)
      if (!fs.existsSync(extPath)) {
        needSync = true
        break
      }
      // 检查是否已编译
      const pkgPath = path.join(extPath, 'package.json')
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        const exts = pkg.openclaw?.extensions || []
        if (exts.some(e => e.endsWith('.ts'))) {
          needSync = true
          break
        }
      }
    }

    if (needSync) {
      console.log('[builder-hooks] Re-syncing + precompiling local extensions...')
      syncLocalOpenClawExtensions(runtimeDir)
      await precompileExtensions(runtimeDir)
    }
  }

  // 验证 runtime 结构
  const checks = [
    { path: path.join(runtimeDir, 'node_modules'), label: 'node_modules' },
    { path: path.join(runtimeDir, 'gateway-bundle.mjs'), label: 'gateway-bundle.mjs', minSize: 1024 * 1024 }
  ]

  for (const check of checks) {
    if (!fs.existsSync(check.path)) {
      throw new Error(`[builder-hooks] Missing: ${check.label} at ${check.path}`)
    }
    if (check.minSize) {
      const size = fs.statSync(check.path).size
      if (size < check.minSize) {
        throw new Error(`[builder-hooks] ${check.label} too small: ${size} bytes (expected >= ${check.minSize})`)
      }
    }
  }

  // Windows: 打 tar 包
  if (electronPlatformName === 'win32') {
    console.log('[builder-hooks] Packing Windows resources tar...')
    const { packWinCombined } = require('./pack-openclaw-tar.cjs')
    packWinCombined()
  }

  console.log('[builder-hooks] beforePack complete')
}

// === afterPack ===

async function fixMacCodesign(context) {
  if (context.electronPlatformName !== 'darwin') return

  // macOS: 删除 node_modules/.bin/ 符号链接（codesign 不兼容）
  const resourcesPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
  const petmindDir = path.join(resourcesPath, 'petmind')

  if (fs.existsSync(petmindDir)) {
    removeBinDirs(petmindDir)
    console.log('[builder-hooks] Removed .bin dirs from petmind (macOS codesign fix)')
  }
}

function removeBinDirs(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '.bin') {
        fs.rmSync(fullPath, { recursive: true, force: true })
      } else {
        removeBinDirs(fullPath)
      }
    }
  }
}

// === 导出（electron-builder 调用约定） ===

exports.default = async function (context) {
  // electron-builder 通过检查调用阶段来决定执行哪个钩子
  // beforePack 和 afterPack 在同一文件通过 context 区分

  // 注意：electron-builder 的 hooks 机制是：
  // - beforePack 配置指向此文件，调用 exports.default
  // - afterPack 配置指向此文件，调用 exports.default
  // 通过检测 context.appOutDir 是否存在来区分阶段

  if (context.appOutDir && fs.existsSync(context.appOutDir)) {
    // afterPack
    await fixMacCodesign(context)
  } else {
    // beforePack
    await ensureBundledRuntime(context)
  }
}
```

- [ ] **Step 2: 创建 NSIS 安装脚本**

```nsis
; scripts/nsis-installer.nsh
; Windows NSIS 自定义安装脚本
; 解压 win-resources.tar 到安装目录

!macro customInstall
  ; 解压 runtime tar
  DetailPrint "Extracting PetClaw runtime..."
  nsExec::ExecToLog '"$INSTDIR\resources\unpack-petmind.cjs"'
!macroend

!macro customUnInstall
  ; 清理 runtime
  RMDir /r "$INSTDIR\resources\petmind"
  RMDir /r "$INSTDIR\resources\SKILLs"
!macroend
```

- [ ] **Step 3: 创建 macOS 公证脚本**

```javascript
// scripts/notarize.js
// macOS 公证（需要 Apple Developer 帐号配置环境变量）

const { notarize } = require('@electron/notarize')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const appId = 'ai.petclaw.desktop'
  const appPath = `${appOutDir}/${context.packager.appInfo.productFilename}.app`

  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD) {
    console.log('[notarize] Skipping: APPLE_ID or APPLE_ID_PASSWORD not set')
    return
  }

  console.log(`[notarize] Notarizing ${appId}...`)

  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  })

  console.log('[notarize] Done')
}
```

- [ ] **Step 4: 安装 notarize 依赖**

Run: `cd petclaw-desktop && npm install -D @electron/notarize`

- [ ] **Step 5: 提交**

```bash
git add scripts/electron-builder-hooks.cjs scripts/nsis-installer.nsh scripts/notarize.js package.json
git commit -m "feat(scripts): add electron-builder hooks, NSIS installer, and notarize script"
```

---

## Task 15: auto-updater — 自动更新

**Files:**
- Create: `src/main/auto-updater.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: 实现 auto-updater 模块**

```typescript
// src/main/auto-updater.ts
// electron-updater 自动更新逻辑
// 通过 GitHub Releases 检测和分发更新

import { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

// electron-updater 配置
autoUpdater.logger = log
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

export interface UpdateInfo {
  version: string
  releaseDate: string
  releaseNotes: string | null
}

export function initAutoUpdater(chatWindow: BrowserWindow): void {
  // 检查更新事件
  autoUpdater.on('checking-for-update', () => {
    chatWindow.webContents.send('updater:status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    const updateInfo: UpdateInfo = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    }
    chatWindow.webContents.send('updater:status', { status: 'available', info: updateInfo })
  })

  autoUpdater.on('update-not-available', () => {
    chatWindow.webContents.send('updater:status', { status: 'up-to-date' })
  })

  autoUpdater.on('download-progress', (progress) => {
    chatWindow.webContents.send('updater:status', {
      status: 'downloading',
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      }
    })
  })

  autoUpdater.on('update-downloaded', () => {
    chatWindow.webContents.send('updater:status', { status: 'downloaded' })
  })

  autoUpdater.on('error', (err) => {
    chatWindow.webContents.send('updater:status', { status: 'error', error: err.message })
  })

  // 启动后延迟检查更新（避免启动性能影响）
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // 静默失败（离线等情况）
    })
  }, 10_000)
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates()
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate()
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
```

- [ ] **Step 2: 安装 electron-log 依赖**

Run: `cd petclaw-desktop && npm install electron-log`

- [ ] **Step 3: 在 index.ts 中集成 auto-updater**

在 `src/main/index.ts` 的启动流程中，boot 成功后初始化 auto-updater：

```typescript
// 在 boot:complete 之后
import { initAutoUpdater, checkForUpdates, downloadUpdate, installUpdate } from './auto-updater'

// ... boot 成功后
initAutoUpdater(chatWindow)

// IPC handlers
ipcMain.handle('updater:check', async () => checkForUpdates())
ipcMain.handle('updater:download', async () => downloadUpdate())
ipcMain.handle('updater:install', async () => installUpdate())
```

- [ ] **Step 4: 更新 preload/index.ts**

在 preload 中新增 updater channels：

```typescript
updater: {
  check: () => ipcRenderer.invoke('updater:check'),
  download: () => ipcRenderer.invoke('updater:download'),
  install: () => ipcRenderer.invoke('updater:install'),
  onStatus: (cb: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => cb(data)
    ipcRenderer.on('updater:status', handler)
    return () => ipcRenderer.removeListener('updater:status', handler)
  }
}
```

- [ ] **Step 5: 更新 preload/index.d.ts**

同步类型定义：

```typescript
updater: {
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  onStatus: (cb: (data: {
    status: 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'
    info?: { version: string; releaseDate: string; releaseNotes: string | null }
    progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number }
    error?: string
  }) => void) => () => void
}
```

- [ ] **Step 6: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit`

- [ ] **Step 7: 提交**

```bash
git add src/main/auto-updater.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts package.json
git commit -m "feat(updater): add electron-updater auto-update with GitHub Releases"
```

---

## Task 16: CI/CD — GitHub Actions 工作流

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/build-platforms.yml`
- Create: `.github/workflows/openclaw-check.yml`

- [ ] **Step 1: 创建 CI 工作流**

参考 LobsterAI `.github/workflows/ci.yml`，PetClaw 简化版：

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: 'npm'
          cache-dependency-path: petclaw-desktop/package-lock.json
      - run: cd petclaw-desktop && npm ci
      - run: cd petclaw-desktop && npm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: 'npm'
          cache-dependency-path: petclaw-desktop/package-lock.json
      - run: cd petclaw-desktop && npm ci
      - run: cd petclaw-desktop && npm run typecheck

  test:
    runs-on: ubuntu-latest
    needs: [lint, typecheck]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: 'npm'
          cache-dependency-path: petclaw-desktop/package-lock.json
      - run: cd petclaw-desktop && npm ci
      - run: cd petclaw-desktop && npm test

  build:
    runs-on: ubuntu-latest
    needs: [test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: 'npm'
          cache-dependency-path: petclaw-desktop/package-lock.json
      - run: cd petclaw-desktop && npm ci
      - run: cd petclaw-desktop && npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: petclaw-desktop/out/
          retention-days: 7
```

- [ ] **Step 2: 创建全平台发布工作流**

参考 LobsterAI `.github/workflows/build-platforms.yml`：

```yaml
# .github/workflows/build-platforms.yml
name: Build & Release

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: 'npm'
          cache-dependency-path: petclaw-desktop/package-lock.json
      - run: cd petclaw-desktop && npm ci
      - run: cd petclaw-desktop && npm run build
      - run: cd petclaw-desktop && npx electron-builder --mac --publish never
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
      - uses: actions/upload-artifact@v4
        with:
          name: macos-build
          path: |
            petclaw-desktop/release/*.dmg
            petclaw-desktop/release/*.zip
          retention-days: 30

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: 'npm'
          cache-dependency-path: petclaw-desktop/package-lock.json
      - run: cd petclaw-desktop && npm ci
      - run: cd petclaw-desktop && npm run build
      - run: cd petclaw-desktop && npx electron-builder --win --publish never
        env:
          WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
      - uses: actions/upload-artifact@v4
        with:
          name: windows-build
          path: |
            petclaw-desktop/release/*.exe
          retention-days: 30

  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: 'npm'
          cache-dependency-path: petclaw-desktop/package-lock.json
      - run: |
          sudo apt-get update
          sudo apt-get install -y libgtk-3-dev libnotify-dev libnss3-dev libxss1 libgconf-2-4 libatk-bridge2.0-0 libdrm2 libgbm1
      - run: cd petclaw-desktop && npm ci
      - run: cd petclaw-desktop && npm run build
      - run: cd petclaw-desktop && npx electron-builder --linux --publish never
      - uses: actions/upload-artifact@v4
        with:
          name: linux-build
          path: |
            petclaw-desktop/release/*.AppImage
            petclaw-desktop/release/*.deb
          retention-days: 30

  create-release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: [build-macos, build-windows, build-linux]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          path: artifacts/
      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          draft: true
          prerelease: ${{ contains(github.ref, '-beta') || contains(github.ref, '-alpha') || contains(github.ref, '-rc') }}
          files: artifacts/**/*
          generate_release_notes: true
```

- [ ] **Step 3: 创建 Openclaw 版本检查工作流**

```yaml
# .github/workflows/openclaw-check.yml
name: Openclaw Version Check

on:
  schedule:
    - cron: '23 8 * * 1'  # 每周一 08:23 UTC
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'
      - name: Check Openclaw version
        run: |
          CURRENT=$(node -e "console.log(require('./petclaw-desktop/package.json').openclaw.version)")
          echo "Current Openclaw version: $CURRENT"
          # 检查 repo 中最新 tag
          LATEST=$(git ls-remote --tags https://github.com/openclaw/openclaw.git | grep -oP 'v\d+\.\d+\.\d+' | sort -V | tail -1)
          echo "Latest Openclaw version: $LATEST"
          if [ "$CURRENT" != "$LATEST" ]; then
            echo "::warning::Openclaw update available: $CURRENT → $LATEST"
          else
            echo "Openclaw is up to date"
          fi
```

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/
git commit -m "feat(ci): add GitHub Actions workflows for CI, release, and openclaw check"
```

---

## Task 17: 收尾与验证

**Files:**
- Multiple verification steps

- [ ] **Step 1: 验证所有脚本语法**

Run: `cd petclaw-desktop && for f in scripts/*.cjs; do echo "Checking $f..."; node -c "$f"; done`
Expected: 全部无输出（语法正确）

- [ ] **Step 2: 类型检查**

Run: `cd petclaw-desktop && npm run typecheck`
Expected: 通过

- [ ] **Step 3: 运行全量测试**

Run: `cd petclaw-desktop && npm test`
Expected: 全部通过

- [ ] **Step 4: 验证 electron-builder 配置**

Run: `cd petclaw-desktop && npx electron-builder --help` （验证配置文件被正确识别）

- [ ] **Step 5: 验证 package.json 结构**

Run: `cd petclaw-desktop && node -e "const p = require('./package.json'); console.log('openclaw:', p.openclaw.version); console.log('plugins:', p.openclaw.plugins.length)"`
Expected: 输出版本号和插件数量

- [ ] **Step 6: 同步文档**

更新 `.ai/README.md` 和 `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md` 的 Phase 4 完成状态。

- [ ] **Step 7: 最终提交**

```bash
git add -A
git commit -m "docs: mark Phase 4 engineering tasks complete"
```

---

## Verification

### 脚本验证
1. `node -c scripts/*.cjs` — 全部语法正确
2. `bash -n scripts/build-openclaw-runtime.sh` — shell 语法正确
3. `npm run typecheck` — 类型检查通过
4. `npm test` — 全量测试通过

### Phase 4 验证标准（来自 v3 spec §26）
- electron-builder 全平台打包（macOS dmg/zip + Windows NSIS/portable + Linux AppImage/deb）
- 自动更新：发布 → 检测 → 下载 → 安装 流程正常
- CI/CD: push → build → test → package 全链路通过
- Openclaw 版本管理：`package.json` 中 `openclaw.version` 变更后 `openclaw:ensure` 自动 checkout 到锁定版本
- Openclaw 版本管理：`runtime-build-info.json` 缓存命中时跳过构建，版本变更时触发重新构建

### 手动验证清单
1. `npm run openclaw:ensure` — 检出锁定版本（需要 `../openclaw` 源码目录或首次 clone）
2. `npm run openclaw:runtime:host` — 自动检测平台并触发构建
3. `npm run openclaw:bundle` — 生成 gateway-bundle.mjs
4. `npm run openclaw:plugins` — 安装 6 个第三方插件
5. `npm run openclaw:extensions` — 同步 2 个本地扩展
6. `npm run openclaw:precompile` — TS → JS 预编译
7. `npm run openclaw:prune` — 体积裁剪
8. `npx electron-builder --mac` — macOS 打包成功
9. 安装 dmg → 启动 → 10 秒后自动检查更新