# Engine Manager & Gateway 全面对齐 LobsterAI

## 背景

PetClaw 的 `engine-manager.ts` 和 `gateway.ts` 基于 LobsterAI 的 `openclawEngineManager.ts` 和 `openclawRuntimeAdapter.ts` 实现，但存在大量功能缺失。本次设计目标是**全面对齐 LobsterAI**，补齐所有缺失的功能、工具模块和依赖。

## 参考源

- LobsterAI `src/main/libs/openclawEngineManager.ts` — engine 进程生命周期管理
- LobsterAI `src/main/libs/agentEngine/openclawRuntimeAdapter.ts` — gateway WS 客户端、事件处理、重连
- LobsterAI `src/main/libs/coworkUtil.ts` — 环境变量构造、Skills 目录、node/npm shim、会话标题生成
- LobsterAI `src/main/libs/systemProxy.ts` — 系统代理解析
- LobsterAI `src/main/libs/pythonRuntime.ts` — Windows Python 运行时
- LobsterAI `src/main/libs/openclawLocalExtensions.ts` — 本地扩展同步
- LobsterAI `src/main/libs/claudeSettings.ts` — API 配置管理
- LobsterAI `src/main/libs/coworkModelApi.ts` — 模型 API 协议适配
- LobsterAI `src/main/libs/coworkOpenAICompatProxy.ts` — OpenAI 兼容代理服务器
- LobsterAI `src/main/libs/coworkLogger.ts` — 日志工具
- LobsterAI `src/main/fsCompat.ts` — 文件系统兼容

---

## 模块 1：新增工具模块

从 LobsterAI 搬运并适配 PetClaw 命名。所有 `LOBSTERAI_*` 环境变量前缀改为 `PETCLAW_*`，应用名引用改为 `PetClaw`，打包路径 `cfmind` 对应 `petmind`。

### 1.1 `src/main/ai/system-proxy.ts`

**源**: `systemProxy.ts` (~134 行)

功能：
- 通过 Electron `session.defaultSession.resolveProxy()` 解析系统代理配置
- PAC 格式解析（PROXY、HTTPS、SOCKS5、SOCKS4）
- 代理启用/禁用状态管理
- 进程环境变量注入（http_proxy / https_proxy / HTTP_PROXY / HTTPS_PROXY）

导出：
- `isSystemProxyEnabled()` / `setSystemProxyEnabled(enabled)`
- `resolveSystemProxyUrl(targetUrl)` / `resolveSystemProxyUrlForTargets(targets?)`
- `applySystemProxyEnv(proxyUrl)` / `restoreOriginalProxyEnv()`
- `DEFAULT_PROXY_RESOLUTION_TARGETS`

### 1.2 `src/main/ai/python-runtime.ts`

**源**: `pythonRuntime.ts` (~391 行)

功能：
- Windows Python 嵌入式运行时管理
- 查找 bundled Python（resources/python-win）和 user Python（userData/runtimes/python-win）
- 同步 bundled → user：`cpRecursiveSync` + embed _pth 配置修正
- pip 支持检测与 `ensurepip` 引导
- PATH 注入：将 Python 根目录和 Scripts 目录追加到 PATH

导出：
- `appendPythonRuntimeToEnv(env)` — 仅 Windows 生效
- `ensurePythonRuntimeReady()` — 确保 Python 运行时就绪
- `ensurePythonPipReady()` — 确保 pip 可用
- `getBundledPythonRoot()` / `getUserPythonRoot()`

依赖：
- `src/main/fs-compat.ts` — `cpRecursiveSync`

### 1.3 `src/main/ai/openclaw-local-extensions.ts`

**源**: `openclawLocalExtensions.ts` (~179 行)

功能：
- 开发模式下将 `openclaw-extensions/` 目录同步到运行时的 `third-party-extensions/` 目录
- 列出本地/bundled 扩展 ID
- 清理残留在 `dist/extensions/` 和 `extensions/` 下的第三方插件（防止与 bundled 插件冲突）

导出：
- `syncLocalOpenClawExtensionsIntoRuntime(runtimeRoot)` — 返回 `{ sourceDir, copied }`
- `listLocalOpenClawExtensionIds()`
- `listBundledOpenClawExtensionIds()`
- `hasBundledOpenClawExtension(extensionId)`
- `findThirdPartyExtensionsDir()`
- `cleanupStaleThirdPartyPluginsFromBundledDir(runtimeRoot, thirdPartyPluginIds)`

