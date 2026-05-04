# CI/CD 架构设计

本文档描述 PetClaw GitHub Actions 的职责划分。CI/CD 是仓库级工程能力，不属于单个产品包；desktop 打包和 OpenClaw runtime 分发机制见 [Desktop打包与Runtime分发架构设计.md](../desktop/runtime/Desktop打包与Runtime分发架构设计.md)。

## 1. 流水线总览

现有 workflow 按职责划分：

| 职责 | Workflow |
|---|---|
| 质量门禁 | `.github/workflows/ci.yml` |
| Electron 验证 | `.github/workflows/electron-verify.yml` |
| OpenClaw 集成校验 | `.github/workflows/openclaw-check.yml` |
| 安全扫描 | `.github/workflows/security.yml` |
| 多平台构建与 Release | `.github/workflows/build-platforms.yml` |

整体拓扑：

```text
Pull Request
  -> CI
  -> Electron Verify
  -> OpenClaw Integration Check
  -> Security Scan

push main/develop
  -> CI
  -> Electron Verify
  -> Security Scan

schedule
  -> OpenClaw Integration Check
  -> Security Scan

tag v*
  -> Build & Release
  -> draft GitHub Release
```

CI/CD 不按 monorepo workspace 机械拆分。当前真实发布目标是 `petclaw-desktop`，所以 workflow 围绕质量、安全、Electron 验证、OpenClaw 集成和平台发布划分。未来 `petclaw-web`、`petclaw-api` 落地后再新增 web deploy 或 api deploy workflow，而不是让 desktop release workflow 承担其它包的部署职责。

## 2. 触发策略

- PR：优先跑质量门禁、Electron 验证、OpenClaw 集成校验和安全扫描。
- push：验证主分支集成状态。
- schedule：用于安全扫描和 OpenClaw 集成漂移检查。
- workflow_dispatch：用于人工触发构建或专项检查。

## 3. Workflow 划分

workflow 不按 workspace 包硬拆。当前复杂度主要在 `petclaw-desktop`，但流水线职责更稳定：质量、安全、集成、构建发布分别演进，未来 `web` 和 `api` 实现后再按部署目标新增 workflow。

职责边界：

| Workflow | 必须做 | 不应该做 |
|---|---|---|
| CI | lint、typecheck、test、必要 build | 签名、发布、联网查 OpenClaw 最新版本 |
| Electron Verify | 验证 electron-vite 输出结构和 Electron 构建入口 | 生成平台安装包 |
| OpenClaw Check | 验证 runtime 版本、repo、plugins、关键脚本 | 替代完整打包或运行桌面 app |
| Security Scan | secrets、dependency、skills、CodeQL | 自动修复依赖或提交改动 |
| Build & Release | 平台矩阵构建、上传 artifact、draft Release | PR 快速反馈 |

## 4. PR 校验流水线

`.github/workflows/ci.yml` 是基础质量门禁，负责 changed-files、lint、typecheck、test 和 build。它验证代码可以被合并，不负责发布产物。

阶段图：

```text
changed-files
  -> lint-and-typecheck
  -> test
  -> build
```

实现细节：

- `changed-files` 使用 `dorny/paths-filter` 输出 renderer、main、skills、scripts 四类变更。
- lint 只检查本次变更的 `.ts/.tsx`，push 和 PR 使用不同 diff base。
- typecheck 始终全量运行 `pnpm --filter petclaw-desktop typecheck`。
- test 始终运行 `pnpm --filter petclaw-desktop test`。
- build 只在 renderer/main 变更或 push 事件运行，纯文档变更不消耗构建时间。
- concurrency 取消同一 PR 上已经过时的旧 run。

## 5. Electron 验证流水线

`.github/workflows/electron-verify.yml` 验证 Electron 桌面环境相关约束。它应覆盖 desktop 专属风险，例如 preload 隔离、打包前配置、平台依赖和 Electron 构建入口。

验证链路：

```text
checkout
  -> setup pnpm/node
  -> install Ubuntu Electron system libraries
  -> pnpm install --frozen-lockfile
  -> pnpm --filter petclaw-desktop build
  -> assert out/renderer/index.html
  -> assert out/main/index.js
  -> assert out/preload/index.js
```

它捕获的是“能编译但产物目录不符合 Electron Builder 预期”的问题，和 CI build job 互补。

## 6. OpenClaw 集成校验流水线

`.github/workflows/openclaw-check.yml` 验证 OpenClaw runtime、版本锁定、patch 和 gateway 集成健康。它属于 runtime 集成边界，不应被普通 lint/test 替代。

检查项：

```text
package.json#openclaw.version  -> 必须是 vX.Y.Z
package.json#openclaw.repo     -> 必须是 GitHub .git URL
package.json#openclaw.plugins  -> 必须是数组，且每项有 id/npm/version
core scripts                   -> 关键 runtime 构建脚本存在
remote latest tag              -> 只在 schedule/workflow_dispatch 查远端
```

触发边界：

- push 修改 `petclaw-desktop/package.json` 或 openclaw 相关脚本时运行。
- PR 修改 `petclaw-desktop/package.json` 时运行。
- schedule 每周运行，用于发现 upstream 版本漂移。
- workflow_dispatch 支持人工专项检查。

