// scripts/notarize.js
// macOS 公证脚本，由 electron-builder afterSign 钩子调用
// 本地构建可缺省跳过；发布构建通过 PETCLAW_REQUIRE_MAC_NOTARIZATION=1 强制要求凭据。

const { notarize } = require('@electron/notarize');
const path = require('path');

// 尝试加载 .env，打包环境不强依赖 dotenv
try {
  require('dotenv').config();
} catch (error) {
  if (!error || error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

function isRequiredMacReleaseBuild() {
  return process.env.PETCLAW_REQUIRE_MAC_NOTARIZATION === '1';
}

function resolveAppleIdPassword() {
  return process.env.APPLE_ID_PASSWORD || process.env.APPLE_APP_SPECIFIC_PASSWORD || '';
}

function getMissingReleaseCredentials() {
  const missing = [];
  if (!process.env.CSC_LINK) missing.push('CSC_LINK');
  if (!process.env.CSC_KEY_PASSWORD) missing.push('CSC_KEY_PASSWORD');
  if (!process.env.APPLE_ID) missing.push('APPLE_ID');
  if (!resolveAppleIdPassword()) missing.push('APPLE_ID_PASSWORD');
  if (!process.env.APPLE_TEAM_ID) missing.push('APPLE_TEAM_ID');
  return missing;
}

function skipOrThrowForMissingCredentials(missing) {
  if (isRequiredMacReleaseBuild()) {
    throw new Error(
      'Missing required macOS release credentials: '
      + missing.join(', ')
      + '. Configure CI secrets or unset PETCLAW_REQUIRE_MAC_NOTARIZATION for local builds.',
    );
  }

  console.warn(`⚠️  跳过公证: 未设置 ${missing.join(', ')}`);
  console.warn('   本地开发和 package:dir 可跳过；正式发布必须在 CI secrets 中配置 Apple Developer 凭据');
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const missing = getMissingReleaseCredentials();
  if (missing.length > 0) {
    skipOrThrowForMissingCredentials(missing);
    return;
  }

  const appleIdPassword = resolveAppleIdPassword();
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`🔐 正在公证 ${appName}...`);
  console.log(`   应用路径: ${appPath}`);
  console.log('   Apple ID: configured');
  console.log(`   Team ID:  ${process.env.APPLE_TEAM_ID}`);
  console.log(`   App ID:   ai.petclaw.desktop`);

  try {
    await notarize({
      appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword,
      teamId: process.env.APPLE_TEAM_ID,
    });

    console.log('✅ 公证成功！');
    console.log('   应用已通过公证，可以分发给用户');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ 公证失败:', message);
    console.error('   请检查 Apple Developer 凭据并重试');
    console.error('   访问 https://appstoreconnect.apple.com/notarization-history 查看详情');
    throw error;
  }
};

exports._private = {
  getMissingReleaseCredentials,
  isRequiredMacReleaseBuild,
  resolveAppleIdPassword,
};
