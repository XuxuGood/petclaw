# Desktop 打包架构设计

## 1. 模块定位

Desktop 打包模块负责 Electron Builder、本地 OpenClaw runtime 打包、平台产物、签名和 notarize 的本地机制。远端流水线见 `../engineering/CI-CD架构设计.md`。

打包文档回答两个问题：

- 本地 `dist:*` 命令如何把 renderer/main/preload、OpenClaw runtime、SKILLs、资源文件组合成一个可运行桌面产物。
- CI release workflow 如何复用同一套本地脚本，避免本地包和远端包行为不一致。

## 2. 核心概念

- Electron Builder：桌面产物生成。
- bundled runtime：随应用分发的 OpenClaw runtime。
- `vendor/openclaw-runtime/current`：打包时读取的 runtime 当前目录。
- platform target：macOS、Windows、Linux。
- extraResources：打包到 app resources 的 runtime、SKILLs、tray 图标和平台资源。
- asar / asarUnpack：应用源码进入 asar，native module 按需解包。
- notarize/sign：平台发布安全要求。

## 3. 总体架构

```text
┌─────────────────────────────────────────────────────────────────────┐
│ pnpm --filter petclaw-desktop dist:<platform>:<arch>                 │
└──────────────┬──────────────────────────────────────────────────────┘
               ▼
┌────────────────────────────┐
│ electron-vite build         │
│ out/main + out/preload      │
│ out/renderer                │
└──────────────┬─────────────┘
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ openclaw runtime pipeline                                           │
│ ensure -> patch -> build target -> sync current -> bundle gateway    │
│ -> plugins -> local extensions -> precompile -> channel deps -> prune│
│ -> finalize                                                         │
└──────────────┬──────────────────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ electron-builder                                                     │
│ beforePack/afterPack hooks -> extraResources -> sign/notarize        │
└──────────────┬──────────────────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ release/                                                            │
│ macOS .dmg/.zip | Windows .exe/portable | Linux .AppImage/.deb       │
└─────────────────────────────────────────────────────────────────────┘
```

## 4. 端到端数据流

构建脚本确认 OpenClaw 版本和 runtime 目录；打包脚本裁剪、patch、预编译或拷贝 runtime；Electron Builder 按平台配置生成产物；macOS 发布路径执行签名和 notarize；最终产物交给 CI release workflow 上传。

本地打包时序：

```text
Developer or CI
  -> npm run dist:mac:arm64 / dist:win:x64 / dist:linux:x64
  -> electron-vite 输出 out/
  -> openclaw:ensure 校验 package.json#openclaw.version/repo/plugins
  -> openclaw:patch 应用 PetClaw 需要的 runtime patch
  -> run-build-openclaw-runtime.cjs 生成目标平台 runtime
  -> sync-openclaw-runtime-current.cjs 指向目标平台
  -> bundle-openclaw-gateway.cjs 准备 Gateway 入口
  -> ensure-openclaw-plugins.cjs 安装预装插件
  -> sync-local-openclaw-extensions.cjs 同步 mcp-bridge/ask-user-question
  -> precompile-openclaw-extensions.cjs 预编译本地扩展
  -> prune-openclaw-runtime.cjs 裁剪测试、源码映射和无关文件
  -> finalize-openclaw-runtime.cjs 固化最终 runtime 布局
  -> electron-builder --<platform> --<arch>
  -> electron-builder-hooks.cjs 再校验 runtime/SKILLs/平台资源
  -> release/* 产物
```

Windows 特殊路径：

```text
build-tar/win-resources.tar
  -> extraResources/win-resources.tar
  -> scripts/unpack-petmind.cjs
  -> 首次运行或安装阶段解出 Windows runtime 资源
```

## 5. 状态机与生命周期

```text
prepare
→ build app
→ prepare runtime
→ package
→ sign/notarize
→ artifact ready
→ failed
```

失败处理必须停在最早可解释阶段：

- runtime 版本错误：停在 `openclaw:ensure`。
- patch 冲突：停在 `openclaw:patch`。
- Gateway 入口缺失：停在 `openclaw:bundle` 或 builder hook。
- 预装插件缺失：停在 `ensure-openclaw-plugins` 或 builder hook。
- macOS symlink/codesign 问题：停在 `afterPack` 或 `afterSign`。

## 6. 数据模型

打包配置来自 `electron-builder.json`、package scripts、scripts 下的 runtime 构建脚本和平台资源文件。

