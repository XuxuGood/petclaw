# Desktop 组件规范

本文档记录 PetClaw desktop 组件级视觉和交互规范。组件状态来源、IPC 调用和错误处理见 `docs/架构设计/desktop/foundation/Renderer架构设计.md` 和对应功能模块文档；本文只约束组件如何呈现、响应和降级。

## 1. 通用组件原则

- 所有可见按钮必须有真实行为；未接入能力必须 disabled 或隐藏。
- loading、empty、error、disabled、selected、hover、focus、pressed 状态必须可见。
- 组件视觉优先复用 `index.css` 中已有 token 和共享类。
- 交互组件必须带语义元素或 ARIA role；不要用裸 `div` 模拟按钮。
- 所有用户可见文案走 i18n。
- icon-only 控件必须提供 `aria-label`，必要时配 Tooltip。
- 破坏性操作必须与普通操作空间分离，并使用 danger 语义。
- 组件不得因异步内容加载改变外层布局尺寸；需要预留空间或使用 skeleton。

## 2. 状态矩阵

| 状态 | 视觉要求 | 交互要求 |
|---|---|---|
| Rest | 使用默认 token，层级克制 | 可点击元素有 pointer cursor |
| Hover | 背景或文字提升一级 | 不依赖 hover 暴露唯一关键操作 |
| Pressed | 100ms 内有反馈，可用 active 背景或轻 scale | 不改变外层布局 |
| Focus | `.ui-focus:focus-visible` 或同等 focus ring | 键盘可达，顺序符合视觉 |
| Selected | `bg-active` + primary text 或专用 selected 类 | 有 `aria-selected` / `aria-current` |
| Loading | spinner、progress、skeleton 或内联状态 | 禁止重复提交，必要时 disabled |
| Empty | 图标/标题/说明/下一步操作 | 不显示空白面板 |
| Error | 错误原因 + 恢复动作 | 提供 retry、edit、open settings 等路径 |
| Disabled | disabled 属性 + `text-disabled` / opacity | 无点击效果，无空 onClick |

## 3. Button

### 3.1 类型

| 类型 | 用途 | 视觉 |
|---|---|---|
| Primary | 页面主操作、确认、创建 | `bg-accent` / white text / hover accent-hover |
| Secondary | 次要确认、局部操作 | 中性边框或弱背景 |
| Ghost | 顶栏、列表行、轻操作 | 透明底，hover 使用 `workspace-state-hover` |
| Icon | 折叠、刷新、更多、关闭 | 32px 或 28px 控制，必须有 aria-label |
| Pill | 顶栏 CTA、短标签动作 | `radius-pill`，文字短，不能塞长句 |
| Danger | 删除、拒绝、移除敏感配置 | danger token，空间上远离 primary |

### 3.2 尺寸

- 面板控制：`panel-toggle`，28px，圆角 7px。
- 常规图标按钮：`ui-icon-button`，32px。
- 主图标按钮：`ui-primary-icon-button`，32px，pill。
- 顶栏按钮：`topbar-btn`，高度遵循顶栏密度，不撑高 titlebar。
- 小窗或触摸风险区域：最小 hit area 44px。

### 3.3 行为

- async 按钮点击后必须进入 loading 或 disabled，防止重复提交。
- loading 状态保留按钮宽度，避免文字切换导致跳动。
- 禁用按钮不显示 hover/active。
- 只有一个主要 CTA；同一区域多按钮时，主次关系必须明显。

## 4. Input / Search / Textarea

### 4.1 基础输入

- 输入框背景使用 `--color-bg-input` 或白底，边框使用 `--color-border-input`。
- label 必须可见；placeholder 只能做示例，不能替代 label。
- helper text 放在字段附近，错误信息放在对应字段下方。
- 错误态必须说明原因和修复方式。
- 密码/API key 输入必须支持隐藏敏感值，明文展示需要用户动作。

### 4.2 Search

- 顶栏搜索使用 `topbar-search-field` / `topbar-search-input` 语言。
- 搜索框应有搜索图标和 placeholder，placeholder 走 i18n。
- 清空按钮出现时不得挤压输入文字。
- 搜索过滤无结果时显示 empty state，不显示空列表。

### 4.3 Composer

聊天输入壳使用 `composer-shell`：

- Rest：白底 + 低强度边框和阴影。
- Hover：边框提升到 input border。
- Focus：使用 ring，不只改变边框。
- Disabled：整体 opacity 降权并阻断指针。
- Dragging：虚线边框 + warm-soft 背景。

附件和引用：

- 文件/目录/图片使用 `composer-file-card` 或 `composer-ref-chip`。
- skill chip 使用 safe 语义 token。
- remove 按钮常态可以降权，但 hover 和 focus 必须可见。
- 附件过多时在 composer 内部滚动，不把底部工具条挤出视口。

## 5. Select / Popover / Menu

Popover 使用 `.ui-popover`：

- z-index 默认 60。
- 背景必须是 `--color-bg-popover` 不透明白。
- 内部 row 使用 `.ui-popover-row`，双行使用 `.ui-popover-row-2l`。
- active 使用 `.ui-popover-row-active`。
- disabled row 使用 disabled token，hover 不变色。
- 分隔线使用 `.ui-popover-divider`。
- 空态使用 `.ui-popover-empty`，包含 title 和 desc。

规则：

