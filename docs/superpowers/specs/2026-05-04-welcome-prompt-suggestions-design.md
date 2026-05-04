# Welcome Prompt Suggestions Design

## 1. Goal

Improve the empty Chat welcome state with prompt suggestions while preserving the existing
WelcomePage layout and visual direction.

The current quick cards send a prompt immediately. The new behavior should make the flow safer:
users first choose a task category, then choose a concrete suggestion, then review or edit it in
the composer before sending.

## 2. Scope

In scope:

- Keep the existing WelcomePage title, subtitle, mascot, and three quick cards.
- Change quick card clicks from immediate send to category selection.
- Show prompt suggestions only after a quick card is clicked.
- Put the selected suggestion into the ChatInputBox textarea without auto-sending.
- Add localized Chinese and English prompt suggestion text.

Out of scope:

- Redesigning WelcomePage colors, typography, spacing, or icon style.
- Changing Chat session creation semantics.
- Adding new IPC or preload APIs.
- Automatically selecting directories or reading files before the user sends.
- Changing prompt execution, approval, or runtime behavior.

## 3. Interaction Design

Default empty state:

- WelcomePage renders exactly as today: greeting, subtitle, and three quick cards.
- No prompt suggestions are visible by default.
- ChatInputBox remains visible below the welcome area.

Card click:

- Clicking `文件整理`, `内容创作`, or `文档处理` selects that category.
- The selected category's three suggestions appear above ChatInputBox.
- The click does not send a Cowork message.
- Switching categories replaces the visible suggestions.

Suggestion click:

- Clicking a suggestion copies its full prompt text into ChatInputBox.
- The input is not sent automatically.
- The user can edit the prompt, add cwd/attachments/skills/model, then send manually.
- Clicking another suggestion replaces the current input with that suggestion.

## 4. Prompt Content

Chinese prompt suggestions are provided by product requirements:

- File organization:
  - 扫描我的 Downloads 文件夹，找出所有重复的文件，保留最新版本。
  - 请访问我的桌面文件夹，按文件类型（文档、图片、视频、表格等）自动分类整理到不同的子文件夹中。
  - 请读取相册目录下照片的 EXIF 信息，获取拍摄地点和日期，统一重命名为『YY-MM-DD 地点-序号.jpg』。
- Content creation:
  - 整理『品牌资源』文件夹中的 Logo、配色方案、字体文件，创建一个品牌使用指南 PDF，包含所有素材的预览和使用说明。
  - 为这个20分钟的会议录音生成中英双语字幕文件（SRT格式），并导出带时间轴的文字记录 Word 文档。
  - 生成一个用于演示光的折射原理的动画视频，并帮我制作一个 PPT 课件，将这个视频作为素材插入 PPT 中。
- Document processing:
  - 读取『会议记录』文件夹中本周的所有会议记录，提取关键决策和行动项，生成一份本周会议要点总结文档。
  - 从『参考文献』文件夹中的20篇 PDF 论文中提取标题、作者、发表年份、摘要和关键词，生成规范的参考文献列表。
  - 将『提案文件』文件夹中的10份 Word 文档统一调整为：标题宋体加粗18号、正文宋体12号、1.5倍行距、首行缩进2字符。

English translations should be semantically equivalent and stored under matching i18n keys.

## 5. Component Boundaries

`WelcomePage.tsx`:

- Owns the category cards and selected category callback.
- Does not own ChatInputBox state.
- Does not call the send path directly.

`ChatView.tsx`:

- Owns the selected welcome category/suggestions state while the empty welcome view is visible.
- Passes selected suggestions into ChatInputBox.
- Clears or ignores the welcome suggestion UI once the chat has messages or an active session.

`ChatInputBox.tsx`:

- Owns textarea state.
- Accepts optional suggestion prompts from ChatView.
- Writes a clicked suggestion into its existing `input` state.
- Keeps the existing send flow unchanged.

`petclaw-shared/src/i18n/locales/{zh,en}.ts`:

- Stores all user-visible suggestion labels and prompt strings.
- Keeps Chinese and English key sets aligned.

## 6. Safety And Error Handling

- Suggestions must never auto-send because the prompts may trigger local filesystem operations.
- The final send still goes through the existing Cowork flow, including cwd, attachments, model,
  skill selection, runtime state, and approval handling.
- No new file access or permission request happens when selecting a category or suggestion.
- If suggestions are absent or malformed, ChatInputBox should simply render no suggestion list.

## 7. Testing And Verification

Targeted verification:

- Default empty welcome state shows no suggestions.
- Clicking each quick card shows exactly that category's three suggestions.
- Clicking a suggestion fills ChatInputBox without calling `onSend`.
- Existing manual send behavior is unchanged after the prompt is filled.
- i18n resources contain matching Chinese and English keys.

Command verification:

```bash
pnpm --filter petclaw-desktop typecheck
```

If suitable renderer tests already cover ChatInputBox or ChatView interactions, add focused tests
there. If no matching test harness exists for this UI path, document the manual verification.
