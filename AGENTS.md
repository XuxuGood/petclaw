# PetClaw — AI Agent 工作入口

本文件是 AI Agent 在 PetClaw 仓库中的执行入口。入口文件只保留必须遵守的规则、常用命令、查找路由和高频架构边界；完整事实以文档和代码为准。

- 总体架构事实源：[docs/架构设计/PetClaw架构总览.md](docs/架构设计/PetClaw架构总览.md)
- Desktop 架构事实源：[docs/架构设计/desktop/overview/Desktop架构设计.md](docs/架构设计/desktop/overview/Desktop架构设计.md)
- 前端架构事实源：[docs/架构设计/desktop/foundation/Renderer架构设计.md](docs/架构设计/desktop/foundation/Renderer架构设计.md)
- AI 代码上下文事实源：[docs/架构设计/engineering/AI代码上下文工程设计.md](docs/架构设计/engineering/AI代码上下文工程设计.md)
- Gateway 协议：[docs/openclaw-gateway-api.md](docs/openclaw-gateway-api.md)
- OpenClaw 上游源码参考：`/Users/xiaoxuxuy/Desktop/工作/AI/开源项目/openclaw`，远端为 `https://github.com/openclaw/openclaw`

## 1. 基本原则

- 始终中文回复。
- 先读后改，不凭记忆修改代码。
- 保持最小改动，不做无关重构。
- 不回滚、不覆盖、不格式化用户已有改动。
- 生产级实现，禁止 demo / MVP / TODO hack。
- 不确定时先查本地文档、代码、调用方和测试，不要把仓库内可自行发现的问题丢给用户。
- 修改核心模块前必须做影响分析和调用方扫描。
- 涉及用户可见行为时，必须考虑错误态、权限、安全边界和验证方式。

## 2. 写文件授权规则

任何代码、文档、配置文件变更前，必须先列出：

- 拟修改文件
- 修改原因
- 预期影响
- 验证方式

然后等待用户明确确认。

如果用户明确说“直接改”“修复”“实现”“提交”“加下”“改下”，视为已授权本次相关改动。

用户只是在提问、排查、解释或要求运行命令时，只能执行只读检查和用户明确要求的命令，不得顺手修改文件。

自动格式化、生成文件、删除文件也视为写操作。

## 3. 不确定时的默认动作

如果当前任务涉及某个模块，而本文件没有足够细节，AI 必须自行执行：

1. 读对应设计文档。
2. 用 `rg` 查相关 symbol / IPC channel / config key / table / 文件名。
3. 必要时读调用方和测试。
4. 再提出修改边界或实现。

不要要求用户手动指出本仓库中可通过搜索获得的信息。

## 4. 信息查找路由

- 总体架构不清楚：读 [docs/架构设计/PetClaw架构总览.md](docs/架构设计/PetClaw架构总览.md)
- Desktop 模块不清楚：先读 [docs/架构设计/desktop/overview/Desktop架构设计.md](docs/架构设计/desktop/overview/Desktop架构设计.md)，再读对应模块文档。
- 前端状态、UI、preload、renderer 不清楚：读 [docs/架构设计/desktop/foundation/Renderer架构设计.md](docs/架构设计/desktop/foundation/Renderer架构设计.md)
- AI 代码上下文工具不清楚：读 [docs/架构设计/engineering/AI代码上下文工程设计.md](docs/架构设计/engineering/AI代码上下文工程设计.md)
- Gateway 协议不清楚：读 [docs/openclaw-gateway-api.md](docs/openclaw-gateway-api.md)
- OpenClaw 上游源码实现不清楚：查 `/Users/xiaoxuxuy/Desktop/工作/AI/开源项目/openclaw`，必要时参考 `https://github.com/openclaw/openclaw`
- PetClaw 实际分发的 OpenClaw runtime 不清楚：查 `petclaw-desktop/package.json#openclaw.version`、`petclaw-desktop/vendor/openclaw-runtime/current/` 和 [docs/架构设计/desktop/runtime/Desktop打包与Runtime分发架构设计.md](docs/架构设计/desktop/runtime/Desktop打包与Runtime分发架构设计.md)
- PetClaw 本地 OpenClaw 扩展不清楚：查 `petclaw-desktop/openclaw-extensions/`
- 启动链路不清楚：查 `petclaw-desktop/src/main/index.ts`、`bootcheck.ts`、`runtime-services.ts`
- IPC 不清楚：查 `petclaw-desktop/src/main/ipc/`、`petclaw-desktop/src/preload/index.ts`、`petclaw-desktop/src/preload/index.d.ts`
- SQLite 表结构不清楚：查 `petclaw-desktop/src/main/data/db.ts`
- ConfigSync 不清楚：查 `petclaw-desktop/src/main/ai/config-sync.ts`
- Cowork 不清楚：查 `petclaw-desktop/src/main/ai/cowork-*`、`petclaw-desktop/src/renderer/src/views/chat/`
- Openclaw runtime 运行时链路不清楚：查 `petclaw-desktop/src/main/ai/engine-manager.ts`、`gateway.ts`
- IM 不清楚：查 `petclaw-desktop/src/main/im/`、`petclaw-desktop/src/renderer/src/views/im/`
- Cron 不清楚：查 `petclaw-desktop/src/main/scheduler/`、`petclaw-desktop/src/renderer/src/views/cron/`
- Pet 事件不清楚：查 `petclaw-desktop/src/main/pet/`
- i18n key 不清楚：查 `petclaw-shared/src/i18n/locales/{zh,en}.ts`

