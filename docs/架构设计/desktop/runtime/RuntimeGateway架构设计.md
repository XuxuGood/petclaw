# RuntimeGateway 架构设计

## 1. 模块定位

RuntimeGateway 管理 OpenClaw runtime 的生命周期、动态端口、token、健康检查、重启和 GatewayClient 连接。

## 2. 核心概念

- OpenclawEngineManager：runtime 进程管理者。
- GatewayClient：主进程访问 OpenClaw Gateway 的客户端。
- connection info：endpoint、token、状态和时间戳。
- health check：判断 runtime 是否可用。
- runtime root：生产环境为 `process.resourcesPath/petmind/`，开发环境为 `vendor/openclaw-runtime/current/`。
- state dir：`{userData}/openclaw/state/`，保存 `openclaw.json`、gateway token、端口、日志和 shim。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ Boot / Runtime Status UI                                           │
│  - snapshot: engine status                                          │
│  - push: status/progress updates                                    │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ OpenclawEngineManager                                               │
│  ├── resolve runtime root                                           │
│  │    ├─ prod: process.resourcesPath/petmind/                       │
│  │    └─ dev:  vendor/openclaw-runtime/current/                     │
│  ├── prepare state dir                                              │
│  │    ├─ openclaw.json                                              │
│  │    ├─ gateway-token / gateway-port.json                          │
│  │    ├─ logs/gateway.log                                           │
│  │    └─ bin/openclaw / claw / node / npm / npx shims               │
│  ├── fork/spawn Gateway child process                               │
│  └── emit EngineStatus                                              │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ connectionInfo
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ OpenclawGateway                                                     │
│  ├── dynamic GatewayClient loader                                   │
│  ├── WebSocket connect/reconnect                                    │
│  ├── tick watchdog                                                  │
│  └── event dispatch                                                 │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Domain Services                                                     │
│ Cowork / MCP / Cron / IM / Skills / Memory                          │
└────────────────────────────────────────────────────────────────────┘
```

关键文件：

| 层 | 文件 |
|---|---|
| Engine manager | `petclaw-desktop/src/main/ai/engine-manager.ts` |
| Gateway client wrapper | `petclaw-desktop/src/main/ai/gateway.ts` |
| Gateway restart scheduler | `petclaw-desktop/src/main/ai/gateway-restart-scheduler.ts` |
| Runtime services wiring | `petclaw-desktop/src/main/runtime-services.ts` |
| Boot check | `petclaw-desktop/src/main/bootcheck.ts` |
| Local extensions sync | `petclaw-desktop/src/main/ai/openclaw-local-extensions.ts` |
| Renderer boot UI | `petclaw-desktop/src/renderer/src/views/boot/BootCheckPanel.tsx` |

启动时序图：

```text
App          Boot UI       EngineManager       Gateway Child       GatewayClient
 │              │                │                   │                  │
 │ app ready     │                │                   │                  │
 │──────────────▶│                │                   │                  │
 │ startGateway  │                │                   │                  │
 │───────────────────────────────▶│                   │                  │
 │              │ status:starting │                   │                  │
 │◀───────────────────────────────│                   │                  │
 │              │                │ resolve paths/token/port/env          │
 │              │                │──────────────────▶│ spawn/fork        │
 │              │                │ health probes      │                  │
 │              │                │◀──────────────────│ ready             │
 │              │ status:running │                   │                  │
 │◀───────────────────────────────│                   │                  │
 │ connect      │                │ connectionInfo     │                  │
 │────────────────────────────────────────────────────────────────────▶│
 │              │                │                   │ hello/tick        │
 │◀────────────────────────────────────────────────────────────────────│
```

## 4. 端到端数据流

应用启动后，EngineManager 准备 runtime 路径、环境变量、shim、端口和 token；启动 runtime；GatewayClient 使用连接信息建连；状态通过 IPC snapshot + push 通知 renderer；业务服务在运行时就绪后调用 Gateway RPC。

完整启动序列：

```text
startGateway()
→ startGatewayPromise 防重入
→ ensureReady()
  → resolveRuntimeMetadata()
  → 同步本地 OpenClaw extensions
  → 清理过期第三方插件
