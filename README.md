# PetClaw

<p align="center">
  <strong>AI 桌面宠物助理 — Monorepo</strong>
</p>

---

PetClaw 是一款 AI 桌面宠物助理，以桌面宠物为交互入口，内置 Cowork 协作模式，帮你完成日常办公中的各类事务。

## 子项目

| 目录 | 说明 | 文档 |
|------|------|------|
| [`petclaw-desktop/`](./petclaw-desktop/) | Electron 桌面应用（主项目） | [README](./petclaw-desktop/README.md) |
| [`petclaw-shared/`](./petclaw-shared/) | 共享类型、常量、i18n 翻译资源 | — |

## 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 24 < 25 | Electron 41 要求 |
| pnpm | >= 9 | Monorepo 包管理 |
| Git | >= 2.30 | Openclaw 源码管理 |

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/xxx/petclaw.git
cd petclaw

# 安装依赖
pnpm install

# 首次拉取项目后必须执行一次：初始化 AI 代码上下文工具链并接入 AI 客户端
pnpm ai:setup -- --client codex

# 首次启动桌面开发环境：构建/检查 OpenClaw runtime 后启动
pnpm --filter petclaw-desktop dev:openclaw

# 后续日常启动桌面应用开发环境
pnpm --filter petclaw-desktop dev

# 可选：AI 工具链异常时诊断 GitNexus / Serena / MCP / 锁 / 权限
pnpm ai:doctor
```

更多开发细节请查看 [petclaw-desktop/README.md](./petclaw-desktop/README.md)。

## 全局命令

```bash
npm run typecheck                  # workspace 全量类型检查
npm test                           # workspace 全量测试
pnpm -r lint                      # workspace 全量 lint
```

## 桌面打包

```bash
# 本地验证真实 Electron 应用壳，不生成 dmg/zip/安装包
pnpm --filter petclaw-desktop run package:dir

# macOS Apple Silicon 正式分发包
pnpm --filter petclaw-desktop dist:mac:arm64
```

`package:dir` 会按当前平台生成 unpacked app：macOS 打开 `release/mac*/PetClaw.app`，Windows
运行 `release/win-unpacked/PetClaw.exe`，Linux 运行 `release/linux-unpacked/PetClaw`。

## 文档

| 文档 | 说明 |
|------|------|
| [`CLAUDE.md`](./CLAUDE.md) | Claude Code 工作指南 |
| [`AGENTS.md`](./AGENTS.md) | Codex 工作指南 |
| [`docs/架构设计/PetClaw架构总览.md`](./docs/架构设计/PetClaw架构总览.md) | 架构文档顶层入口和 PetClaw 总体架构地图 |
| [`docs/架构设计/desktop/overview/Desktop架构设计.md`](./docs/架构设计/desktop/overview/Desktop架构设计.md) | desktop 分层架构入口 |
| [`docs/架构设计/shared/Shared架构设计.md`](./docs/架构设计/shared/Shared架构设计.md) | shared 公共底座边界 |
| [`docs/架构设计/web/Web架构边界.md`](./docs/架构设计/web/Web架构边界.md) | web 预留包边界 |
| [`docs/架构设计/api/API架构边界.md`](./docs/架构设计/api/API架构边界.md) | api 预留包边界 |
| [`docs/架构设计/desktop/foundation/Renderer架构设计.md`](./docs/架构设计/desktop/foundation/Renderer架构设计.md) | desktop renderer、Preload API 使用方式和 UI/UX 架构事实源 |
| [`docs/架构设计/engineering/AI代码上下文工程设计.md`](./docs/架构设计/engineering/AI代码上下文工程设计.md) | AI 代码上下文工具链、MCP 客户端适配与自动化变更影响分析设计 |
| [`docs/superpowers/specs/`](./docs/superpowers/specs/) | 阶段性设计规格 |
| [`docs/superpowers/plans/`](./docs/superpowers/plans/) | 实施计划 |
