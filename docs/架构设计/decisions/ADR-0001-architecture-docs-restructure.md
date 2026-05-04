# ADR-0001: 架构与设计文档按模块重组

## 状态

Accepted

## 背景

原 `PetClaw总体架构设计.md` 同时承载总体架构、desktop 运行时、业务模块、数据库、IPC、构建发布和历史分期，导致读者和 AI Agent 很难精准读取上下文。原 `PetClaw前端架构设计.md` 实际只描述 desktop renderer/preload/UI，命名会和未来 `petclaw-web` 混淆。

旧设计目录原本同时承载外部产品参考图、PetClaw 视觉规范和当前实现截图，容易让参考素材被误读为产品事实源。

## 决策

采用以下文档结构：

- `PetClaw架构总览.md` 只做系统地图。
- `desktop/` 按功能模块保存详细架构设计。
- `shared/`、`web/`、`api/` 记录 workspace 包边界。
- `engineering/` 保存 AI 代码上下文和 GitHub Actions / CI/CD 等仓库级工程能力。
- `docs/设计参考/` 作为本地素材目录，只保存外部参考和当前实现截图，不提交到仓库。
- PetClaw 自己的 Desktop 视觉、组件和页面布局规范归入 `desktop/`，与模块架构设计放在同一个事实源目录。

## 拒绝方案

- 继续维护两个大文档：短期省事，但会继续放大事实源不清的问题。
- 只按 workspace 包拆：无法表达 desktop 内部 Cowork、IM、Cron、Pet、ConfigSync 等功能模块的端到端数据流。
- 按 frontend/backend 拆：同一个业务模块会被拆散，改功能时需要跨更多文档。
- 把外部参考图当设计事实源：会导致实现直接复制外部产品或误解 PetClaw 目标视觉。

## 后果

优点：

- 模块边界清楚，AI Agent 可以按任务读取更小的上下文。
- 总览文档不再膨胀。
- CI/CD、AI 工程能力和产品运行时架构分离。
- 外部参考、视觉规范和当前截图的事实源边界明确。
- AI Agent 修改 UI 时可以在 `docs/架构设计/desktop/` 内同时读取状态架构、模块布局和像素级约束。

代价：

- 文档文件数量增加，需要 README 和总览维护好导航。
- 旧大文档内容需要逐步迁移，迁移期间 `legacy/` 仍需作为参考保留。
