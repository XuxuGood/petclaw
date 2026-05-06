# PetClaw 架构总览

PetClaw 是 Electron 桌面宠物与 AI 协作应用。当前主体是 `petclaw-desktop`：主进程管理窗口、SQLite、本地配置、OpenClaw runtime 和系统集成；渲染进程提供 Chat、Settings、Skills、Cron、IM 和 Pet UI；Preload 通过受控 API 暴露主进程能力。

本文件是 `docs/架构设计/` 的唯一顶层入口。代码仍是最终事实源；架构文档用于解释模块原理、边界、端到端数据流和修改时需要遵守的约束。

## 阅读路径

| 场景 | 阅读入口 |
|---|---|
| 了解整体系统 | 本文件 |
| 修改 desktop 功能 | [`desktop/overview/Desktop架构设计.md`](./desktop/overview/Desktop架构设计.md)，再读对应分层和模块文档 |
| 修改 renderer/UI 状态 | [`desktop/foundation/Renderer架构设计.md`](./desktop/foundation/Renderer架构设计.md) 和对应功能模块文档 |
| 修改目录驱动 Agent | [`desktop/domains/Directory架构设计.md`](./desktop/domains/Directory架构设计.md) |
| 修改 IPC 或 preload | [`desktop/foundation/IPCPreload架构设计.md`](./desktop/foundation/IPCPreload架构设计.md) 和 [`desktop/foundation/IPCChannel契约.md`](./desktop/foundation/IPCChannel契约.md) |
| 修改 SQLite/store | [`desktop/foundation/DataStorage架构设计.md`](./desktop/foundation/DataStorage架构设计.md) |
| 修改 i18n | [`desktop/foundation/I18n架构设计.md`](./desktop/foundation/I18n架构设计.md) 和 [`shared/Shared架构设计.md`](./shared/Shared架构设计.md) |
| 修改问题反馈链路 | [`desktop/foundation/Feedback架构设计.md`](./desktop/foundation/Feedback架构设计.md) 和 [`api/Feedback API架构设计.md`](./api/Feedback%20API架构设计.md) |
| 修改 Desktop 打包或 OpenClaw runtime 分发 | [`desktop/runtime/Desktop打包与Runtime分发架构设计.md`](./desktop/runtime/Desktop打包与Runtime分发架构设计.md) |
| 修改 AI 开发工具链 | [`engineering/AI代码上下文工程设计.md`](./engineering/AI代码上下文工程设计.md) |
| 修改 GitHub Actions | [`engineering/CI-CD架构设计.md`](./engineering/CI-CD架构设计.md) |
| 查历史大文档 | [`legacy/`](./legacy/) |

## 目录职责

```text
docs/架构设计/
  PetClaw架构总览.md      顶层入口，只讲包关系、模块关系、阅读路径和关键数据流摘要
  shared/                petclaw-shared 公共底座
  desktop/               petclaw-desktop 分层架构和功能模块设计
  web/                   petclaw-web 预留边界
  api/                   petclaw-api 预留边界
  engineering/           仓库级工程能力
  decisions/             架构决策记录
  legacy/                历史方案、旧大文档、问题清单
```

写作规则：

- 总览文档只做地图，不承载模块详细设计。
- 功能模块文档必须讲清楚模块定位、核心概念、总体架构、端到端数据流、状态机、数据模型、IPC/Preload、Renderer 布局、Runtime/Gateway、错误态、安全边界和测试策略。
- `petclaw-shared` 是唯一公共底座；其它包之间默认不直接 import 彼此实现。
- Desktop 像素级视觉、组件和页面布局规范放在 [`desktop/ui/Desktop视觉规范.md`](./desktop/ui/Desktop视觉规范.md)、[`desktop/ui/Desktop组件规范.md`](./desktop/ui/Desktop组件规范.md) 和 [`desktop/ui/Desktop页面布局规范.md`](./desktop/ui/Desktop页面布局规范.md)。
- 外部产品截图和当前实现截图可放在本地 `docs/设计参考/`，该目录不提交，不能作为架构事实源。

## Monorepo 包关系

`petclaw-shared` 是唯一公共底座：

```text
petclaw-shared
  ↑
  ├── petclaw-desktop
  ├── petclaw-web
  └── petclaw-api
```

规则：