→ 检查已有 gateway 进程
→ ensureBareEntryFiles()
→ resolveOpenClawEntry()
→ ensureGatewayToken()
→ resolveGatewayPort()
→ ensureConfigFile()
→ 构建 gateway env
→ 生成 CLI shim 和 node/npm/npx shim
→ macOS/Linux utilityProcess.fork 或 Windows spawn
→ waitForGatewayReady()
→ status = running 或 error
```

## 5. 状态机与生命周期

```text
idle
→ starting
→ running
→ unhealthy
→ restarting
→ stopped
→ failed
```

停止应用时必须优雅关闭 runtime，并清理连接订阅。

EngineManager 对外状态使用更细的 phase：

```text
not_installed
→ ready
→ starting
→ running
→ error
```

`starting` 阶段通过 `progressPercent` 从 10 到 90 渐进，renderer 用它展示 BootCheck 进度。`canRetry` 为 true 时 UI 才展示重试入口。

## 6. 数据模型

RuntimeGateway 主要使用内存状态和本地 runtime 文件路径。需要持久化的模型、MCP、IM、Cron 等配置由对应 store 和 ConfigSync 管理。

关键文件：

```text
{userData}/
  petclaw.db
  openclaw/state/
    openclaw.json
    gateway-token
    gateway-port.json
    .compile-cache/
    bin/
      petclaw / openclaw / claw
    logs/gateway.log
    workspace/
    agents/main/
```

生产包只读资源：

```text
Resources/
  petmind/                 OpenClaw runtime
  SKILLs/                  PetClaw 定制 skills 模板
  openclaw-extensions/     ask-user-question、mcp-bridge 等本地扩展
```

## 7. IPC / Preload 契约

renderer 只能查询 runtime/gateway 状态和订阅状态变化，不能直接获取敏感 token。任何重启或修复入口必须通过 main 校验。

典型状态 IPC：

- `engine:status`：查询或订阅 EngineStatus。
- runtime restart/repair 类操作只暴露受控 API，不暴露原始进程句柄、token 或 arbitrary command。

## 8. Renderer 布局、状态与交互

BootCheck 和状态页必须先查询 snapshot，再订阅 push。runtime 未就绪时，发送、安装、同步等依赖 Gateway 的按钮必须 disabled 或展示恢复入口。

页面入口与源码：

| 区域 | 源码 |
|---|---|
| BootCheck | `petclaw-desktop/src/renderer/src/views/boot/BootCheckPanel.tsx` |
| Engine 设置页 | `petclaw-desktop/src/renderer/src/views/settings/EngineSettings.tsx` |
| App boot gate | `petclaw-desktop/src/renderer/src/App.tsx` |

BootCheck 布局结构：

```text
┌────────────────────────────────────────────────────────────────────┐
│ PetClaw 正在准备运行环境                                             │
│                                                                    │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ OpenClaw Runtime                                              │   │
│ │ phase: starting / running / error                             │   │
│ │ version: vX.Y.Z                                                │   │
│ │ progress: [████████████░░░░] 72%                               │   │
│ │ message: 正在连接 Gateway                                      │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                                                    │
│ 启动步骤                                                            │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ ✓ 检查 runtime 文件                                           │   │
│ │ ✓ 写入 openclaw.json                                          │   │
│ │ … 启动 Gateway                                                │   │
│ │ · 建立 GatewayClient                                          │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                                                    │
│                                  [重试] [查看日志] [打开设置]       │
└────────────────────────────────────────────────────────────────────┘
```

EngineSettings 布局：

```text
┌────────────────────────────────────────────────────────────────────┐
│ Agent 引擎                                                          │
│ 查看 OpenClaw runtime 状态、版本和诊断信息                           │
│                                                                    │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ 状态                                             running      │   │
│ │ 版本                                             vX.Y.Z       │   │
│ │ PID                                              12345        │   │
│ │ Uptime                                           18 min       │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                                                    │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ 诊断                                                         │   │
│ │ Gateway endpoint                              127.0.0.1:**** │   │
│ │ 日志                                                         │   │
│ │ [打开日志] [复制脱敏诊断信息] [重启 Runtime]                   │   │
│ └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