## 5. 常用命令

从 monorepo 根目录执行：

```bash
pnpm --filter petclaw-desktop typecheck
pnpm --filter petclaw-desktop test
pnpm --filter petclaw-desktop lint
pnpm --filter petclaw-desktop build

npm run typecheck
npm test
```

开发调试需要启动应用时：

```bash
pnpm --filter petclaw-desktop dev
pnpm --filter petclaw-desktop dev:openclaw
```

启动 dev 前先清理旧进程，避免 Electron/Vite 多实例冲突：

```bash
pkill -f electron
pkill -f vite
```

沙箱环境可能禁止监听端口或 Unix socket，表现为 `listen EPERM` 或端口测试超时。遇到这种情况应说明环境限制，并在允许的环境下重跑测试，不要误判为业务失败。

## 6. 架构边界摘要

PetClaw 是 Electron 桌面宠物应用：

- Main Process：窗口、系统集成、SQLite、本地配置、Openclaw runtime 管理。
- Renderer Process：Chat、Settings、Skills、Cron、IM、Pet UI。
- Preload：通过 contextBridge 暴露受控 API。
- Openclaw Runtime：由主进程管理，动态端口和 token 认证。

不可触碰的隔离红线：

- `nodeIntegration: false`
- `contextIsolation: true`
- Renderer 不直接访问 Node / Electron 主进程能力。
- IPC 必须通过 preload 暴露的受控 API。

## 7. 核心领域边界

ConfigSync：

- 是 Openclaw runtime 配置同步入口。
- 聚合 Directory、Model、Skill、MCP、IM、Cron、memorySearch 等配置。
- 写入 `openclaw.json`、main workspace `AGENTS.md`、exec approvals。
- 敏感信息只能通过 env placeholder 写入 runtime 配置。
- 只变更 main workspace `AGENTS.md` 时也必须返回 changed，确保 boot/reload 链路感知变化。
- DirectoryManager 只输出 `agents.list`，不负责全局 defaults。

Cowork：

- 是核心协作领域。
- 所有会话、消息、审批、流式事件使用 Cowork 命名。
- Cowork 配置通过 `CoworkConfigStore` 读写，不在业务代码散落裸 key。
- Session 必须固化 `system_prompt`、目录和模型上下文。
- 前端状态必须以 `sessionId` 建模。
- 消息、流式输出和错误只写入当前打开的会话详情；后台会话事件只更新运行状态、未读或列表摘要。
- 切换会话时必须从主进程重新加载历史，并防止旧请求覆盖新会话。
- 禁止使用无 session 归属的全局消息数组或单一 loading boolean。
- 权限审批使用全局 FIFO 队列串行展示，每个请求必须保留 `sessionId`、`requestId`、`toolUseId` 和 tool 上下文。

当前目录：

