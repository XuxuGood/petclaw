# Logging 架构设计

## 1. 模块定位

Logging 是 Desktop foundation 层能力，负责 PetClaw 桌面端所有本地诊断日志、日志脱敏、日志落盘和跨进程日志上报。

Logging 不属于 Cowork、RuntimeGateway、MCP、SystemIntegration 或 Renderer 任一业务域。业务域只声明事件和上下文字段，日志平台统一负责序列化、脱敏、路径、轮转、保留和导出。

目标：

- 给开发者提供可定位问题的结构化本地日志。
- 给用户提供可操作的查看日志入口，并为 Diagnostics 提供受控日志读取能力。
- 给 AI/Cowork、MCP、OpenClaw runtime 等高敏感链路提供默认安全的诊断边界。
- 在 macOS、Windows、Linux 三端使用同一套路径、保留、脱敏和导出规则。

非目标：

- 不做远端 telemetry、analytics 或自动上传。
- 不记录用户 prompt、模型 response、memory 正文或 tool 参数全文。
- 不把日志当作用户错误提示；用户可见错误仍由对应 UI 和 i18n 负责。
- 不暴露通用文件系统或通用 IPC 能力给 renderer。

## 2. 总体架构

```text
Logging Platform
  ├── LogFacade
  │   ├── main logger
  │   ├── renderer IPC logger
  │   ├── child-process stream logger
  │   └── domain scoped logger
  ├── LogSanitizer
  │   ├── secret/env/token redaction
  │   ├── prompt/tool/memory content policy
  │   └── size truncation / circular-safe serialization
  ├── LogStorage
  │   ├── per-source log files
  │   ├── rotation / retention
  │   └── cross-platform path resolver
  └── Logging IPC
      ├── renderer -> main report
      ├── logging snapshot
      └── open log folder
```

`Logging IPC` 是 logging 能力的 Electron IPC 适配层，文件归属 `petclaw-desktop/src/main/ipc/logging-ipc.ts`；`petclaw-desktop/src/main/logging/` 只保留日志领域能力、存储、脱敏和子进程日志接入。诊断事件和诊断包归属 `petclaw-desktop/src/main/diagnostics/`。

核心原则：

- 统一规则，不统一成单个日志文件。不同来源保留独立日志流，诊断包负责统一收集。
- main process 是唯一落盘方。renderer 只能通过 preload 暴露的最小 logging API 上报结构化事件。
- 所有落盘内容必须经过 `LogSanitizer`。诊断包导出时必须二次脱敏。
- 生产源码禁止使用 `console.*`；main 使用 `getLogger(module, source)`，renderer 使用 preload logging API。
- 日志写入失败不能影响业务主流程；应记录日志系统降级状态，并在 logging snapshot 中暴露。

## 3. 日志流与文件布局

日志路径由统一 resolver 基于 Electron `app.getPath('userData')` 和 `path` 派生。业务模块不得自行拼接日志目录。

```text
{userData}/logs/
  main/
    main-YYYY-MM-DD.log
  renderer/
    renderer-YYYY-MM-DD.log
  startup/
    startup-diagnostics.jsonl
  cowork/
    cowork-YYYY-MM-DD.log
  mcp/
    mcp-YYYY-MM-DD.log
  updater/
    updater-YYYY-MM-DD.log
  installer/
    installer.log
  diagnostics/
    petclaw-diagnostics-YYYYMMDDTHHmmss.zip

{userData}/openclaw/logs/
  gateway/
    gateway-YYYY-MM-DD.log
  runtime/
    runtime-YYYY-MM-DD.log
```

日志流职责：

| 日志流 | 记录内容 | 不记录内容 |
|---|---|---|
| `main` | app 生命周期、IPC handler 失败、系统集成、配置同步摘要 | token、完整 env、用户 prompt |
| `renderer` | UI 崩溃、关键操作失败、不可恢复错误 | 普通点击流水、输入框正文 |
| `startup` | 启动阶段 JSONL 事件、boot check 结果、窗口加载结果 | runtime token、完整环境变量 |
| `cowork` | sessionId、requestId、toolUseId、状态迁移、错误摘要 | prompt/response 全文、memory 正文 |
| `mcp` | server 连接、tool 调用结果摘要、传输错误 | tool 参数原文、credential |
| `gateway` | OpenClaw stdout/stderr、启动里程碑、退出原因 | gateway token、完整启动命令 |
| `updater` / `installer` | 更新检查、下载、安装、解包进度、失败原因 | signing secrets、release token |

`{userData}/logs` 只放 PetClaw Desktop 自己负责的日志、诊断包和安装/更新日志。`{userData}/openclaw/logs` 只放 OpenClaw runtime 和 gateway 相关日志。

