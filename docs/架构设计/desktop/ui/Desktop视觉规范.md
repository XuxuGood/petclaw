# Desktop 视觉规范

本文档记录 PetClaw desktop 的视觉事实源。实现细节以代码为最终事实源；本规范把当前 `petclaw-desktop/src/renderer/src/index.css` 中已经稳定的 token、视觉取向和 UI 质量规则提炼为可执行约束。

外部参考图可放在本地 `docs/设计参考/references/`，只作风格参考，不能作为架构事实源。`docs/设计参考/` 不提交到仓库。

## 1. 视觉定位

PetClaw desktop 是长期驻留的本地 AI 协作工作台，不是营销页、内容社区或游戏主界面。视觉方向是：

- 克制、清晰、轻量：优先让任务、消息、审批和运行状态可扫描。
- 原生桌面质感：允许 macOS vibrancy、透明窗口和细边框，但不使用装饰性毛玻璃堆叠。
- 有宠物温度：Pet Window、空态、轻提示可以更柔和，但主工作台不做卡通化。
- 高密度但不拥挤：列表、设置项、任务监控可以紧凑，关键操作保留明确触达面积。
- 稳定优先：hover、loading、折叠、弹窗、流式输出不得造成布局跳动。

禁止方向：

- 不做紫蓝渐变、营销 hero、装饰 orb、bento 展示墙。
- 不把外部参考图直接当目标视觉稿复制。
- 不为单个页面临时发明独立色彩、圆角、阴影或字体体系。
- 不用 emoji 作为结构性图标。

## 2. 事实源顺序

视觉决策按以下顺序读取：

1. `petclaw-desktop/src/renderer/src/index.css` 中的 CSS token 和共享类。
2. 本文档、`Desktop组件规范.md`、`Desktop页面布局规范.md`。
3. 对应功能模块架构文档的 Renderer 布局章节。
4. 本地 `docs/设计参考/references/` 外部参考图。

如果本规范和代码不一致，先按代码实现判断当前事实，再同步文档或代码，不能让两者长期分叉。

## 3. 色彩系统

颜色必须优先使用 CSS token，不在组件里硬编码新的 hex。确需新增颜色时，先补 token，再说明语义。

### 3.1 基础色

| Token | 用途 |
|---|---|
| `--color-bg-root` | 应用根背景，偏暖浅灰，承托原生桌面质感 |
| `--color-workspace-base` | workspace-window 透明工作台底 |
| `--color-workspace-main` | 主画布实色面 |
| `--color-bg-card` | 卡片和设置 panel |
| `--color-bg-popover` | popover / menu，必须是不透明白底 |
| `--color-bg-input` | 输入框和弱容器 |
| `--color-bg-hover` | 页面级 hover 状态层 |
| `--color-bg-active` | 页面级 active / selected 状态层 |

`--color-bg-popover` 不得改回半透明。弹窗内容需要稳定可读，不能让底层边框、focus ring 或列表 hover 透进来污染内部层级。

### 3.2 文本色

| Token | 用途 | 规则 |
|---|---|---|
| `--color-text-primary` | 标题、正文主信息、选中项 | 常规正文必须满足 WCAG AA |
| `--color-text-secondary` | 可交互辅助信息、图标按钮常态 | 可点击文本/图标最低使用 secondary |
| `--color-text-tertiary` | 装饰性弱辅助、meta、empty desc | 不承载关键操作语义 |
| `--color-text-disabled` | 禁用态文本/图标 | 只用于 disabled，不用于普通说明 |
| `--color-text-bubble-ai` | AI 消息正文 | AI 气泡专用 |
| `--color-text-bubble-user` | 用户消息正文 | 用户深色气泡专用 |

规则：

- 用户可读正文、按钮文字、表单 label、错误提示必须满足 4.5:1 对比度。
- 只要元素可交互，静态态图标和文字不能低于 `secondary`。
- `tertiary` 只能用于弱说明和 meta；不要拿它做按钮、链接或关键状态。
- 禁用态必须同时有语义属性和视觉降权，不能只是颜色变淡。

### 3.3 品牌与语义色