- 当前目录只能有一个事实源。
- 禁止侧栏目录状态和 Chat 发送 `cwd` 脱节。
- Chat 发送、会话启动、继续会话、目录展示必须从同一状态源读取。
- 如需缓存，只能缓存 `sessionId -> directoryId/cwd` 这类已固化会话上下文。

IM：

- 前端必须围绕 `im_instances` 建模。
- `platform` 只是筛选、分组和创建入口。
- 禁止把 platform key 当 instance id 使用。
- 会话绑定、凭据、启停状态、配置编辑必须指向具体 `im_instances.id`。

Pet 事件：

- Chat、Cowork、IM、Cron、HookServer 事件汇聚到 `PetEventBridge`。
- Pet 窗口只消费统一事件，不直接理解各业务域内部状态。

## 8. IPC 规则

- Channel 使用 `模块:动作`，例如 `cowork:session:start`。
- 禁止驼峰 channel。
- 新增或修改 IPC 必须同步：
  - `petclaw-desktop/src/main/ipc/*.ts`
  - `petclaw-desktop/src/preload/index.ts`
  - `petclaw-desktop/src/preload/index.d.ts`
  - renderer 调用点
- 所有 IPC 注册必须通过 `safeHandle` / `safeOn`。
- 禁止裸 `ipcMain.handle/on`。
- IPC 分两阶段注册：
  - Phase A：boot 前，仅依赖 db。
  - Phase B：pet-ready 后，可依赖 runtimeServices。

## 9. 前端规则

前端改动前必须阅读：

[docs/架构设计/desktop/foundation/Renderer架构设计.md](docs/架构设计/desktop/foundation/Renderer架构设计.md)

规则：

- 做实际可用界面，不做营销式占位页。
- 所有可见按钮必须有真实行为。
- 阶段性未接入能力必须 disabled 或隐藏，禁止空 `onClick`。
- 用户可见操作失败必须展示错误态，禁止只 `console.warn/error` 后静默吞掉。
- Runtime / Engine 状态页必须使用 snapshot 查询 + push 订阅。
- 所有用户可见文案、状态、错误、aria-label、title、placeholder 必须走 i18n。
- 新增前端 IPC 必须同步 main、preload、类型声明和 renderer 调用点。
- 涉及 store、IPC、会话状态、权限队列、IM/Cron 契约时必须补针对性测试。

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

- 样式优先写在 `className`，遵循现有组件和 `index.css` token。
- 禁止硬编码 hex，除非设计 token 尚未覆盖且已说明原因。
- 圆角、动效、间距优先复用现有同类组件规则，不在新组件中临时发明一套视觉语言。
- 前端结构、状态和交互边界以 [docs/架构设计/desktop/foundation/Renderer架构设计.md](docs/架构设计/desktop/foundation/Renderer架构设计.md) 为准；像素级视觉细节以 [docs/架构设计/desktop/ui/Desktop视觉规范.md](docs/架构设计/desktop/ui/Desktop视觉规范.md)、[docs/架构设计/desktop/ui/Desktop组件规范.md](docs/架构设计/desktop/ui/Desktop组件规范.md)、[docs/架构设计/desktop/ui/Desktop页面布局规范.md](docs/架构设计/desktop/ui/Desktop页面布局规范.md) 和现有同类组件为准。

## 10. i18n 与日志

i18n：

- 所有用户可见 UI 文案、状态消息、错误提示必须走 i18n。
- 翻译资源在 `petclaw-shared/src/i18n/locales/{zh,en}.ts`。
- 新增 key 必须中英文同步。
- key 使用扁平 `模块.键名`。
- 主进程用户可见文本用主进程 i18n，渲染进程用 `useI18n()`。
- AI system prompts、AGENTS 模板、开发日志、代码注释不纳入 i18n。

日志：

- 主进程使用 `petclaw-desktop/src/main/logger.ts`。
- 日志消息使用英文，前缀 `[ModuleName]`。
- 错误日志保留 error 对象作为最后一个参数。
- 高频轮询和心跳不得使用 info 级别刷屏。

## 11. 编码风格