如果上游 runtime 仍写入自身临时目录，PetClaw 不把该临时目录作为 Desktop 日志事实源；诊断包可以按受控规则读取或引用这些 runtime 日志，并在 manifest 中标记来源。

## 4. 轮转和保留策略

默认策略：

- 普通日志按天命名。
- 单个日志文件默认上限为 20 MB；超过上限后使用同日序号轮转，例如 `main-YYYY-MM-DD.1.log`。
- 普通日志默认保留最近 14 天。
- 启动诊断 JSONL 默认保留最近 14 天，并受单文件大小上限保护。
- 诊断包默认保留最近 5 个。

写入策略：

- 写入前确保目录存在。
- 单条事件序列化后超过事件大小上限时截断字段，并记录 `truncated: true`。
- 单个日志流写入失败时只影响该日志流，不影响业务流程。
- 日志系统降级状态通过 logging snapshot 暴露给 UI。

## 5. LogFacade API 边界

业务模块只使用 scoped logger：

```typescript
const logger = getLogger('ConfigSync')

logger.info('sync.completed', 'Config sync completed', {
  reason,
  changed,
  durationMs
})

logger.warn(
  'sync.degraded',
  'Config sync completed with degraded optional inputs',
  {
    reason,
    missingOptionalConfig: true
  },
  error
)

logger.error(
  'sync.failed',
  'Config sync failed',
  {
    reason,
    sessionId
  },
  error
)
```

事件命名使用点分 lowerCamelCase。对于全局日志使用 `domain.action.outcome`；对于 scoped logger，`module` 已经提供领域上下文时，event 可以使用 `action.outcome`，例如 `getLogger('ConfigSync')` 下的 `sync.failed`。

```text
app.started
boot.check.failed
configSync.sync.completed
gateway.process.exited
cowork.session.started
cowork.approval.resolved
mcp.tool.failed
renderer.render.failed
updater.download.failed
```

工程约束：

- event 必须是字符串字面量，禁止模板字符串、变量和运行时拼接。
- event 至少包含两段：`action.outcome`；推荐三段：`domain.action.outcome`。
- 每段使用 lowerCamelCase，禁止中文、空格、横线和下划线。
- 最后一段 outcome 必须登记在日志规范测试的白名单中；新增 outcome 需要同步说明语义，避免 `failed1`、`error2`、`someCase` 这类不可聚合命名。
- 变量上下文只能进入 `fields`，不能进入 event。

落盘事件标准字段：

```text
timestamp
level
source
module
event
message
platform
arch
appVersion
sessionId?
requestId?
toolUseId?
durationMs?
fields?
error?
```

### 5.1 人类可读日志

日志必须同时服务机器检索和人工排障。`event` 是稳定机器 key，`message` 是固定英文人类可读句子，变量必须进入 `fields`，不得拼接进 `message`。

推荐：

```typescript
logger.error(
  'titleGeneration.failed',
  'Failed to generate session title',
  {
    sessionId,
    modelId,
    elapsedMs
  },
  error
)
```

禁止：

```typescript
logger.error(
  'titleGeneration.failed',
  `Failed to generate title for session ${sessionId} using ${modelId}`,
  undefined,
  error
)
```

原因：

- 固定 `message` 让人可以快速理解日志含义。
- 固定 `event` 让日志可以稳定聚合、过滤和告警。
- 变量放入 `fields`，便于脱敏、裁剪、查询和诊断包摘要展示。
- 变量拼接进 `message` 会让同类错误产生大量不同文本，并可能绕过字段级脱敏。

规则：

- debug/info/warn/error 所有日志等级都必须提供非空英文 `message`。
- Logging facade 的 TypeScript 签名强制 `logger.<level>(event, message, fields?, error?)`，禁止 event-only 或 fields-only 调用。
- `warn` / `error` 允许在无 fields 时写成 `logger.error(event, message, error)`；禁止使用 `undefined` 作为 fields 占位。
- 底层 `LogEventInput.message` 必填，sanitizer 不从 `event` 回退生成可读文本。
- `event` 和 `message` 都必须是字符串字面量，禁止模板字符串、变量和运行时拼接。
- `message` 不包含用户正文、prompt、memory、token、URL query、文件全文或截图内容。
- `message` 不使用中文；中文只用于 UI/i18n。
- 变量、错误摘要、动态上下文必须进入 `fields`；开发者自定义字段名应直接表达含义，例如 `sessionId`、`provider`、`elapsedMs`、`errorMessage`。
- Cowork 日志必须直接使用 Logging facade，不保留独立 wrapper 或 detail 字符串入口。
- 保留规范测试防止退回 `console.*`、动态 event、动态 message 或无 `message` 的日志调用。

规则：

