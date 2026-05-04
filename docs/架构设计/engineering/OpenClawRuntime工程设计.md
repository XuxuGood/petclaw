# OpenClaw Runtime 工程设计

## 1. 模块定位

OpenClaw Runtime 工程描述 PetClaw 如何锁定、构建、裁剪、预编译、同步和发布随桌面应用分发的 OpenClaw runtime。它是仓库级工程能力，连接 `RuntimeGateway架构设计.md`、`Desktop打包架构设计.md` 和 `CI-CD架构设计.md`。

本文不描述运行时业务调用协议；Gateway 生命周期见 `../desktop/runtime/RuntimeGateway架构设计.md`，用户配置写入见 `../desktop/runtime/ConfigSync架构设计.md`。

## 2. 核心概念

- OpenClaw version lock：`petclaw-desktop/package.json#openclaw.version`。
- OpenClaw repo：`package.json#openclaw.repo`。
- preinstalled plugins：`package.json#openclaw.plugins`。
- runtime target：`mac-arm64`、`mac-x64`、`win-x64`、`win-arm64`、`linux-x64`、`linux-arm64`。
- `vendor/openclaw-runtime/{target}`：目标平台 runtime 输出目录。
- `vendor/openclaw-runtime/current`：当前打包或开发使用的 runtime 指针目录。
- local extensions：PetClaw 本地维护的 OpenClaw 扩展，例如 `mcp-bridge`、`ask-user-question`。
- finalize/prune：打包前去除无关文件并固化生产布局。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ petclaw-desktop/package.json                                        │
│ openclaw.version / repo / plugins / npm scripts                     │
└──────────────┬─────────────────────────────────────────────────────┘
               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Runtime build scripts                                               │
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
│ Desktop package                                                     │
│ Resources/petmind or Windows resource archive                       │
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

发布打包：

```text
dist:<platform>:<arch>
  -> electron-vite build
  -> openclaw:runtime:<target>
  -> openclaw:finalize
  -> electron-builder
  -> electron-builder-hooks.cjs validates runtime/plugins/extensions
  -> release artifacts
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
  -> packaged
```

失败必须停在最早可解释阶段：

- 版本格式错误停在 `openclaw:ensure`。
- patch 冲突停在 `openclaw:patch`。
- Gateway 入口缺失停在 `openclaw:bundle` 或 builder hook。
- 插件缺失停在 `openclaw:plugins` 或 builder hook。
- 本地扩展缺失停在 `openclaw:extensions` / `openclaw:precompile`。

## 6. 数据模型

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

生产资源：

```text
macOS/Linux app resources
  petmind/
  SKILLs/

Windows app resources
  win-resources.tar
  unpack-petmind.cjs
```

## 7. 命令设计

常用命令：

```text
pnpm --filter petclaw-desktop dev:openclaw
pnpm --filter petclaw-desktop openclaw:runtime:host
pnpm --filter petclaw-desktop dist:mac:arm64
pnpm --filter petclaw-desktop dist:mac:x64
pnpm --filter petclaw-desktop dist:win:x64
pnpm --filter petclaw-desktop dist:linux:x64
```

脚本职责：

| 脚本 | 职责 |
|---|---|
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

## 8. 本地扩展

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

GatewayClient 入口查找优先级见 `RuntimeGateway架构设计.md`。构建工程必须保证这些入口在 runtime 内存在。

## 10. CI/CD 集成

OpenClaw Integration Check 负责快速验证：

```text
openclaw.version format
openclaw.repo URL
openclaw.plugins shape
core build scripts existence
latest upstream version on schedule/workflow_dispatch
```

Build & Release workflow 调用 `dist:*` 命令执行真实平台构建。PR 不跑全平台打包，避免反馈过慢。

## 11. 错误态、安全和权限

- 构建日志不得输出 API key、signing secrets、Gateway token。
- runtime 配置中的敏感值使用 `${VAR}` placeholder，不写明文。
- `.env`、测试、源码映射、虚拟环境和无关文档不进入打包 runtime。
- 版本升级必须显式修改 `package.json#openclaw.version` 并重建 runtime。
- 本地 OpenClaw 源码开发只能作为开发模式输入，不应污染发布产物。

## 12. 与其它模块的关系

| 模块 | 关系 |
|---|---|
| RuntimeGateway | 运行构建好的 Gateway runtime |
| ConfigSync | 写入 runtime 启动和运行时配置 |
| Desktop 打包 | 把 runtime 放入平台产物 |
| MCP | 依赖 `mcp-bridge` local extension |
| Cowork | 依赖 `ask-user-question` 审批扩展 |
| CI/CD | 校验版本、脚本和平台构建 |

## 13. 测试策略

- `openclaw.version`、repo、plugins shape 校验。
- runtime target 构建脚本 smoke test。
- `current` 目录 target build info 校验。
- Gateway 入口存在性校验。
- local extensions 预编译产物存在性校验。
- prune 后敏感文件和测试文件不进入 runtime 的检查。
- 平台 `dist:*` CI job 或本地构建验证。
