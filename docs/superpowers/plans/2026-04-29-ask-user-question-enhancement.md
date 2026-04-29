# AskUserQuestion 功能完善实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 PetClaw ask-user-question 的 6 项缺失功能：全局权限队列、CoworkQuestionWizard 向导、dangerReason 文案、弹窗全局化、radio/checkbox 图标、dismiss 全局生效。

**Architecture:** 新建 Zustand `usePermissionStore` 管理权限请求队列，新建 `usePermissionListener` hook 在 App 顶层订阅 IPC 事件，将弹窗渲染从 ChatView 提升到 App.tsx，新建 CoworkQuestionWizard 分步向导组件处理多问题场景。

**Tech Stack:** React 18, Zustand, Tailwind CSS v4, Lucide Icons, Electron IPC

**Spec:** `docs/superpowers/specs/2026-04-29-ask-user-question-enhancement-design.md`

---

### Task 1: 新建 usePermissionStore (Zustand)

**Files:**
- Create: `petclaw-desktop/src/renderer/src/stores/permission-store.ts`
- Test: `petclaw-desktop/tests/renderer/stores/permission-store.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/renderer/stores/permission-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { usePermissionStore } from '../../../src/renderer/src/stores/permission-store'

const makeRequest = (id: string) => ({
  requestId: id,
  toolName: 'AskUserQuestion',
  toolInput: { questions: [] },
  toolUseId: null
})

describe('usePermissionStore', () => {
  beforeEach(() => {
    usePermissionStore.getState().clear()
  })

  it('enqueue 追加到队列尾部', () => {
    const store = usePermissionStore.getState()
    store.enqueue(makeRequest('a'))
    store.enqueue(makeRequest('b'))
    expect(usePermissionStore.getState().pendingPermissions).toHaveLength(2)
    expect(usePermissionStore.getState().pendingPermissions[0].requestId).toBe('a')
    expect(usePermissionStore.getState().pendingPermissions[1].requestId).toBe('b')
  })

  it('enqueue 按 requestId 去重', () => {
    const store = usePermissionStore.getState()
    store.enqueue(makeRequest('a'))
    store.enqueue(makeRequest('a'))
    expect(usePermissionStore.getState().pendingPermissions).toHaveLength(1)
  })

  it('dequeue 精确删除指定 requestId', () => {
    const store = usePermissionStore.getState()
    store.enqueue(makeRequest('a'))
    store.enqueue(makeRequest('b'))
    store.dequeue('a')
    const remaining = usePermissionStore.getState().pendingPermissions
    expect(remaining).toHaveLength(1)
    expect(remaining[0].requestId).toBe('b')
  })

  it('dequeue 无参数时 shift 队首', () => {
    const store = usePermissionStore.getState()
    store.enqueue(makeRequest('a'))
    store.enqueue(makeRequest('b'))
    store.dequeue()
    const remaining = usePermissionStore.getState().pendingPermissions
    expect(remaining).toHaveLength(1)
    expect(remaining[0].requestId).toBe('b')
  })

  it('dequeue 对不存在的 requestId 为 no-op', () => {
    const store = usePermissionStore.getState()
    store.enqueue(makeRequest('a'))
    store.dequeue('nonexistent')
    expect(usePermissionStore.getState().pendingPermissions).toHaveLength(1)
  })

  it('clear 清空全部', () => {
    const store = usePermissionStore.getState()
    store.enqueue(makeRequest('a'))
    store.enqueue(makeRequest('b'))
    store.clear()
    expect(usePermissionStore.getState().pendingPermissions).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter petclaw-desktop test -- tests/renderer/stores/permission-store.test.ts`
Expected: FAIL — 模块 `permission-store` 不存在

- [ ] **Step 3: 实现 store**

