# Desktop 架构设计

`petclaw-desktop` 是当前 PetClaw 主体包，承载 Electron 桌面体验、本地数据、OpenClaw runtime 管理和系统集成。

本文件是 `petclaw-desktop` 的架构事实源入口。`desktop/` 下的文件按职责分层，不按代码目录镜像。

## 1. 领域定位

Desktop 负责把本机系统能力、OpenClaw runtime、SQLite、本地配置和 renderer UI 组合成一个长期驻留的桌面 AI 协作应用。

不负责：

- 云端 API 实现。
- Web 端部署。
- 跨包共享契约的定义；共享契约属于 `petclaw-shared`。

## 2. 阅读路径

| 场景 | 阅读入口 |
|---|---|
| 了解 desktop 整体边界 | 本文件 |
| 修改 renderer、preload、IPC、SQLite 或 i18n | [`../foundation/`](../foundation/) |
| 修改 OpenClaw runtime、ConfigSync、系统集成或打包 | [`../runtime/`](../runtime/) |
| 修改 Cowork、IM、Cron、Skills、Models、MCP、Memory、Directory 或 Pet 事件 | [`../domains/`](../domains/) |
| 修改像素级视觉、组件和页面布局 | [`../ui/`](../ui/) |

## 3. 目录职责

```text
desktop/
  overview/      desktop 总览、进程边界、启动流和模块地图
  foundation/    所有功能共享的 renderer/preload/IPC/data/i18n 基础层
  runtime/       OpenClaw runtime、配置同步、系统集成、打包发布
  domains/       具体业务功能域的端到端架构设计
  ui/            Desktop 视觉、组件和页面布局规范
```

分层规则：

- `overview/` 只做地图，不承载模块细节。
- `foundation/` 不写具体业务语义，只描述所有功能共享的宿主边界。
- `runtime/` 描述本地 runtime 生命周期、系统能力和工程发布能力。
- `domains/` 每份文档必须讲清楚端到端数据流、Renderer 布局、状态机、错误态和测试策略。
- `ui/` 只记录像素级视觉、组件和页面布局规范；参考图可放在本地 `docs/设计参考/`，但不提交。

## 4. 进程边界

```text
┌────────────────────────────────────────────────────────────────────┐
│ Renderer Process                                                   │
│                                                                    │
│  Main Window                                                       │
│  ├── Chat / Cowork                                                  │
│  ├── Settings / Directory / Models / MCP / Memory / IM              │
│  ├── Skills                                                         │
│  ├── Cron                                                           │
│  └── BootCheck                                                      │
│                                                                    │
│  Pet Window                                                        │
│  └── PetCanvas / state-machine / bubble                             │
└───────────────────────────────┬────────────────────────────────────┘
                                │ window.api
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│ Preload                                                            │
│  contextBridge exposes typed, minimal APIs                          │
└───────────────────────────────┬────────────────────────────────────┘
                                │ safe IPC channels
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│ Main Process                                                       │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ IPC Router   │  │ SQLite Store │  │ System Integration       │  │
│  │ safeHandle   │  │ db.ts/stores │  │ windows/menus/update     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────────┘  │
│         │                 │                                         │
│         ▼                 ▼                                         │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Domain Services                                                │  │
│  │ Cowork / IM / Cron / MCP / Skills / Models / Memory            │  │
│  └───────────────┬───────────────────────────────┬───────────────┘  │
│                  │                               │                  │
│                  ▼                               ▼                  │
│  ┌──────────────────────────────┐   ┌───────────────────────────┐  │
│  │ RuntimeGateway               │   │ ConfigSync                │  │
│  │ OpenclawEngine + Gateway     │   │ openclaw.json / AGENTS.md │  │
│  └──────────────────────────────┘   └───────────────────────────┘  │
│                  │                                                  │
│                  ▼                                                  │
│  ┌──────────────────────────────┐                                  │
│  │ PetEventBridge               │ ───────────────▶ Pet Window       │
│  └──────────────────────────────┘                                  │
└────────────────────────────────────────────────────────────────────┘
```

隔离红线：

- `nodeIntegration: false`
- `contextIsolation: true`
- renderer 不直接访问 Node / Electron 主进程能力。
- 所有能力通过 preload 和 IPC。

