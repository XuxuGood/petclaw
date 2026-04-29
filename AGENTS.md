# PetClaw — Codex 工作指南

本文件是 Codex 在 PetClaw 仓库中的执行入口。Codex 即使只读取本文件，也必须能正确开发、排查和验证本项目。

架构事实源：`docs/架构设计/PetClaw总体架构设计.md`。本文件写执行规则和高频项目上下文，架构文档写完整原理、数据模型和模块设计。

## 1. 构建与开发命令

从 monorepo 根目录执行：

```bash
pnpm --filter petclaw-desktop dev              # 启动 Electron + Vite 开发模式
pnpm --filter petclaw-desktop dev:openclaw     # 构建/检查 Openclaw runtime 后启动
pnpm --filter petclaw-desktop typecheck        # desktop 类型检查
pnpm --filter petclaw-desktop test             # desktop 单元测试
pnpm --filter petclaw-desktop lint             # ESLint
pnpm --filter petclaw-desktop build            # 生产构建

npm run typecheck                              # workspace 类型检查
npm test                                       # workspace 全量测试
```

Openclaw runtime：

```bash
pnpm --filter petclaw-desktop openclaw:ensure
pnpm --filter petclaw-desktop openclaw:runtime:host
pnpm --filter petclaw-desktop openclaw:plugins
pnpm --filter petclaw-desktop openclaw:extensions:local
```

打包：

```bash
pnpm --filter petclaw-desktop dist:mac:arm64
pnpm --filter petclaw-desktop dist:mac:x64
pnpm --filter petclaw-desktop dist:win
pnpm --filter petclaw-desktop dist:linux
```

启动 dev server 前先清理旧进程，避免 Electron/Vite 多实例冲突：

```bash
pkill -f electron
pkill -f vite
```

## 2. 架构总览

PetClaw 是 Electron 桌面宠物应用。主进程负责窗口、系统集成、本地持久化和 Openclaw runtime 管理；渲染进程负责 UI；AI 能力由随应用捆绑的 Openclaw Runtime 提供。

```text
Electron Main Process
├── Pet/Main 双窗口
├── SQLite / app_config / settings
├── ConfigSync → openclaw.json / main workspace AGENTS.md / exec-approvals.json
├── OpenclawEngineManager → utilityProcess.fork()
└── OpenclawGateway → GatewayClient → Openclaw Runtime

Renderer Process
├── Chat / Settings / Skills / Cron / IM / Onboarding
├── Zustand stores
└── preload contextBridge API
```

核心原则：

- Electron 进程隔离红线不可触碰：`nodeIntegration: false`、`contextIsolation: true`。
- Openclaw runtime 由主进程管理，使用动态端口和 token 认证。
- ConfigSync 是 OpenClaw runtime 配置同步入口，负责 `openclaw.json`、main workspace `AGENTS.md`、exec approvals。它聚合 Directory、Model、Skill、MCP、IM、Cron、memorySearch 等配置；敏感信息只能通过 env placeholder 写入 runtime 配置。
- Cowork 是核心协作领域，所有会话、消息、审批、流式事件使用 Cowork 命名。

## 3. 进程模型

主进程入口和关键模块：

```text
petclaw-desktop/src/main/
├── index.ts              启动编排、BootCheck、IPC 注册时机
├── windows.ts            Pet/Main 窗口创建、持久化、切换
├── window-layout.ts      窗口尺寸/位置纯计算
├── runtime-services.ts   Gateway / Cowork / Cron 服务组装
├── bootcheck.ts          启动检查和 runtime 初始化前置校验
├── ai/
│   ├── engine-manager.ts Openclaw runtime 生命周期
│   ├── gateway.ts        GatewayClient 动态加载和 RPC/事件分发
│   ├── config-sync.ts    openclaw.json 与 AGENTS.md 同步
│   ├── cowork-controller.ts
│   ├── cowork-session-manager.ts
│   └── system-prompt.ts
├── data/                 SQLite repository 层
├── ipc/                  模块化 IPC handlers
├── scheduler/            定时任务 Gateway RPC 代理
├── im/                   IM 平台配置和会话路由
└── pet/                  PetEventBridge 多源事件聚合
```

渲染进程：