### 1.4 `src/main/ai/cowork-util.ts`

**源**: `coworkUtil.ts` (~1692 行)

功能清单：

**环境变量构造** (`getEnhancedEnv` / `getEnhancedEnvWithTmpdir`)：
- macOS：`resolveUserShellPath()` 解析用户登录 shell 的 PATH（解决 packaged Electron 不继承 shell profile 的问题）
- Windows：`resolveWindowsRegistryPath()` 从注册表读最新 PATH（解决 Explorer 继承的 PATH 过时问题）
- Windows：`ensureWindowsSystemEnvVars()` 注入 SystemRoot/windir/COMSPEC/SYSTEMDRIVE
- Windows：`ensureWindowsSystemPathEntries()` 确保 System32 等系统目录在 PATH 中
- Windows：`resolveWindowsGitBashPath()` 全链路 git-bash 查找（env var → bundled → installed → registry → PATH）+ 健康检查
- Windows：`ensureWindowsBashBootstrapPath()` 前置 `/usr/bin:/bin` 使 bash 能找到 cygpath
- Windows：`ensureWindowsOriginalPath()` 设置 POSIX 格式的 ORIGINAL_PATH
- Windows：`ensureWindowsBashUtf8InitScript()` 生成 chcp 65001 init 脚本
- Windows：UTF-8 环境变量注入（LANG/LC_ALL/PYTHONUTF8/PYTHONIOENCODING/LESSCHARSET）
- `applyPackagedEnvOverrides()` 综合以上所有逻辑

**node/npm/npx Shim** (`ensureElectronNodeShim`)：
- 生成 bash + .cmd shim 脚本
- node shim: `ELECTRON_RUN_AS_NODE=1 "$PETCLAW_ELECTRON_PATH" "$@"`
- npx/npm shim: 通过 node shim 调用 bundled npm 的 cli.js
- Electron Helper 运行时路径解析 (`getElectronNodeRuntimePath`)

**Skills 目录** (`getSkillsRoot`)：
- packaged: `userData/SKILLs`
- dev: 多候选路径查找

**会话标题生成** (`generateSessionTitle`)：
- 支持 Anthropic 和 Gemini Native 两种协议
- 50 字符限制 + markdown 清理 + 超时 fallback
- 依赖 `resolveSessionTitleApiConfig()` 解析当前 API 配置

**模型探测** (`probeCoworkModelReadiness`)：
- 向配置的 API 发送最小请求验证可达性
- 20s 超时

**Tmp 目录** (`ensureCoworkTempDir` / `getEnhancedEnvWithTmpdir`)：
- 为 Claude Agent SDK 设置 TMPDIR/TMP/TEMP 到工作目录下 `.cowork-temp/`

导出的所有公开函数：
- `getElectronNodeRuntimePath()`
- `ensureElectronNodeShim(electronPath, npmBinDir?)`
- `getSkillsRoot()`
- `getEnhancedEnv(target?)` / `getEnhancedEnvWithTmpdir(cwd, target?)`
- `generateSessionTitle(userIntent)`
- `probeCoworkModelReadiness(timeoutMs?)`
- `ensureCoworkTempDir(cwd)`

命名调整：
- `LOBSTERAI_ELECTRON_PATH` → `PETCLAW_ELECTRON_PATH`
- `LOBSTERAI_OPENCLAW_ENTRY` → `PETCLAW_OPENCLAW_ENTRY`
- `LOBSTERAI_SKILLS_ROOT` → `PETCLAW_SKILLS_ROOT`
- `LOBSTERAI_NPM_BIN_DIR` → `PETCLAW_NPM_BIN_DIR`
- `LOBSTERAI_NODE_SHIM_ACTIVE` → `PETCLAW_NODE_SHIM_ACTIVE`
- `LOBSTERAI_PYTHON_ROOT` → `PETCLAW_PYTHON_ROOT`
- `LOBSTERAI_GIT_BASH_RESOLUTION_ERROR` → `PETCLAW_GIT_BASH_RESOLUTION_ERROR`
- `CLAUDE_CODE_GIT_BASH_PATH` 保持不变（这是上游 SDK 的约定）

### 1.5 `src/main/ai/cowork-model-api.ts`

**源**: `coworkModelApi.ts` (~159 行)

