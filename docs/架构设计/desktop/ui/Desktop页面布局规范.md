# Desktop 页面布局规范

本文档记录 PetClaw desktop 页面级布局规范。页面状态、数据流和交互边界见 `docs/架构设计/desktop/foundation/Renderer架构设计.md`；本文只约束稳定布局、滚动、响应式和页面级视觉结构。

## 1. 总体原则

- 应用首屏必须是可用工作台，不做营销式首页。
- 页面布局优先服务高频操作和扫描效率。
- 所有页面必须有稳定的 loading、empty、error、disabled 状态区域。
- 弹窗、列表、详情面板必须有稳定尺寸约束，避免内容加载导致布局跳动。
- 关键页面 UI 改动后，可更新本地 `docs/设计参考/snapshots/desktop/` 下对应截图辅助回归；该目录不提交。

## 2. Main Window 工作台

主窗口由 `WorkspaceFrame` 管理：

```text
┌────────────────────────────────────────────────────────────────────┐
│ AppTopBar                                                          │
│ ┌──────────────┐ ┌──────────────────────────────┐ ┌─────────────┐ │
│ │ left controls│ │ center slot                  │ │ right slot  │ │
│ └──────────────┘ └──────────────────────────────┘ └─────────────┘ │
├───────────────┬──────────────────────────────────┬────────────────┤
│ Sidebar       │ Main Surface                     │ Task Monitor   │
│               │                                  │                │
│ Directory     │ Chat / Skills / Cron / IM        │ Session tools  │
│ Sessions      │ Settings full page when active   │ Runtime status │
│ Channels      │                                  │ Active skills  │
└───────────────┴──────────────────────────────────┴────────────────┘
```

布局职责：

- `app-shell`：占满窗口，居中承载 workspace。
- `workspace-window`：透明无边框窗口壳，负责 5px canvas inset。
- `AppTopBar`：统一顶栏和拖拽区，业务页面只注入 center/right slot。
- `workspace-sidebar-shell`：左侧栏，open/collapsed/drawer 三态。
- `workspace-center-column`：主内容列。
- `workspace-main-surface`：页面实际画布，负责 titlebar 避让。
- `workspace-monitor-shell`：右侧任务监控，open/collapsed/drawer 三态。

硬规则：

- `workspace-window` 内禁止用 flex gap 控制面板间距。
- 面板开合时，间距必须随面板宽度归零。
- 顶栏 drag 区和按钮 no-drag 区不能互相覆盖。
- 主内容不能被 fixed 顶栏或底部 composer 遮挡。

## 3. 响应式宽度

当前断点来自 `WorkspaceFrame.tsx`：

| 模式 | 宽度条件 | 布局 |
|---|---|---|
| full | `frameWidth >= 1040` 或未测量 | Sidebar + Main + Task Monitor |
| compact | `720 <= frameWidth < 1040` | Sidebar + Main，Task Monitor 改 drawer |
| single | `frameWidth < 720` | Main 优先，Sidebar/Monitor 改 drawer |

CSS 收紧规则：

| 条件 | 页面横向 padding |
|---|---:|
| 默认 | `--space-page-x` = 24px |
| `max-width: 900px` | 16px |
| `max-width: 640px` | 12px |

规则：

- 小窗口优先保留当前任务输入和阅读空间。
- compact/single 下隐藏文字按钮时，图标按钮必须保留 aria-label。
- Drawer 打开时必须有 backdrop 和关闭路径。
- 搜索、顶栏动作过多时先折叠次要文字，再隐藏低优先级动作。

## 4. 页面容器

共享页面容器：

| Class | 用途 |
|---|---|
| `.page-scroll` | 主页面滚动容器 |
| `.page-container` | 默认页面容器 |
| `.page-container-readable` | 长文/设置说明语义容器 |
| `.page-container-workbench` | 工作台类页面语义容器 |
| `.workspace-page-container` | 顶栏下方页面内容容器 |

规则：

- 页面容器铺满父宽度，不使用 `margin: 0 auto` 做二次居中。
- 可读宽度由内部内容控制，例如正文、说明、消息气泡。
- 页面级滚动只能发生在 `.page-scroll` 或明确的内部列表，不让 body 滚动。
- 嵌套滚动区必须有固定高度或 max-height，并使用 contained scroll。

## 5. TopBar 布局

TopBar 分三段：