```ts
// src/renderer/src/stores/permission-store.ts
// 权限请求队列 store：管理 AskUserQuestion 和标准 exec-approval 请求的 FIFO 队列
import { create } from 'zustand'

export interface PermissionRequest {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId?: string | null
}

interface PermissionState {
  pendingPermissions: PermissionRequest[]
  // 按 requestId 去重后追加到队列尾部
  enqueue: (request: PermissionRequest) => void
  // 精确删除匹配项；无参数时 shift 队首
  dequeue: (requestId?: string) => void
  // 清空全部（会话中止时使用）
  clear: () => void
}

export const usePermissionStore = create<PermissionState>()((set) => ({
  pendingPermissions: [],

  enqueue: (request) =>
    set((state) => {
      // 按 requestId 去重，避免 IPC 重复推送
      if (state.pendingPermissions.some((p) => p.requestId === request.requestId)) {
        return state
      }
      return { pendingPermissions: [...state.pendingPermissions, request] }
    }),

  dequeue: (requestId?) =>
    set((state) => {
      if (requestId) {
        // 精确匹配删除
        const filtered = state.pendingPermissions.filter((p) => p.requestId !== requestId)
        if (filtered.length === state.pendingPermissions.length) return state
        return { pendingPermissions: filtered }
      }
      // 无参数：shift 队首
      if (state.pendingPermissions.length === 0) return state
      return { pendingPermissions: state.pendingPermissions.slice(1) }
    }),

  clear: () => set({ pendingPermissions: [] })
}))
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter petclaw-desktop test -- tests/renderer/stores/permission-store.test.ts`
Expected: 6 tests PASS

- [ ] **Step 5: 提交**

```bash
git add petclaw-desktop/src/renderer/src/stores/permission-store.ts petclaw-desktop/tests/renderer/stores/permission-store.test.ts
git commit -m "feat: add usePermissionStore for FIFO permission request queue"
```

---

### Task 2: 新建 usePermissionListener hook

**Files:**
- Create: `petclaw-desktop/src/renderer/src/hooks/use-permission-listener.ts`

- [ ] **Step 1: 创建 hook**

```ts
// src/renderer/src/hooks/use-permission-listener.ts
// 全局 IPC 监听 hook：订阅权限请求到达和超时关闭事件，维护 permission store 队列
import { useEffect } from 'react'
import { usePermissionStore } from '../stores/permission-store'
import type { PermissionRequest } from '../stores/permission-store'

export function usePermissionListener(): void {
  const enqueue = usePermissionStore((s) => s.enqueue)
  const dequeue = usePermissionStore((s) => s.dequeue)

  useEffect(() => {
    // 权限/AskUser 请求到达 → 入队
    const unsubPermission = window.api.cowork.onPermission((data) => {
      const d = data as { sessionId: string; request: PermissionRequest }
      if (d.request) {
        enqueue(d.request)
      }
    })

    // 超时/已响应后关闭弹窗 → 出队
    const unsubDismiss = window.api.cowork.onPermissionDismiss((data) => {
      const d = data as { requestId: string }
      if (d.requestId) {
        dequeue(d.requestId)
      }
    })

    return () => {
      unsubPermission()
      unsubDismiss()
    }
  }, [enqueue, dequeue])
}
```

- [ ] **Step 2: 提交**

```bash
git add petclaw-desktop/src/renderer/src/hooks/use-permission-listener.ts
git commit -m "feat: add usePermissionListener hook for global IPC subscription"
```

---

### Task 3: i18n 新增 dangerReason + wizard 翻译 key

**Files:**
- Modify: `petclaw-shared/src/i18n/locales/zh.ts`
- Modify: `petclaw-shared/src/i18n/locales/en.ts`

- [ ] **Step 1: 在 zh.ts 的 `permission` 区域末尾追加新 key**

在现有 `permission.allow` key 之后追加：

```ts
  // 危险原因文案
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

  // Question Wizard
  'wizard.title': '需要您的确认',
  'wizard.skip': '跳过',
  'wizard.submit': '提交',
  'wizard.other': '其他',
  'wizard.previous': '上一步',
  'wizard.next': '下一步',
  'wizard.answerRequired': '请回答所有问题后提交',
```

- [ ] **Step 2: 在 en.ts 对应位置追加相同结构的英文 key**

```ts
  // Danger reason labels
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

  // Question Wizard
  'wizard.title': 'Confirmation Needed',
  'wizard.skip': 'Skip',
  'wizard.submit': 'Submit',
  'wizard.other': 'Other',
  'wizard.previous': 'Previous',
  'wizard.next': 'Next',
  'wizard.answerRequired': 'Please answer all questions before submitting',
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add petclaw-shared/src/i18n/locales/zh.ts petclaw-shared/src/i18n/locales/en.ts
git commit -m "feat: add i18n keys for dangerReason labels and question wizard"
```

