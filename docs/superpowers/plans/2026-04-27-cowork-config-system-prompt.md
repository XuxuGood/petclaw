# Cowork Config System Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PetClaw cowork 配置和 system prompt 链路改为 `app_config` typed 门面 + session prompt 固化 + controller 只负责注入。

**Architecture:** 新增 `CoworkConfigStore` 封装 `cowork.*` KV；`cowork_sessions` 增加 `system_prompt` 字段；IPC 在主进程上层合并 managed prompt 和用户 prompt，创建 session 时固化，controller 按“首次或变化”注入。

**Tech Stack:** Electron IPC, TypeScript, better-sqlite3, Vitest

**Spec:** `docs/superpowers/specs/2026-04-27-cowork-config-system-prompt-design.md`

---

### Task 1: CoworkConfigStore

**Files:**
- Create: `petclaw-desktop/src/main/data/cowork-config-store.ts`
- Test: `petclaw-desktop/tests/main/data/cowork-config-store.test.ts`

- [x] Write failing tests for defaults, set/get, boolean parsing, and trimmed prompts.
- [x] Implement store with `cowork.*` keys backed by `app_config`.
- [x] Run targeted test.

### Task 2: Session System Prompt Persistence

**Files:**
- Modify: `petclaw-desktop/src/main/data/db.ts`
- Modify: `petclaw-desktop/src/main/data/cowork-store.ts`
- Modify: `petclaw-desktop/src/main/ai/types.ts`
- Test: `petclaw-desktop/tests/main/data/cowork-store.test.ts`

- [x] Write failing tests proving `createSession()` stores and returns `systemPrompt`.
- [x] Add `system_prompt` to schema and store mapping.
- [x] Run targeted test.

### Task 3: Prompt Builder

**Files:**
- Create: `petclaw-desktop/src/main/ai/system-prompt.ts`
- Test: `petclaw-desktop/tests/main/ai/system-prompt.test.ts`

- [x] Write failing tests for managed-only, user-only, merged, and empty prompt.
- [x] Implement `mergeCoworkSystemPrompt`.
- [x] Run targeted test.

### Task 4: Runtime Chain

**Files:**
- Modify: `petclaw-desktop/src/main/ai/cowork-session-manager.ts`
- Modify: `petclaw-desktop/src/main/ai/cowork-controller.ts`
- Modify: `petclaw-desktop/tests/main/ai/cowork-session-manager.test.ts`
- Modify: `petclaw-desktop/tests/main/ai/cowork-controller.test.ts`

- [x] Write failing tests for start persistence, continue fallback, prompt reinjection on change, and skill metadata.
- [x] Pass `systemPrompt` through session manager/controller.
- [x] Remove `skillsDir` and `buildManagedSections` from controller.
- [x] Run targeted tests.

### Task 5: IPC/Preload Integration

**Files:**
- Modify: `petclaw-desktop/src/main/ipc/chat-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/index.ts`
- Modify: `petclaw-desktop/src/main/index.ts`
- Modify: `petclaw-desktop/src/preload/index.ts`
- Modify: `petclaw-desktop/src/preload/index.d.ts`

- [x] Add `cowork:config:get/set`.
- [x] Merge managed prompt in IPC, not controller.
- [x] Allow `cwd` fallback to `cowork.defaultDirectory`.
- [x] Update preload types.

### Task 6: Docs and Verification

**Files:**
- Modify: `.ai/README.md`
- Modify: `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md`

- [x] Sync architecture docs.
- [x] Run `npm run typecheck`.
- [x] Run `npx vitest run`.
- [x] Run grep checks for `CoworkController` not referencing `skillsDir` / `buildManagedSections`.