```text
┌──────────────────────────────────────────────────────────────┐
│ left safe / controls │ center slot            │ right slot   │
└──────────────────────────────────────────────────────────────┘
```

规则：

- Chat 的 center slot 是会话标题和编辑入口。
- Cron / Skills / IM 等工作台页面可以把搜索和主要动作放入 right slot。
- 顶栏按钮高度不能撑大 `--size-titlebar`。
- 顶栏搜索宽度必须随布局收缩，不能挤压系统窗口按钮安全区。
- 顶栏中 disabled 能力必须显式 disabled，不允许空点击。

## 6. Chat / Cowork 页面

```text
┌──────────────────────────────────────────────────────────────┐
│ AppTopBar: ChatTitleSlot                         actions     │
├──────────────────────────────────────────────────────────────┤
│ Message timeline / empty welcome                            │
│                                                              │
│ streaming message / approval prompt / error inline           │
├──────────────────────────────────────────────────────────────┤
│ Composer                                                     │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ attachment cards / skill chips / cwd / context chips      │ │
│ │ textarea                                                  │ │
│ │ tool row / model selector / send                          │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

规则：

- 消息列表和 composer 是同一会话上下文，不能出现无 session 归属的全局消息区。
- Composer 固定在主画布底部视觉位置，消息区滚动。
- 附件过多时在 composer 内部滚动，不推走发送按钮。
- 流式消息只更新当前打开 session；后台 session 只更新列表摘要和未读。
- 权限审批 modal 覆盖当前工作台，但不能破坏会话滚动状态。

## 7. Sidebar

Sidebar 承载：

```text
Directory / current workspace
Tasks / Channels segment
Session or IM list
Settings / secondary actions
```

规则：

- Sidebar 宽度默认 216px，紧凑 204px。
- 当前目录、当前会话、当前 channel 必须有 active 状态。
- 列表项文本截断时提供 tooltip 或完整路径查看。
- Sidebar 折叠后，主区域左右视觉间距仍保持对称。
- Settings 入口属于次级操作，不和新任务主操作竞争。

## 8. Task Monitor

```text
┌────────────────────────────┐
│ Task Monitor header         │
├────────────────────────────┤
│ Runtime / session status    │
│ Active skills               │
│ Current approvals / tools   │
└────────────────────────────┘
```

规则：

- 宽度默认 248px，full 模式占位，compact/single 用 drawer。
- 每个 section 可折叠，header 必须 keyboard 可达。
- 空 section 显示短 empty hint，不留空白。
- 状态数字和 token 使用 tabular/mono。

## 9. Settings 页面

Settings 是全页面模式，进入后隐藏主侧栏，独占渲染。

```text
┌──────────────────────────────────────────────────────────────┐
│ Settings top area: back / title / optional actions            │
├───────────────┬──────────────────────────────────────────────┤
│ Settings nav  │ Current settings panel                       │
│ Preferences   │                                              │
│ Directory     │ Forms / cards / status / test result          │
│ Models        │                                              │
│ MCP           │                                              │
│ Memory        │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

规则：

- Settings 必须保留返回来源页的路径。
- 左侧设置导航项 active 清晰，禁用项说明原因。
- 表单保存、测试连接、同步配置等异步动作就近显示 loading/result/error。
- 复杂配置采用左列表 + 右详情，不在单列里无限堆叠。
- API key、token、路径等长字段必须支持复制、显示/隐藏和截断提示。

## 10. Models 页面

```text
┌──────────────────────────────────────────────────────────────┐
│ Title / subtitle                                              │
├─────────────────────┬────────────────────────────────────────┤
│ Provider list        │ Provider detail                        │
│ Preset providers     │ Base URL / API key / format            │
│ Custom providers     │ Test connection                        │
│ Add custom           │ Models list / default / capability      │
└─────────────────────┴────────────────────────────────────────┘
```

规则：

- Provider list 默认 260px 左列，窄屏改为单列堆叠。
- provider 状态使用文字 + 图标，不只靠颜色。
- 测试连接结果显示在按钮附近。
- model capability badge 不得使用未定义语义色；新增颜色先补 token。

## 11. MCP 页面

```text
┌──────────────────────────────────────────────────────────────┐
│ MCP status / bridge state / sync action                       │
├─────────────────────┬────────────────────────────────────────┤
│ Server list          │ Server detail                          │
│ enabled / disabled   │ command / args / env / tools           │
│ connection state     │ error / reconnect / tool preview       │
└─────────────────────┴────────────────────────────────────────┘
```