---

### Task 4: CoworkPermissionModal 增强 — dangerReason 文案 + radio/checkbox 图标

**Files:**
- Modify: `petclaw-desktop/src/renderer/src/views/chat/CoworkPermissionModal.tsx`

- [ ] **Step 1: 添加 DANGER_REASON_I18N_MAP 常量**

在 `CoworkPermissionModal.tsx` 顶部（`DANGER_STYLES` 之前）添加：

```ts
// 危险原因 → i18n key 映射，用于弹窗中展示具体危险原因文案
const DANGER_REASON_I18N_MAP: Record<string, string> = {
  'recursive-delete': 'dangerReason.recursiveDelete',
  'git-force-push': 'dangerReason.gitForcePush',
  'git-reset-hard': 'dangerReason.gitResetHard',
  'disk-overwrite': 'dangerReason.diskOverwrite',
  'disk-format': 'dangerReason.diskFormat',
  'file-delete': 'dangerReason.fileDelete',
  'git-push': 'dangerReason.gitPush',
  'process-kill': 'dangerReason.processKill',
  'permission-change': 'dangerReason.permissionChange',
  'git-clean': 'dangerReason.gitClean',
  'find-delete': 'dangerReason.findDelete'
}
```

- [ ] **Step 2: 在标准审批模式的标题栏和内容区之间添加 dangerReason 警告条**

在 `CoworkPermissionModal` 主函数的标题栏 `</div>` 和内容区 `<div className="px-5 py-4 overflow-y-auto">` 之间插入：

```tsx
        {/* 危险原因警告条 */}
        {dangerLevel !== 'safe' && toolInput.dangerReason && (
          <div className={`flex items-center gap-2 px-5 py-2.5 text-[12px] ${style.bg} border-b ${style.border}`}>
            <AlertTriangle size={14} className={style.iconColor} />
            <span className="text-text-secondary">
              {t(DANGER_REASON_I18N_MAP[String(toolInput.dangerReason)] ?? 'permission.needConfirm')}
            </span>
          </div>
        )}
```

同时在文件顶部 import 中添加 `AlertTriangle`：

```ts
import { AlertTriangle, ShieldAlert, ShieldCheck, ShieldX, X } from 'lucide-react'
```

- [ ] **Step 3: 在确认模式（ConfirmModeModal）中也添加 dangerReason 警告条**

在 `ConfirmModeModal` 的 `{dangerLevel !== 'safe' && (` 条件块内，紧跟标题栏之后、内容区之前，添加同样的警告条：

```tsx
        {/* 危险原因警告条 */}
        {typeof toolInput.dangerReason === 'string' && toolInput.dangerReason && (
          <div className={`flex items-center gap-2 px-5 py-2.5 text-[12px] ${style.bg} border-b ${style.border}`}>
            <AlertTriangle size={14} className={style.iconColor} />
            <span className="text-text-secondary">
              {t(DANGER_REASON_I18N_MAP[toolInput.dangerReason] ?? 'permission.needConfirm')}
            </span>
          </div>
        )}
```

- [ ] **Step 4: 在 MultiQuestionModal 中添加 radio/checkbox 图标**

修改 `MultiQuestionModal` 中选项按钮的渲染，在 `<span className="font-medium">` 前添加 radio/checkbox 指示器：

