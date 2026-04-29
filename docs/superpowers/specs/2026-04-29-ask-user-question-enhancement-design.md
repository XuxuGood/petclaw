# AskUserQuestion 功能完善设计

对比 LobsterAI 参考实现，补齐 PetClaw 的 ask-user-question 扩展在 UI、状态管理、安全展示三个维度的缺失功能。

## 1. 背景与目标

PetClaw 的 ask-user-question 扩展核心链路（extension → HTTP callback → McpBridgeServer → IPC → preload → renderer）已完整，但 UI 层和状态管理存在 6 个差距：

| 优先级 | 缺失项 | 影响 |
|--------|--------|------|
| 🔴 高 | CoworkQuestionWizard 向导组件 | 多问题堆叠展示，体验差 |
| 🔴 高 | 全局队列式权限状态管理 | 并发请求覆盖丢失，视图切换弹窗消失 |
| 🔴 高 | onPermissionDismiss 全局生效 | 超时后弹窗常驻 |
| 🟡 中 | dangerReason 文案展示 | 用户不知道为什么危险 |
| 🟡 中 | 权限弹窗全局化 | 切换到设置/IM 视图后弹窗消失 |
| 🟢 低 | radio/checkbox 视觉差异 | 单选/多选无法区分 |

目标：一次性补齐全部 6 项，对齐 LobsterAI 功能完整度。

## 2. 架构变更：全局权限状态管理

### 2.1 新建 `usePermissionStore` (Zustand)

文件：`src/renderer/src/stores/permission-store.ts`

```ts
interface PermissionRequest {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId?: string | null
}

interface PermissionState {
  pendingPermissions: PermissionRequest[]
  enqueue: (request: PermissionRequest) => void
  dequeue: (requestId?: string) => void
  clear: () => void
}
```

**行为：**
- `enqueue`：按 `requestId` 去重后追加到队列尾部
- `dequeue(requestId)`：精确删除匹配项；无参数时 shift 队首
- `clear`：清空全部（会话中止时使用）
- 暴露计算 getter `firstPending`：`state.pendingPermissions[0] ?? null`

### 2.2 全局权限监听 Hook

文件：`src/renderer/src/hooks/use-permission-listener.ts`

```ts
export function usePermissionListener(): void
```

- 在 App 顶层调用一次
- `useEffect` 内订阅 `window.api.cowork.onPermission` → `store.enqueue()`
- `useEffect` 内订阅 `window.api.cowork.onPermissionDismiss` → `store.dequeue(requestId)`
- cleanup 时取消两个订阅

### 2.3 ChatView 移除权限相关状态

从 `ChatView.tsx` 中移除：
- `pendingPermission` useState
- `onPermission` / `onPermissionDismiss` useEffect 订阅
- `CoworkPermissionModal` 渲染

### 2.4 App 顶层弹窗渲染

在 `src/renderer/src/App.tsx` 中：

**关键约束：** Settings 视图是提前 return，不走三栏布局。弹窗必须在所有分支之外渲染，确保任何视图下都可见。

```tsx
export function App() {
  usePermissionListener()
  const firstPending = usePermissionStore(s => s.pendingPermissions[0] ?? null)

  // 权限弹窗在所有视图分支之上，用 fragment 包裹
  const permissionOverlay = firstPending
    ? <PermissionModalRouter permission={firstPending} />
    : null

  if (phase === 'bootcheck') {
    return <>{permissionOverlay}<BootCheckPanel ... /></>
  }

  if (phase === 'onboarding') {
    return <>{permissionOverlay}<OnboardingPanel ... /></>
  }

  if (activeView === 'settings') {
    return <>{permissionOverlay}<SettingsPage ... /></>
  }

  return (
    <>
      {permissionOverlay}
      <div className="w-full h-full flex ...">
        {/* 三栏布局 */}
      </div>
    </>
  )
}
```

`PermissionModalRouter` 根据 `toolName` 和 `questions.length` 决定渲染：
- `toolName === 'AskUserQuestion'` 且 `questions.length > 1` → `<CoworkQuestionWizard />`
- 其他 → `<CoworkPermissionModal />`（保持现有三种子模式逻辑）

## 3. CoworkQuestionWizard 向导组件

文件：`src/renderer/src/views/chat/CoworkQuestionWizard.tsx`

### 3.1 功能清单