- Popover 不能超出窗口可视区域；需要根据触发器位置选择上/下/左/右。
- Menu 项的图标、文字、快捷信息、badge 对齐必须稳定。
- 嵌套 flyout 只用于短列表；复杂配置必须进入页面或 dialog。

## 6. Card / Panel / Row

### 6.1 Card

- 普通卡片使用 `.ui-card`。
- 可点击卡片使用 `.ui-card-action`。
- 卡片圆角默认 10px；内部按钮仍按按钮规范，不跟随卡片放大。
- 卡片内分组间距使用 12/16/20px 体系。
- 卡片嵌套卡片要谨慎；优先用 section、divider、row 表达层级。

### 6.2 Row

- 通用行按钮使用 `.ui-row-button`。
- row selected 使用 `.ui-row-button-active`。
- 列表行高度一般不低于 32px；含开关、平台图标、双行说明时不低于 44px。
- 行内尾部操作默认可以弱化，但键盘 focus 时必须出现。
- 长文本优先 truncation + tooltip；错误信息优先 wrap。

### 6.3 Segment

- 分段控件使用 `.ui-segment` / `.ui-segment-button`。
- 同一 segment 内选项数量建议 2-4 个。
- selected 要有背景和字重变化，不只靠颜色。

## 7. Badge / Chip / Status

| 类型 | 用途 | 规则 |
|---|---|---|
| Badge | 短状态、数量、能力标记 | 10-12px，短文本，不放句子 |
| Chip | 已选资源、过滤条件、skill | 可移除 chip 必须有可见/focus 可见 remove |
| Status dot | 在线、运行、失败 | 必须配文字或 tooltip |
| Risk badge | 审批危险等级 | 使用 danger/caution/safe token |

规则：

- 不用颜色单独表达状态。
- 大写 label 只用于短词，letter spacing 只能轻微正值。
- 数字状态使用 tabular figures。

## 8. Dialog / Modal / Sheet

### 8.1 基础规则

- Dialog 必须有标题、关闭/取消路径、主操作和错误展示位置。
- 关闭按钮必须是语义 button，带 aria-label。
- 打开后 focus 进入 dialog；关闭后 focus 返回触发器。
- Esc 可关闭非强制 dialog；强制审批类 dialog 要明确原因。
- 背景使用 scrim，前景必须足够可读。
- 内容过长时 dialog 内部滚动，头部和底部操作保持稳定。

### 8.2 权限审批

权限审批 UI 是高风险组件：

- 全局 FIFO 队列一次只展示一个审批。
- 必须显示 tool 名称、风险级别、请求来源和用户可理解的输入摘要。
- allow / deny / edit input 的视觉层级必须清楚。
- danger 操作不能和 allow 主按钮贴在一起。
- 多问题表单使用 wizard 时必须显示进度，允许返回修改。
- 提交后禁用按钮并显示 loading。

### 8.3 表单 Dialog

- 字段分组必须清楚，复杂选项使用 progressive disclosure。
- 测试连接、保存配置、添加 provider 等异步动作必须显示结果。
- 关闭含未保存改动的 dialog 前必须确认或保留草稿。

## 9. Tooltip

Tooltip 使用 `.ui-tooltip`：

- 承载瞬态解释、完整路径、截断全文、图标按钮说明。
- 深色背景 + 白字，与白底 popover 区分。
- 不承载复杂交互；需要点击选择时用 popover。
- 长路径允许 `word-break: break-all`，不能撑出屏幕。
- Tooltip 不应替代 aria-label。

## 10. Loading / Empty / Error

### 10.1 Loading

- 小区域使用 inline spinner。
- 列表或卡片加载超过 300ms 使用 skeleton 或稳定占位。
- 页面初始化 loading 必须保留页面结构，不闪烁空白。
- 流式输出使用 typing / streaming 状态，不阻断已生成内容阅读。

### 10.2 Empty

Empty state 至少包含：

```text
icon / visual anchor
title
description
primary recovery action or next step
```

如果能力未接入，必须 disabled 或隐藏入口，不能显示空操作。

### 10.3 Error

Error state 至少包含：

```text
what failed
why user may care
how to recover
retry / settings / details action
```

错误不能只 `console.error`。用户可见失败必须出现在相关区域附近。

## 11. Navigation Components

- 主导航在 Sidebar，Settings 内部有自己的二级导航。
- 当前页面必须有 active 状态。
- 返回 Settings 来源页时保留 `previousView` 语义，不跳回默认首页。
- Sidebar 折叠和 drawer 模式必须保留打开入口。
- 深层配置 dialog 不承担主导航职责。

## 12. Accessibility Checklist

组件交付前检查：

- 所有 icon-only button 有 `aria-label`。
- 所有表单字段有可见 label。
- focus ring 可见且不被 overflow 裁掉。
- 键盘能打开、操作并关闭 popover/dialog。
- 错误信息能被读屏感知。
- disabled 使用真实 `disabled` 或 `aria-disabled`。
- 可点击目标视觉尺寸小于 32px 时扩展 hit area。
- 颜色不是唯一状态信号。

## 13. 新组件准入

新增共享组件或共享 class 前必须回答：

1. 是否已有 `.ui-*`、`.topbar-*`、`.workspace-*`、`.composer-*` 可复用？
2. 是否覆盖 rest、hover、pressed、focus、disabled、loading、error？
3. 是否需要 i18n、aria-label、tooltip 或 aria-live？
4. 是否在小窗口和长文本下保持尺寸稳定？
5. 是否同步本文档或视觉规范？
