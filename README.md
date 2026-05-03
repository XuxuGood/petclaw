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

# 启动桌面应用开发环境
pnpm --filter petclaw-desktop dev

# 首次运行需要构建 OpenClaw runtime
pnpm --filter petclaw-desktop dev:openclaw

# 可选：首次拉取项目后初始化一次 AI 代码上下文工具链并接入 AI 客户端
pnpm ai:setup -- --client codex

# 可选：诊断 GitNexus / Serena / MCP / 锁 / 权限
pnpm ai:doctor

# 可选：仅查看某个 AI 客户端的接入说明
pnpm ai:mcp:guide -- --client claude-code
```

更多开发细节请查看 [petclaw-desktop/README.md](./petclaw-desktop/README.md)。

## 全局命令

```bash
npm run typecheck                  # workspace 全量类型检查
npm test                           # workspace 全量测试
pnpm -r lint                      # workspace 全量 lint
```

## 文档

| 文档 | 说明 |
|------|------|
| [`CLAUDE.md`](./CLAUDE.md) | Claude Code 工作指南 |
| [`AGENTS.md`](./AGENTS.md) | Codex 工作指南 |
| [`docs/架构设计/PetClaw总体架构设计.md`](./docs/架构设计/PetClaw总体架构设计.md) | PetClaw 总体架构事实源 |
| [`docs/架构设计/PetClaw前端架构设计.md`](./docs/架构设计/PetClaw前端架构设计.md) | 渲染进程、Preload API 和桌面 UI/UX 架构事实源 |
| [`docs/架构设计/AI代码上下文工程设计.md`](./docs/架构设计/AI代码上下文工程设计.md) | AI 代码上下文工具链、MCP 客户端适配与自动化变更影响分析设计 |
| [`docs/架构设计/`](./docs/架构设计/) | 总体架构与模块设计 |
| [`docs/superpowers/specs/`](./docs/superpowers/specs/) | 阶段性设计规格 |
| [`docs/superpowers/plans/`](./docs/superpowers/plans/) | 实施计划 |
| [`docs/设计/`](./docs/设计/) | UI 设计稿与素材 |