| 功能 | 说明 |
|------|------|
| 分步展示 | 每次只显示一个问题 |
| 进度条 | 顶部 `(currentStep + 1) / totalSteps` 比例填充 |
| 步骤圆点 | 编号圆点可点击跳转，已答变绿 + ✓ |
| 上一步/下一步 | ChevronLeft / ChevronRight 按钮 |
| 单选自动前进 | 选中后 150ms 延迟自动跳下一题 |
| 多选 checkbox | 多选用 checkbox 图标，单选用 radio 图标 |
| "其他"输入 | 每道题底部附带自由文本输入框 |
| "跳过" | 可跳过当前题，不强制填答 |
| 提交守卫 | 所有问题有答案才可提交 |
| 关闭 = deny | 点击 X 返回 `{ behavior: 'deny' }` |

### 3.2 UI 布局

```
┌─────────────────────────────────────────────────┐
│ ████████░░░░░░░░░░  进度条 (h-1 bg-accent)      │
│                                                  │
│  需要您的确认                           [X]      │
│                                                  │
│  ① ● ③ ④   步骤圆点导航                        │
│                                                  │
│  [header badge]                                  │
│  问题内容                                        │
│                                                  │
│  ○ 选项A                                        │
│     选项描述文字                                  │
│  ● 选项B  ← 选中 (accent 高亮)                  │
│     选项描述文字                                  │
│  ○ 选项C                                        │
│     选项描述文字                                  │
│                                                  │
│  其他: [________________]                        │
│                                                  │
│  [跳过]              [← 上一步] [下一步 →]       │
│                      (最后一步: [提交])           │
└─────────────────────────────────────────────────┘
```

### 3.3 设计规范（遵循项目 Design Token）

| 属性 | 值 | 说明 |
|------|-----|------|
| 弹窗宽度 | `w-[520px]` | 比 MultiQuestionModal 略宽，适应分步内容 |
| 弹窗最大高度 | `max-h-[80vh]` | 防止超出视口 |
| 圆角 | `rounded-[14px]` | 项目规范 radius-lg |
| 背景 | `bg-bg-root` | 项目 token |
| overlay | `bg-overlay` | 项目 token rgba(0,0,0,0.4) |
| z-index | `z-50` | 与现有 Modal 一致 |
| 进度条高度 | `h-1` | 细长进度条 |
| 进度条颜色 | `bg-accent` | 与主色一致 |
| 进度条背景 | `bg-bg-hover` | 未填充部分 |
| 步骤圆点尺寸 | `w-7 h-7` | 28px，满足 touch target + 视觉清晰 |
| 步骤圆点 - 当前 | `bg-accent text-white` | 高亮当前步 |
| 步骤圆点 - 已答 | `bg-success/10 text-success` + ✓ | 绿色已完成 |
| 步骤圆点 - 未答 | `bg-bg-hover text-text-tertiary` | 灰色未达 |
| 选项按钮高度 | 最小 `min-h-[44px]` | 满足可点击区域要求 |
| 选项按钮 - 选中 | `bg-accent/10 border-accent/30 text-accent` | 与现有一致 |
| 选项按钮 - 未选 | `bg-bg-hover text-text-secondary border-transparent` | 与现有一致 |
| radio 图标 | 未选 `○` 选中 `●` | 16px 圆形，accent 色 |
| checkbox 图标 | 未选 `☐` 选中 `☑` | 16px 方形，accent 色 |
| "其他"输入框 | `bg-bg-input border-border-input rounded-[10px]` | 项目 token |
| 按钮交互 | `active:scale-[0.96] duration-[120ms]` | 项目统一交互规范 |
| 动画 | `transition-all duration-200 ease-out` | 步骤切换淡入淡出 |

### 3.4 交互细节

**步骤切换动画：**
- 使用 `opacity` + `translateX` 过渡：向前时内容从右淡入，向后时从左淡入
- 持续时间 200ms，ease-out 缓动

**单选自动前进：**
- 选中后视觉反馈立即生效
- 150ms 后 `setTimeout` 跳转下一题
- 若已是最后一题则不自动前进

**"其他"输入与选项互斥：**
- 在"其他"输入框输入文字时，清除当前问题的选项选择
- 选择选项时，清除"其他"输入框内容
- 提交时优先使用选项值，若无选项则使用"其他"文本

**键盘支持：**
- Enter 提交（最后一步）或前进（非最后一步）
- Escape 关闭弹窗 (deny)
- Tab 在选项间导航

## 4. dangerReason 文案展示

### 4.1 i18n 新增

在 `petclaw-shared/src/i18n/locales/{zh,en}.ts` 中新增：

