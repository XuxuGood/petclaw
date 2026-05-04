# PetClaw macOS 系统集成体验设计

> Superseded: 本文是早期 macOS 系统集成体验草案。后续以
> `docs/架构设计/desktop/runtime/SystemIntegration架构设计.md` 作为 SystemIntegration
> 模块设计和实现计划的事实源。本文仅保留为决策过程记录。

## 1. 背景

PetClaw 是桌面宠物优先的 AI 协作应用。现有窗口内部 UI 已有较多设计，但 macOS
系统触点仍较零散：打包配置指向应用图标资源，主窗口使用 macOS 隐藏标题栏和毛玻璃，
系统托盘实现曾使用空图标加 emoji 标题。缺少统一规则会导致 Dock、菜单、桌面宠物和
应用内部品牌露出互相重复。

本设计只覆盖 macOS 系统集成体验，不重做完整品牌系统，不调整聊天、模型、技能、IM 等
应用内部信息架构。

## 2. 设计目标

1. 让 PetClaw 像一个原生 macOS 应用，而不是网页套壳。
2. 保持“桌面宠物优先”的产品姿态：宠物负责常驻存在感，Dock 负责回到应用，菜单负责
   系统规范。
3. 减少重复品牌露出：App 内不再把 Logo 当作导航装饰反复展示。
4. 去除第一版 Menu Bar Extra，避免它和桌面宠物争夺常驻入口。
5. 把任务监控留在应用内部高级/诊断区域，不放进系统外壳入口。

## 3. 非目标

- 不设计官网、营销页、完整品牌手册。
- 不设计 Menu Bar Extra 第一版入口。
- 不把任务监控、模型、技能、目录、IM 放入 Dock Menu 或 Application Menu。
- 不在用户项目目录写入任何系统集成配置。
- 不改变 Electron 安全边界：`nodeIntegration: false`、`contextIsolation: true` 仍是红线。

## 4. 产品姿态

PetClaw 在 macOS 上的主姿态是“桌面宠物 + AI 协作助手”：

- 桌面宠物是常驻存在感和轻交互入口。
- 主窗口是对话、设置和管理工作区的地方。
- Dock 是系统级品牌入口和恢复入口。
- 原生 Application Menu 提供 macOS 归属感和标准命令。
- 右上角 Menu Bar Extra 不作为默认入口。

核心原则：**宠物负责存在感，Dock 负责回来，菜单负责系统规范，内部负责复杂功能。**

## 5. App Icon 设计

### 5.1 图标概念

Dock/App Icon 使用“抽象爪痕 + AI 光点”：

- 主符号：抽象爪痕，表达 PetClaw 和桌面宠物。
- 辅助符号：一个小光点或短轨迹，表达 AI 协作。
- 风格：macOS 原生工具感，克制、有深度，不做卡通头像。
- 避免：真实猫脸、文字 `PC`、机器人头、复杂代码符号。

图标表达一句话：**一只在桌面上轻轻帮你做事的 AI 爪子。**

### 5.2 资产要求

后续实现应产出或接入这些资产：

| 资产 | 用途 | 要求 |
|---|---|---|
| App Icon 源文件 | 设计源 | 建议保留矢量源或高分辨率 PNG |
| `.icns` 或构建可生成资源 | macOS Dock / Finder | 适配 16、32、128、256、512、1024 尺寸 |
| `resources/icon.png` 或等价路径 | electron-builder 输入 | 与 `electron-builder.json` 保持一致 |
| About/Settings 小图标 | 应用内部品牌点 | 可复用简化彩色版，不进入导航装饰 |

### 5.3 尺寸检查

图标必须在以下尺寸人工检查：

- 16px：轮廓仍能识别为爪痕。
- 32px：光点不糊成噪点。
- 128px：Dock 缩小时有清晰品牌记忆。
- 512/1024px：大图有足够精致度，不显得像占位图。

## 6. Menu Bar Extra

第一版不做 Menu Bar Extra。

原因：

1. PetClaw 已有桌面宠物作为常驻存在感。
2. Dock 和宠物右键菜单已覆盖快速恢复和轻控制。
3. 同时存在 Dock、桌面宠物、Menu Bar Extra、App 内 Logo 会造成品牌触点过载。

后续如果用户明确需要“隐藏宠物后仍保留一个极轻入口”，再单独设计 Menu Bar Extra。
该后续能力必须重新评估，不作为本设计第一版的预留实现任务。

## 7. Dock 行为与 Dock Menu

### 7.1 Dock 点击

点击 Dock 图标时：

- 如果主窗口隐藏：显示主窗口。
- 如果主窗口已显示：聚焦主窗口。
- 如果主窗口不存在或已销毁：重新创建并显示主窗口。

Dock 点击不直接切换宠物显示状态，避免用户误以为应用没有打开。

### 7.2 Dock Menu

Dock 右键菜单只放核心系统入口：

1. `Open PetClaw`
2. `Show/Hide Pet`
3. `Settings...`
4. `Quit PetClaw`

