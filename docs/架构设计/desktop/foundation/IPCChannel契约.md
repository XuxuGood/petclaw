# IPC Channel 契约

## 1. 模块定位

本文档是 PetClaw 当前 IPC channel inventory。`IPCPreload架构设计.md` 描述 IPC/Preload 的架构规则；本文列出现有 channel、方向、注册阶段和用途。

代码仍是最终事实源。修改 channel 时必须同步本文、`petclaw-desktop/src/main/ipc/*.ts`、`petclaw-desktop/src/preload/index.ts`、`petclaw-desktop/src/preload/index.d.ts` 和 renderer 调用点。

## 2. 全局规则

- Channel 使用 `模块:动作`，禁止驼峰。
- 所有主进程注册必须通过 `safeHandle` / `safeOn`。
- preload 不暴露通用 `ipcRenderer`。
- 订阅类 API 必须返回 unsubscribe。
- 状态类能力使用 snapshot + push。
- Phase A 只依赖 db、settings、boot、i18n、app version。
- Phase B 可依赖 runtimeServices、Gateway 和业务 manager；必须在 boot 成功后、`boot:complete` 前注册，避免 renderer 进入主界面后先调用业务 IPC 时出现未注册 handler。

注册拓扑：

```text
Phase A
  -> registerBootIpcHandlers
  -> registerSettingsIpcHandlers
  -> registerLoggingIpcHandlers
  -> boot status/retry closures

Phase B
  -> registerAllIpcHandlers
  -> chat/window/directory/models/skills/mcp/memory/scheduler/im
  -> boot:complete
  -> renderer app:pet-ready
  -> create pet window / PetEventBridge / shortcuts
  -> auto updater handlers
```

## 3. Phase A Channels

| Channel | 方向 | Preload API | 说明 |
|---|---|---|---|
| `app:version` | invoke | `getAppVersion()` | 获取应用版本 |
| `i18n:get-language` | invoke | `getLanguage()` | 获取当前语言 |
| `i18n:set-language` | invoke | `setLanguage(locale)` | 设置并持久化语言 |
| `settings:get` | invoke | `getSetting(key)` | 获取 app_config 设置 |
| `settings:set` | invoke | `setSetting(key, value)` | 保存 app_config 设置 |
| `logging:report` | invoke | `logging.report(event)` | renderer 上报 warn/error 级诊断事件，main 校验并脱敏落盘 |
| `logging:snapshot` | invoke | `logging.snapshot()` | 获取日志系统可写状态和各日志流当前路径 |
| `logging:export-diagnostics` | invoke | `logging.exportDiagnostics(options)` | 导出最近 1/3/7 天脱敏诊断包 |
| `logging:open-log-folder` | invoke | `logging.openLogFolder()` | 打开预定义主日志目录，不接受 renderer 传入路径 |
| `boot:status` | invoke | `getBootStatus()` | 获取启动完成状态 |
| `boot:retry` | send | `retryBoot()` | 重试启动检查 |
| `boot:step-update` | main -> renderer | `onBootStepUpdate()` | BootCheck 步骤更新 |
| `boot:complete` | main -> renderer | `onBootComplete()` | BootCheck 完成 |

## 4. App / Window / System Channels

| Channel | 方向 | Preload API | 说明 |
|---|---|---|---|
| `window:move` | send | `moveWindow(dx, dy)` | 移动透明窗口 |
| `window:composer-bounds:update` | send | `updateComposerBounds(bounds)` | Renderer 上报聊天输入框相对 Main Window 内容区的布局坐标，main 只用于计算 Pet 首次视觉锚点 |
| `chat:toggle` | send | `toggleMainWindow()` | 显示或隐藏主窗口 |
| `app:pet-ready` | send | `petReady()` | Renderer 主界面就绪后通知 main 创建 Pet Window、PetEventBridge 和快捷键；Pet Window ready 后恢复 Main Window 前台激活 |
| `app:quit` | send | `quitApp()` | 退出应用 |
| `panel:open` | main -> renderer | `onPanelOpen()` | 打开指定面板 |
| `hook:event` | main -> renderer | `onHookEvent()` | Hook 事件透传 |

## 5. Cowork Channels