- `electron-log` 或底层 writer 不暴露给业务模块。
- 生产源码禁止使用 `console.*`；所有运行时日志必须显式使用 Logging facade 或 renderer logging IPC。
- 错误对象作为最后一个参数传入，保留 `name`、`message`、`stack`。
- 日志 `message` 使用英文固定句子，模块标签和 event name 保持稳定。
- 高频轮询、心跳和 stream chunk 不使用 info 级别刷屏；必要时使用 debug 并限流。

## 6. Renderer 与 Preload 边界

renderer 不直接写文件，不访问 Node/Electron 日志能力。

preload 暴露最小 API：

```text
window.api.logging.report({ level, event, message, fields? })
window.api.logging.snapshot()
window.api.logging.exportDiagnostics(options)
window.api.logging.openLogFolder()
```

Feedback 不直接读取日志文件。问题反馈链路需要诊断信息时，必须由 main 侧 FeedbackService 调用 Diagnostics bundle 生成脱敏包，再提交给 Feedback API。Renderer 只展示诊断摘要和勾选状态。

IPC channel：

```text
logging:report
logging:snapshot
logging:export-diagnostics
logging:open-log-folder
```

规则：

- IPC 必须通过 `safeHandle` / `safeOn` 注册。
- IPC 适配层放在 `petclaw-desktop/src/main/ipc/logging-ipc.ts`，只调用 logging facade 和 Diagnostics bundle，不反向让 logging domain 暴露 IPC 模块。
- preload 只暴露受控方法，不透传 `ipcRenderer`。
- main 负责 renderer payload shape 校验、字段裁剪、权限判断、脱敏、落盘和导出。
- renderer 不能传任意路径给 main 打开，只能请求预定义日志目录。
- renderer 默认只上报 error/warn、React 错误边界、不可恢复失败和关键用户操作失败。
- renderer 上报遵守和 main 相同的 event/message 规范：`event`、`message` 使用字符串字面量，动态错误信息和 UI 上下文进入 `fields`。
- 用户可见失败必须在 UI 展示本地化文案，不能只上报日志。

## 7. Child Process 与 Runtime 日志

OpenClaw gateway、runtime 辅助进程、installer、updater 等子进程日志通过 child-process stream logger 接入。

```text
attachProcessLogger({
  platform,
  source,
  module,
  stdout,
  stderr
})
```

规则：

- stdout/stderr 先进入对应日志流，再按需输出到 main 日志摘要。
- gateway 启动里程碑只记录首行摘要、耗时和 phase，不记录 token 或完整启动命令。
- runtime env 只记录安全白名单 key 的存在性和摘要，不 dump 完整 env。
- 子进程日志中的 UTC 时间戳可以规范化为本地时区展示，但原始事件时间仍需保留。
- 子进程退出、重启、健康检查失败要写主进程结构化事件，并由 runtime UI 展示可操作错误。

## 8. 隐私脱敏策略

默认策略是记录可排障元数据，不记录用户内容正文和密钥材料。

| 类别 | 默认策略 |
|---|---|
| API key、token、secret、password、cookie、authorization | 永远脱敏 |
| env 完整内容、启动命令完整参数 | 不落盘，只记录 key 摘要和安全白名单 |
| prompt、response、system prompt、memory 正文 | 默认不记录全文 |
| MCP tool 参数、tool 返回正文 | 默认只记录 tool 名、server、结果摘要、错误摘要 |
| 文件路径 | 可记录，但 home/userData/workspace/temp 需规范化 |
| URL | 保留 origin/path，query 中敏感字段脱敏 |
| 错误对象 | 保留 name/message/stack，stack 中路径规范化 |
| SQLite row / app config | 只记录字段摘要，不 dump 整行 |

路径规范化：

```text
{userData}
{workspace}
{temp}
{home}
```

`LogSanitizer` 处理顺序：

```text
redactByKeyName(apiKey/token/secret/password/cookie/authorization...)
→ normalizePaths(userData/workspace/temp/home)
→ redactUrlQuery()
→ redactByValuePattern(sk-..., Bearer ..., JWT-like..., non-URL key=value)
→ truncateLargeValues(max chars / max object keys / max array items)
→ circular-safe serialization
→ classify event contentPolicy
```

失败策略：

- 脱敏失败时写入 `sanitization.failed` 元事件，不写原始 payload。
- 序列化失败时写入 `serialization.failed` 和错误摘要，不写原始对象。
- 字段过大时截断并记录 `truncated: true`。
- 检测到疑似 secret 时替换为 `[redacted]`，并记录 `redactionCount`。

诊断包导出必须对历史日志再次运行二次脱敏，防止旧日志或第三方输出绕过当前 sanitizer。

## 9. AI 内容日志策略

Cowork、MCP、Memory 和模型调用属于高敏感链路。

默认允许记录：

- `sessionId`、`messageId`、`requestId`、`toolUseId`。
- provider、model、token 计数、耗时、状态迁移。
- tool 名、server id、结果类型、错误摘要。
- memory 检索是否启用、命中数量、耗时。

