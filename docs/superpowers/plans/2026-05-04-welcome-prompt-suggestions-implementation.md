# Welcome Prompt Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add category-based welcome prompt suggestions that fill the chat composer without sending.

**Architecture:** Keep the welcome page as the category selector and keep textarea state inside
`ChatInputBox`. `ChatView` owns the selected category while the empty welcome view is visible and
passes localized suggestion rows into the composer.

**Tech Stack:** React function components, TypeScript, Zustand-backed chat state, lucide-react,
PetClaw shared i18n resources.

---

## File Structure

- Modify `petclaw-desktop/src/renderer/src/components/WelcomePage.tsx`: replace immediate send
  callback with category selection callback.
- Modify `petclaw-desktop/src/renderer/src/views/chat/ChatView.tsx`: keep selected welcome
  category state and pass suggestions to `ChatInputBox`.
- Modify `petclaw-desktop/src/renderer/src/views/chat/ChatInputBox.tsx`: render optional
  suggestion buttons above the composer and write clicked prompts into existing input state.
- Modify `petclaw-shared/src/i18n/locales/zh.ts`: add the nine Chinese prompt suggestions.
- Modify `petclaw-shared/src/i18n/locales/en.ts`: add matching English translations.

## Impact Notes

- GitNexus impact for `WelcomePage`, `ChatView`, and `ChatInputBox`: LOW risk, direct callers 0,
  affected processes 0.
- `pnpm ai:prepare-change -- --target WelcomePage` degraded to local text scanning because the
  GitNexus global registry had a permission issue. Local scan confirmed the active renderer path:
  `WelcomePage.tsx` imported by `ChatView.tsx`, with `ChatInputBox.tsx` below it.
- No IPC, preload, SQLite, ConfigSync, or runtime services are touched.

## Task 1: Add Welcome Suggestion i18n Keys

**Files:**

- Modify: `petclaw-shared/src/i18n/locales/zh.ts`
- Modify: `petclaw-shared/src/i18n/locales/en.ts`

- [ ] **Step 1: Add Chinese keys**

Add these keys near the existing `welcome.card.*` keys in `zh.ts`:

```typescript
'welcome.suggestion.fileOrganize.duplicateDownloads':
  '扫描我的 Downloads 文件夹，找出所有重复的文件，保留最新版本。',
'welcome.suggestion.fileOrganize.sortDesktop':
  '请访问我的桌面文件夹，按文件类型（文档、图片、视频、表格等）自动分类整理到不同的子文件夹中。',
'welcome.suggestion.fileOrganize.renamePhotos':
  '请读取相册目录下照片的 EXIF 信息，获取拍摄地点和日期，统一重命名为『YY-MM-DD 地点-序号.jpg』。',
'welcome.suggestion.contentCreation.brandGuide':
  '整理『品牌资源』文件夹中的 Logo、配色方案、字体文件，创建一个品牌使用指南 PDF，包含所有素材的预览和使用说明。',
'welcome.suggestion.contentCreation.meetingSubtitles':
  '为这个20分钟的会议录音生成中英双语字幕文件（SRT格式），并导出带时间轴的文字记录 Word 文档。',
'welcome.suggestion.contentCreation.refractionLesson':
  '生成一个用于演示光的折射原理的动画视频，并帮我制作一个 PPT 课件，将这个视频作为素材插入 PPT 中。',
'welcome.suggestion.docProcess.weeklyMeetings':
  '读取『会议记录』文件夹中本周的所有会议记录，提取关键决策和行动项，生成一份本周会议要点总结文档。',
'welcome.suggestion.docProcess.paperReferences':
  '从『参考文献』文件夹中的20篇 PDF 论文中提取标题、作者、发表年份、摘要和关键词，生成规范的参考文献列表。',
'welcome.suggestion.docProcess.formatProposals':
  '将『提案文件』文件夹中的10份 Word 文档统一调整为：标题宋体加粗18号、正文宋体12号、1.5倍行距、首行缩进2字符。',
```

- [ ] **Step 2: Add matching English keys**

Add these keys near the existing `welcome.card.*` keys in `en.ts`:

```typescript
'welcome.suggestion.fileOrganize.duplicateDownloads':
  'Scan my Downloads folder, find all duplicate files, and keep the newest version.',
'welcome.suggestion.fileOrganize.sortDesktop':
  'Open my Desktop folder and automatically sort files by type, such as documents, images, videos, and spreadsheets, into separate subfolders.',
'welcome.suggestion.fileOrganize.renamePhotos':
  'Read EXIF information from photos in my album folder, get the shooting location and date, and rename them as "YY-MM-DD Location-Number.jpg".',
'welcome.suggestion.contentCreation.brandGuide':
  'Organize the Logos, color palettes, and font files in the "Brand Assets" folder, then create a brand usage guide PDF with previews and usage notes for every asset.',
'welcome.suggestion.contentCreation.meetingSubtitles':
  'Generate Chinese-English bilingual subtitles in SRT format for this 20-minute meeting recording, and export a timestamped transcript as a Word document.',
'welcome.suggestion.contentCreation.refractionLesson':
  'Generate an animated video that demonstrates light refraction, then create a PPT lesson deck and insert the video as a slide asset.',
'welcome.suggestion.docProcess.weeklyMeetings':
  'Read all meeting notes from this week in the "Meeting Notes" folder, extract key decisions and action items, and generate a weekly meeting summary document.',
'welcome.suggestion.docProcess.paperReferences':
  'Extract titles, authors, publication years, abstracts, and keywords from 20 PDF papers in the "References" folder, then generate a standardized bibliography.',
'welcome.suggestion.docProcess.formatProposals':
  'Format the 10 Word documents in the "Proposals" folder with bold 18 pt SimSun titles, 12 pt SimSun body text, 1.5 line spacing, and two-character first-line indentation.',
```

- [ ] **Step 3: Verify key parity**

Run:

```bash
rg -n "welcome\\.suggestion" petclaw-shared/src/i18n/locales/{zh,en}.ts
```

Expected: both files show the same nine `welcome.suggestion.*` keys.

## Task 2: Change WelcomePage From Send To Category Selection

**Files:**

- Modify: `petclaw-desktop/src/renderer/src/components/WelcomePage.tsx`

- [ ] **Step 1: Replace the prop contract**

Change:

```typescript
interface WelcomePageProps {
  onSendPrompt: (text: string) => void
}
```

to:

```typescript
export type WelcomeSuggestionCategory = 'fileOrganize' | 'contentCreation' | 'docProcess'

interface WelcomePageProps {
  selectedCategory: WelcomeSuggestionCategory | null
  onSelectCategory: (category: WelcomeSuggestionCategory) => void
}
```

- [ ] **Step 2: Add category ids to card data**

Build `quickCards` with stable ids:

```typescript
const quickCards: Array<{
  id: WelcomeSuggestionCategory
  icon: typeof FolderOpen
  title: string
  desc: string
}> = [
  {
    id: 'fileOrganize',
    icon: FolderOpen,
    title: t('welcome.card.fileOrganize.title'),
    desc: t('welcome.card.fileOrganize.desc')
  },
  {
    id: 'contentCreation',
    icon: PenLine,
    title: t('welcome.card.contentCreation.title'),
    desc: t('welcome.card.contentCreation.desc')
  },
  {
    id: 'docProcess',
    icon: BarChart3,
    title: t('welcome.card.docProcess.title'),
    desc: t('welcome.card.docProcess.desc')
  }
]
```

- [ ] **Step 3: Update card button behavior**

Change each button to select a category and expose selected state:

```tsx
<button
  key={card.id}
  type="button"
  aria-pressed={selectedCategory === card.id}
  onClick={() => onSelectCategory(card.id)}
  className={`ui-card-action flex flex-1 flex-col items-start p-4 text-left ${
    selectedCategory === card.id ? 'border-accent/40 bg-bg-active' : ''
  }`}
>
```

Expected: clicking a card no longer calls the chat send path.

## Task 3: Wire Suggestions Through ChatView

**Files:**

- Modify: `petclaw-desktop/src/renderer/src/views/chat/ChatView.tsx`

- [ ] **Step 1: Import category type and useState**

Ensure the file imports `useState` and the category type:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  WelcomePage,
  type WelcomeSuggestionCategory
} from '../../components/WelcomePage'
```

- [ ] **Step 2: Add suggestion item type and builder**

Add near the component body or internal helpers:

```typescript
interface WelcomeSuggestion {
  id: string
  text: string
}

function getWelcomeSuggestions(
  category: WelcomeSuggestionCategory | null,
  t: (key: string) => string
): WelcomeSuggestion[] {
  if (!category) return []
  const keysByCategory: Record<WelcomeSuggestionCategory, string[]> = {
    fileOrganize: [
      'welcome.suggestion.fileOrganize.duplicateDownloads',
      'welcome.suggestion.fileOrganize.sortDesktop',
      'welcome.suggestion.fileOrganize.renamePhotos'
    ],
    contentCreation: [
      'welcome.suggestion.contentCreation.brandGuide',
      'welcome.suggestion.contentCreation.meetingSubtitles',
      'welcome.suggestion.contentCreation.refractionLesson'
    ],
    docProcess: [
      'welcome.suggestion.docProcess.weeklyMeetings',
      'welcome.suggestion.docProcess.paperReferences',
      'welcome.suggestion.docProcess.formatProposals'
    ]
  }
  return keysByCategory[category].map((key) => ({ id: key, text: t(key) }))
}
```

- [ ] **Step 3: Store selected category and derived suggestions**

Inside `ChatView`:

```typescript
const [welcomeCategory, setWelcomeCategory] = useState<WelcomeSuggestionCategory | null>(null)
const welcomeSuggestions = getWelcomeSuggestions(welcomeCategory, t)
```

- [ ] **Step 4: Replace old welcome send handler**

Remove:

```typescript
/** WelcomePage 快捷卡片点击时直接发送，使用空 cwd */
const handleSendFromWelcome = (text: string) => {
  handleSend(text, '')
}
```

Pass selection state instead:

```tsx
<WelcomePage
  selectedCategory={welcomeCategory}
  onSelectCategory={setWelcomeCategory}
