#!/usr/bin/env bash
# ────────────────────────────────────────────────────────
# prepare-runtime.sh
# 下载并打包 Node.js + Openclaw 运行时资源
# 生成 resources/node/<platform-arch>.tar.gz
#       resources/openclaw/<platform-arch>.tar.gz
# ────────────────────────────────────────────────────────
set -euo pipefail

# ── 版本配置（必须对应：Openclaw 要求 Node.js >= 22.12） ──
NODE_VERSION="v22.14.0"
OPENCLAW_VERSION="2026.3.11"  # npm 版本号，可改为 "latest"

# ── 目标架构（可通过参数覆盖，默认当前平台）──
PLATFORM="${1:-$(uname -s | tr '[:upper:]' '[:lower:]')}"
ARCH="${2:-$(uname -m)}"

# 规范化
case "$PLATFORM" in
  darwin|linux) ;;
  mingw*|msys*|cygwin*) PLATFORM="win" ;;
  *) echo "Unsupported platform: $PLATFORM"; exit 1 ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|x64) ARCH="x64" ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

TARGET="${PLATFORM}-${ARCH}"
echo "🎯 Target: $TARGET"
echo "📦 Node.js: $NODE_VERSION"
echo "📦 Openclaw: $OPENCLAW_VERSION"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESOURCES_DIR="$PROJECT_DIR/resources"
TMP_DIR="$(mktemp -d)"

trap "rm -rf $TMP_DIR" EXIT

# ── Step 1: 下载 Node.js ──
echo ""
echo "⬇️  Downloading Node.js $NODE_VERSION for $TARGET..."

if [ "$PLATFORM" = "win" ]; then
  NODE_FILENAME="node-${NODE_VERSION}-win-${ARCH}.zip"
  NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_FILENAME}"
else
  NODE_FILENAME="node-${NODE_VERSION}-${PLATFORM}-${ARCH}.tar.gz"
  NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_FILENAME}"
fi

NODE_TMP="$TMP_DIR/node-download"
mkdir -p "$NODE_TMP"

curl -fSL --progress-bar "$NODE_URL" -o "$TMP_DIR/$NODE_FILENAME"

# Use nodejs.org tar.gz directly (bootcheck extracts with --strip-components=2)
echo "📦 Copying Node.js tar.gz..."
mkdir -p "$RESOURCES_DIR/node"
cp "$TMP_DIR/$NODE_FILENAME" "$RESOURCES_DIR/node/${TARGET}.tar.gz"
NODE_SIZE=$(du -h "$RESOURCES_DIR/node/${TARGET}.tar.gz" | cut -f1)
echo "✅ Node.js packaged: resources/node/${TARGET}.tar.gz ($NODE_SIZE)"

# Also extract locally for npm install in next step
NODE_EXTRACT="$TMP_DIR/node-extracted"
mkdir -p "$NODE_EXTRACT"
tar xzf "$TMP_DIR/$NODE_FILENAME" -C "$NODE_EXTRACT" --strip-components=1

# ── Step 2: 安装并打包 Openclaw ──
echo ""
echo "⬇️  Installing Openclaw ($OPENCLAW_VERSION) via npm..."

OPENCLAW_TMP="$TMP_DIR/openclaw-install"
mkdir -p "$OPENCLAW_TMP"

# Use the just-extracted node to install openclaw
export PATH="$NODE_EXTRACT/bin:$PATH"
npm install -g openclaw@"$OPENCLAW_VERSION" --prefix "$OPENCLAW_TMP" 2>&1 | tail -3

OPENCLAW_DIR="$OPENCLAW_TMP/lib/node_modules"
if [ ! -d "$OPENCLAW_DIR/openclaw" ]; then
  echo "❌ Openclaw installation failed"
  exit 1
fi

# Flatten: hoist openclaw's nested deps to top-level node_modules
echo "📂 Flattening dependencies..."
FLAT_DIR="$TMP_DIR/openclaw-flat/node_modules"
mkdir -p "$FLAT_DIR"

# Copy openclaw itself
cp -R "$OPENCLAW_DIR/openclaw" "$FLAT_DIR/openclaw"

# Hoist nested deps from openclaw/node_modules to top level
if [ -d "$FLAT_DIR/openclaw/node_modules" ]; then
  cp -R "$FLAT_DIR/openclaw/node_modules"/* "$FLAT_DIR/" 2>/dev/null || true
  rm -rf "$FLAT_DIR/openclaw/node_modules"
fi

echo "📦 Packaging Openclaw (flattened)..."
mkdir -p "$RESOURCES_DIR/openclaw"
cd "$TMP_DIR/openclaw-flat"
tar czf "$RESOURCES_DIR/openclaw/${TARGET}.tar.gz" node_modules
OC_SIZE=$(du -h "$RESOURCES_DIR/openclaw/${TARGET}.tar.gz" | cut -f1)
echo "✅ Openclaw packaged: resources/openclaw/${TARGET}.tar.gz ($OC_SIZE)"

# ── Summary ──
echo ""
echo "════════════════════════════════════════"
echo "  Runtime resources prepared for $TARGET"
echo "  Node.js:  $NODE_VERSION  ($NODE_SIZE)"
echo "  Openclaw: $OPENCLAW_VERSION ($OC_SIZE)"
echo "════════════════════════════════════════"
echo ""
echo "To build for all platforms:"
echo "  ./scripts/prepare-runtime.sh darwin arm64"
echo "  ./scripts/prepare-runtime.sh darwin x64"
echo "  ./scripts/prepare-runtime.sh win x64"