```text
petclaw-desktop/src/renderer/src/
├── views/chat/           Cowork 对话主界面
├── views/settings/       设置
├── views/cron/           定时任务
├── views/im/             IM 频道
├── views/onboarding/     初始化引导
├── pet/                  宠物窗口 UI 和状态机
├── stores/               Zustand stores
├── components/           共享组件
└── i18n.ts               renderer i18n service / useI18n
```

Preload：

```text
petclaw-desktop/src/preload/
├── index.ts
└── index.d.ts
```

新增或修改 IPC 必须同步 `src/main/ipc/*.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`。

## 4. 关键目录

```text
petclaw/
├── CLAUDE.md                         Claude Code 工作入口
├── AGENTS.md                         Codex 工作入口
├── docs/架构设计/
│   ├── PetClaw总体架构设计.md          架构事实源
│   ├── 模块设计/                      后续模块级详细设计
│   └── 决策记录/                      后续架构决策记录
├── docs/superpowers/specs/           阶段性设计 spec
├── docs/superpowers/plans/           实施计划
├── petclaw-desktop/                  Electron 桌面应用
├── petclaw-shared/                   共享类型、常量、i18n 翻译资源
├── petclaw-web/                      官网
├── petclaw-api/                      后端服务
└── docs/设计/                         UI 设计稿和素材
```

## 5. 核心数据流

启动流程：

1. `index.ts` 初始化 logger、SQLite、i18n、EngineManager、各 Manager。
2. 创建 Main Window，显示 BootCheck UI。
3. `runBootCheck()` 创建 runtime 目录、同步 ConfigSync、启动 Openclaw gateway。
4. boot 成功后 `initializeRuntimeServices()` 创建 Gateway、CoworkController、CoworkSessionManager、CronJobService。
5. renderer 通知 `app:pet-ready` 后创建 Pet Window，注册完整 IPC、Tray、Shortcuts、PetEventBridge。

Cowork session：

1. Renderer 通过 preload 调用 `cowork:session:start` 或 `cowork:session:continue`。
2. 主进程读取 `CoworkConfigStore`、目录配置、模型配置和会话参数。
3. `mergeCoworkSystemPrompt()` 合并 scheduled task prompt 和用户 system prompt。
4. `CoworkSessionManager` 创建或读取 session，固化 `system_prompt`。
5. `CoworkController` 通过 GatewayClient 调用 Openclaw，转发流式事件到 renderer。
6. Renderer 更新 Zustand 状态和消息 UI。

ConfigSync：

- 聚合 Directory、Model、Skill、MCP、IM、Cron、memorySearch 配置。
- 写入 `{userData}/openclaw/state/openclaw.json`。
- 写入 `{userData}/openclaw/.openclaw/exec-approvals.json`。
- `agents.defaults` 由 ConfigSync 组合：workspace 使用 `{userData}/openclaw/workspace`，model 使用 `ModelRegistry` 当前 active model 或默认启用模型。
- `DirectoryManager` 只输出 `agents.list`，不负责全局 defaults。
- 同步 main agent workspace 的 `AGENTS.md`。
- 敏感信息只能通过 env placeholder 写入 runtime 配置。
- 只变更 `AGENTS.md` 时也必须返回 changed，确保 boot/reload 链路感知变化。

Pet 事件：

- Chat、Cowork、IM、定时任务、HookServer 事件汇聚到 `PetEventBridge`。
- Pet 窗口只消费统一事件，不直接理解各业务域内部状态。

## 6. 持久化与配置

主要持久化位置：

- SQLite：应用业务数据、`app_config`、Cowork sessions/messages、目录、模型、MCP、IM、定时任务元数据。
- `app_config`：通用配置 KV，领域代码必须通过 typed store 访问，Cowork 使用 `CoworkConfigStore`。
- `{userData}/openclaw/`：Openclaw runtime 状态、workspace、logs。
- `{userData}/SKILLs/`：用户/应用同步后的 skills 根目录。
- `resources/SYSTEM_PROMPT.md`：Cowork 默认 systemPrompt 资源；KV 未持久化时由 `CoworkConfigStore` 读取。
- app settings 文件：窗口位置、宠物位置、auto-launch 等本地设置。

规则：