/>
```

- [ ] **Step 5: Pass suggestions to ChatInputBox only in welcome state**

In the empty welcome branch:

```tsx
<ChatInputBox
  onSend={handleSend}
  disabled={isLoading}
  promptSuggestions={welcomeSuggestions}
/>
```

In the active chat branch, keep:

```tsx
<ChatInputBox onSend={handleSend} disabled={isLoading} />
```

Expected: suggestions exist only before an active session or displayed messages.

## Task 4: Render Suggestions In ChatInputBox

**Files:**

- Modify: `petclaw-desktop/src/renderer/src/views/chat/ChatInputBox.tsx`

- [ ] **Step 1: Add prop types**

Add:

```typescript
interface PromptSuggestion {
  id: string
  text: string
}
```

Extend props:

```typescript
interface ChatInputBoxProps {
  onSend: (
    message: string,
    cwd: string,
    skillIds: string[],
    selectedModel: SelectedModel | null,
    imageAttachments: ChatImageAttachment[],
    pathReferences: ChatPathReference[]
  ) => void
  disabled?: boolean
  promptSuggestions?: PromptSuggestion[]
}
```

- [ ] **Step 2: Accept the new prop**

Change:

```typescript
export function ChatInputBox({ onSend, disabled = false }: ChatInputBoxProps) {
```

to:

```typescript
export function ChatInputBox({
  onSend,
  disabled = false,
  promptSuggestions = []
}: ChatInputBoxProps) {
```

- [ ] **Step 3: Add suggestion click handler**

Add after `handleSubmit` or near other event handlers:

```typescript
const handleSelectPromptSuggestion = (text: string) => {
  setInput(text)
  requestAnimationFrame(() => {
    textareaRef.current?.focus()
    if (!textareaRef.current) return
    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
  })
}
```

- [ ] **Step 4: Render suggestions above composer shell**

Wrap the current return content with a parent fragment or container and place this immediately
before the existing composer shell:

```tsx
{promptSuggestions.length > 0 ? (
  <div className="mx-6 mb-3 flex flex-col gap-2">
    {promptSuggestions.map((suggestion) => (
      <button
        key={suggestion.id}
        type="button"
        onClick={() => handleSelectPromptSuggestion(suggestion.text)}
        className="ui-row-button text-left text-[13px] leading-[1.55] text-text-secondary"
      >
        {suggestion.text}
      </button>
    ))}
  </div>
) : null}
```

Expected: suggestion buttons are visible only when `promptSuggestions` is non-empty and do not send.

## Task 5: Verify Behavior

**Files:**

- Read: `petclaw-desktop/src/renderer/src/components/WelcomePage.tsx`
- Read: `petclaw-desktop/src/renderer/src/views/chat/ChatView.tsx`
- Read: `petclaw-desktop/src/renderer/src/views/chat/ChatInputBox.tsx`
- Read: `petclaw-shared/src/i18n/locales/zh.ts`
- Read: `petclaw-shared/src/i18n/locales/en.ts`

- [ ] **Step 1: Check no old immediate-send path remains**

Run:

```bash
rg -n "onSendPrompt|handleSendFromWelcome|welcome\\.card\\..*\\.prompt" petclaw-desktop/src petclaw-shared/src
```

Expected: no `onSendPrompt` or `handleSendFromWelcome`; old `welcome.card.*.prompt` keys may remain
only if other code still references them, otherwise remove them from both locales.

- [ ] **Step 2: Typecheck desktop**

Run:

```bash
pnpm --filter petclaw-desktop typecheck
```

Expected: exits 0. If it fails because of unrelated dirty worktree changes, capture the first
relevant error and identify whether it comes from this task's files.

- [ ] **Step 3: Manual UI verification**

Run the app only if the local environment permits Electron/Vite sockets:

```bash
pnpm --filter petclaw-desktop dev
```

Verify:

- Empty welcome state initially shows no prompt suggestions.
- Clicking each quick card shows exactly three suggestions.
- Clicking a suggestion fills the textarea.
- The send button remains idle until the user manually sends.
- Existing cwd, attachment, skill, and model controls still render.

## Commit Guidance

The current workspace has unrelated uncommitted changes. Do not commit implementation files unless
the user asks. If committing later, stage only the files listed in this plan and verify with:

```bash
git diff --cached --name-only
```