## 7. 安全扫描流水线

`.github/workflows/security.yml` 包含 secrets scan、dependency audit、skills audit 和 CodeQL。安全扫描的目标是阻止凭据泄漏、依赖风险和 AI skill 供应链风险进入主线。

并行 job：

| Job | 工具 | 阻塞策略 | 说明 |
|---|---|---|---|
| secrets-scan | TruffleHog | 阻塞 | 扫描 verified secrets |
| dependency-audit | pnpm audit | non-blocking | 高危依赖输出警告 |
| skills-audit | npm audit per skill | non-blocking | SKILLs 独立依赖树 |
| codeql | GitHub CodeQL | 阻塞/按 GitHub 配置 | 上传 Security tab |

安全扫描不能注入发布 secrets。PR 场景只允许最低权限，外部 PR 不应得到签名、notarize 或 release 凭据。

## 8. 多平台构建与 Release 流水线

`.github/workflows/build-platforms.yml` 负责 macOS arm64、macOS x64、Windows、Linux 产物和 release 创建。它只在 release 场景触发，不作为普通 PR 快速反馈路径。

平台矩阵：

```text
v* tag push or workflow_dispatch
  -> build-macos-arm64  macos-latest   node 24.x  dist:mac:arm64
  -> build-macos-x64    macos-13       node 24.x  dist:mac:x64
  -> build-windows      windows-latest node 24.x  dist:win:x64
  -> build-linux        ubuntu-latest  node 24.x  dist:linux:x64
  -> create-release     ubuntu-latest  draft release
```

Release 策略：

- tag push 自动构建所有平台。
- workflow_dispatch 可按平台开关，用于人工补包或验证。
- 每个平台上传 artifact，保留 30 天。
- `create-release` 只在 `refs/tags/v*` 运行，下载所有 artifact 后创建 draft Release。
- tag 包含 `-beta`、`-alpha`、`-rc` 时标记 prerelease。

## 9. Secrets 与权限边界

签名、notarize、release token 等 secrets 只能用于发布 workflow。PR 触发的 workflow 不应暴露高权限 secrets；外部贡献者 PR 必须按 GitHub 默认权限边界运行。

Secrets 使用边界：

| Secret | 使用位置 | 说明 |
|---|---|---|
| `GITHUB_TOKEN` | build-platforms | GitHub publish/release；create-release 需要 `contents: write` |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | macOS release job | macOS 签名证书 |
| `APPLE_ID` / `APPLE_ID_PASSWORD` / `APPLE_TEAM_ID` | macOS release job | notarize |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows release job | Windows 签名证书 |

这些 secrets 不进入 CI、Electron Verify、OpenClaw Check 或 Security Scan 的普通 PR 路径。

## 10. Artifact 与发布产物

构建产物按平台上传 artifact。Release workflow 负责汇总产物、生成发布记录，并与自动更新通道保持一致。

产物映射：

| 平台 | Job | 产物 |
|---|---|---|
| macOS arm64 | `build-macos-arm64` | `petclaw-desktop/release/*.dmg`、`*.zip` |
| macOS x64 | `build-macos-x64` | `petclaw-desktop/release/*.dmg`、`*.zip` |
| Windows x64 | `build-windows` | `petclaw-desktop/release/*.exe` |
| Linux x64 | `build-linux` | `petclaw-desktop/release/*.AppImage`、`*.deb` |

自动更新依赖 GitHub Release 和 Electron Builder publish 配置。Release 默认为 draft，人工确认后再发布，避免未验证产物直接进入更新通道。

## 11. 失败处理与重跑策略

- 质量门禁失败：优先本地复现 `npm run typecheck`、`npm test`。
- Electron 验证失败：检查 desktop 构建配置和平台依赖。
- OpenClaw 校验失败：检查 runtime 版本、patch、gateway 脚本和缓存。
- Release 构建失败：按平台重跑对应 job，避免无关平台重复消耗。

本地复现路径：

| 失败点 | 本地命令 |
|---|---|
| CI typecheck | `pnpm --filter petclaw-desktop typecheck` |
| CI test | `pnpm --filter petclaw-desktop test` |
| CI build / Electron Verify | `pnpm --filter petclaw-desktop build` |
| OpenClaw runtime | `pnpm --filter petclaw-desktop openclaw:runtime:host` |
| macOS arm64 release | `pnpm --filter petclaw-desktop dist:mac:arm64` |
| Windows release | `pnpm --filter petclaw-desktop dist:win:x64` |
| Linux release | `pnpm --filter petclaw-desktop dist:linux:x64` |

## 12. 未来扩展边界

当 `petclaw-web` 或 `petclaw-api` 真正落地时新增 workflow：

- `web-ci.yml`：web lint/typecheck/test/build。
- `web-deploy.yml`：只负责 web 部署目标。
- `api-ci.yml`：api lint/typecheck/test/migration check。
- `api-deploy.yml`：只负责 api 部署目标。

这些 workflow 可以复用 root pnpm install/cache，但不能依赖 desktop 的 Electron、OpenClaw runtime 或 release secrets。
