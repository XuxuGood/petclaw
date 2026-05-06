# Cowork Draft Flow Design

Date: 2026-05-06

## Purpose

PetClaw already has most of the Cowork runtime path in place: the chat input can pass a
message, current directory, selected skills, selected model, attachments, and path references
to `cowork:session:start` or `cowork:session:continue`. The missing product link is the
pre-send task state.

This design restores the intended PetClaw behavior:

- Clicking **New Task** creates or focuses an unsent task draft, not a database session.
- A real Cowork session is created only after the first message is sent.
- Drafts survive app restart.
- The sidebar shows only meaningful unsent task drafts.
- Sending succeeds by migrating the draft into a Cowork session; sending failure keeps the draft.

## Current Context

Relevant PetClaw sources:

- `docs/架构设计/desktop/domains/Cowork架构设计.md`
- `docs/架构设计/desktop/foundation/Renderer架构设计.md`
- `docs/superpowers/specs/2026-04-23-petclaw-phase2-design.md`
- `petclaw-desktop/src/renderer/src/App.tsx`
- `petclaw-desktop/src/renderer/src/views/chat/ChatView.tsx`
- `petclaw-desktop/src/renderer/src/views/chat/ChatInputBox.tsx`
- `petclaw-desktop/src/renderer/src/components/Sidebar.tsx`
- `petclaw-desktop/src/renderer/src/stores/chat-store.ts`
- `petclaw-desktop/src/main/ipc/chat-ipc.ts`
- `petclaw-desktop/src/main/ai/cowork-session-manager.ts`
- `petclaw-desktop/src/main/ai/cowork-controller.ts`
- `petclaw-desktop/src/main/data/cowork-store.ts`
- `petclaw-desktop/src/main/data/db.ts`

LobsterAI reference points:

- `src/renderer/components/cowork/CoworkView.tsx`
- `src/renderer/components/cowork/CoworkPromptInput.tsx`
- `src/renderer/services/cowork.ts`
- `src/renderer/store/slices/coworkSlice.ts`

The useful LobsterAI lessons are not its Redux structure itself. The useful behaviors are:
draft state is keyed separately from real sessions, start failures keep user input visible,
session list updates are reconciled after stream events, and stale async loads do not overwrite
the current view.

## Product Rules

The user-facing button remains **New Task**. It must not be renamed to "Create Draft" or any
implementation-oriented wording.

Drafts have two visibility states:

```ts
type CoworkDraftVisibility = 'editing' | 'listed'
```

- `editing`: the current New Task editor state. It is persisted in the background for crash and
  restart recovery, but it is not shown in the sidebar.
- `listed`: an unsent task draft that the user has left behind. It is shown in the sidebar
  Drafts section.

A draft enters the sidebar only if `prompt.trim().length > 0`. Directory, model, skill, and
attachment selections alone do not make a sidebar draft.

An empty current editing draft affects only itself. It must never delete or hide existing listed
drafts.

Clicking **New Task** follows these rules:

- If the current editing draft has a non-empty prompt, flush it to storage, mark it `listed`,
  show it in the sidebar Drafts section, then create a new empty editing draft.
- If the current editing draft has an empty prompt, discard that empty editing draft state and
  open/focus a new empty New Task editor. Existing listed drafts are unchanged.

Switching away from the New Task editor follows the same rule:

- Non-empty prompt: flush and mark listed.
- Empty prompt: discard only the current editing draft.

Opening a real Cowork session sets `activeDraftId = null`. Opening a draft sets
`activeSessionId = null`. The two states are mutually exclusive.

On app restart:

- Load all listed drafts with non-empty prompts into the sidebar.
- If the last editing draft has no prompt, do not restore it.
- If the last editing draft has a non-empty prompt, restore it as a listed draft and open it in
  the Chat draft view.

## Data Model

Drafts are stored in SQLite, not `localStorage`, because main process storage is the local
source of truth for desktop data.

Add `cowork_drafts`:

```sql
CREATE TABLE IF NOT EXISTS cowork_drafts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  directory_path TEXT,
  selected_model_json TEXT,
  skill_ids_json TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'editing',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Add `cowork_draft_attachments`:

```sql
CREATE TABLE IF NOT EXISTS cowork_draft_attachments (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT,
  mime_type TEXT,
  size INTEGER,
  staged_path TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES cowork_drafts(id) ON DELETE CASCADE
);
```

Renderer-facing types:

```ts
interface CoworkDraft {
  id: string
  title: string
  prompt: string
  directoryPath: string | null
  selectedModel: { providerId: string; modelId: string } | null
  skillIds: string[]
  visibility: 'editing' | 'listed'
  attachments: CoworkDraftAttachment[]
  createdAt: number
  updatedAt: number
}

interface CoworkDraftAttachment {
  id: string
  draftId: string
  kind: 'file' | 'directory' | 'image'
  name: string
  path: string | null
  mimeType: string | null
  size: number | null
  stagedPath: string | null
  createdAt: number
}
```

`title` is derived from the first non-empty line of `prompt`, capped to the existing session title
length convention. Empty prompts use the existing default New Task title only in the editor, not
as a sidebar draft.

## Attachment Storage

Do not store large image base64 payloads in SQLite.

Attachment behavior:

- File and directory references save absolute paths.
- Native file-picker images save their original absolute path. When sending, main or renderer can
  read image content as base64 if needed.
- Pasted or dragged images that do not expose a reliable path are staged by the main process under
  app userData, then SQLite stores only `stagedPath` plus metadata.
- Deleting a draft deletes its attachment rows and staged files.
- Sending a draft successfully deletes the draft and its staged files.
- If an attachment path no longer exists after restart, the UI shows an invalid attachment chip.
  The user can remove it. Sending should either filter invalid attachments with a visible warning
  or block and ask the user to remove them; blocking is safer for the first implementation.

Staged paths must be built with Electron/app path APIs and Node `path`. No hard-coded `/tmp`,
`~`, drive letters, or platform-specific separators.

## IPC And Preload

Add Cowork draft IPC channels:

```ts
cowork:draft:list
cowork:draft:get
cowork:draft:create
cowork:draft:update
cowork:draft:mark-listed
cowork:draft:delete
cowork:draft:stage-attachment
cowork:draft:delete-attachment
```

All handlers use `safeHandle`. Preload exposes a typed controlled API, preferably under
`window.api.cowork.drafts` if it fits the existing preload style. If that shape creates noisy
type churn, use `window.api.coworkDrafts`; do not expose raw IPC.

Draft IPC is local state only. It does not talk to OpenClaw Gateway and does not create runtime
sessions.

## Renderer Flow

Add `useCoworkDraftStore` for UI cache only:

```ts
interface CoworkDraftState {
  drafts: CoworkDraftSummary[]
  activeDraft: CoworkDraft | null
  isDraftLoading: boolean
  draftError: string | null
}
```

Zustand actions only update state. IPC side effects live in App, ChatView, or a small renderer
service.

App-level state changes:

- Add `activeDraftId: string | null`.
- Keep `activeSessionId` and `activeDraftId` mutually exclusive.
- Replace `chatDraftResetSignal` clearing behavior with explicit draft transitions.

Sidebar:

- Add a Drafts section above scheduled tasks and real task sessions.
- Only render listed drafts returned by `cowork:draft:list`.
- Draft rows show title, updated time, and weak directory metadata when present.
- Clicking a draft opens Chat draft mode.

Chat draft mode:

- `ChatInputBox` becomes controlled for draft fields:
  - prompt
  - directoryPath
  - selectedModel
  - skillIds
  - attachments
- Input updates are debounced to `cowork:draft:update`.
- Attachment creation/deletion uses dedicated draft attachment APIs.
- The editor can optimistically update local UI before debounce flush, but leaving the editor and
  sending must flush first.

Chat session mode:

- Existing `activeSessionId` history loading remains session-based.
- Background stream events continue to update only current visible session messages and session
  running state, not draft state.

## Sending Flow

When sending from draft mode:

1. Flush pending draft updates.
2. Reject sending if `prompt.trim()` is empty.
3. Validate directory and attachments.
4. Convert draft attachments into:
   - `imageAttachments`
   - `pathReferences`
5. Call existing `cowork:session:start`.
6. On success:
   - Delete the draft and staged files.
   - Set `activeDraftId = null`.
   - Set `activeSessionId = returned sessionId`.
   - Refresh or insert sidebar session.
   - Bind visible draft user message to the created session and continue receiving stream events.
7. On failure:
   - Keep the draft.
   - Show the error in the draft page.
   - Do not clear input, selections, or attachments.

When sending from session mode:

- Keep existing `cowork:session:continue` flow.
- Per-turn skill selection still clears after send.
- selectedModel changes patch the session as existing main flow already supports.

## Error Handling

Required visible states:

- Draft load failed.
- Draft save failed.
- Attachment staging failed.
- Attachment path no longer exists.
- Send failed because runtime/gateway/model/directory is not ready.
- Send failed after session creation request.

Draft save failures should not silently `console.warn`. The current editor should show a compact
save-error state and keep local edits in memory until retry or navigation.

## Testing

Add focused tests before implementation where practical.

Main/store tests:

- `createDraft()` creates `editing` draft.
- `listDrafts()` excludes empty prompts.
- `markDraftListed()` lists only non-empty prompt drafts.
- Empty editing draft deletion does not delete listed drafts.
- `deleteDraft()` removes attachment rows and staged files.
- staged image attachments store paths, not base64 payloads.

IPC/preload tests:

- all draft channels are registered through `safeHandle`.
- preload types match renderer usage.
- invalid attachment IDs and draft IDs return clear errors.

Renderer tests:

- clicking New Task with non-empty current prompt lists the old draft and opens a new empty editor.
- clicking New Task with empty prompt does not change existing listed drafts.
- switching to a session lists a non-empty active draft and clears `activeDraftId`.
- clicking a listed draft restores prompt, cwd, model, skills, and attachments.
- send success deletes the draft and activates the created session.
- send failure keeps the draft visible and editable.

Default verification:

```bash
npm run typecheck
npm test
```

Targeted verification:

```bash
pnpm --filter petclaw-desktop test -- tests/main/data/cowork-draft-store.test.ts
pnpm --filter petclaw-desktop test -- tests/main/ipc/cowork-draft-ipc.test.ts
pnpm --filter petclaw-desktop test -- tests/renderer/stores/cowork-draft-store.test.ts
pnpm --filter petclaw-desktop test -- tests/renderer/stores/chat-store.test.ts
```

If sandbox restrictions block port or socket work, report the environment limitation and rerun in
an allowed environment before treating failures as product regressions.

## Architecture Documentation Sync

Implementation changes the architecture facts. After code lands and verification passes, update:

- `docs/架构设计/desktop/domains/Cowork架构设计.md`
- `docs/架构设计/desktop/foundation/Renderer架构设计.md`
- `docs/架构设计/desktop/foundation/DataStorage架构设计.md`
- `docs/架构设计/desktop/foundation/IPCPreload架构设计.md`
- `docs/架构设计/desktop/foundation/IPCChannel契约.md` if the channel list is maintained there

Do not update architecture docs from this design alone. Update them after implementation so the
facts match the actual shipped code.

## Non-Goals

- Do not turn drafts into `cowork_sessions` rows.
- Do not create an OpenClaw runtime session before the first send.
- Do not store base64 image blobs in SQLite.
- Do not rename the user-facing **New Task** action.
- Do not make directory/model/skill-only selections appear as sidebar drafts without a message.
- Do not let an empty current editing draft clear existing sidebar drafts.

## Open Implementation Notes

- Prefer adding a dedicated main store file such as `petclaw-desktop/src/main/data/cowork-draft-store.ts`.
- Keep draft attachment staging under app userData with a deterministic per-draft subdirectory.
- Use `path` and Electron app paths for all filesystem locations.
- Before editing symbols, run required GitNexus impact analysis and `pnpm ai:prepare-change` for
  the target module.