- 新增配置默认值集中在对应配置模块，禁止魔法值散落。
- Cowork 领域配置通过 `CoworkConfigStore` 读写，不在业务代码散落裸 key。
- API Key 等敏感信息不得写入 `openclaw.json`。
- 目录 Agent 不主动写用户项目目录下的 `AGENTS.md`，避免污染用户仓库。
- 新增/修改表结构时，必须同步 `src/main/data/db.ts` 中的字段注释。

SQLite 表结构速查（完整注释见 `src/main/data/db.ts`）：

| 表 | 用途 | 关键 JSON 字段 |
|---|---|---|
| `app_config` | 全局 KV 配置 | value 为 JSON 字符串或纯文本。已知 key：`language`、`onboardingComplete`、`nickname`、`roles`、`selectedSkills`、`userMdSyncedFrom`、`cowork.defaultDirectory`、`cowork.systemPrompt`、`cowork.memory` |
| `directories` | 工作区目录 | `skill_ids` → `string[]`（Skill ID 白名单）；`model_override` → `"providerId/modelId"` 或空字符串；`agent_id` → `ws-{SHA256前12位}` |
| `model_providers` | 模型供应商 | `models_json` → `ModelDefinition[]`（`{ id, name, reasoning, supportsImage, contextWindow, maxTokens }`）；`api_format` → `'openai-completions'` \| `'anthropic'` \| `'google-generative-ai'` |
| `model_provider_secrets` | 供应商密钥（隔离） | — |
| `cowork_sessions` | AI 协作会话 | `selected_model_json` → `{ providerId, modelId }` \| null；`status` → `'idle'` \| `'running'` \| `'completed'` \| `'error'` |
| `cowork_messages` | 会话消息 | `metadata` → `CoworkMessageMetadata`（含 `toolName`/`toolInput`/`toolResult`/`toolUseId`/`error`/`isStreaming`/`isThinking`/`isTimeout`/`isFinal`/`imageAttachments`/`skillIds`）；`type` → `'user'` \| `'assistant'` \| `'tool_use'` \| `'tool_result'` \| `'system'` |
| `im_instances` | IM 平台实例 | `credentials` → 各平台不同（飞书 `{appId,appSecret,domain?}`、钉钉 `{appKey,appSecret}`、企微 `{corpId,agentId,secret}`、微信 `{accountId}`）；`config` → `{dmPolicy,groupPolicy,allowFrom,debug}` |
| `im_conversation_bindings` | IM 对话级绑定（Tier 1） | `peer_kind` → `'dm'` \| `'group'` |
| `im_session_mappings` | IM 对话→Cowork 会话映射 | — |
| `scheduled_task_meta` | 定时任务本地元数据 | `origin`/`binding` 为预留字段 |
| `mcp_servers` | MCP 服务器 | `config_json` → stdio: `{command,args,env?}`、sse/streamable-http: `{url,headers?}`；`transport_type` → `'stdio'` \| `'sse'` \| `'streamable-http'` |

## 7. 编码风格与命名

通用：

- 始终中文回复。
- 生产级系统设计，禁止 demo / MVP / TODO hack。
- 先读后改，改核心模块前用 `rg` 查调用方和影响范围。
- 最小改动，不做无关重构，不回滚用户已有改动。
- 禁止 `any`，使用 `unknown` + 类型收窄。
- 不标注可推断类型。
- 注释用中文，说明”为什么这样做”，不要复述代码。
- 业务逻辑、条件分支、非显而易见的算法必须写注释，解释意图和上下文。
- 函数/方法若逻辑超过 15 行或含多步骤，在函数体开头用注释概述整体流程。
- 复杂条件判断（`if` 嵌套 ≥2 层、多条件组合）在判断前注释说明什么场景走这个分支。
- 数据库/配置的 JSON 字段、枚举值、魔法数字必须注释取值范围和含义。
- workaround、兼容处理、边界情况必须注释原因和背景，附 issue/文档链接（如有）。

React：

- 组件用函数声明导出：`export function ComponentName()`。
- 不标注组件返回类型。
- 不用 `forwardRef`。
- Hooks 顺序：`useState` → `useRef` → `useEffect` → `useCallback` → `useMemo`。

Zustand：

- Store 命名 `useXxxStore`。
- Actions 只做 `set()`。
- IPC/API 等副作用放组件 `useEffect` 或服务层。

Tailwind / CSS：

