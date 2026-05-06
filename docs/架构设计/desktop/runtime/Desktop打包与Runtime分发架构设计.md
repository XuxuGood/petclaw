# Desktop 打包与 Runtime 分发架构设计

## 1. 模块定位

Desktop 打包与 Runtime 分发模块负责把 `petclaw-desktop` 的 main/preload/renderer 产物、OpenClaw runtime、预装 skills、本地扩展、平台资源、签名和发布产物组合成可运行的桌面应用。

本文回答三个问题：

- 本地 `dist:*` 命令如何构建 Electron 应用和目标平台 OpenClaw runtime。
- OpenClaw runtime 如何锁定版本、应用补丁、安装插件、同步本地扩展、裁剪并固化生产布局。
- Electron Builder 如何把 runtime、skills、图标、Windows tar、签名和 notarize 串成平台产物。

本文不描述运行时业务调用协议；Gateway 生命周期见 [RuntimeGateway架构设计.md](./RuntimeGateway架构设计.md)，用户配置写入见 [ConfigSync架构设计.md](./ConfigSync架构设计.md)，远端流水线见 [CI-CD架构设计.md](../../engineering/CI-CD架构设计.md)。

## 2. 核心概念

| 概念 | 含义 |
|---|---|
| OpenClaw version lock | `petclaw-desktop/package.json#openclaw.version`，发布 runtime 的唯一版本事实源 |
| OpenClaw repo | `package.json#openclaw.repo`，用于 clone/checkout 的源码仓库 |
| preinstalled plugins | `package.json#openclaw.plugins`，随 runtime 预装的 OpenClaw 插件 |
| runtime target | `mac-arm64`、`mac-x64`、`win-x64`、`win-arm64`、`linux-x64`、`linux-arm64` |
| `vendor/openclaw-runtime/{target}` | 目标平台 runtime 输出目录 |
| `vendor/openclaw-runtime/current` | 当前开发或打包使用的 runtime 指针目录 |
| local extensions | PetClaw 本地维护的 OpenClaw 扩展，例如 `mcp-bridge`、`ask-user-question` |
| finalize/prune | 打包前去除无关文件并固化生产 runtime 布局 |
| Electron Builder | 生成 `.dmg`、`.zip`、`.exe`、`.AppImage`、`.deb` 等平台产物 |
| extraResources | 打包到 app resources 的 runtime、skills、tray 图标和平台资源 |
| asar / asarUnpack | 应用源码进入 asar，native module 按需解包 |
| notarize/sign | macOS、Windows 等平台发布安全要求 |

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ petclaw-desktop/package.json                                        │
│ openclaw.version / repo / plugins / dist:* scripts                  │
└──────────────┬─────────────────────────────────────────────────────┘
               ▼
┌────────────────────────────┐
│ electron-vite build         │
│ out/main + out/preload      │
│ out/renderer                │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────────────────────────────────────────────┐
│ OpenClaw runtime pipeline                                           │
│ ensure -> patch -> build target -> sync current -> bundle gateway    │
│ -> plugins -> local extensions -> precompile -> channel deps -> prune│
│ -> finalize                                                         │
└──────────────┬─────────────────────────────────────────────────────┘
               ▼
┌────────────────────────────────────────────────────────────────────┐
│ vendor/openclaw-runtime                                             │
│ mac-arm64 / mac-x64 / win-x64 / linux-x64 / current                 │
└──────────────┬─────────────────────────────────────────────────────┘
               ▼
┌────────────────────────────────────────────────────────────────────┐
│ electron-builder                                                    │
│ beforePack/afterPack hooks -> extraResources -> sign/notarize       │
└──────────────┬─────────────────────────────────────────────────────┘
               ▼
┌────────────────────────────────────────────────────────────────────┐
│ release artifacts                                                   │
│ macOS .dmg/.zip | Windows .exe/portable | Linux .AppImage/.deb      │
└──────────────┬─────────────────────────────────────────────────────┘
               ▼
┌────────────────────────────────────────────────────────────────────┐
│ RuntimeGateway                                                      │
│ resolve runtime root -> spawn/fork Gateway -> GatewayClient connect │
└────────────────────────────────────────────────────────────────────┘
```

## 4. 端到端数据流

开发模式：

```text
pnpm --filter petclaw-desktop dev:openclaw
  -> check native ABI
  -> openclaw:ensure
  -> openclaw:patch
  -> openclaw:runtime:host
  -> electron-vite dev
