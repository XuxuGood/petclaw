// scripts/notarize.js
// macOS 公证脚本，由 electron-builder afterSign 钩子调用
// 需要在环境变量或 .env 中配置 Apple Developer 凭据

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

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  // 未配置凭据时跳过公证，允许本地开发构建不出错
  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD) {
    console.warn('⚠️  跳过公证: 未设置 APPLE_ID 或 APPLE_ID_PASSWORD');
    console.warn('   如需启用公证，请创建 .env 文件并配置 Apple Developer 凭据');
    console.warn('   参考 .env.example 模板');
    return;
  }

  if (!process.env.APPLE_TEAM_ID) {
    console.warn('⚠️  跳过公证: 未设置 APPLE_TEAM_ID');
    console.warn('   公证需要 APPLE_TEAM_ID（可在 Apple Developer 账户中找到）');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`🔐 正在公证 ${appName}...`);
  console.log(`   应用路径: ${appPath}`);
  console.log(`   Apple ID: ${process.env.APPLE_ID}`);
  console.log(`   Team ID:  ${process.env.APPLE_TEAM_ID}`);
  console.log(`   App ID:   ai.petclaw.desktop`);

  try {
    await notarize({
      appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASSWORD,
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