功能：
- `CoworkModelProtocol` 枚举（Anthropic / GeminiNative）
- `buildAnthropicMessagesUrl(baseURL)` / `buildGeminiGenerateContentUrl(baseURL, model)`
- `extractTextFromAnthropicResponse(payload)` / `extractTextFromGeminiResponse(payload)`
- `extractApiErrorSnippet(errorText)` — API 错误文本摘要提取

### 1.6 `src/main/ai/cowork-logger.ts`

**源**: `coworkLogger.ts` (~76 行)

功能：
- `coworkLog(level, tag, message)` — 结构化日志
- 支持 INFO/WARN/ERROR 级别
- 统一格式：`[level] [tag] message`

### 1.7 `src/main/ai/claude-settings.ts`

**源**: `claudeSettings.ts` (~555 行)

功能：
- API 配置管理：读取/解析 OpenClaw 配置中的模型提供商信息
- `getCurrentApiConfig(target?)` — 获取当前 API 配置
- `resolveCurrentApiConfig()` / `resolveRawApiConfig()` — 解析和验证配置
- `buildEnvForConfig(config)` — 根据 API 配置构造环境变量

### 1.8 `src/main/ai/cowork-openai-compat-proxy.ts`

**源**: `coworkOpenAICompatProxy.ts` (~2930 行)

功能：
- 完整的 OpenAI 兼容 API 代理服务器
- 将 OpenAI 格式的请求转发到配置的后端（Anthropic / Gemini / OpenRouter 等）
- 支持流式响应（SSE）
- 请求/响应格式转换
- 错误处理和重试

### 1.9 `src/main/fs-compat.ts`

**源**: `fsCompat.ts` (~44 行)

功能：
- `cpRecursiveSync(src, dest, options?)` — 递归复制目录
- Node.js 16.7+ `fs.cpSync` 的 polyfill，兼容旧版本

---

## 模块 2：engine-manager.ts 增强

### 2.1 types.ts 更新

```typescript
// EnginePhase 增加 'running'
export type EnginePhase = 'not_installed' | 'starting' | 'ready' | 'running' | 'error'

// EngineStatus 增加 progressPercent
export interface EngineStatus {
  phase: EnginePhase
  version: string | null
  progressPercent?: number
  message: string
  canRetry: boolean
}

// GatewayConnectionInfo 增加 clientEntryPath
export interface GatewayConnectionInfo {
  version: string | null
  port: number | null
  token: string | null
  url: string | null
  clientEntryPath: string | null  // 新增
}
```

### 2.2 secretEnvVars 支持

新增公开 API：
```typescript
setSecretEnvVars(vars: Record<string, string>): void
getSecretEnvVars(): Record<string, string>
```

- `config-sync.ts` 解析模型配置时，将 API Key 等敏感值写入 secretEnvVars
- `openclaw.json` 中使用 `${ANTHROPIC_API_KEY}` 占位符，明文值通过 env 注入 gateway 进程
- `doStartGateway` 的 env 中展开 `...this.secretEnvVars`

### 2.3 环境变量补齐

`doStartGateway` 的 env 对象增加以下变量：

```typescript
const skillsRoot = getSkillsRoot().replace(/\\/g, '/')
const electronNodeRuntimePath = getElectronNodeRuntimePath()
const cliShimDir = this.ensureBundledCliShims()
const compileCacheDir = path.join(this.stateDir, '.compile-cache')

const env: NodeJS.ProcessEnv = {
  ...process.env,
  // 现有变量保持不变...
  
  // 新增
  SKILLS_ROOT: skillsRoot,
  PETCLAW_SKILLS_ROOT: skillsRoot,
  OPENCLAW_BUNDLED_PLUGINS_DIR: path.join(runtime.root, 'dist', 'extensions'),
  NODE_COMPILE_CACHE: compileCacheDir,
  PETCLAW_ELECTRON_PATH: electronNodeRuntimePath.replace(/\\/g, '/'),
  PETCLAW_OPENCLAW_ENTRY: openclawEntry.replace(/\\/g, '/'),
  ...this.secretEnvVars,
}
```

之后按顺序注入：
1. CLI shim PATH（`ensureBundledCliShims` → env.PATH 前置）
2. Python 运行时 PATH（`appendPythonRuntimeToEnv`）
3. node/npm/npx shim PATH（`ensureElectronNodeShim`）
4. 系统代理（`isSystemProxyEnabled` → `resolveSystemProxyUrlForTargets` → env.http_proxy 等）

### 2.4 clientEntryPath 提供

