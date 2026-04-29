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
  [ ! -f "$OUT_DIR/openclaw.mjs" ] || { echo "FAIL: openclaw.mjs should be packed into gateway.asar"; ERRORS=$((ERRORS+1)); }
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