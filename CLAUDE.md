# PetClaw Monorepo — AI 工作指南

## 子项目
- `petclaw-desktop/` — Electron 桌面应用（Phase 1 当前焦点）
- `petclaw-web/` — Next.js 营销官网（Phase 3）
- `petclaw-api/` — 后端服务（Phase 3）
- `petclaw-shared/` — 共享 TypeScript 类型

## Commit 规范
Conventional Commits：`type(scope): subject`
- scope：`desktop`、`web`、`api`、`shared`、`ci`

## 包管理
pnpm workspace，从根目录执行：`pnpm --filter petclaw-desktop <cmd>`