```

目标平台构建：

```text
npm run openclaw:runtime:<target>
  -> ensure-openclaw-version.cjs
  -> apply-openclaw-patches.cjs
  -> run-build-openclaw-runtime.cjs --target=<target>
  -> sync-openclaw-runtime-current.cjs <target>
  -> bundle-openclaw-gateway.cjs
  -> ensure-openclaw-plugins.cjs
  -> sync-local-openclaw-extensions.cjs
  -> precompile-openclaw-extensions.cjs
  -> install-openclaw-channel-deps.cjs
  -> prune-openclaw-runtime.cjs
```

本地或 CI 打包：

```text
Developer or CI
  -> npm run dist:mac:arm64 / dist:win:x64 / dist:linux:x64
  -> electron-vite build
  -> openclaw:runtime:<target>
  -> finalize-openclaw-runtime.cjs
  -> electron-builder --<platform> --<arch>
  -> electron-builder-hooks.cjs validates runtime/skills/platform resources
  -> sign/notarize when release credentials exist
  -> release/* artifacts
```

Windows 特殊路径：

```text
build-tar/win-resources.tar
  -> extraResources/win-resources.tar
  -> scripts/unpack-petmind.cjs
  -> first run or install phase unpacks Windows runtime resources
```

## 5. 状态机与生命周期

```text
not-prepared
  -> source ensured
  -> patches applied
  -> target built
  -> current synced
  -> gateway bundled
  -> plugins installed
  -> local extensions synced
  -> extensions precompiled
  -> pruned
  -> finalized
  -> app built
  -> packaged
  -> signed/notarized
  -> artifact ready
```

失败必须停在最早可解释阶段：

- 版本格式错误停在 `openclaw:ensure`。
- patch 冲突停在 `openclaw:patch`。
- Gateway 入口缺失停在 `openclaw:bundle` 或 builder hook。
- 插件缺失停在 `openclaw:plugins` 或 builder hook。
- 本地扩展缺失停在 `openclaw:extensions` / `openclaw:precompile`。
- macOS symlink、codesign 或 notarize 问题停在 `afterPack` 或 `afterSign`。

## 6. 数据模型与目录布局

`package.json#openclaw`：

```json
{
  "openclaw": {
    "version": "vX.Y.Z",
    "repo": "https://github.com/openclaw/openclaw.git",
    "plugins": [
      { "id": "plugin-id", "npm": "package-name", "version": "x.y.z" }
    ]
  }
}
```

runtime 目录：

```text
petclaw-desktop/
  vendor/openclaw-runtime/
    current/
    mac-arm64/
    mac-x64/
    win-x64/
    win-arm64/
    linux-x64/
    linux-arm64/
  openclaw-extensions/
    mcp-bridge/
    ask-user-question/
```

生产资源布局：

```text
macOS/Linux app resources
  tray/
  skills/              PetClaw 内置 skills 打包只读源
  petmind/
    node_modules/      OpenClaw runtime 根依赖，独立 FileSet 复制

Windows app resources
  tray/
  win-resources.tar
  unpack-petmind.cjs
```

打包后的 `Resources/skills` 不作为运行时直接读取目录。应用启动时由
`SkillManager.syncBundledSkillsToUserData()` 同步到 Electron `{userData}/skills`，随后
`ConfigSync` 只把 `{userData}/skills` 写入 `skills.load.extraDirs`。内置 skill 升级以
`SKILL.md` frontmatter `version` 为准；修复或覆盖使用临时目录和 backup 原子替换，
失败时恢复旧目录且不阻断其它 skill；修复或覆盖时保留 userData 目标目录里的 `.env`。

打包配置来自 `electron-builder.json`、`petclaw-desktop/package.json` scripts、runtime 构建脚本和平台资源文件：

| 配置 | 位置 | 作用 |
|---|---|---|
| product/app id | `electron-builder.json` | 应用身份和系统注册 |
| files | `electron-builder.json` | 收录 package、SYSTEM_PROMPT 和 out 产物 |
| extraResources | `electron-builder.json` | tray、skills、runtime、Windows tar 资源 |
| platform icons | `build/icons/{mac,win,png}` | macOS `.icns`、Windows `.ico`、Linux PNG 图标输入 |
| protocols | `electron-builder.json` | 注册 `petclaw://` |
| asarUnpack | `electron-builder.json` | 解包 `better-sqlite3` native module |
| dist scripts | `petclaw-desktop/package.json` | 平台和架构入口 |
| builder hooks | `scripts/electron-builder-hooks.cjs` | 打包前后校验和平台处理 |

macOS 图标事实源是 `electron-builder.json#mac.icon`。electron-builder 会把 `.icns`
复制到 `Contents/Resources/icon.icns` 并写入 `Info.plist#CFBundleIconFile`。PetClaw
不手写 `CFBundleIconName`，也不在 packaged app 启动时用 `app.dock.setIcon()` 覆盖
bundle 图标。

`electron-builder.json` 中的 filter 不只是体积优化，也是安全边界：`.env`、测试、源码映射、无关 README/License 不能被误带入 runtime 或 skills 包。

macOS/Linux 的 OpenClaw runtime 资源必须把
`vendor/openclaw-runtime/current/node_modules` 作为独立 `extraResources` FileSet
复制到 `petmind/node_modules`。electron-builder 26 会过滤 FileSet 源目录下的根
`node_modules`，只配置 `from: vendor/openclaw-runtime/current` 会导致生产包缺失
runtime 依赖，Gateway 在 bootcheck 阶段启动失败。Windows 不走这条路径，安装包内
使用 `win-resources.tar` 保留 runtime 目录结构并在安装/首次运行时解压。

## 7. 命令与脚本职责

常用命令：

```text
pnpm --filter petclaw-desktop dev:openclaw
pnpm --filter petclaw-desktop openclaw:runtime:host
pnpm --filter petclaw-desktop assets:icons
pnpm --filter petclaw-desktop check:icons
pnpm --filter petclaw-desktop run package:dir
pnpm --filter petclaw-desktop dist:mac:arm64
pnpm --filter petclaw-desktop dist:mac:x64
pnpm --filter petclaw-desktop dist:win:x64
pnpm --filter petclaw-desktop dist:linux:x64
```

脚本职责：

| 脚本 | 职责 |
|---|---|
| `generate-app-icons.cjs` | 从 `resources/icon.png` 生成 `build/icons` 平台图标产物；仅在图标源变化时运行 |
| `check-app-icons.cjs` | 构建前检查平台图标产物是否存在且尺寸有效 |
| `ensure-openclaw-version.cjs` | 校验版本、clone/checkout 指定 OpenClaw |
| `apply-openclaw-patches.cjs` | 应用 PetClaw 维护的 patch |
| `run-build-openclaw-runtime.cjs` | 按 target 构建 runtime |
| `sync-openclaw-runtime-current.cjs` | 同步目标 runtime 到 current |
| `bundle-openclaw-gateway.cjs` | 准备 Gateway 入口 |
| `ensure-openclaw-plugins.cjs` | 安装预装插件 |
| `sync-local-openclaw-extensions.cjs` | 同步本地扩展 |
| `precompile-openclaw-extensions.cjs` | 预编译本地扩展 |
| `install-openclaw-channel-deps.cjs` | 安装 channel 依赖 |
| `prune-openclaw-runtime.cjs` | 裁剪无关文件 |
| `finalize-openclaw-runtime.cjs` | 固化生产 runtime 布局 |
| `electron-builder-hooks.cjs` | 打包前后校验和平台处理 |

`package:dir` 是当前平台 unpacked app 的系统壳验收入口：它运行 `check:icons`、构建 Electron
产物并执行 `electron-builder --dir`。`dev:openclaw` 只作为功能调试入口，不作为
Dock/Finder/任务栏/desktop icon 的最终事实源。完整发布仍使用 `dist:*`，并在构建前运行
`check:icons`，不会每次重新生成图标。

## 8. 本地扩展与预装能力

PetClaw 维护的 OpenClaw local extensions 是 runtime 能力的一部分：

| 扩展 | 职责 |
|---|---|
| `mcp-bridge` | 让 OpenClaw tool 调用回到 PetClaw MCP bridge server |
| `ask-user-question` | 把 runtime 的用户询问能力接入 PetClaw 审批/交互链路 |

打包前必须保证扩展包含：

```text
openclaw.plugin.json
index.js
```

缺失时 `electron-builder-hooks.cjs` 会尝试同步和预编译；仍缺失则失败并提示执行对应 runtime 构建命令。

## 9. Runtime / Gateway 集成

RuntimeGateway 在运行时只消费构建结果，不负责构建 runtime。

入口解析边界：

```text
development
  -> petclaw-desktop/vendor/openclaw-runtime/current

production macOS/Linux
  -> process.resourcesPath/petmind

production Windows
  -> app resources win-resources.tar
  -> unpack to userData/runtime location when needed
```

GatewayClient 入口查找优先级见 [RuntimeGateway架构设计.md](./RuntimeGateway架构设计.md)。构建和打包必须保证这些入口在 runtime 内存在。

EngineManager 不应该知道 CI runner 或开发机路径；它只能根据生产资源目录、用户数据目录和 runtime build info 解析运行时位置。

## 10. IPC / Preload 与 Renderer 可见影响

打包不定义 runtime IPC，但产物必须保持 preload 安全配置：

- `nodeIntegration: false`
- `contextIsolation: true`

打包验证必须确认以下入口存在：

```text
petclaw-desktop/out/renderer/index.html
petclaw-desktop/out/main/index.js
petclaw-desktop/out/preload/index.js
```

这些路径改变时，需要同步 Electron Verify workflow、electron-builder 配置和 Desktop/IPC 文档。

打包影响用户看到的版本、关于页、更新状态和首次启动体验：

- About 页版本号来自打包后的 app metadata。
- BootCheck 的 runtime 缺失、Gateway 入口缺失、资源路径错误都属于打包可见错误。
- 自动更新状态依赖发布产物和 GitHub Release，不应在未签名本地包中展示成功更新承诺。
- 首次启动时如果 runtime 解包或资源校验失败，必须展示恢复操作和日志入口。

## 11. 错误态、安全和权限

签名、notarize、release token 不写入仓库。构建日志不能泄漏 secrets。runtime 缺失时 BootCheck 展示可恢复错误。

安全边界：

- 构建日志不得输出 API key、signing secrets、Gateway token。
- runtime 配置中的敏感值使用 `${VAR}` placeholder，不写明文。
- `.env`、测试、源码映射、虚拟环境和无关文档不进入打包 runtime。
- 版本升级必须显式修改 `package.json#openclaw.version` 并重建 runtime。
- 本地 OpenClaw 源码开发只能作为开发模式输入，不应污染发布产物。
- macOS 使用 hardened runtime 和 entitlements；Developer ID 签名与 notarize 是可选发布增强。
  当前个人产品策略允许本地和 release 构建在缺少 Apple 凭据时跳过 notarize。未来面向普通用户
  正式分发时，可设置 `PETCLAW_REQUIRE_MAC_NOTARIZATION=1` 强制缺凭据失败。
- Windows 签名 secrets 只在 release workflow 注入。
- GitHub release token 使用 `GITHUB_TOKEN`，只在发布 job 需要 `contents: write`。
- `CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID_PASSWORD` 等不得写入脚本默认值或文档示例。
- skills 打包过滤 `.env`、虚拟环境和测试目录，避免用户凭据或开发依赖进入安装包。

## 12. 与其它模块的关系

| 模块 | 关系 |
|---|---|
| RuntimeGateway | 读取 production runtime、Gateway 入口和运行时资源 |
| ConfigSync | 生产 runtime 启动后写入 openclaw.json/AGENTS.md |
| Skills | skills 随包分发，用户目录中的 skill 仍走配置同步 |
| MCP | 本地 `mcp-bridge` 扩展必须预编译进 runtime |
| Cowork | 依赖 `ask-user-question` 审批扩展 |
| SystemIntegration | 图标、协议、签名、更新和平台资源由打包提供 |
| CI/CD | 校验版本、脚本，并调用同一组 `dist:*` 命令 |

## 13. 测试策略

- `openclaw.version`、repo、plugins shape 校验。
- runtime target 构建脚本 smoke test。
- `current` 目录 target build info 校验。
- Gateway 入口存在性校验。
- local extensions 预编译产物存在性校验。
- prune 后敏感文件和测试文件不进入 runtime 的检查。
- Electron Verify workflow 验证 `out/` 结构。
- 平台构建脚本 dry-run 或 CI 验证。
- 打包产物启动冒烟测试。
- Release 前至少跑目标平台 `dist:*` 或对应 CI job。