规则：

- server 连接状态必须区分 disabled、connecting、connected、failed。
- env 中敏感值默认隐藏。
- tool preview 是只读预览，不作为执行入口。
- bridge 不可用时显示恢复路径，例如重启 runtime、检查配置。

## 12. Memory 页面

```text
┌──────────────────────────────────────────────────────────────┐
│ Memory Search status / index state                           │
├─────────────────────┬────────────────────────────────────────┤
│ Sources / scopes     │ Detail / maintenance                   │
│ enabled folders      │ rebuild index / clear cache / errors   │
└─────────────────────┴────────────────────────────────────────┘
```

规则：

- index 状态必须显示最近更新时间、运行中、失败、禁用。
- 重建索引是高成本操作，要有确认和进度。
- 没有 memorySearch 能力时显示 disabled reason。

## 13. Skills 页面

```text
┌──────────────────────────────────────────────────────────────┐
│ TopBar: search / refresh / install                           │
├──────────────────────────────────────────────────────────────┤
│ Scope tabs / filters                                          │
├──────────────────────────────────────────────────────────────┤
│ Skill cards or rows                                           │
│ name / scope / enabled / source / actions                     │
└──────────────────────────────────────────────────────────────┘
```

规则：

- search 无结果时显示 empty state 和清空过滤动作。
- Skill enable/disable 的状态必须即时反馈，失败回滚。
- 安装或刷新时保持列表高度稳定。
- Skill 来源、scope、启用状态要可扫描。

## 14. Cron 页面

```text
┌──────────────────────────────────────────────────────────────┐
│ TopBar: search / refresh / create                            │
├──────────────────────────────────────────────────────────────┤
│ Task list                                                     │
│ name / schedule / next run / status / actions                 │
├──────────────────────────────────────────────────────────────┤
│ Edit dialog: trigger / prompt / directory / model / IM bind   │
└──────────────────────────────────────────────────────────────┘
```

规则：

- Cron 状态至少区分 enabled、disabled、running、failed。
- 下一次运行时间使用本地化时间格式。
- 创建/编辑 dialog 分组展示 trigger、execution、delivery。
- 删除或禁用任务需要确认，失败显示恢复动作。

## 15. IM 页面

```text
┌──────────────────────────────────────────────────────────────┐
│ TopBar: search / add instance                                │
├─────────────────────┬────────────────────────────────────────┤
│ Instance list        │ Instance detail / config               │
│ platform grouping    │ credentials / bind sessions / status   │
└─────────────────────┴────────────────────────────────────────┘
```

规则：

- 页面围绕 `im_instances` 建模，platform 只是筛选和分组。
- instance id 相关操作必须落在具体实例行或详情里。
- 凭据配置默认隐藏敏感值。
- 启停状态必须有 loading 和失败反馈。

## 16. Pet Window

```text
┌──────────────────────────┐
│ transparent window        │
│ ┌──────────────────────┐ │
│ │ PetCanvas             │ │
│ │ sprite / animation    │ │
│ │ bubble                │ │
│ └──────────────────────┘ │
└──────────────────────────┘
```

规则：

- Pet Window 不显示主工作台式卡片。
- bubble 文案短，不能遮挡宠物主体。
- 拖拽区域和点击区域必须清晰。
- 宠物状态来自 PetEventBridge，不直接理解各业务模块内部状态。

## 17. Z-index 层级

| 层级 | 建议值 | 用途 |
|---|---:|---|
| Base | 0 | 页面内容 |
| TopBar / panel header | 10-20 | 固定头部、局部浮层 |
| Inline popover | 20-60 | composer、selector、menu |
| Tooltip | 100 | 全局 tooltip |
| Drawer backdrop | 40-80 | 小窗 sidebar/monitor drawer |
| Modal / permission | 50-100 | 审批、dialog、wizard |

规则：

- 新增 z-index 必须说明所在层级，不使用随机大数。
- Modal 和 Tooltip 不应互相遮挡关键内容。
- Popover 不能被 drawer backdrop 覆盖。

## 18. 截图基线

影响以下页面外观时应更新截图：

- `desktop/chat/`
- `desktop/settings/`
- `desktop/skills/`
- `desktop/cron/`
- `desktop/im/`
- `desktop/pet-window/`

更新说明应包含：

```text
changed page
changed state: normal / loading / empty / error / disabled
viewport size
why visual change is intended
```