新增私有方法 `resolveGatewayClientEntry(runtimeRoot)`——独立于 `resolveOpenClawEntry`（后者解析 gateway 进程入口），查找 GatewayClient SDK 的入口文件：

查找顺序：
1. `dist/plugin-sdk/gateway-runtime.js`（v2026.4.5+）
2. `dist/gateway/client.js`（旧版）
3. `dist/client.js`
4. `gateway.asar/dist/plugin-sdk/gateway-runtime.js`
5. `dist/client-*.js`（last resort glob）

`getGatewayConnectionInfo()` 返回值增加 `clientEntryPath` 字段。

### 2.5 asar 解压支持

新增方法：

**`ensureBareEntryFiles(runtimeRoot)`**：
- 如果 `gateway-bundle.mjs` 存在 → 跳过 dist 解压，只解压 control-ui
- 否则检查 `openclaw.mjs` + `dist/entry.js` 是否存在
- 不存在则从 `gateway.asar` 解压

**`ensureControlUiFiles(runtimeRoot)`**：
- 检查 `dist/control-ui/index.html` 是否存在
- 不存在则从 `gateway.asar/dist/control-ui/` 解压

**`copyDirFromAsar(srcDir, destDir)`**：
- 递归复制 asar 内目录到磁盘

在 `doStartGateway` 中，`resolveOpenClawEntry` 之前调用 `ensureBareEntryFiles`。

### 2.6 Windows bundle-only CJS launcher

新增 `ensureGatewayLauncherCjsForBundle(runtimeRoot)` 方法——简化版 CJS launcher，仅加载 `gateway-bundle.mjs`，无 dist/ 回退。`resolveOpenClawEntry` 在 Windows + bundle 存在时优先使用此方法。

现有 `ensureGatewayLauncherCjs` 也需要更新为 LobsterAI 的完整版本（包含 V8 compile cache、argv patch、fallback 逻辑）。

### 2.7 local extensions 同步 + stale plugins 清理

`ensureReady()` 中增加：
```typescript
const localExtensionSync = syncLocalOpenClawExtensionsIntoRuntime(runtime.root)
if (localExtensionSync.copied.length > 0) {
  console.log(`[OpenClaw] synced local extensions: ${localExtensionSync.copied.join(', ')}`)
}

// 清理残留的第三方插件
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'))
  const thirdPartyIds: string[] = (pkg.openclaw?.plugins ?? [])
    .map((p: { id?: string }) => p.id)
    .filter((id: unknown): id is string => typeof id === 'string')
  const localIds = listLocalOpenClawExtensionIds()
  const allNonBundledIds = [...new Set([...thirdPartyIds, ...localIds])]
  const cleaned = cleanupStaleThirdPartyPluginsFromBundledDir(runtime.root, allNonBundledIds)
  if (cleaned.length > 0) {
    console.log(`[OpenClaw] cleaned stale plugins: ${cleaned.join(', ')}`)
  }
} catch { /* best-effort */ }
```

### 2.8 getOpenClawDailyLogDir()

新增方法：解析 gateway 写入的每日滚动日志目录：
- macOS/Linux: `/tmp/openclaw`
- Windows: `{drive}/tmp/openclaw` 或 `os.tmpdir()/openclaw`

### 2.9 rewriteUtcTimestamps

新增静态方法：将日志中的 UTC ISO 时间戳转换为本地时区格式。`attachGatewayProcessLogs` 中使用。

### 2.10 ensureReady phase 检查

`doStartGateway` 中 `ensureReady` 返回后，除了检查 `ready`，也接受 `running` phase（如果 gateway 已在运行中）：
```typescript
if (ensured.phase !== 'ready' && ensured.phase !== 'running') {
  return ensured
}
```

### 2.11 running phase

gateway 启动成功后状态设为 `running`（而非 `ready`）：
```typescript
this.setStatus({
  phase: 'running',
  version: runtime.version,
  progressPercent: 100,
  message: `OpenClaw gateway 运行中，端口 ${port}。`,
  canRetry: false
})
```

`stopGateway` 后回到 `ready`。

### 2.12 progressPercent

- `starting` 初始：`progressPercent: 10`
- `waitForGatewayReady` 轮询中：`10 + (elapsed / timeout) * 80`，上限 90
- `running`：`progressPercent: 100`

### 2.13 ensureBundledCliShims