| Token | 用途 |
|---|---|
| `--color-accent` / `--color-accent-hover` | 主操作、当前强选中、用户气泡 |
| `--color-brand` / `--color-brand-hover` / `--color-brand-soft` | 品牌相关、连接状态强调、非主 CTA |
| `--color-warm` / `--color-warm-soft` | 宠物温度、拖放高亮、轻提示 |
| `--color-success` | 成功状态图标和简短标签 |
| `--color-error` | 错误状态、失败状态、危险提示 |
| `--color-warning` | 警告、上下文容量危险阶段 |
| `--color-danger-*` | 权限审批危险级别和破坏性操作 |
| `--color-caution-*` | 需谨慎审批、警告卡片 |
| `--color-safe-*` | 安全审批、已启用 skill chip |

规则：

- 成功、错误、警告不能只靠颜色表达，必须配合文字或图标。
- `danger/caution/safe` 是审批和风险分级语义，不要随意拿来装饰。
- 新增彩色 badge 必须先判断是否已有语义 token；没有语义时使用中性色。

## 4. 字体与排版

当前字体事实源：

```text
--font-sans:
  'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', system-ui, sans-serif;
--font-mono:
  'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace;
```

PetClaw 是 Electron 桌面工具，字体优先保证系统一致性和中英混排稳定；不要为了“设计感”引入远程字体或大体积字体包。

### 4.1 字号层级

| 层级 | 字号 | 行高 | 字重 | 用途 |
|---|---:|---:|---:|---|
| Page title | 28px | 1.15 | 800 | 页面首屏标题，少量使用 |
| Settings title | 20px | 1.25 | 700 | 设置页、配置页标题 |
| Section title | 14px | 1.45 | 650 | 卡片标题、分组标题 |
| Body | 13.5px | 1.6-1.65 | 400-500 | 消息正文、说明文本 |
| Control | 13px | 1.4 | 500-600 | 按钮、输入、列表主文本 |
| Meta | 12px | 1.45-1.5 | 500-600 | badge、状态、辅助说明 |
| Tiny label | 10-11px | 1.3 | 600-700 | 大写标签、短状态，不放长句 |
| Mono data | 11-13px | 1.45 | 400-600 | path、model id、token、数字 |

规则：

- 正文不低于 12px；长段说明优先 13px 或 13.5px。
- 10px 只用于极短 label，不用于解释性文案。
- 长路径、模型 ID、端口、token、计数使用 mono 或 tabular figures。
- 字间距保持 `0`，只允许 tiny uppercase label 使用极小正 letter spacing。
- 截断必须有 tooltip、展开或可复制路径，不能丢失关键信息。

## 5. 间距系统

PetClaw 使用 4px / 8px 节奏，但工作台最外层存在 5px 画布 inset 的特殊设计。

### 5.1 全局布局 token

| Token | 值 | 用途 |
|---|---:|---|
| `--size-titlebar` | 44px | 顶栏高度和窗口拖拽安全区 |
| `--size-sidebar` | 216px | 左侧栏宽度 |
| `--size-sidebar-compact` | 204px | 紧凑侧栏宽度 |
| `--size-monitor-panel` | 248px | 右侧任务监控宽度 |
| `--size-traffic-safe` | 92px | macOS traffic light 安全距离 |
| `--space-canvas-inset` | 5px | 工作台外壳四边 inset |
| `--space-panel-gutter` | 5px | 侧栏/监控与主画布间距 |
| `--space-page-x` | 24px | 页面水平内边距 |
| `--space-page-y` | 20px | 页面垂直内边距 |
| `--content-readable-max` | 760px | 长文可读宽度参考 |
| `--content-wide-max` | 1040px | 设置页宽内容参考 |
| `--content-workbench-max` | 1180px | 工作台宽内容参考 |

`workspace-window` 内禁止使用 flex gap 控制三栏间距。面板间距由面板自己的 margin 负责，折叠态必须同步归零，避免侧栏折叠后残留视觉偏移。

### 5.2 内容间距

| Token | 值 | 用途 |
|---|---:|---|
| `--gap-topbar-tools` | 8px | 顶栏按钮、搜索、操作组之间 |
| `--gap-card` | 12px | 卡片之间、小节块之间 |
| `--gap-card-inner` | 16px | 卡片内部主间距 |
| `--gap-section` | 20px | 页面 section 之间 |

规则：

- 页面容器的左右留白只能由 `--space-page-x` 提供，不叠加 auto margin 二次居中。
- 長文可读宽度由内部正文元素控制，不通过页面容器整体限宽实现。
- 控件之间至少 8px 间距；图标按钮视觉尺寸小于 32px 时必须扩大 hit area。

## 6. 尺寸与圆角