| Channel | 方向 | Preload API | 说明 |
|---|---|---|---|
| `cowork:config:get` | invoke | `cowork.getConfig()` | 获取 Cowork 配置 |
| `cowork:config:set` | invoke | `cowork.setConfig(patch)` | 更新 Cowork 配置 |
| `cowork:session:start` | invoke | `cowork.startSession(options)` | 启动新会话 |
| `cowork:session:continue` | invoke | `cowork.continueSession(options)` | 继续会话 |
| `cowork:session:stop` | invoke | `cowork.stopSession(sessionId)` | 停止会话 |
| `cowork:session:list` | invoke | `cowork.listSessions()` | 会话列表 |
| `cowork:session:get` | invoke | `cowork.getSession(id)` | 会话详情 |
| `cowork:session:delete` | invoke | `cowork.deleteSession(id)` | 删除会话 |
| `cowork:permission:respond` | invoke | `cowork.respondPermission()` | 权限审批响应 |
| `cowork:stream:message` | main -> renderer | `cowork.onMessage()` | 新消息 |
| `cowork:stream:message-update` | main -> renderer | `cowork.onMessageUpdate()` | 流式内容增量 |
| `cowork:stream:permission` | main -> renderer | `cowork.onPermission()` | 权限审批请求 |
| `cowork:stream:permission-dismiss` | main -> renderer | `cowork.onPermissionDismiss()` | 权限请求消失 |
| `cowork:stream:complete` | main -> renderer | `cowork.onComplete()` | 会话完成 |
| `cowork:stream:error` | main -> renderer | `cowork.onError()` | 会话错误 |
| `cowork:stream:session-stopped` | main -> renderer | `cowork.onSessionStopped()` | 会话停止 |

## 6. Dialog / Directory Channels

| Channel | 方向 | Preload API | 说明 |
|---|---|---|---|
| `dialog:select-attachments` | invoke | `chat.selectAttachments()` | 选择文件/目录/图片附件 |
| `dialog:select-directory` | invoke | `directories.selectDirectory()` | 选择工作目录 |
| `directory:list` | invoke | `directories.list()` | 目录列表 |
| `directory:get` | invoke | `directories.get(agentId)` | 按 agentId 获取目录 |
| `directory:get-by-path` | invoke | `directories.getByPath(path)` | 按路径获取目录 |
| `directory:update-name` | invoke | `directories.updateName()` | 更新目录别名 |
| `directory:update-model` | invoke | `directories.updateModel()` | 更新目录模型覆盖 |
| `directory:update-skills` | invoke | `directories.updateSkills()` | 更新目录 skill 白名单 |

## 7. Models Channels

| Channel | 方向 | Preload API | 说明 |
|---|---|---|---|
| `models:providers` | invoke | `models.providers()` | provider 列表 |
| `models:provider` | invoke | `models.provider(id)` | provider 详情 |
| `models:add-provider` | invoke | `models.addProvider(data)` | 新增 provider |
| `models:update-provider` | invoke | `models.updateProvider(id, patch)` | 更新 provider |
| `models:remove-provider` | invoke | `models.removeProvider(id)` | 删除 provider |
| `models:toggle-provider` | invoke | `models.toggleProvider(id, enabled)` | 启用/禁用 provider |
| `models:default` | invoke | `models.defaultModel()` | 获取默认模型 |
| `models:set-default` | invoke | `models.setDefaultModel(selected)` | 设置默认模型 |
| `models:set-api-key` | invoke | `models.setApiKey()` | 保存 API key |
| `models:clear-api-key` | invoke | `models.clearApiKey()` | 清除 API key |
| `models:test-connection` | invoke | `models.testConnection(id)` | 测试 provider |
| `models:add-model` | invoke | `models.addModel()` | 添加模型 |
| `models:remove-model` | invoke | `models.removeModel()` | 删除模型 |

## 8. Skills / MCP / Memory Channels

Skills:

| Channel | 方向 | Preload API | 说明 |
|---|---|---|---|
| `skills:list` | invoke | `skills.list()` | 获取 skill 列表 |
| `skills:set-enabled` | invoke | `skills.setEnabled(id, enabled)` | 启用/禁用 skill |

MCP:

| Channel | 方向 | Preload API | 说明 |
|---|---|---|---|
| `mcp:list` | invoke | `mcp.list()` | MCP server 列表 |
| `mcp:create` | invoke | `mcp.create(data)` | 新增 MCP server |
| `mcp:update` | invoke | `mcp.update(id, patch)` | 更新 MCP server |
| `mcp:delete` | invoke | `mcp.delete(id)` | 删除 MCP server |
| `mcp:set-enabled` | invoke | `mcp.setEnabled(id, enabled)` | 启用/禁用 MCP server |
| `mcp:bridge:refresh` | invoke | `mcp.refreshBridge()` | 刷新 MCP bridge |
| `mcp:bridge:syncStart` | main -> renderer | `mcp.onBridgeSyncStart()` | bridge 同步开始 |
| `mcp:bridge:syncDone` | main -> renderer | `mcp.onBridgeSyncDone()` | bridge 同步完成 |