```tsx
                    <button
                      key={opt.label}
                      onClick={() => { /* 现有逻辑不变 */ }}
                      className={`w-full text-left px-3 py-2.5 rounded-[10px] text-[13px] transition-colors duration-[120ms] flex items-start gap-3 ${
                        isSelected
                          ? 'bg-accent/10 text-accent border border-accent/30'
                          : 'bg-bg-hover text-text-secondary hover:bg-bg-active border border-transparent'
                      }`}
                    >
                      {/* radio/checkbox 指示器 */}
                      {isMulti ? (
                        <span className={`w-4 h-4 rounded-[3px] border-2 flex items-center justify-center mt-0.5 flex-shrink-0 transition-colors ${
                          isSelected ? 'border-accent bg-accent' : 'border-text-tertiary'
                        }`}>
                          {isSelected && (
                            <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 16 16" fill="none">
                              <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                      ) : (
                        <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center mt-0.5 flex-shrink-0 transition-colors ${
                          isSelected ? 'border-accent' : 'border-text-tertiary'
                        }`}>
                          {isSelected && <span className="w-2 h-2 rounded-full bg-accent" />}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{opt.label}</span>
                        {opt.description && (
                          <span className="text-text-tertiary ml-2 text-[12px]">{opt.description}</span>
                        )}
                      </div>
                    </button>
```

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add petclaw-desktop/src/renderer/src/views/chat/CoworkPermissionModal.tsx
git commit -m "feat: add dangerReason display and radio/checkbox icons to permission modal"
```

---

### Task 5: 新建 CoworkQuestionWizard 向导组件

**Files:**
- Create: `petclaw-desktop/src/renderer/src/views/chat/CoworkQuestionWizard.tsx`

- [ ] **Step 1: 创建完整的 Wizard 组件**

使用 `ui-ux-pro-max` skill 设计 UI，参考 LobsterAI 实现，适配 PetClaw 设计 token。

组件接口：

```ts
interface CoworkQuestionWizardProps {
  permission: PermissionRequest
  onRespond: (result: PermissionResult) => void
}
```

功能要求：
- 分步展示（每次一个问题）
- 顶部进度条（`h-1 bg-accent`，比例 `(currentStep+1)/totalSteps`）
- 步骤圆点导航（可点击跳转，已答绿色 ✓，当前 accent 高亮）
- 上一步/下一步按钮（ChevronLeft / ChevronRight）
- 单选自动前进（150ms 延迟）
- 多选 checkbox / 单选 radio 图标
- "其他"自由文本输入
- "跳过"按钮
- 提交守卫（allAnswered）
- 关闭 = deny
- 键盘支持（Escape 关闭）

设计 token 使用项目 `index.css` 中定义的变量：
- `bg-bg-root`、`bg-overlay`、`bg-bg-hover`、`bg-bg-input`
- `text-text-primary`、`text-text-secondary`、`text-text-tertiary`
- `border-border`、`border-border-input`
- `bg-accent`、`bg-accent-hover`
- `rounded-[14px]`、`rounded-[10px]`
- `active:scale-[0.96] duration-[120ms]`

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add petclaw-desktop/src/renderer/src/views/chat/CoworkQuestionWizard.tsx
git commit -m "feat: add CoworkQuestionWizard step-by-step wizard component"
```

---

### Task 6: App.tsx 全局化 — 提升弹窗 + 接入 store

**Files:**
- Modify: `petclaw-desktop/src/renderer/src/App.tsx`
- Modify: `petclaw-desktop/src/renderer/src/views/chat/ChatView.tsx`

- [ ] **Step 1: 在 App.tsx 添加 import 和弹窗路由**

在 `App.tsx` 顶部添加 import：

```ts
import { usePermissionListener } from './hooks/use-permission-listener'
import { usePermissionStore } from './stores/permission-store'
import type { PermissionRequest } from './stores/permission-store'
import { CoworkPermissionModal } from './views/chat/CoworkPermissionModal'
import { CoworkQuestionWizard } from './views/chat/CoworkQuestionWizard'
```

在 `App` 函数体最开始（`const [phase, setPhase]` 之前）添加：

```ts
  // 全局权限请求监听：订阅 IPC 事件维护队列
  usePermissionListener()
  const firstPending = usePermissionStore((s) => s.pendingPermissions[0] ?? null)
  const dequeue = usePermissionStore((s) => s.dequeue)