### 6.1 控件尺寸

| Token | 值 | 用途 |
|---|---:|---|
| `--ctrl-sm` | 28px | 面板折叠、标题编辑等小控制 |
| `--ctrl-md` | 32px | 常规按钮、popover row、输入附属按钮 |
| `--ctrl-lg` | 36px | 主按钮、重要表单操作 |
| `--size-control-min` | 32px | desktop 鼠标主控件最低视觉高度 |
| `--size-touch-min` | 44px | 需要触摸/小窗兼容的最低点击高度 |

### 6.2 圆角层级

| Token / 值 | 用途 |
|---|---|
| `4px` | 复选框、小状态块、细小标记 |
| `--radius-chip` / 6px | chip、badge、菜单内小项 |
| `--radius-default` / 8px | 按钮、输入框、列表项、普通卡片 |
| `--radius-lg` / 10px | 重要卡片、popover、小弹窗 |
| `12px` | 主内容大容器、品牌/空态图标最大常规半径 |
| `14px` | 最外层无边框窗口壳 |
| `--radius-pill` / 999px | 搜索框、toggle、状态点、真实 pill CTA |

除头像、状态点、toggle、搜索框和 pill CTA 外，新增 UI 不应使用 `rounded-full` 表达普通控件圆角。

## 7. 阴影、边框与透明

| Token | 用途 |
|---|---|
| `--shadow-card` | 普通卡片，低存在感 |
| `--shadow-dropdown` | popover、menu、hover card |
| `--shadow-workspace` | 最外层 workspace window |

规则：

- 主工作台依赖原生 vibrancy 和低对比边框，不用重阴影堆层级。
- `ui-card` 使用 `--color-bg-card` + `--color-border`，不私加大阴影。
- `ui-popover` 使用不透明白底 + dropdown shadow，确保浮层可读。
- `ui-tooltip` 使用深色背景，与白底 popover 区分语义。
- `ui-glass` 只用于明确需要背景感知的轻容器；不要在 modal、popover、表单主面板里叠 glass。

## 8. 图标

- 默认使用项目已启用的 Lucide 图标。
- 同一层级图标 strokeWidth 保持一致，常规为 `1.9` 或 `2`。
- 顶栏和面板控制常用 14-16px 图标；列表行常用 12-16px；空态图标可放大到 32-48px。
- icon-only button 必须有 `aria-label` 或 `title`，并通过 Tooltip 或可见文本解释不熟悉动作。
- 图标颜色走 `text-primary/secondary/tertiary` 或语义 token，不使用随机彩色图标。
- 不使用 emoji 作为导航、设置、状态、工具、审批图标。

## 9. 动效

| Token | 值 | 用途 |
|---|---:|---|
| `--motion-fast` | 120ms | hover、focus、pressed、tooltip 进入 |
| `--motion-base` | 180ms | 折叠、状态切换、chip 展开 |
| `--motion-slow` | 240ms | drawer、modal、较大面板过渡 |

规则：

- 动效只表达状态变化、层级变化或任务反馈，不做纯装饰。
- 优先动画 `opacity`、`transform`、`background-color`、`border-color`；避免动画 `width/height/top/left`，除非已有明确布局约束。
- pressed feedback 必须在 100ms 内可感知。
- loading 超过 300ms 必须展示 spinner、skeleton 或 inline loading。
- 长列表不要给每行复杂入场动画。
- 需要支持 `prefers-reduced-motion`；新增复杂动画时必须定义降级。

## 10. 可访问性与可读性

- 正文和交互文本对比度最低 4.5:1；大图标和粗线图形最低 3:1。
- focus ring 必须可见，统一使用 `.ui-focus:focus-visible` 或同等样式。
- 键盘焦点顺序必须跟视觉顺序一致。
- 图标按钮必须有可读标签。
- 错误、成功、警告必须包含文字，不能只靠颜色。
- Toast、异步错误、审批请求等动态消息需要可被屏幕阅读器感知，使用 `aria-live` 或等效机制。
- 用户可见文案仍以 i18n 为事实源，本规范不定义业务文案。

## 11. 更新规则

- 修改 token 前先查所有使用点，确认不会破坏 workspace、popover、composer、settings 页面。
- 新增共享类时，同步 `Desktop组件规范.md` 或 `Desktop页面布局规范.md`。
- 新增视觉语义 token 时，同步本文的色彩、动效、尺寸或层级表。