状态页不能直接展示 token、完整 env 或内部进程参数；日志入口只展示脱敏后的主进程/运行时日志。

状态来源：

| 状态 | 所有者 | 说明 |
|---|---|---|
| boot steps | BootCheck IPC | step-update push |
| engine status | Engine status push | phase/version/progress/error |
| retry pending | BootCheckPanel 本地 state | 防止重复 retry |
| runtime diagnostics | EngineSettings | 脱敏展示 |

交互状态：

- boot running：业务页面不显示，避免用户进入不可用 Cowork。
- boot error：停留在 BootCheck，显示重试、日志、设置入口。
- runtime running：EngineSettings 显示状态和诊断，不展示 token。
- restart pending：重启按钮 pending，依赖 Gateway 的页面显示等待状态。

## 9. Runtime / Gateway 集成

RuntimeGateway 是 Gateway 集成的根模块。业务模块不能自行启动 runtime，也不能缓存过期 endpoint/token。

GatewayClient 连接参数来自 `EngineManager.getGatewayConnectionInfo()`：

```typescript
interface GatewayConnectionInfo {
  version: string | null
  port: number | null
  token: string | null
  url: string | null
  clientEntryPath: string | null
}
```

GatewayClient 动态加载入口优先级：

```text
dist/plugin-sdk/gateway-runtime.js
→ dist/gateway/client.js
→ dist/client.js
→ dist/client-*.js
```

连接生命周期：

```text
connect(connectionInfo)
→ 检测 version/clientEntryPath 变化
→ 动态加载 GatewayClient
→ client.start()
→ onHelloOk 后晋升为正式 client
→ start tick watchdog
→ emit connected
```

断线后最多 10 次指数退避重连，tick 超过 90 秒未更新时判定连接死锁并重连。

## 10. 错误态、安全和权限

token 只在 main process 和 runtime 内部使用。日志不能泄漏 token。启动失败要展示可恢复错误，并保留 error 对象到主进程日志。

环境变量边界：

- `OPENCLAW_HOME`、`OPENCLAW_STATE_DIR`、`OPENCLAW_CONFIG_PATH` 指向 `{userData}/openclaw/`。
- `OPENCLAW_GATEWAY_TOKEN` 和 `OPENCLAW_GATEWAY_PORT` 只注入子进程。
- `PETCLAW_ELECTRON_PATH`、`PETCLAW_OPENCLAW_ENTRY` 供 CLI shim 使用。
- Secret vars 只用于 `${VAR}` placeholder，不写入 `openclaw.json` 明文。

健康检查：

- 并行探测 `/health`、`/healthz`、`/ready`、`/` 和 TCP。
- 任一成功即视为健康。
- 启动轮询默认每 600ms，最长等待 300 秒。

自动重启：

- 意外退出最多自动重启 5 次。
- 退避延迟为 3s、5s、10s、20s、30s。
- 手动 restart 会重置计数。

## 11. 与其它模块的关系

ConfigSync 依赖 runtime 可写配置；Cowork、Skills、MCP、Cron、IM、Memory 依赖 Gateway RPC 或事件。

## 12. 测试策略

- EngineManager 状态机测试。
- Gateway 连接失败和重连测试。
- BootCheck runtime 未就绪测试。
- token 和 endpoint 不泄漏检查。
- Windows gateway launcher 入口解析测试。
- gateway token/port 持久化测试。
- tick watchdog 重连测试。