默认禁止记录：

- 用户消息全文。
- 模型响应全文。
- system prompt、AGENTS 模板全文。
- memory 正文、检索片段正文。
- MCP tool 参数全文和 tool 返回正文。
- 模型 provider credential、runtime token、OpenClaw gateway token。

受控内容日志模式：

- 默认关闭。
- 必须由用户显式开启。
- UI 必须说明会包含敏感 AI 内容。
- 必须有过期时间。
- 诊断包导出时必须再次确认是否包含该内容。
- 即使开启，也必须保留 secret redaction、大小截断和路径规范化。

## 10. 诊断包

诊断包是 Diagnostics domain 的一等能力，用于用户主动提交或导出本地排障资料。Diagnostics 读取 Logging storage 的受控日志源，Logging 不反向依赖 Diagnostics。

用户入口：

```text
BootCheck 错误页
  → 打开日志目录
  → 导出诊断包
  → 重试

Settings / Engine
  → 查看 runtime 状态
  → 打开日志目录
  → 导出诊断包

Settings / About 或 Support
  → 导出诊断包
  → 打开日志目录
```

诊断包结构：

```text
petclaw-diagnostics-YYYYMMDDTHHmmss.zip
  manifest.json
  logs/
    main/*.log
    renderer/*.log
    startup/*.jsonl
    cowork/*.log
    mcp/*.log
    gateway/*.log
    updater/*.log
    installer/*.log
  metadata/
    app.json
    platform.json
```

`manifest.json` 字段：

```text
createdAt
appVersion
platform
arch
logTimeRange
includedSources
redactionVersion
redactionCounts
exportErrors
```

默认导出最近 3 天日志。UI 可提供最近 1 天、3 天、7 天选项。

metadata 边界：

- `app.json`：应用版本。
- `platform.json`：platform、arch、Electron/Node/Chrome 版本。
- Diagnostics 不直接读取 SQLite、runtime token、provider credential 或业务配置。需要业务域元数据时，由对应 domain 提供已脱敏摘要，再纳入诊断包。

部分日志缺失、读失败或二次脱敏失败时，导出仍应尽力完成，并在 manifest 的 `exportErrors` 中记录失败来源和脱敏后的错误摘要。

## 11. 错误态与用户体验

日志和用户提示分层：

- 日志记录英文技术细节和 error 对象。
- UI 展示本地化摘要、下一步操作和恢复入口。
- 启动失败、runtime 失败、更新失败、系统权限失败必须提供查看日志或导出诊断包入口。

错误边界：

- 日志写入失败不能导致业务失败。
- 诊断包导出失败必须返回本地化错误 key 给 UI。
- renderer 上报失败不能影响当前 UI 操作。
- 日志目录打开失败必须提示用户，并记录 main error。

## 12. 最终态约束

Logging Platform 是 Desktop 唯一日志事实源。所有业务域，包括 main、startup、gateway、cowork、mcp、updater、installer 和 renderer 上报，都必须收敛到统一 storage、sanitizer、facade 和 IPC。启动诊断事件与反馈诊断包统一归属 Diagnostics domain，并消费 Logging storage。

规则：

1. 生产源码禁止 `console.*`。
2. 不保留业务域独立日志 wrapper。
3. 不保留 event-only、fields-only、动态 message 或 detail 字符串入口。
4. 不保留 `src/main/logger.ts` 兼容入口，业务代码不得直接导入 `electron-log/main`。
5. 新增日志入口必须同时通过类型签名、运行时 schema 和日志规范测试。
6. 旧设计文档和 legacy 文档不再作为 Logging 事实源；有效规则以本文为准。

## 13. 测试策略

必须覆盖：

- `LogSanitizer`：key/value 脱敏、路径规范化、URL query 脱敏、循环引用、大对象截断。
- `LogStorage`：跨平台路径、目录创建、日切、大小轮转、retention、写入失败降级。
- `LogFacade`：事件字段标准化、error stack 保留、日志初始化幂等。
- `Renderer logging IPC`：schema 校验、字段裁剪、非法 payload 拒绝、renderer 无文件写权限。
- `DiagnosticsBundle`：zip 内容、manifest、二次脱敏、缺失文件 warning、诊断包保留数量。
- `Gateway/Cowork/MCP`：不泄漏 token、prompt、memory、tool 参数原文。
- UI：BootCheck、Engine、Support/About 的日志入口有真实行为，失败显示 i18n 文案。

默认验证：

```bash
pnpm --filter petclaw-desktop typecheck
pnpm --filter petclaw-desktop test
```

针对性验证示例：

```bash
pnpm --filter petclaw-desktop test -- tests/main/logging
pnpm --filter petclaw-desktop test -- tests/main/ipc/logging-ipc.test.ts
pnpm --filter petclaw-desktop test -- tests/renderer
```