```ts
// zh
'dangerReason.fileDelete': '文件删除操作',
'dangerReason.recursiveDelete': '递归删除操作（不可恢复）',
'dangerReason.gitForcePush': 'Git 强制推送',
'dangerReason.gitResetHard': 'Git 硬重置（丢弃本地修改）',
'dangerReason.diskOverwrite': '磁盘写入操作',
'dangerReason.diskFormat': '磁盘格式化操作',
'dangerReason.gitClean': 'Git 清理未跟踪文件',
'dangerReason.findDelete': '批量查找删除',
'dangerReason.processKill': '终止进程',
'dangerReason.permissionChange': '权限变更操作',
'dangerReason.gitPush': 'Git 推送',

// en
'dangerReason.fileDelete': 'File deletion',
'dangerReason.recursiveDelete': 'Recursive deletion (irreversible)',
'dangerReason.gitForcePush': 'Git force push',
'dangerReason.gitResetHard': 'Git hard reset (discards local changes)',
'dangerReason.diskOverwrite': 'Disk write operation',
'dangerReason.diskFormat': 'Disk format operation',
'dangerReason.gitClean': 'Git clean untracked files',
'dangerReason.findDelete': 'Batch find & delete',
'dangerReason.processKill': 'Process termination',
'dangerReason.permissionChange': 'Permission change',
'dangerReason.gitPush': 'Git push',
```

### 4.2 UI 展示

在 `CoworkPermissionModal` 的确认模式和标准审批模式中，当 `dangerLevel !== 'safe'` 且 `toolInput.dangerReason` 存在时，在标题栏下方添加危险原因警告条：

```
┌─────────────────────────────────────────────────┐
│ 🛡 需要权限确认                          [X]    │  ← 标题栏（现有）
├──────────���──────────────────────────────────────┤
│ ⚠ 递归删除操作（不可恢复）                      │  ← 新增：危险原因条
├─────────────────────────────────────────────────┤
│ 工具名 / 命令预览 ...                           │  ← 内容区（现有）
```

**样式规范：**

| 等级 | 背景 | 边框 | 图标色 |
|------|------|------|--------|
| destructive | `bg-danger-bg` | `border-danger-border` | `text-danger-icon` |
| caution | `bg-caution-bg` | `border-caution-border` | `text-caution-icon` |

**reason → i18n key 映射表**：`DANGER_REASON_I18N_MAP`，位于 `CoworkPermissionModal.tsx` 顶部。

## 5. radio/checkbox 视觉差异

在 `MultiQuestionModal`（现有）和 `CoworkQuestionWizard`（新增）中：

**单选题选项：**
```tsx
<span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center mr-3 flex-shrink-0 ${
  isSelected ? 'border-accent bg-accent' : 'border-text-tertiary'
}`}>
  {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
</span>
```

**多选题选项：**
```tsx
<span className={`w-4 h-4 rounded-[3px] border-2 flex items-center justify-center mr-3 flex-shrink-0 ${
  isSelected ? 'border-accent bg-accent' : 'border-text-tertiary'
}`}>
  {isSelected && <Check size={10} className="text-white" />}
</span>
```

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 新增 | `src/renderer/src/stores/permission-store.ts` | Zustand 权限队列 store |
| 新增 | `src/renderer/src/hooks/use-permission-listener.ts` | 全局 IPC 监听 hook |
| 新增 | `src/renderer/src/views/chat/CoworkQuestionWizard.tsx` | 多问题分步向导组件 |
| 修改 | `src/renderer/src/views/chat/CoworkPermissionModal.tsx` | 添加 dangerReason 展示 + radio/checkbox 图标 |
| 修改 | `src/renderer/src/views/chat/ChatView.tsx` | 移除权限相关 state 和弹窗渲染 |
| 修改 | `src/renderer/src/App.tsx` | 添加 usePermissionListener() + 弹窗路由 |
| 修改 | `petclaw-shared/src/i18n/locales/zh.ts` | 新增 dangerReason + wizard i18n key |
| 修改 | `petclaw-shared/src/i18n/locales/en.ts` | 同上 |
| 新增 | `tests/renderer/stores/permission-store.test.ts` | store 单元测试 |
| 新增 | `tests/renderer/views/chat/CoworkQuestionWizard.test.ts` | wizard 组件测试 |

## 7. 不做的事

- **不改 `command-safety.ts`** — 已完整，无需修改
- **不改 extension 层** — `openclaw-extensions/ask-user-question/index.ts` 无需改动
- **不改 McpBridgeServer** — HTTP 服务端已完整
- **不改 preload** — IPC API 已暴露
- **不改 config-sync** — 配置同步已完整
- **不改 managed-prompts** — Agent 行为约束已完整
