# Agent 入口与架构文档重组设计

**日期**: 2026-04-27  
**状态**: 待实施  
**范围**: `CLAUDE.md`、`AGENTS.md`、`.ai/README.md`、架构设计文档路径与命名

## 背景

当前 PetClaw 同时存在 `CLAUDE.md`、`AGENTS.md`、`.ai/README.md` 和
`docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md`。其中
`CLAUDE.md` / `AGENTS.md` 主要引用 `.ai/README.md`，但实际使用中 Agent
不一定会继续读取引用文件，导致关键规范可能缺失。

LobsterAI 的 `CLAUDE.md` 更接近“自包含项目工作手册”：命令、架构、关键目录、
数据流、持久化、日志、测试和提交规范都能在入口文件直接读到。PetClaw 应采用同类
结构，但内容必须符合 PetClaw 的生产级约束、Electron 多窗口架构和 Openclaw 运行时
集成现状。

## 目标

1. `CLAUDE.md` 和 `AGENTS.md` 成为 Agent 可直接执行的中文自包含入口。
2. 删除 `.ai/README.md`，避免三份规范长期漂移。
3. 将总体架构文档迁入 `docs/架构设计/`，使用稳定中文命名。
4. 为后续模块级详细设计预留目录结构，每个模块可独立沉淀原理、架构、核心代码和边界。
5. 保留 Claude 与 Codex 的工具差异，但两份入口文档结构保持一致。

## 非目标

1. 本次不拆分总体架构文档的正文内容，只迁移和重命名。
2. 本次不修改业务代码。
3. 本次不批量改写历史 plan 中的旧路径记录，历史记录保留其当时上下文。
4. 本次不引入新的 Agent 规则源，入口规则只放在 `CLAUDE.md` / `AGENTS.md`。

## 推荐方案

采用“双 Agent 自包含入口 + 架构文档目录化”：

```text
CLAUDE.md                         # Claude Code 中文自包含入口
AGENTS.md                         # Codex 中文自包含入口
docs/
├── 架构设计/
│   ├── PetClaw总体架构设计.md      # 原 v3 总体架构文档迁移后的位置
│   ├── 模块设计/                  # 后续模块级详细设计
│   └── 决策记录/                  # 后续架构决策记录
└── superpowers/
    ├── specs/                    # 阶段性设计 spec
    └── plans/                    # 实施计划
```

`.ai/README.md` 直接删除，不保留 redirect。这样可以消除“入口引用另一个入口”的链式依赖。

## `CLAUDE.md` 结构

`CLAUDE.md` 使用中文，参考 LobsterAI 的信息组织方式，直接覆盖 Claude Code 工作所需上下文：

```text
# PetClaw — Claude Code 工作指南

## 1. 构建与开发命令
## 2. 架构总览
## 3. 进程模型
## 4. 关键目录
## 5. 核心数据流
## 6. 持久化与配置
## 7. 编码风格与命名
## 8. IPC、i18n、日志
## 9. 测试与验证
## 10. 变更工作流
## 11. 参考文档
```

必须直接写入的规则包括：

- 始终中文回复。
- 所有架构和功能设计必须面向生产环境，禁止 demo / MVP 式实现。
- 修改前先读代码，理解上下文和调用方。
- 新功能先写测试，bug 修复先写复现测试。
- 改完必须跑 `typecheck` 和 `test`。
- 禁止 `any`，使用 `unknown` 与类型收窄。
- 用户可见字符串必须走 i18n。
- IPC channel 必须按 `模块:动作` 命名，并同步 `ipc/*.ts`、`preload/index.ts`、`preload/index.d.ts`。
- 前端遵守 Tailwind token、Zustand action 纯 `set()`、React 函数声明组件等项目规范。
- 开发完成后同步入口规则和 `docs/架构设计/PetClaw总体架构设计.md` 的相关章节。

## `AGENTS.md` 结构

`AGENTS.md` 与 `CLAUDE.md` 保持同构，但保留 Codex 专属规则：

- 本文件是 Codex 入口。
- 任何代码、文档、配置文件变更前，必须先列出拟修改文件、修改原因和预期影响，并等待用户明确确认。
- 用户明确说“直接改”“修复”“实现”“提交”“加下”“改下”时，视为已授权本次相关改动。
- 用户只是在提问、排查、解释或要求运行命令时，只能执行只读检查和用户明确要求的命令，不得顺手修改文件。
- 未经用户明确确认，不得调用 `apply_patch` 或其他写文件操作。

除此之外，`AGENTS.md` 应和 `CLAUDE.md` 使用相同章节和相同项目事实，避免两套入口在架构理解上分叉。

## 架构文档迁移

原文件：

```text
docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md
```

迁移为：

```text
docs/架构设计/PetClaw总体架构设计.md
```

迁移后需要更新当前有效文档中的引用：

- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- 当前仍作为规范使用的 specs

历史 plans 中记录旧路径的内容不批量改写，因为它们是历史计划和执行记录。

## 后续模块设计目录

本次创建目录但不拆正文：

```text
docs/架构设计/模块设计/
docs/架构设计/决策记录/
```

后续模块设计建议按以下方向拆分：

- 主进程启动与窗口
- Openclaw 运行时
- ConfigSync 配置同步
- Cowork 会话系统
- System Prompt 与 AGENTS 同步
- 数据持久化
- IPC 通信
- IM 集成
- 定时任务
- 宠物事件联动

每个模块文档应包含：

- 设计目标
- 原理与边界
- 架构图或调用链
- 核心数据结构
- 核心代码入口
- 错误处理和边界条件
- 测试策略

## 风险与应对

### 规则重复风险

`CLAUDE.md` 和 `AGENTS.md` 会存在重复内容。为降低漂移：

- 两份文件保持同一章节结构。
- Agent 专属规则只放在“变更工作流”或文件开头说明中。
- 项目事实变更时同步修改两份入口。

### 路径引用遗漏风险

迁移架构文档后，旧路径引用可能遗漏。实施时必须使用 `rg` 检查：

```bash
rg "\.ai/README|2026-04-22-petclaw-architecture-v3"
```

当前入口和 README 必须无旧路径引用；历史 plans 可以保留旧路径。

### 架构文档过大风险

总体架构文档迁移后仍然很大。短期接受该状态，后续按模块逐步拆分，不在本次迁移中一次性重构，避免制造大范围内容风险。

## 验证标准

1. `.ai/README.md` 已删除。
2. `CLAUDE.md` 和 `AGENTS.md` 均为中文自包含入口，不再引用 `.ai/README.md`。
3. `docs/架构设计/PetClaw总体架构设计.md` 存在，原 v3 架构文档路径不再作为当前事实源。
4. `README.md` 指向新的 Agent 入口和架构文档路径。
5. `rg "\.ai/README"` 在当前入口和 README 中无结果。
6. `rg "2026-04-22-petclaw-architecture-v3"` 在当前入口和 README 中无结果。
7. 文档变更不影响业务代码，至少运行一次 `npm run typecheck` 确认工作区仍可类型检查。

