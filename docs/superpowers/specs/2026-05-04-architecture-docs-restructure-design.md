# 架构与设计文档重组设计

**日期**: 2026-05-04  
**状态**: 待实施  
**范围**: `docs/架构设计/`、`docs/设计参考/`、架构文档命名、模块文档模板

## 背景

当前 `docs/架构设计/` 主要依赖两份大文档：

- `PetClaw总体架构设计.md`
- `PetClaw前端架构设计.md`

这两个文件已经无法准确表达文档职责。`PetClaw总体架构设计.md` 混合了系统总览、
desktop 运行时、业务模块、数据库、IPC、构建发布和实现分期等细节；`PetClaw前端架构设计.md`
实际描述的是 desktop renderer/preload/UI 状态边界，未来会和 `petclaw-web` 的前端概念冲突。

PetClaw 是 monorepo 项目，`pnpm-workspace.yaml` 规划了 `petclaw-desktop`、
`petclaw-shared`、`petclaw-web`、`petclaw-api` 四个包。当前只有 `petclaw-shared`
是给其它包复用的公共底座，其它包之间不应直接 import 彼此实现。

同时，`docs/设计参考/` 只作为本地素材目录保存外部产品参考图和当前截图，不提交到仓库。这些素材可以辅助判断，但不应被误认为
PetClaw 当前实现的架构事实源；PetClaw 自己的视觉、组件和页面布局规范应归入 `docs/架构设计/desktop/`。

## 目标

1. 建立清晰的架构文档目录，让 AI Agent 和开发者能按模块精准读取上下文。
2. 将总体文档收敛为系统地图，避免继续承载所有实现细节。
3. 将 desktop 领域详细设计按功能模块拆分，每个模块讲清楚原理、架构、端到端数据流、前端布局、错误态和测试策略。
4. 将仓库级工程能力与产品运行时架构分离，例如 AI 代码上下文和 GitHub Actions / CI/CD。
5. 明确 `docs/设计参考/` 是本地不提交素材目录，PetClaw 视觉规范归入 desktop 架构事实源。

## 非目标

1. 本 spec 不迁移旧文档正文。
2. 本 spec 不创建完整模块文档内容。
3. 本 spec 不修改业务代码、IPC、数据库、前端实现或 GitHub Actions。
4. 本 spec 不把外部参考图整理为 PetClaw 视觉规范。

## 架构文档目录

本地推荐结构：

```text
docs/架构设计/
  README.md
  PetClaw架构总览.md

  shared/
  desktop/
  web/
  api/
  engineering/
  decisions/
  legacy/
```

### `README.md`

架构文档入口，负责说明各目录职责、事实源优先级和阅读路径。它不承载模块细节。

### `PetClaw架构总览.md`

系统地图。只描述：

- PetClaw 的整体定位
- monorepo 包职责
- 包之间的依赖方向
- 核心功能模块清单
- 模块之间的关系
- 关键端到端数据流摘要
- 详细模块文档入口

它不继续承载 runtime、IPC、SQLite、具体页面布局等详细设计。

### `shared/`

`petclaw-shared` 的架构文档。只描述可被其它包复用的公共契约，例如 i18n、共享类型、
协议类型、常量和纯工具函数。

`petclaw-shared` 不依赖 `petclaw-desktop`、`petclaw-web` 或 `petclaw-api`。

### `desktop/`

`petclaw-desktop` 的详细架构文档，是当前主体。按职责分为 overview、foundation、
runtime、domains 和 ui，避免所有模块堆在一级目录。

推荐结构：

```text
docs/架构设计/desktop/
  README.md
  overview/
    Desktop架构设计.md
  foundation/
    Renderer架构设计.md
    IPCPreload架构设计.md
    IPCChannel契约.md
    DataStorage架构设计.md
    I18n架构设计.md
  runtime/
    RuntimeGateway架构设计.md
    ConfigSync架构设计.md
    SystemIntegration架构设计.md
    Desktop打包架构设计.md
  domains/
    Cowork架构设计.md
    Directory架构设计.md
    Pet事件架构设计.md
    IM架构设计.md
    Cron架构设计.md
    Skills架构设计.md
    Models架构设计.md
    MCP架构设计.md
    Memory架构设计.md
  ui/
    Desktop视觉规范.md
    Desktop组件规范.md
    Desktop页面布局规范.md
```

`overview/Desktop架构设计.md` 是 desktop 领域地图，讲 Main、Preload、Renderer、Pet Window、
SQLite、OpenClaw runtime、系统集成之间的关系。它不替代各功能模块文档。