- 样式写在 `className`，不抽自定义 CSS 类。
- 使用 `index.css` token，禁止硬编码 hex。
- 圆角只用 `rounded-[10px]` / `rounded-[14px]`。
- 交互统一 `active:scale-[0.96]` + `duration-[120ms]`。

文件命名：

- `src/main/**` 使用 `kebab-case.ts`。
- React 组件使用 `PascalCase.tsx`。
- 非组件 renderer 文件使用 `kebab-case.ts`。
- tests 镜像源码结构，后缀 `.test.ts`。

## 8. IPC、i18n、日志

IPC：

- Channel 使用 `模块:动作`，例如 `cowork:session:start`。
- 禁止驼峰 channel。
- 新增/修改 channel 必须同步 main IPC、preload 实现、preload 类型声明。
- 所有 IPC 注册必须通过 `safeHandle` / `safeOn`（`src/main/ipc/ipc-registry.ts`），禁止裸 `ipcMain.handle/on`。
- IPC 分两阶段注册（见 `ipc/index.ts` 头部注释）：Phase A（boot 前，仅依赖 db）、Phase B（pet-ready 后，依赖 runtimeServices）。

i18n：

- 所有用户可见 UI 文案、状态消息、错误提示必须走 i18n。
- 翻译资源在 `petclaw-shared/src/i18n/locales/{zh,en}.ts`。
- 新增 key 必须中英文同步。
- key 使用扁平 `模块.键名`。
- 主进程用户可见文本用主进程 i18n，渲染进程用 `useI18n()`。
- AI system prompts、AGENTS 模板、开发日志、代码注释不纳入 i18n。

日志：

- 主进程使用 `src/main/logger.ts`，基于 `electron-log` 拦截 `console.*`。
- 日志消息使用英文，前缀 `[ModuleName]`。
- `console.log/warn/error` 是开发/生产日志，不是用户可见提示。
- 错误日志保留 error 对象作为最后一个参数。
- 高频轮询和心跳不得使用 info 级别刷屏。

## 9. 测试与验证

TDD：

- 新功能先写失败测试，再写实现。
- bug 修复先写复现测试。
- 重构必须先确认现有测试通过，再改结构。

必须验证：

```bash
npm run typecheck
npm test
```

针对性验证：

```bash
pnpm --filter petclaw-desktop test -- tests/main/windows.test.ts
pnpm --filter petclaw-desktop test -- tests/main/bootcheck.test.ts
pnpm --filter petclaw-desktop test -- tests/main/ai/config-sync.test.ts
```

沙箱环境可能禁止监听本地端口或 Unix socket，表现为 `listen EPERM` 或端口测试超时。遇到这种情况，应说明原因并在允许的环境下重跑测试，不要把沙箱权限问题误判为业务失败。

## 10. 变更工作流

Codex 专属规则：

- 任何代码、文档、配置文件变更前，必须先列出拟修改文件、修改原因和预期影响，并等待用户明确确认。
- 用户明确说“直接改”“修复”“实现”“提交”“加下”“改下”时，视为已授权本次相关改动。
- 用户只是在提问、排查、解释或要求运行命令时，只能执行只读检查和用户明确要求的命令，不得顺手修改文件。
- 未经用户明确确认，不得调用 `apply_patch` 或其他写文件操作。
- 自动格式化、生成文件、删除文件也视为写操作。

通用流程：

1. 先读相关代码和文档。
2. 用 `rg` 查调用方、旧路径、IPC channel、配置 key。
3. 列清楚修改边界，保持改动最小。
4. 先测试后实现；文档重组类任务至少做引用检查和 `typecheck`。
5. 开发完成后同步 `CLAUDE.md` / `AGENTS.md` 中仍然有效的规则，以及 `docs/架构设计/PetClaw总体架构设计.md` 的相关章节。
6. 不回滚、不覆盖、不格式化无关用户改动。

前端 UI/UX：

- 设计前端 UI/UX 时，先使用项目要求的 UI/UX skill。
- 参考 `docs/设计/` 下的对应设计稿。
- 做实际可用界面，不做营销式占位页。

## 11. 参考文档

- 总体架构：`docs/架构设计/PetClaw总体架构设计.md`
- 阶段性设计：`docs/superpowers/specs/`
- 实施计划：`docs/superpowers/plans/`
- Gateway 协议：`docs/openclaw-gateway-api.md`
- UI 设计稿：`docs/设计/`