关键配置：

| 配置 | 位置 | 作用 |
|---|---|---|
| product/app id | `electron-builder.json` | 应用身份和系统注册 |
| files | `electron-builder.json` | 只收录 package、SYSTEM_PROMPT 和 out 产物 |
| extraResources | `electron-builder.json` | tray、SKILLs、runtime、Windows tar 资源 |
| protocols | `electron-builder.json` | 注册 `petclaw://` |
| asarUnpack | `electron-builder.json` | 解包 `better-sqlite3` native module |
| dist scripts | `petclaw-desktop/package.json` | 平台和架构入口 |
| builder hooks | `scripts/electron-builder-hooks.cjs` | 打包前后校验和平台处理 |

`electron-builder.json` 中的 filter 不只是体积优化，也是安全边界：`.env`、测试、源码映射、无关 README/License 不能被误带入 runtime 或 SKILLs 包。

## 7. IPC / Preload 契约

打包不定义 runtime IPC，但产物必须保持 preload 安全配置：`nodeIntegration: false`、`contextIsolation: true`。

打包验证必须确认以下入口存在：

```text
petclaw-desktop/out/renderer/index.html
petclaw-desktop/out/main/index.js
petclaw-desktop/out/preload/index.js
```

这些路径改变时，需要同步 Electron Verify workflow、electron-builder 配置和 Desktop/IPC 文档。

## 8. Renderer 布局、状态与交互

打包影响用户看到的版本、关于页、更新状态和首次启动体验。UI 文案仍走 i18n。

用户可见影响：

- About 页版本号来自打包后的 app metadata。
- BootCheck 的 runtime 缺失、Gateway 入口缺失、资源路径错误都属于打包可见错误。
- 自动更新状态依赖发布产物和 GitHub Release，不应在未签名本地包中展示成功更新承诺。
- 首次启动时如果 runtime 解包或资源校验失败，必须展示恢复操作和日志入口。

## 9. Runtime / Gateway 集成

产物必须包含正确平台 runtime，并确保生产路径下 EngineManager 能解析 Gateway 入口和资源路径。

runtime 打包布局：

```text
App resources
  ├── tray/
  ├── SKILLs/                    macOS/Linux extraResources
  ├── petmind/                   macOS/Linux OpenClaw runtime
  ├── win-resources.tar          Windows runtime resource archive
  └── unpack-petmind.cjs         Windows runtime unpack helper
```

EngineManager 不应该知道 CI runner 或开发机路径；它只能根据生产资源目录、用户数据目录和 runtime build info 解析运行时位置。

## 10. 错误态、安全和权限

签名、notarize、release token 不写入仓库。构建日志不能泄漏 secrets。runtime 缺失时 BootCheck 展示可恢复错误。

安全边界：

- macOS 使用 hardened runtime、entitlements 和 notarize。
- Windows 签名 secrets 只在 release workflow 注入。
- GitHub release token 使用 `GITHUB_TOKEN`，只在发布 job 需要 `contents: write`。
- `CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID_PASSWORD` 等不得写入脚本默认值或文档示例。
- SKILLs 打包过滤 `.env`、虚拟环境和测试目录，避免用户凭据或开发依赖进入安装包。

## 11. 与其它模块的关系

RuntimeGateway 依赖打包产物中的 runtime；SystemIntegration 依赖平台产物能力；CI/CD 调用本地打包脚本。

| 模块 | 关系 |
|---|---|
| RuntimeGateway | 读取 production runtime 和 Gateway 入口 |
| ConfigSync | 生产 runtime 启动后写入 openclaw.json/AGENTS.md |
| Skills | SKILLs 目录随包分发，用户目录中的 skill 仍走配置同步 |
| MCP | 本地 `mcp-bridge` 扩展必须预编译进 runtime |
| SystemIntegration | 图标、协议、签名、更新和平台资源由打包提供 |
| CI/CD | build-platforms workflow 调用同一组 `dist:*` 命令 |

## 12. 测试策略

- 本地 build 验证。
- runtime 入口解析测试。
- 平台构建脚本 dry-run 或 CI 验证。
- 打包产物启动冒烟测试。
- Electron Verify workflow 验证 `out/` 结构。
- OpenClaw Integration Check 验证版本、repo、plugins 和关键脚本存在。
- Release 前至少跑目标平台 `dist:*` 或对应 CI job。
