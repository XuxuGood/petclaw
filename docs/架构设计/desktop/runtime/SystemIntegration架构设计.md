# SystemIntegration 架构设计

## 1. 模块定位

SystemIntegration 管理 desktop 与操作系统的边界，包括窗口、系统菜单、非 macOS tray fallback、快捷键、自动更新、平台差异和系统权限。

它不是业务领域模块，也不承载 Cowork、IM、Cron 等业务状态。它的职责是把 Electron 应用安全地放进操作系统环境中：窗口如何创建、如何隐藏到后台、Pet Window 如何透明和点击穿透、Dock/Application Menu/系统入口如何唤醒应用、退出和更新时如何协调 runtime 停止。

macOS 是第一优先级平台。PetClaw 在 macOS 上的主姿态是“桌面宠物 + AI 协作助手”：桌面宠物负责常驻存在感，Dock 负责回到应用，Application Menu 负责系统规范，应用内部页面负责复杂功能。第一版不做 Menu Bar Extra，避免和桌面宠物争夺常驻入口。

## 2. 核心概念

- Main Window：主工作台。
- Pet Window：透明/可拖拽宠物窗口。
- Dock：macOS 系统级品牌入口和恢复入口。
- Application Menu：macOS 标准应用菜单。
- Dock Menu：Dock 右键菜单，只放系统级核心入口。
- Pet Context Menu：桌面宠物右键菜单，只放轻控制。
- Menu Bar Extra：macOS 顶部菜单栏额外入口；第一版不启用。
- tray：非 macOS 平台的后台驻留入口，macOS 第一版不默认创建。
- window state：窗口尺寸、位置、显示/隐藏、置顶、透明和点击穿透状态。
- global shortcut：可选的系统快捷键入口，必须由 main process 统一注册和释放。
- auto update：桌面发布后的更新机制。
- protocol handler：`petclaw://` 自定义协议入口，用于未来深链或系统唤醒。
- App Icon：Dock、Finder、About/Settings 中的品牌资产，不在应用导航里重复装饰。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│                       Electron Main Process                         │
│                                                                    │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐  │
│  │ WindowManager │  │ SystemMenus   │  │ Shortcut/Protocol     │  │
│  │ main/pet win  │  │ Dock/App/Pet  │  │ system entry points   │  │
│  └───────┬───────┘  └───────┬───────┘  └──────────┬────────────┘  │
│          │                  │                     │               │
│          └──────────────────┴──────────┬──────────┘               │
│                                         ▼                          │
│                           Runtime shutdown/update coordinator       │
│                                         │                          │
│                                         ▼                          │
│                           IPC snapshot / status events              │
└─────────────────────────────────────────┬──────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────┐
│ Renderer                                                            │
│ Settings/About/BootCheck: version, update, permission, recovery UI   │
└────────────────────────────────────────────────────────────────────┘
```

系统能力只在 main process 落地。renderer 可以通过 preload 请求有限操作，例如打开设置、显示/隐藏窗口、查询版本和更新状态，但不能得到通用 shell、文件系统或 Electron 原生对象。

macOS 系统入口分层：

```text
┌────────────────────────────────────────────────────────────────────┐
│ macOS system shell                                                  │
│                                                                    │
│  Dock icon          -> Open/Focus main window                       │
│  Dock menu          -> Open PetClaw / Show-Hide Pet / Settings/Quit │
│  Application menu   -> About / Settings / Open / Show-Hide / Quit   │
│  Pet context menu   -> Open / Show-Hide / Pause / Settings/Quit     │
│  Menu Bar Extra     -> not enabled in v1                            │
└────────────────────────────────────────────────────────────────────┘
```

复杂业务入口不进入系统外壳。模型、技能、目录、IM、Cron、Runtime Monitor、Task Monitor 都留在应用内部页面。

## 4. 端到端数据流

应用启动创建窗口；窗口状态和系统菜单操作由主进程管理；用户触发 Dock、Application Menu、宠物右键菜单、快捷键或非 macOS tray 时，主进程切换窗口、唤醒 Pet 或执行系统能力；renderer 只接收状态事件，不直接调用系统 API。

启动和后台驻留流：

```text
App launch
  -> main 初始化 app single instance lock
  -> createMainWindow()
  -> createPetWindow()
  -> register macOS Dock/Application/Pet menus
  -> register non-macOS tray fallback / shortcut / protocol
  -> renderer 通过 preload 获取 system snapshot
  -> 用户关闭主窗口
  -> main 拦截 close，根据退出意图 hide 或 quit
  -> Dock/Menu/Pet context action 重新 show main window
```

macOS 打开和恢复流：

```text
Dock click
  -> if main window hidden: show main window
  -> if main window visible: focus main window
  -> if main window destroyed: recreate and show main window

Settings...
  -> show/focus main window
  -> navigate renderer to settings view