- 禁止 `any`，使用 `unknown` + 类型收窄。
- 不标注可推断类型。
- 注释用中文，说明为什么这样做，不复述代码。
- 复杂业务逻辑、边界情况、兼容处理、魔法值必须注释说明意图和背景。
- 新增配置默认值集中在对应配置模块，禁止魔法值散落。
- 新增或修改表结构时，必须同步 `petclaw-desktop/src/main/data/db.ts` 中的字段注释。
- 文件命名：
  - `src/main/**` 使用 `kebab-case.ts`
  - React 组件使用 `PascalCase.tsx`
  - 非组件 renderer 文件使用 `kebab-case.ts`
  - tests 镜像源码结构，后缀 `.test.ts`

## 12. 测试规则

TDD：

- 新功能先写失败测试，再写实现。
- bug 修复先写复现测试。
- 重构必须先确认现有测试通过，再改结构。

默认验证：

```bash
npm run typecheck
npm test
```

针对性验证示例：

```bash
pnpm --filter petclaw-desktop test -- tests/main/windows.test.ts
pnpm --filter petclaw-desktop test -- tests/main/bootcheck.test.ts
pnpm --filter petclaw-desktop test -- tests/main/ai/config-sync.test.ts
```

如果验证因沙箱、端口、依赖或系统权限限制无法运行，必须明确说明原因。

## 13. AI 代码上下文规则

接到代码改动任务后，先从需求、文件、symbol、模块名、错误信息中推断 `target`。

写文件前必须主动运行：

```bash
pnpm ai:prepare-change -- --target <target>
```

如果无法可靠推断单个 target，改用：

```bash
pnpm --silent ai:prepare-change -- --from-git --json
```

或：

```bash
pnpm --silent ai:prepare-change -- --from-staged --json
```

规则：

- 不要求用户手动运行这些命令。
- 不把 `npx gitnexus analyze` 当默认入口。
- 需要刷新索引时使用 `pnpm ai:index`。
- 工具链异常时优先使用 `pnpm ai:doctor`。
- 机器可读结果使用 `--json`。
- `prepare-change`、`impact`、`doctor` 产生的 `.petclaw/ai-tools/*` 运行产物不得提交。
- GitNexus 锁、registry 权限、沙箱 `EPERM/EACCES` 属于工具链环境异常，应降级为 MCP 和本地 `rg` 扫描。
- 核心模块改动前必须完成 impact analysis，尤其是 ConfigSync、Cowork、IPC、preload、SQLite、i18n、Openclaw runtime 链路。
- 涉及 IPC、ConfigSync、SQLite、i18n、preload 的改动必须追踪完整链路，不能只做字符串搜索。

## 14. GitNexus 规则

本项目 GitNexus repo 名称：`petclaw`

修改 symbol 前必须运行影响分析：

```text
gitnexus_impact({ target: "symbolName", direction: "upstream" })
```

并向用户报告：

- direct callers
- affected processes
- risk level

如果风险为 HIGH 或 CRITICAL，必须先警告用户再继续。

提交前必须运行：

```text
gitnexus_detect_changes()
```

规则：

- 探索陌生代码优先使用 `gitnexus_query`。
- 需要完整 symbol 上下文使用 `gitnexus_context`。
- 不用 find-and-replace 重命名 symbol，使用 `gitnexus_rename`。
- 如果 GitNexus 不可用，降级为 `pnpm ai:prepare-change`、MCP 可用能力和本地 `rg`，并说明原因。

## 15. 文档同步

开发完成后必须先看 `git diff --name-only`，判断是否改变了架构事实。

如果实现改变模块职责、数据流、IPC 契约、preload API、状态模型、数据模型、错误边界、安全边界、UI 布局规则、CI/CD 流程或 Agent 工作规则，必须按 [docs/架构设计/engineering/文档同步路由.md](docs/架构设计/engineering/文档同步路由.md) 检查并同步文档。

纯内部实现细节、局部 bug 修复、测试补充且不改变契约时，不强行改文档，但最终回复必须说明无需同步的原因。

## 16. Git 提交

- Commit message 使用英文。
- 遵循 Conventional Commits：`feat:` / `fix:` / `refactor:` / `docs:` 等。
- Body 每行不超过 100 字符。
- 不加 `Co-Authored-By` AI 署名行。