新增方法：生成 `openclaw` / `claw` CLI shim 脚本到 `stateDir/bin/`：
- Shell wrapper：检测 `PETCLAW_OPENCLAW_ENTRY` 和 `PETCLAW_ELECTRON_PATH`
- Windows .cmd wrapper
- 返回 shimDir，追加到 env.PATH

---

## 模块 3：gateway.ts 增强

### 3.1 connect() 参数重构

**当前签名**：
```typescript
constructor(port: number, token: string)
async connect(runtimeRoot: string): Promise<void>
```

**新签名**：
```typescript
constructor() // 无参构造
async connect(connectionInfo: GatewayConnectionInfo): Promise<void>
```

`GatewayConnectionInfo` 来自 `engineManager.getGatewayConnectionInfo()`，包含 `url`、`token`、`version`、`clientEntryPath`。

connect 内部变更：
- `clientDisplayName`: `'PetClaw'`（保持）
- `clientVersion`: 使用 `app.getVersion()` 获取 PetClaw 应用版本（替代硬编码 `'1.0.0'`）。注意：`connectionInfo.version` 是 OpenClaw 运行时版本，不是客户端版本
- `loadGatewayClientCtor` 使用 `connectionInfo.clientEntryPath`（替代内部查找逻辑）

### 3.2 版本/路径变更检测

新增成员变量：
```typescript
private gatewayClientVersion: string | null = null
private gatewayClientEntryPath: string | null = null
```

`connect()` 时检查：
- 如果 version 或 clientEntryPath 与上次不同 → 先 `disconnect()` 旧连接
- 如果相同且已连接 → 跳过

### 3.3 pendingGatewayClient

新增成员：
```typescript
private pendingGatewayClient: GatewayClientLike | null = null
```

- `new GatewayClient(...)` 后立即赋值给 `pendingGatewayClient`
- `onHelloOk` 成功后 promote 到 `this.client`，清空 `pendingGatewayClient`
- `disconnect()` 时同时清理两者

### 3.4 WS 自动重连

新增成员和方法：
```typescript
private gatewayReconnectTimer: ReturnType<typeof setTimeout> | null = null
private gatewayReconnectAttempt = 0
private gatewayStoppingIntentionally = false
private static readonly GATEWAY_RECONNECT_MAX_ATTEMPTS = 10
private static readonly GATEWAY_RECONNECT_DELAYS = [2_000, 5_000, 10_000, 15_000, 30_000]

private scheduleGatewayReconnect(): void
private async attemptGatewayReconnect(): Promise<void>
private cancelGatewayReconnect(): void
```

触发时机：`onClose` 回调中，排除 `gatewayStoppingIntentionally` 和未完成握手的场景。

需要存储最后一次成功的 `connectionInfo`，重连时复用：
```typescript
private lastConnectionInfo: GatewayConnectionInfo | null = null
```

### 3.5 Tick 心跳看门狗

新增成员和方法：
```typescript
private lastTickTimestamp = 0
private tickWatchdogTimer: ReturnType<typeof setInterval> | null = null
private static readonly TICK_WATCHDOG_INTERVAL_MS = 60_000
private static readonly TICK_TIMEOUT_MS = 90_000

private startTickWatchdog(): void  // onHelloOk 时启动
private stopTickWatchdog(): void   // disconnect 时停止
private checkTickHealth(): void    // 定时检查
```

`handleEvent` 中 `tick` 事件更新 `lastTickTimestamp`。
`checkTickHealth` 检测超时后调用 `disconnect()` + `scheduleGatewayReconnect()`。

### 3.6 gatewayStoppingIntentionally

`disconnect()` 方法中：
```typescript
disconnect(): void {
  this.gatewayStoppingIntentionally = true
  this.cancelGatewayReconnect()
  this.stopTickWatchdog()
  // ... 清理 client ...
  this.gatewayStoppingIntentionally = false
}
```

### 3.7 gatewayClientInitLock

防并发：
```typescript
private gatewayClientInitLock: Promise<void> | null = null

async connect(connectionInfo: GatewayConnectionInfo): Promise<void> {
  if (this.gatewayClientInitLock) {
    await this.gatewayClientInitLock
    return
  }
  this.gatewayClientInitLock = this._connectImpl(connectionInfo)
  try {
    await this.gatewayClientInitLock
  } finally {
    this.gatewayClientInitLock = null
  }
}
```

### 3.8 断连后通知

