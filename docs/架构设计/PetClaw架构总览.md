# PetClaw 架构总览

PetClaw 是 Electron 桌面宠物与 AI 协作应用。当前主体是 `petclaw-desktop`：主进程管理窗口、SQLite、本地配置、OpenClaw runtime 和系统集成；渲染进程提供 Chat、Settings、Skills、Cron、IM 和 Pet UI；Preload 通过受控 API 暴露主进程能力。

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
| Desktop | `desktop/overview/Desktop架构设计.md` | Electron 领域总览 |
| Renderer | `desktop/foundation/Renderer架构设计.md` | desktop 前端状态、布局和交互规范 |
| IPC/Preload | `desktop/foundation/IPCPreload架构设计.md` | 主渲染通信契约 |
| IPC Channel | `desktop/foundation/IPCChannel契约.md` | 当前 IPC channel inventory |
| Runtime/Gateway | `desktop/runtime/RuntimeGateway架构设计.md` | OpenClaw runtime 生命周期与连接 |
| Directory | `desktop/domains/Directory架构设计.md` | 目录驱动 Agent、agentId 和当前目录事实源 |
| ConfigSync | `desktop/runtime/ConfigSync架构设计.md` | runtime 配置、workspace 文件和审批同步 |
| Cowork | `desktop/domains/Cowork架构设计.md` | 会话、消息、流式事件和权限审批 |
| Pet 事件 | `desktop/domains/Pet事件架构设计.md` | 统一宠物事件和 Pet Window 消费协议 |
| IM | `desktop/domains/IM架构设计.md` | IM 实例、绑定、凭据和消息流 |
| Cron | `desktop/domains/Cron架构设计.md` | 定时任务元数据、RPC 和运行历史 |
| Skills | `desktop/domains/Skills架构设计.md` | Skill 作用域、安装和同步 |
| Models | `desktop/domains/Models架构设计.md` | 模型提供商和模型优先级 |
| MCP | `desktop/domains/MCP架构设计.md` | MCP 配置、连接管理和 bridge |
| Memory | `desktop/domains/Memory架构设计.md` | 记忆文件、检索和 runtime 配置 |
| DataStorage | `desktop/foundation/DataStorage架构设计.md` | SQLite 表和 store 所有权 |
| I18n | `desktop/foundation/I18n架构设计.md` | 用户可见文案、语言服务和 shared i18n 资源 |
| SystemIntegration | `desktop/runtime/SystemIntegration架构设计.md` | 窗口、托盘、快捷键、自动更新和平台差异 |
| Desktop 打包 | `desktop/runtime/Desktop打包架构设计.md` | Electron Builder 和本地 runtime 打包 |

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
→ pet-ready 后注册 Phase B IPC
→ OpenclawEngineManager 准备 runtime、端口、token、环境变量
→ GatewayClient 建连和健康检查
→ ConfigSync 同步 openclaw.json / AGENTS.md / approvals
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

- AI 代码上下文和影响分析：`engineering/AI代码上下文工程设计.md`
- OpenClaw runtime 构建、升级和本地扩展：`engineering/OpenClawRuntime工程设计.md`
- GitHub Actions / CI/CD：`engineering/CI-CD架构设计.md`

旧的大文档保留在 `legacy/`，只作为迁移参考，不作为当前模块详细事实源。