Quit PetClaw
  -> explicit quit intent
  -> stop runtime
  -> close all windows
  -> app quit
```

退出/更新流：

```text
User quits or update requests restart
  -> main 标记 isQuitting，禁止 close 退化为 hide
  -> RuntimeGateway 停止 OpenClaw runtime
  -> store flush / sqlite close
  -> unregister shortcuts / dispose tray
  -> app.quit 或 autoUpdater.quitAndInstall
```

## 5. 状态机与生命周期

```text
not-started
  -> launching
  -> ready
  -> visible
  -> hidden/background
  -> update-downloading
  -> update-ready
  -> quitting
  -> exited
```

约束：

- `hidden/background` 只代表窗口不可见，不代表业务会话停止。
- `quitting` 是显式退出意图；进入后不得再把窗口 close 转成 hide。
- 更新重启必须复用退出协调链路，不能直接杀 runtime 进程。
- Pet Window 的拖拽、置顶、透明和点击穿透状态属于窗口状态，不属于 Pet 业务事件状态。

## 6. 数据模型

系统集成保存窗口布局、用户偏好和更新状态。平台特有差异必须封装在 main process 内部。

推荐数据边界：

| 数据 | 所有者 | 持久化 | 说明 |
|---|---|---|---|
| main window bounds | main process | local config/SQLite store | 仅保存可恢复尺寸和位置 |
| pet window bounds | main process | local config/SQLite store | 与 Pet 事件状态分离 |
| tray enabled | main process | local config | 平台不支持时降级 |
| update channel/status | updater coordinator | local config + runtime state | UI 只展示摘要 |
| protocol pending url | main process | memory | 消费后清空，避免重复执行 |

renderer 只消费 DTO，不缓存 Electron 原生窗口对象或系统对象。

App Icon 资产是系统集成数据的一部分，但不进入业务状态：

| 资产 | 用途 | 约束 |
|---|---|---|
| icon source | 设计源 | 保留矢量源或高分辨率 PNG |
| `.icns` / generated icon | macOS Dock/Finder | 覆盖 16、32、128、256、512、1024 尺寸 |
| `resources/icon.png` | electron-builder 输入 | 与 `electron-builder.json` 保持一致 |
| About/Settings 小图标 | 应用内部品牌点 | 可使用简化彩色版，不做导航装饰 |

图标方向使用“抽象爪痕 + AI 光点”：表达 PetClaw 和 AI 协作，避免真实猫脸、`PC` 文字、机器人头或复杂代码符号。

## 7. IPC / Preload 契约

renderer 可请求窗口切换、版本查询、更新状态查询等受控能力。禁止暴露通用 shell 或系统命令能力。

契约形态应遵循 snapshot + push：

```text
system:get-snapshot
  <- { version, platform, mainWindow, petWindow, update, permissions }

system:window:set-visible
  -> { target: "main" | "pet", visible: boolean }
  <- { ok: true, snapshot }

system:update:check
  <- { status, messageKey? }

system:update:event
  -> renderer push { status, progress?, errorKey? }
```

所有 channel 仍使用 `模块:动作` 命名，并通过 `safeHandle` / `safeOn` 注册。

系统动作应集中封装，菜单、Dock、宠物右键菜单和 renderer IPC 复用同一组动作：

```text
openPetClaw()
showMainWindow()
showSettings()
showPet()
hidePet()
pausePet()
resumePet()
quitPetClaw()
```

这样可以避免 Dock Menu、Application Menu、Pet Context Menu 和设置页各自实现窗口逻辑。

## 8. Renderer 布局、状态与交互

设置或关于页展示版本、更新状态和系统权限提示。失败必须提供可操作恢复说明。

系统设置布局：

```text
Settings
  ├── General
  │   ├── Launch on startup
  │   ├── Keep app in tray
  │   └── Close button behavior
  ├── Pet Window
  │   ├── Always on top
  │   ├── Click-through
  │   └── Reset position
  ├── Shortcuts
  │   ├── Toggle main window
  │   └── Toggle pet window
  └── About / Updates
      ├── Version
      ├── Check for updates
      └── Update progress / restart action
```

交互规则：

- 所有按钮必须有真实 IPC 行为；未接入的平台能力 disabled 并展示原因。
- 更新检查失败要展示本地化错误和重试入口，不能只写日志。
- 权限缺失要告诉用户去系统设置恢复，而不是静默禁用功能。
- 重置窗口位置必须只影响目标窗口，不重置业务设置。

macOS 系统菜单文案和行为：

```text
Dock Menu
  ├── Open PetClaw
  ├── Show/Hide Pet
  ├── Settings...
  └── Quit PetClaw