`foundation/Renderer架构设计.md` 是 desktop 前端横切规范，讲页面边界、状态模型、全局布局、
UI 状态、i18n、错误态和 preload API 使用约束。原 `PetClaw前端架构设计.md`
应迁移到这里。

### `web/` 和 `api/`

当前作为 workspace 边界预留。未实现前只保留 README 或空目录说明，不编写虚假的细节设计。

### `engineering/`

仓库级工程能力，不属于某个产品包。

建议文件：

```text
docs/架构设计/engineering/
  AI代码上下文工程设计.md
  CI-CD架构设计.md
```

`AI代码上下文工程设计.md` 从架构根目录迁入 `engineering/`。

`CI-CD架构设计.md` 负责说明 GitHub Actions 的职责划分、触发策略、权限边界和发布产物。

### `decisions/`

架构决策记录。用于记录无法直接从代码看出的取舍，例如为什么按功能模块拆文档、
为什么 `petclaw-shared` 是唯一公共依赖、为什么 desktop 不直接依赖 api 实现。

### `legacy/`

放旧方案、历史问题清单、迁移中间态和废弃设计，避免过时内容继续污染当前事实源。

## 包依赖边界

monorepo 包依赖方向：

```text
petclaw-shared
  ↑
  ├── petclaw-desktop
  ├── petclaw-web
  └── petclaw-api
```

规则：

1. `petclaw-shared` 是唯一公共底座。
2. `petclaw-shared` 只放跨包共享的类型、i18n、协议类型、常量和纯函数。
3. `petclaw-desktop`、`petclaw-web`、`petclaw-api` 可以依赖 `petclaw-shared`。
4. `petclaw-desktop`、`petclaw-web`、`petclaw-api` 之间默认不直接互相 import。
5. 如果 desktop 或 web 需要和 api 通信，应通过 HTTP/RPC 协议，而不是 package import。

## 模块文档模板

desktop 功能模块文档必须讲清楚设计原理，而不是只列文件和 API。

统一模板：

```text
# 模块名称 架构设计

## 1. 模块定位
## 2. 核心概念
## 3. 总体架构
## 4. 端到端数据流
## 5. 状态机与生命周期
## 6. 数据模型
## 7. IPC / Preload 契约
## 8. Renderer 布局、状态与交互
## 9. Runtime / Gateway 集成
## 10. 错误态、安全和权限
## 11. 与其它模块的关系
## 12. 测试策略
```

硬规则：

1. 必须讲清楚端到端完整数据流。
2. 必须讲清楚模块原理、总体架构和边界。
3. 必须覆盖前端布局、状态来源和用户交互。
4. 必须覆盖错误态、安全、权限、降级策略和验证方式。
5. 必须说明与其它模块的关系和禁止耦合点。
6. 禁止只写文件位置、API 清单或实现流水账。

例如 `Cowork架构设计.md` 的端到端数据流应覆盖：

```text
用户在 ChatView 输入消息
→ renderer 从当前 sessionId 和目录状态读取上下文
→ preload 调 cowork:session:send
→ main CoworkController 校验 session / cwd / model
→ CoworkSessionManager 固化消息和上下文
→ GatewayClient 调 OpenClaw sessions.send
→ Gateway 推送流式事件
→ main 转换为 Cowork stream event
→ preload 推送给 renderer
→ renderer 只更新当前打开 session 的消息
→ 后台 session 只更新列表摘要和 unread/running 状态
→ PetEventBridge 收到 Cowork 事件并更新宠物状态
```

## 前端与视觉边界

前端需要出现在两个层级：

1. `desktop/foundation/Renderer架构设计.md` 描述 desktop renderer 的全局架构、布局体系、状态模型和交互规则。
2. 各功能模块文档的 `Renderer 布局、状态与交互` 章节描述该模块自己的页面结构和交互状态。

模块文档里的布局描述应关注稳定结构和状态逻辑，例如页面区域、组件职责、loading / empty /
error / disabled 状态、滚动区域和用户操作路径。

像素级视觉细节不写进架构文档。

## 设计参考目录

推荐结构：

```text
docs/设计参考/
  README.md
  references/
  snapshots/
```

### `references/`

外部产品参考图。只作为灵感来源，不是 PetClaw 当前实现或目标规范。

### Desktop UI 规范

PetClaw 自己的视觉、组件和页面布局规范，是 UI 实现依据。它们不放在参考目录，而是归入
`docs/架构设计/desktop/`：

```text
docs/架构设计/desktop/
  Desktop视觉规范.md
  Desktop组件规范.md
  Desktop页面布局规范.md
```

这里可以记录颜色 token、字体层级、间距系统、圆角、阴影、边框、动效、图标规则、
按钮、输入框、弹窗、侧栏、列表、卡片等组件视觉规范，以及页面级像素布局原则。