不放：

- Task Monitor
- 模型设置
- 技能
- 目录
- IM
- runtime 诊断

## 8. Application Menu

Application Menu 使用标准 macOS 结构，并加入少量核心命令。

### 8.1 PetClaw 菜单

建议结构：

1. `About PetClaw`
2. `Settings...`
3. 分隔线
4. `Open PetClaw`
5. `Show/Hide Pet`
6. 分隔线
7. `Services`
8. 分隔线
9. `Hide PetClaw`
10. `Hide Others`
11. `Show All`
12. 分隔线
13. `Quit PetClaw`

### 8.2 Window 菜单

使用 macOS 标准窗口命令：

1. `Minimize`
2. `Close`
3. 分隔线
4. `Bring All to Front`

### 8.3 业务菜单边界

Application Menu 不承载复杂业务导航。用户需要模型、目录、技能、IM、任务监控时，应进入
应用内部页面。

## 9. 桌面宠物右键菜单

桌面宠物右键菜单负责轻控制，不承担管理功能。

建议项：

1. `Open PetClaw`
2. `Show/Hide Pet` 或 `Hide Pet`
3. `Pause/Resume Pet`
4. `Settings...`
5. `Quit PetClaw`

不放：

- Task Monitor
- Runtime Monitor
- 模型
- 技能
- 目录
- IM

任务监控是高级/诊断能力，不应成为宠物交互的一等入口。

## 10. 窗口关闭与恢复规则

主窗口：

- 点击关闭：隐藏主窗口，不退出应用。
- `Open PetClaw`：显示并聚焦主窗口。
- `Settings...`：显示主窗口并进入设置页。

宠物窗口：

- 默认由应用管理，不通过系统关闭语义退出应用。
- `Show/Hide Pet` 控制显示状态。
- `Pause/Resume Pet` 只影响宠物动画/交互，不停止 runtime。

退出：

- `Quit PetClaw` 才真正退出应用、关闭 runtime 和所有窗口。

## 11. 任务监控边界

任务监控用于查看 AI runtime、工具调用、插件/技能执行等高级状态。它不是普通用户每天
从系统外壳打开的入口。

第一版规则：

- 不放 Dock Menu。
- 不放 Application Menu。
- 不放桌面宠物右键菜单。
- 保留在应用内部。
- 后续可考虑改名为 `Diagnostics` 或 `Runtime Monitor`，放在 Settings 的 Advanced 区。

## 12. 技术落点

后续实现建议使用以下边界：

| 模块 | 责任 |
|---|---|
| `src/main/system/macos-integration.ts` | macOS Application Menu、Dock Menu、Dock 点击行为 |
| `src/main/system/system-actions.ts` | 共享系统动作：打开主窗口、显示/隐藏宠物、打开设置、退出 |
| `src/main/system/tray.ts` | 第一版移除默认调用；保留文件需评估是否删除或仅供非 macOS fallback |
| `src/main/windows.ts` | 主窗口和宠物窗口显示/隐藏/聚焦规则 |
| `electron-builder.json` | macOS App Icon 资源路径 |
| `resources/` | App Icon 与后续系统资产 |

命名建议使用 `macos-integration` 或 `system-integration`，避免使用 `macos-shell`，
因为 shell 容易和命令行混淆。

## 13. i18n 与文案

所有用户可见菜单项必须走 i18n：

- `system.openPetClaw`
- `system.showPet`
- `system.hidePet`
- `system.pausePet`
- `system.resumePet`
- `system.settings`
- `system.quit`
- `system.about`

现有 `tray.*` key 可迁移或保留兼容，但第一版不应继续用 “tray” 表达 macOS 系统菜单。

## 14. 测试与验证

### 14.1 手动验证

- Dock 点击能恢复主窗口。
- Dock Menu 每一项行为正确。
- Application Menu 标准项存在且行为符合 macOS 预期。
- 主窗口关闭后应用仍运行。
- `Quit PetClaw` 能真正退出应用。
- 桌面宠物右键菜单不出现任务监控。
- Menu Bar Extra 不出现。

### 14.2 自动化验证

可添加主进程单元测试覆盖：

- 系统动作函数调用正确窗口方法。
- Dock Menu 模板只包含允许项。
- Application Menu 模板不包含 Task Monitor。
- 设置入口打开统一 settings view。

## 15. 第一版交付范围

第一版应做：

1. 接入正确 macOS App Icon 资源。
2. 去除默认 Menu Bar Extra / Tray 创建。
3. 新增或重构 Application Menu。
4. 新增 Dock Menu。
5. 统一 Dock 点击和主窗口恢复逻辑。
6. 清理桌面宠物右键菜单，移除任务监控入口。
7. 同步 i18n 和架构文档。

第一版不做：

- Menu Bar Extra。
- 复杂状态同步。
- 图标生成流水线自动化。
- 品牌系统全面重做。
- 任务监控改版。
