# Agent Guides and Architecture Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize PetClaw agent instructions into Chinese self-contained `CLAUDE.md` / `AGENTS.md`, remove `.ai/README.md`, and move the overall architecture document to `docs/架构设计/`.

**Architecture:** Agent execution rules live directly in root entry files, while long-form architecture lives under `docs/架构设计/`. Historical superpowers specs and plans remain as records; current entry points and README point to the new architecture path.

**Tech Stack:** Markdown documentation, Git file moves, repository-wide reference checks with `rg`.

---

## File Structure

- Modify: `CLAUDE.md` — Chinese self-contained Claude Code working guide.
- Modify: `AGENTS.md` — Chinese self-contained Codex working guide with Codex-specific confirmation rules.
- Delete: `.ai/README.md` — deprecated duplicated guide.
- Move: `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md` → `docs/架构设计/PetClaw总体架构设计.md`.
- Create: `docs/架构设计/模块设计/.gitkeep` — reserve module design directory.
- Create: `docs/架构设计/决策记录/.gitkeep` — reserve architecture decision directory.
- Modify: `README.md` — update documentation entry paths.
- Modify current active specs only when they contain current guide references that would confuse future work.

---

### Task 1: Move Architecture Document

**Files:**
- Move: `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md`
- Create: `docs/架构设计/PetClaw总体架构设计.md`
- Create: `docs/架构设计/模块设计/.gitkeep`
- Create: `docs/架构设计/决策记录/.gitkeep`

- [ ] **Step 1: Create target directories**

Run:

```bash
mkdir -p docs/架构设计/模块设计 docs/架构设计/决策记录
```

Expected: directories exist.

- [ ] **Step 2: Move the architecture document**

Run:

```bash
mv docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md docs/架构设计/PetClaw总体架构设计.md
```

Expected: old file path no longer exists; new file path exists with identical content.

- [ ] **Step 3: Preserve empty module directories**

Create empty `.gitkeep` files:

```bash
touch docs/架构设计/模块设计/.gitkeep docs/架构设计/决策记录/.gitkeep
```

Expected: both placeholder files exist.

---

### Task 2: Rewrite Agent Entry Guides

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Replace `CLAUDE.md` with Chinese self-contained guide**

Write a LobsterAI-style guide with these sections:

```markdown
# PetClaw — Claude Code 工作指南

本文件是 Claude Code 在 PetClaw 仓库中的执行入口。Claude 即使只读取本文件，也必须能正确开发、排查和验证本项目。

## 1. 构建与开发命令
## 2. 架构总览
## 3. 进程模型
## 4. 关键目录
## 5. 核心数据流
## 6. 持久化与配置
## 7. 编码风格与命名
## 8. IPC、i18n、日志
## 9. 测试与验证
## 10. 变更工作流
## 11. 参考文档
```

Content must include PetClaw commands, Electron + Openclaw architecture, main/renderer maps, ConfigSync/Cowork/System Prompt flow, persistence, i18n, logging, TDD, and verification rules.

- [ ] **Step 2: Replace `AGENTS.md` with matching Codex guide**

Use the same structure as `CLAUDE.md`, but change the title and add Codex-specific workflow rules:

```markdown
# PetClaw — Codex 工作指南

本文件是 Codex 在 PetClaw 仓库中的执行入口。Codex 即使只读取本文件，也必须能正确开发、排查和验证本项目。
```

Include:

- before changes, list files/reason/impact and wait for explicit confirmation;
- if user says “直接改”“修复”“实现”“提交”“加下”“改下”, that authorizes the scoped change;
- when user only asks questions or diagnostics, perform read-only checks only;
- do not call `apply_patch` or write files without confirmation.

---

### Task 3: Delete Deprecated `.ai/README.md`

**Files:**
- Delete: `.ai/README.md`

- [ ] **Step 1: Delete the duplicated guide**

Run:

```bash
rm .ai/README.md
```

Expected: `.ai/README.md` no longer exists.

---

### Task 4: Update Current References

**Files:**
- Modify: `README.md`
- Modify active docs containing current guide references when needed.

- [ ] **Step 1: Find old current references**

Run:

```bash
rg "\.ai/README|2026-04-22-petclaw-architecture-v3" README.md CLAUDE.md AGENTS.md docs/superpowers/specs docs/架构设计
```

Expected: only historical context or files that will be patched in the next step.

- [ ] **Step 2: Patch current references**

Replace current references as follows:

```text
.ai/README.md
→ CLAUDE.md / AGENTS.md

docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md
→ docs/架构设计/PetClaw总体架构设计.md
```

Do not bulk-edit historical `docs/superpowers/plans/**` records.

---

### Task 5: Verify

**Files:**
- All changed docs

- [ ] **Step 1: Check old references in current entry files**

Run:

```bash
rg "\.ai/README|2026-04-22-petclaw-architecture-v3" README.md CLAUDE.md AGENTS.md docs/架构设计
```

Expected: no output.

- [ ] **Step 2: Check architecture document exists**

Run:

```bash
test -f docs/架构设计/PetClaw总体架构设计.md
test ! -f docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md
test ! -f .ai/README.md
```

Expected: command exits 0.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: exits 0. Documentation-only changes should not affect TypeScript.