- `petclaw-shared` 只放共享类型、i18n、协议类型、常量和纯函数。
- `petclaw-desktop`、`petclaw-web`、`petclaw-api` 可以依赖 `petclaw-shared`。
- desktop、web、api 之间不直接 import 实现；运行时通信通过 HTTP/RPC、Gateway、IPC 或配置契约。

## 当前模块地图

```text
┌─────────────────────────────────────────────────────────────────────┐
│                              PetClaw                                │
│                         Electron Desktop App                         │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          petclaw-desktop                            │
│                                                                     │
│  ┌──────────────────────┐       ┌────────────────────────────────┐  │
│  │ Renderer             │       │ Main Process                    │  │
│  │ - Chat               │       │ - IPC Router                    │  │
│  │ - Settings           │       │ - SQLite / Stores               │  │
│  │ - Skills / Cron / IM │       │ - Cowork / IM / Cron / MCP      │  │
│  │ - BootCheck          │       │ - Runtime / ConfigSync          │  │
│  └──────────┬───────────┘       └───────────────┬────────────────┘  │
│             │                                   │                   │
│             ▼                                   ▼                   │
│  ┌──────────────────────┐       ┌────────────────────────────────┐  │
│  │ Preload              │       │ OpenClaw Runtime                │  │
│  │ contextBridge        │       │ - Gateway RPC / Events          │  │
│  │ window.api           │       │ - Agents / Skills / Cron        │  │
│  └──────────────────────┘       └────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────┐       ┌────────────────────────────────┐  │
│  │ Pet Window           │◀──────│ PetEventBridge                  │  │
│  │ state machine/bubble │       │ Cowork / IM / Cron events       │  │
│  └──────────────────────┘       └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │
┌─────────────────────────────────┴───────────────────────────────────┐
│ petclaw-shared                                                       │
│ i18n / shared types / protocol types / constants / pure utilities    │
└─────────────────────────────────────────────────────────────────────┘

Reserved workspace packages:
  petclaw-web  ── depends on petclaw-shared only
  petclaw-api  ── depends on petclaw-shared only
```

| 模块 | 详细文档 | 职责 |
|---|---|---|
| Shared | [`shared/Shared架构设计.md`](./shared/Shared架构设计.md) | 跨包共享类型、i18n、协议类型、常量和纯函数 |
| Web | [`web/Web架构边界.md`](./web/Web架构边界.md) | `petclaw-web` 预留包边界 |
| API | [`api/API架构边界.md`](./api/API架构边界.md) | `petclaw-api` 预留包边界 |
| Desktop | [`desktop/overview/Desktop架构设计.md`](./desktop/overview/Desktop架构设计.md) | Electron 领域总览 |
| Renderer | [`desktop/foundation/Renderer架构设计.md`](./desktop/foundation/Renderer架构设计.md) | desktop 前端状态、布局和交互规范 |
| IPC/Preload | [`desktop/foundation/IPCPreload架构设计.md`](./desktop/foundation/IPCPreload架构设计.md) | 主渲染通信契约 |
| IPC Channel | [`desktop/foundation/IPCChannel契约.md`](./desktop/foundation/IPCChannel契约.md) | 当前 IPC channel inventory |
| Runtime/Gateway | [`desktop/runtime/RuntimeGateway架构设计.md`](./desktop/runtime/RuntimeGateway架构设计.md) | OpenClaw runtime 生命周期与连接 |
| Directory | [`desktop/domains/Directory架构设计.md`](./desktop/domains/Directory架构设计.md) | 目录驱动 Agent、agentId 和当前目录事实源 |
| ConfigSync | [`desktop/runtime/ConfigSync架构设计.md`](./desktop/runtime/ConfigSync架构设计.md) | runtime 配置、workspace 文件和审批同步 |
| Cowork | [`desktop/domains/Cowork架构设计.md`](./desktop/domains/Cowork架构设计.md) | 会话、消息、流式事件和权限审批 |
| Pet 事件 | [`desktop/domains/Pet事件架构设计.md`](./desktop/domains/Pet事件架构设计.md) | 统一宠物事件和 Pet Window 消费协议 |
| IM | [`desktop/domains/IM架构设计.md`](./desktop/domains/IM架构设计.md) | IM 实例、绑定、凭据和消息流 |
| Cron | [`desktop/domains/Cron架构设计.md`](./desktop/domains/Cron架构设计.md) | 定时任务元数据、RPC 和运行历史 |
| Skills | [`desktop/domains/Skills架构设计.md`](./desktop/domains/Skills架构设计.md) | Skill 作用域、安装和同步 |
| Models | [`desktop/domains/Models架构设计.md`](./desktop/domains/Models架构设计.md) | 模型提供商和模型优先级 |
| MCP | [`desktop/domains/MCP架构设计.md`](./desktop/domains/MCP架构设计.md) | MCP 配置、连接管理和 bridge |
| Memory | [`desktop/domains/Memory架构设计.md`](./desktop/domains/Memory架构设计.md) | 记忆文件、检索和 runtime 配置 |
| DataStorage | [`desktop/foundation/DataStorage架构设计.md`](./desktop/foundation/DataStorage架构设计.md) | SQLite 表和 store 所有权 |
| I18n | [`desktop/foundation/I18n架构设计.md`](./desktop/foundation/I18n架构设计.md) | 用户可见文案、语言服务和 shared i18n 资源 |
| SystemIntegration | [`desktop/runtime/SystemIntegration架构设计.md`](./desktop/runtime/SystemIntegration架构设计.md) | 窗口、macOS Dock/Application/Pet Context Menu、非 macOS tray fallback、快捷键、自动更新和平台差异 |
| Desktop 打包与 Runtime 分发 | [`desktop/runtime/Desktop打包与Runtime分发架构设计.md`](./desktop/runtime/Desktop打包与Runtime分发架构设计.md) | Electron Builder、OpenClaw runtime 构建、本地扩展和平台产物 |