Memory:

| Channel | 方向 | Preload API | 说明 |
|---|---|---|---|
| `memory:read` | invoke | `memory.read(workspace)` | 读取 memory |
| `memory:append` | invoke | `memory.append(workspace, entry)` | 添加 memory |
| `memory:remove` | invoke | `memory.remove(workspace, text)` | 删除 memory |
| `memory:search` | invoke | `memory.search(workspace, keyword)` | 搜索 memory |
| `memory:list-entries` | invoke | `memory.listEntries(workspace)` | memory 条目列表 |
| `memory:update-entry` | invoke | `memory.updateEntry()` | 更新 memory 条目 |

## 9. Scheduler / IM Channels

Scheduler:

| Channel | 方向 | Preload API | 说明 |
|---|---|---|---|
| `scheduler:list` | invoke | `scheduler.list()` | 任务列表 |
| `scheduler:create` | invoke | `scheduler.create(input)` | 创建任务 |
| `scheduler:update` | invoke | `scheduler.update(id, input)` | 更新任务 |
| `scheduler:delete` | invoke | `scheduler.delete(id)` | 删除任务 |
| `scheduler:toggle` | invoke | `scheduler.toggle(id, enabled)` | 启用/禁用任务 |
| `scheduler:run-manually` | invoke | `scheduler.runManually(id)` | 手动运行 |
| `scheduler:list-runs` | invoke | `scheduler.listRuns(jobId, limit, offset)` | 指定任务运行记录 |
| `scheduler:list-all-runs` | invoke | `scheduler.listAllRuns(limit, offset)` | 全部运行记录 |
| `scheduler:status-update` | main -> renderer | `scheduler.onStatusUpdate()` | 任务状态更新 |
| `scheduler:refresh` | main -> renderer | `scheduler.onRefresh()` | 任务列表刷新 |

IM:

| Channel | 方向 | Preload API | 说明 |
|---|---|---|---|
| `im:load-config` | invoke | `im.listInstances()` | IM 实例列表 |
| `im:create-instance` | invoke | `im.createInstance()` | 创建 IM 实例 |
| `im:save-config` | invoke | `im.updateInstance()` | 更新 IM 实例 |
| `im:delete-instance` | invoke | `im.deleteInstance(id)` | 删除 IM 实例 |
| `im:get-status` | invoke | `im.getStatus()` | IM 状态 |
| `im:set-binding` | invoke | `im.setBinding()` | 绑定会话到目录 |
| `im:load-settings` | invoke | 未公开 | 兼容占位，返回空对象 |
| `im:save-settings` | invoke | 未公开 | 兼容占位 |
| `im:status-update` | main -> renderer | `im.onStatusUpdate()` | IM 状态推送 |

## 10. Pet / Engine / Updater Channels

Pet:

| Channel | 方向 | Preload API | 说明 |
|---|---|---|---|
| `pet:context-menu` | send | `showPetContextMenu(paused)` | Pet 右键菜单请求 |
| `pet:toggle-pause` | main -> renderer | `onPetTogglePause()` | 暂停/恢复 Pet |
| `pet:state-event` | main -> renderer | `pet.onStateEvent()` | 统一 Pet 状态事件 |
| `pet:bubble` | main -> renderer | `pet.onBubble()` | Pet 气泡 |

Engine:

| Channel | 方向 | Preload API | 说明 |
|---|---|---|---|
| `engine:status` | main -> renderer | `engine.onStatus()` | runtime 状态推送 |

Updater:

| Channel | 方向 | Preload API | 说明 |
|---|---|---|---|
| `updater:check` | invoke | `updater.check()` | 检查更新 |
| `updater:download` | invoke | `updater.download()` | 下载更新 |
| `updater:install` | invoke | `updater.install()` | 安装更新 |
| `updater:status` | main -> renderer | `updater.onStatus()` | 更新状态 |

## 11. 变更流程

新增或修改 IPC：

```text
1. 判断 Phase A 或 Phase B
2. 在对应 main ipc 文件中 safeHandle/safeOn 注册
3. 在 preload/index.ts 暴露最小 API
4. 在 preload/index.d.ts 同步类型
5. 更新 renderer 调用点和错误态
6. 更新本文 channel 表
7. 补 IPC/preload/renderer 针对性测试
```

禁止事项：

- 不得把 raw channel name 暴露给 renderer。
- 不得让 renderer 任意传入 channel 调用。
- 不得删除 response 字段而不扫描调用方。
- 不得在 push 事件中发送 token、env、进程句柄或未脱敏日志。