`onClose` 回调中：
- 设置 `this.connected = false`
- emit `'disconnected'` 事件（携带 reason）
- 如果非主动断开：`scheduleGatewayReconnect()`

controller 监听 `disconnected` 事件后负责清理 activeTurns 并通知前端。

### 3.9 公开重连接口

```typescript
/** 外部可调用：如果已连接则跳过，否则建立连接 */
async connectIfNeeded(connectionInfo: GatewayConnectionInfo): Promise<void>

/** 外部可调用：强制重连（先断开再连接） */
async reconnect(connectionInfo: GatewayConnectionInfo): Promise<void>
```

### 3.10 loadGatewayClientCtor 简化

现有的 `loadGatewayClientCtor` 内部查找候选路径的逻辑移除，改为直接使用 `connectionInfo.clientEntryPath`：

```typescript
private async loadGatewayClientCtor(clientEntryPath: string): Promise<GatewayClientCtor> {
  const req = createRequire(import.meta.url)
  const loaded = req(clientEntryPath) as Record<string, unknown>
  // ... 查找 GatewayClient 导出（保持 duck-type 检测）
}
```

---

## 模块 4：cowork-controller.ts 适配

### 4.1 disconnected 事件处理

```typescript
private bindGatewayEvents(): void {
  // ... 现有事件绑定 ...
  this.gateway.on('disconnected', (reason) => {
    console.warn('[CoworkController] gateway 断开:', reason)
    // 清理所有活跃 turn
    for (const [sessionId] of this.activeTurns) {
      this.store.updateSession(sessionId, { status: 'error' })
      this.emit('error', sessionId, `Gateway 连接断开: ${reason}`)
      this.cleanupSessionTurn(sessionId)
    }
  })
}
```

### 4.2 messageUpdate 节流

新增 leading + trailing 节流模式，避免高频 IPC：

```typescript
private static readonly MESSAGE_UPDATE_THROTTLE_MS = 50
private lastMessageUpdateEmitTime = new Map<string, number>()
private pendingMessageUpdateTimer = new Map<string, ReturnType<typeof setTimeout>>()

private throttledEmitMessageUpdate(sessionId: string, messageId: string, content: string): void
private clearPendingMessageUpdate(messageId: string): void
```

### 4.3 store 写入节流

```typescript
private static readonly STORE_UPDATE_THROTTLE_MS = 200
private lastStoreUpdateTime = new Map<string, number>()
private pendingStoreTimer = new Map<string, ReturnType<typeof setTimeout>>()

private throttledStoreUpdateMessage(sessionId: string, messageId: string, content: string, metadata: {...}): void
```

---

## 模块 5：index.ts 适配

### 5.1 initializeRuntimeServices 重构

```typescript
async function initializeRuntimeServices(): Promise<void> {
  const connectionInfo = engineManager.getGatewayConnectionInfo()
  if (!connectionInfo.url || !connectionInfo.token) {
    console.warn('Gateway 连接信息不完整，跳过 V3 Runtime 初始化')
    return
  }

  gateway = new OpenclawGateway()
  try {
    await gateway.connect(connectionInfo)
  } catch (err) {
    console.warn('Gateway 连接失败:', err instanceof Error ? err.message : err)
  }

  // ... 后续 controller/session-manager/cron 初始化保持不变 ...
}
```

不再传 port/token 参数，而是从 engineManager 统一获取 connectionInfo。

---

## 模块 6：测试更新

所有现有测试需要适配新接口：
- `engine-manager.test.ts` — 补测 running phase、progressPercent、secretEnvVars
- `gateway.test.ts` — 补测重连逻辑、tick watchdog、版本检测
- 新增工具模块测试（system-proxy.test.ts、cowork-util.test.ts 等）

---

## 风险和注意事项

1. **环境变量命名**：`LOBSTERAI_*` → `PETCLAW_*` 的替换需要全局一致，不能遗漏
2. **依赖引入顺序**：coworkUtil 依赖 systemProxy、pythonRuntime、claudeSettings 等，需要按依赖顺序创建文件
3. **Windows 兼容**：大量 Windows 特有逻辑（git-bash、注册表 PATH、MSYS2 等），需要确保测试覆盖
4. **gateway 构造函数变更**：从有参 `(port, token)` 改为无参，所有调用方需同步更新
5. **running vs ready**：前端代码如果依赖 `phase === 'ready'` 判断 gateway 可用，需要改为 `phase === 'ready' || phase === 'running'`