## 关键数据流摘要

### 用户发送 Cowork 消息

```text
┌──────────────┐
│ ChatInputBox │
└──────┬───────┘
       │ text + cwd + files + skillIds
       ▼
┌────────────────────┐
│ Preload window.api │
└──────┬─────────────┘
       │ cowork:session:start/send
       ▼
┌────────────────────────────────────────┐
│ Main Process                            │
│ - CoworkController                      │
│ - CoworkSessionManager                  │
│ - CoworkStore                           │
│   固化 session / cwd / model / prompt    │
└──────┬───────────────────────┬─────────┘
       │                       │
       │ sessions.send         │ pet state / bubble
       ▼                       ▼
┌────────────────────┐   ┌────────────────────┐
│ OpenClaw Gateway   │   │ PetEventBridge      │
│ stream events      │   │ → Pet Window        │
└──────┬─────────────┘   └────────────────────┘
       │ cowork:stream:*
       ▼
┌────────────────────────────────────────┐
│ Renderer                                │
│ 当前 session 更新消息详情                │
│ 后台 session 只更新列表摘要/未读/running │
└────────────────────────────────────────┘
```

### Runtime 启动

```text
App boot
→ BootCheck Phase A IPC
→ OpenclawEngineManager 准备 runtime、端口、token、环境变量
→ GatewayClient 建连和健康检查
→ ConfigSync 同步 openclaw.json / AGENTS.md / approvals
→ runtimeServices 就绪后、boot:complete 前注册 Phase B IPC
→ renderer 进入主界面后发送 app:pet-ready 创建 Pet Window / PetEventBridge
→ renderer 获取 snapshot 并订阅状态
```

### IM 或 Cron 触发 AI

```text
IM/Cron 入口
→ main 解析 instance/task 绑定
→ 生成或定位 Cowork session
→ Gateway sessions.send / cron.* RPC
→ Cowork 和 PetEventBridge 接收运行事件
→ 对应页面刷新实例、任务或运行历史
```

## 工程能力

仓库级工程能力不属于 desktop 模块：

- AI 代码上下文和影响分析：[`engineering/AI代码上下文工程设计.md`](./engineering/AI代码上下文工程设计.md)
- Desktop 打包、OpenClaw runtime 构建、升级和本地扩展：[`desktop/runtime/Desktop打包与Runtime分发架构设计.md`](./desktop/runtime/Desktop打包与Runtime分发架构设计.md)
- GitHub Actions / CI/CD：[`engineering/CI-CD架构设计.md`](./engineering/CI-CD架构设计.md)

旧的大文档保留在 `legacy/`，只作为迁移参考，不作为当前模块详细事实源。