```

添加弹窗响应回调和路由函数（在 `handleViewChange` 之前）：

```ts
  // 权限弹窗响应：发送结果到主进程并出队
  const handlePermissionRespond = useCallback(
    (result: { behavior: 'allow' | 'deny'; updatedInput?: Record<string, unknown>; message?: string }) => {
      if (!firstPending) return
      window.api.cowork.respondPermission(firstPending.requestId, result)
      dequeue(firstPending.requestId)
    },
    [firstPending, dequeue]
  )

  // 根据 toolName 和 questions 数量选择弹窗组件
  const renderPermissionModal = useCallback(() => {
    if (!firstPending) return null
    const isAskUser = firstPending.toolName === 'AskUserQuestion'
    const questions = (firstPending.toolInput as Record<string, unknown>).questions
    const isMultiQuestion = isAskUser && Array.isArray(questions) && questions.length > 1

    if (isMultiQuestion) {
      return <CoworkQuestionWizard permission={firstPending} onRespond={handlePermissionRespond} />
    }
    return <CoworkPermissionModal permission={firstPending} onRespond={handlePermissionRespond} />
  }, [firstPending, handlePermissionRespond])
```

- [ ] **Step 2: 在 App.tsx 所有 return 分支中插入弹窗 overlay**

修改 `bootcheck` 返回：

```tsx
  if (phase === 'bootcheck') {
    return (
      <>
        {renderPermissionModal()}
        <BootCheckPanel onRetry={() => window.api.retryBoot()} />
      </>
    )
  }
```

修改 `onboarding` 返回：

```tsx
  if (phase === 'onboarding') {
    return (
      <>
        {renderPermissionModal()}
        <OnboardingPanel onComplete={() => setPhase('main')} />
      </>
    )
  }
```

修改 `settings` 返回：

```tsx
  if (activeView === 'settings') {
    return (
      <>
        {renderPermissionModal()}
        <SettingsPage
          activeTab={settingsTab}
          onTabChange={setSettingsTab}
          onBack={handleBackFromSettings}
        />
      </>
    )
  }
```

修改主布局返回：

```tsx
  return (
    <>
      {renderPermissionModal()}
      <div className="w-full h-full flex bg-bg-root overflow-hidden">
        {/* 现有三栏布局不变 */}
      </div>
    </>
  )
```

- [ ] **Step 3: 从 ChatView.tsx 移除权限相关代码**

1. 删除 import（第 8 行）：
   ```ts
   // 删除：import { CoworkPermissionModal } from './CoworkPermissionModal'
   ```

2. 删除 `pendingPermission` useState（第 37–42 行）：
   ```ts
   // 删除整个 useState 声明
   ```

3. 删除 useEffect 中的 `onPermission` 和 `onPermissionDismiss` 订阅（第 79–89 行）：
   ```ts
   // 删除 unsubPermission 和 unsubPermissionDismiss 相关代码
   ```

4. 删除 cleanup 中的 `unsubPermission()` 和 `unsubPermissionDismiss()` 调用。

5. 删除 JSX 中的 `CoworkPermissionModal` 渲染（第 201–209 行）：
   ```tsx
   // 删除整个 {pendingPermission && (<CoworkPermissionModal ... />)} 块
   ```

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add petclaw-desktop/src/renderer/src/App.tsx petclaw-desktop/src/renderer/src/views/chat/ChatView.tsx
git commit -m "feat: promote permission modal to App level with global store"
```

---

### Task 7: 全量验证

**Files:** 无新文件

- [ ] **Step 1: 类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 2: 全量测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: 手动验证清单**

启动开发模式前先清理旧进程：

```bash
pkill -f electron; pkill -f vite
pnpm --filter petclaw-desktop dev
```

验证项：
1. 正常对话中 AI 调用 AskUserQuestion（单问题 2 选项）→ 确认模式弹窗正常显示
2. 切换到 Settings 视图 → 弹窗仍然可见
3. 危险命令（rm -rf）→ 标题栏变红 + 显示 "递归删除操作（不可恢复）" 文案
4. 多选模式 → radio/checkbox 图标正确区分
5. 多问题场景 → CoworkQuestionWizard 分步向导正常工作
6. 向导中单选自动前进、"其他"输入、"跳过"功能正常
7. 120s 超时 → 弹窗自动消失（dismiss 事件生效）
8. 连续两个权限请求 → 第一个响应后第二个自动浮出

- [ ] **Step 4: 提交最终状态（如有修复）**

```bash
git add -A
git commit -m "fix: address issues found during manual verification"
```