### `snapshots/`

PetClaw 当前实现截图，用作视觉回归基线。AI 开发 UI 时，如果没有 Figma 或人工产品稿，
截图是最可靠的“现在长什么样”的事实源。

建议结构：

```text
docs/设计参考/snapshots/
  desktop/
    chat/
    settings/
    skills/
    cron/
    im/
    pet-window/
```

UI 变更流程：

1. 先读 `docs/架构设计/desktop/foundation/Renderer架构设计.md`，理解状态和交互边界。
2. 再读 `docs/架构设计/desktop/` 下对应视觉、组件和页面布局规范。
3. 必要时查看 `docs/设计参考/references/` 获取风格参考，但不得直接复制外部产品。
4. 修改后可更新本地关键页面截图到 `docs/设计参考/snapshots/`，作为视觉回归依据；该目录不提交。

## CI/CD 文档划分

GitHub Actions 不按 workspace 包拆，而按流水线职责拆。

`docs/架构设计/engineering/CI-CD架构设计.md` 应覆盖现有 workflow：

```text
质量门禁
  .github/workflows/ci.yml

Electron 验证
  .github/workflows/electron-verify.yml

OpenClaw 集成校验
  .github/workflows/openclaw-check.yml

安全扫描
  .github/workflows/security.yml

多平台构建与 Release
  .github/workflows/build-platforms.yml
```

建议章节：

```text
# CI/CD 架构设计

## 1. 流水线总览
## 2. 触发策略
## 3. Workflow 划分
## 4. PR 校验流水线
## 5. Electron 验证流水线
## 6. OpenClaw 集成校验流水线
## 7. 安全扫描流水线
## 8. 多平台构建与 Release 流水线
## 9. Secrets 与权限边界
## 10. Artifact 与发布产物
## 11. 失败处理与重跑策略
```

`desktop/runtime/Desktop打包架构设计.md` 只讲 Electron Builder、本地 runtime 打包、notarize
和平台产物机制，不重复 GitHub Actions 的远端流水线设计。

## 迁移映射

现有文档建议迁移关系：

```text
docs/架构设计/PetClaw总体架构设计.md
→ 拆分为：
  - docs/架构设计/PetClaw架构总览.md
  - docs/架构设计/desktop/overview/Desktop架构设计.md
  - docs/架构设计/desktop/各功能模块架构设计.md

docs/架构设计/PetClaw前端架构设计.md
→ docs/架构设计/desktop/foundation/Renderer架构设计.md

docs/架构设计/AI代码上下文工程设计.md
→ docs/架构设计/engineering/AI代码上下文工程设计.md
```

`docs/openclaw-gateway-api.md` 可先保留原位。后续如果纳入架构目录，应由
`RuntimeGateway架构设计.md` 或独立协议文档引用，不应复制大段协议内容。

## 风险与应对

### 文档过度拆分

风险：文件数量增加后，读者不知道先看哪份。

应对：`docs/架构设计/README.md` 和 `PetClaw架构总览.md` 必须成为清晰入口；
每份模块文档开头写明适用范围和相关文档。

### 外部参考误作事实源

风险：AI Agent 把 `docs/设计参考/references/` 的外部产品图当成 PetClaw 规范。

应对：相关架构文档必须明确 `references/` 只作参考；实现依据以
`docs/架构设计/desktop/`、`snapshots/` 和现有代码为准。

### 总览文档再次膨胀

风险：后续继续把详细设计写回 `PetClaw架构总览.md`。

应对：总览文档只允许记录系统关系、模块地图和关键数据流摘要；详细原理必须落到模块文档。

### 模块文档变成文件清单

风险：模块文档只记录代码入口，不能解释完整机制。

应对：模块文档模板强制包含端到端数据流、状态机、前端布局、错误态、安全边界和测试策略。

## 验证标准

实施完成后应满足：

1. `docs/架构设计/README.md` 能说明所有一级目录职责。
2. `PetClaw架构总览.md` 只作为系统地图，不承载模块详细设计。
3. `desktop/` 下至少包含 desktop 总览、renderer、IPC/preload、runtime、ConfigSync 和核心功能模块文档入口。
4. `engineering/` 下包含 AI 代码上下文和 CI/CD 文档入口。
5. 架构文档明确本地 `docs/设计参考/` 的素材边界，Desktop UI 规范已归入 `docs/架构设计/desktop/`。
6. 原 `PetClaw前端架构设计.md` 的内容不再作为根级“前端架构”事实源，而应归属到 desktop renderer。
7. 所有现行入口文档中的架构事实源路径已更新，不再指向过时命名。