## 5. 模块关系

```text
Renderer UI
  ↓ preload
IPC Router
  ↓
Main services
  ├── Data stores
  ├── GatewayClient
  ├── ConfigSync
  └── PetEventBridge
      ↓
Pet Window
```

功能模块详细设计：

- [`../domains/Cowork架构设计.md`](../domains/Cowork架构设计.md)
- [`../domains/Directory架构设计.md`](../domains/Directory架构设计.md)
- [`../domains/Pet事件架构设计.md`](../domains/Pet事件架构设计.md)
- [`../domains/IM架构设计.md`](../domains/IM架构设计.md)
- [`../domains/Cron架构设计.md`](../domains/Cron架构设计.md)
- [`../domains/Skills架构设计.md`](../domains/Skills架构设计.md)
- [`../domains/Models架构设计.md`](../domains/Models架构设计.md)
- [`../domains/MCP架构设计.md`](../domains/MCP架构设计.md)
- [`../domains/Memory架构设计.md`](../domains/Memory架构设计.md)

基础层详细设计：

- [`../foundation/Renderer架构设计.md`](../foundation/Renderer架构设计.md)
- [`../foundation/IPCPreload架构设计.md`](../foundation/IPCPreload架构设计.md)
- [`../foundation/IPCChannel契约.md`](../foundation/IPCChannel契约.md)
- [`../foundation/DataStorage架构设计.md`](../foundation/DataStorage架构设计.md)
- [`../foundation/I18n架构设计.md`](../foundation/I18n架构设计.md)
- [`../foundation/Logging架构设计.md`](../foundation/Logging架构设计.md)

运行时详细设计：

- [`../runtime/ConfigSync架构设计.md`](../runtime/ConfigSync架构设计.md)
- [`../runtime/RuntimeGateway架构设计.md`](../runtime/RuntimeGateway架构设计.md)
- [`../runtime/SystemIntegration架构设计.md`](../runtime/SystemIntegration架构设计.md)
- [`../runtime/Desktop打包与Runtime分发架构设计.md`](../runtime/Desktop打包与Runtime分发架构设计.md)

UI 规范：

- [`../ui/Desktop视觉规范.md`](../ui/Desktop视觉规范.md)
- [`../ui/Desktop组件规范.md`](../ui/Desktop组件规范.md)
- [`../ui/Desktop页面布局规范.md`](../ui/Desktop页面布局规范.md)

## 6. 端到端启动流

```text
Electron app ready
  │
  ├─ create/open database
  │
  ├─ register Phase A IPC
  │    └─ boot:* / i18n:* / settings:* / app:version
  │
  ├─ show Main Window BootCheck
  │
  ├─ create Pet Window
  │    └─ wait pet-ready
  │
  ├─ initialize runtimeServices
  │    ├─ stores/managers
  │    ├─ OpenclawEngineManager
  │    ├─ OpenclawGateway
  │    └─ ConfigSync
  │
  ├─ register Phase B IPC
  │    └─ cowork:* / mcp:* / cron:* / im:* / skills:* ...
  │
  ├─ ConfigSync.sync('boot')
  │
  ├─ EngineManager.startGateway()
  │
  ├─ GatewayClient.connect()
  │
  └─ Renderer queries snapshot + subscribes push events
```

启动失败必须停留在 BootCheck 可恢复界面；业务页面不能在 runtime 未就绪时暴露可发送 Cowork 的入口。

## 7. 状态与错误边界

- Main Process 是本地事实源，负责数据读写、runtime 状态和系统能力。
- Renderer 是交互层，必须展示 loading、empty、error、disabled 和 retry。
- Preload 是安全边界，只暴露最小 API。
- Runtime / Gateway 未就绪时，功能模块必须提供降级状态，不能静默失败。

## 8. 测试策略

Desktop 变更按风险选择验证：

- IPC/preload：主进程 IPC 测试 + preload 类型检查。
- Renderer 状态：store 测试 + 组件关键路径测试。
- SQLite/store：store 和 migration 测试。
- Runtime/Gateway：启动、健康检查、配置同步相关测试。