Application Menu / PetClaw
  ├── About PetClaw
  ├── Settings...
  ├── Open PetClaw
  ├── Show/Hide Pet
  ├── Services
  ├── Hide PetClaw
  ├── Hide Others
  ├── Show All
  └── Quit PetClaw

Window Menu
  ├── Minimize
  ├── Close
  └── Bring All to Front

Pet Context Menu
  ├── Open PetClaw
  ├── Hide Pet / Show Pet
  ├── Pause Pet / Resume Pet
  ├── Settings...
  └── Quit PetClaw
```

禁止放入系统菜单的业务入口：

- Task Monitor / Runtime Monitor。
- 模型设置。
- 技能管理。
- 目录管理。
- IM。
- Cron。

任务监控属于高级/诊断能力，应保留在应用内部。后续如改名为 Diagnostics 或 Runtime Monitor，也只能进入 Settings 的 Advanced 区域。

## 9. Runtime / Gateway 集成

系统集成不直接依赖 Gateway，但退出、重启和更新流程必须协调 RuntimeGateway 优雅停止。

协作边界：

- App 启动：SystemIntegration 创建窗口，RuntimeGateway 负责 runtime。
- App 隐藏：不停止 runtime，除非用户配置明确要求后台停用。
- App 退出：先请求 RuntimeGateway 停止，再释放窗口和托盘。
- App 更新：下载和安装由更新模块管理，安装前必须进入退出协调链路。

宠物的 `Pause/Resume Pet` 只影响宠物动画、气泡或轻交互，不停止 OpenClaw runtime，不暂停 Cowork 会话，也不改变 Cron/IM 后台状态。

## 10. 错误态、安全和权限

快捷键、透明点击穿透、自动更新和系统权限需要平台差异处理。日志保留 error 对象，UI 展示本地化摘要。

安全边界：

- renderer 不得直接获得 `BrowserWindow`、`shell`、`globalShortcut` 或 `autoUpdater`。
- 自定义协议 payload 必须解析、校验和限制动作集合。
- 快捷键注册失败不能影响应用启动，应降级为 UI 可见提示。
- 更新包校验、签名和 notarize 结果只由发布链路保障，运行时不接受未授权 update source。
- 点击穿透只允许 Pet Window 使用，Main Window 不应开启透明穿透。
- macOS 第一版不创建 Menu Bar Extra。后续若增加，需要重新评估它与桌面宠物、Dock 和应用内部入口的关系。
- Dock/Application/Pet 菜单不得承载业务深层导航，避免系统外壳变成第二套应用导航。

i18n 边界：

- 所有用户可见菜单项必须走 i18n。
- 推荐使用 `system.*` key 表达系统动作，例如 `system.openPetClaw`、`system.showPet`、`system.hidePet`、`system.pausePet`、`system.resumePet`、`system.settings`、`system.quit`、`system.about`。
- 旧 `tray.*` key 只用于兼容或非 macOS fallback，不应继续表达 macOS Dock/Application Menu。

## 11. 与其它模块的关系

SystemIntegration 为 Boot、Pet Window、RuntimeGateway 和 Renderer 提供桌面壳能力。

| 依赖方 | 关系 |
|---|---|
| Renderer | 查询系统状态、触发窗口/更新操作 |
| Pet 事件 | Pet Window 展示事件，但窗口属性由 SystemIntegration 管 |
| RuntimeGateway | 退出和更新前协调 runtime 停止 |
| Desktop 打包与 Runtime 分发 | 提供图标、协议、签名、更新配置、OpenClaw runtime 和平台产物 |
| CI/CD | 验证 Electron 构建结构和发布产物 |

建议源码落点：

| 文件 | 职责 |
|---|---|
| `src/main/system/macos-integration.ts` | macOS Application Menu、Dock Menu、Dock 点击行为 |
| `src/main/system/system-actions.ts` | 打开主窗口、显示/隐藏宠物、打开设置、退出等共享动作 |
| `src/main/system/tray.ts` | 非 macOS fallback；macOS 第一版不默认调用 |
| `src/main/windows.ts` | 主窗口和宠物窗口显示、隐藏、聚焦、关闭语义 |
| `electron-builder.json` | macOS App Icon、协议和签名相关资源路径 |
| `resources/` | App Icon、tray 和其它系统资产 |

## 12. 测试策略

- 窗口创建和状态切换测试。
- 自动更新状态测试。
- 平台差异分支测试。
- renderer 不直接访问系统能力检查。
- close-to-hide 与 explicit quit 的分支测试。
- update-ready 后重启会调用 runtime stop 的集成测试。
- macOS Dock 点击恢复主窗口测试。
- Dock Menu 和 Application Menu 模板只包含允许项。
- Pet Context Menu 不包含 Task Monitor、模型、技能、目录、IM、Cron。
- Menu Bar Extra 第一版不出现。
- App Icon 在 16、32、128、512/1024px 尺寸下人工检查轮廓和识别度。
