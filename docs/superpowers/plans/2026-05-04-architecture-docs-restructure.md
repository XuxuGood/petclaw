# Architecture Docs Restructure Implementation Plan

> **For agentic workers:** `writing-plans` is not available in this environment. This plan is the fallback implementation plan for the approved spec `docs/superpowers/specs/2026-05-04-architecture-docs-restructure-design.md`.

**Goal:** Reorganize PetClaw architecture and design documentation so the root architecture document becomes a map, desktop details move into function-module documents, engineering workflows are separated, and external design references are clearly distinguished from PetClaw visual facts.

**Architecture:** Current facts remain in existing docs until migrated. The new structure introduces explicit document ownership: `PetClaw架构总览.md` for system-level navigation, `desktop/` for detailed desktop modules and Desktop UI specifications, `engineering/` for repository engineering workflows, and local-only `docs/设计参考/{references,snapshots}` for UI reference assets.

**Tech Stack:** Markdown documentation, Git file moves, repository-wide reference checks with `rg`.

---

## File Structure

- Create: `docs/架构设计/README.md` — architecture docs entry and reading routes.
- Create: `docs/架构设计/PetClaw架构总览.md` — system map replacing the root-level meaning of the old overall doc.
- Create: `docs/架构设计/shared/README.md` — shared package boundary.
- Create: `docs/架构设计/desktop/README.md` — desktop layered documentation entry.
- Create: `docs/架构设计/desktop/overview/Desktop架构设计.md` — desktop domain overview.
- Create: `docs/架构设计/desktop/foundation/Renderer架构设计.md` — migrated role of the current frontend architecture doc.
- Create: `docs/架构设计/desktop/{foundation,runtime,domains,ui}/*.md` — module documents for core desktop layers.
- Create: `docs/架构设计/web/README.md` — reserved workspace boundary.
- Create: `docs/架构设计/api/README.md` — reserved workspace boundary.
- Create: `docs/架构设计/engineering/CI-CD架构设计.md` — GitHub Actions workflow architecture.
- Move: `docs/架构设计/AI代码上下文工程设计.md` → `docs/架构设计/engineering/AI代码上下文工程设计.md`.
- Create: `docs/架构设计/decisions/ADR-0001-architecture-docs-restructure.md` — decision record for this split.
- Use: `docs/架构设计/legacy/` — target for obsolete or historical docs when migration happens.
- Keep `docs/设计参考/` local-only for design reference assets.
- Do not commit external reference images or local screenshot baselines.
- Move Desktop UI specification docs under `docs/架构设计/desktop/`.
- Move existing external design reference folders under `docs/设计参考/references/`.
- Modify: `AGENTS.md`, `CLAUDE.md`, `README.md`, and other current docs that point to renamed architecture facts.

---

## Task 1: Prepare Directories

**Files:**
- Create directories under `docs/架构设计/`
- Keep local-only directories under `docs/设计参考/` when needed.

- [ ] **Step 1: Create architecture directories**

Run locally when reference assets are needed:

```bash
mkdir -p docs/架构设计/shared docs/架构设计/desktop docs/架构设计/web docs/架构设计/api docs/架构设计/engineering docs/架构设计/decisions docs/架构设计/legacy
```

Expected: all architecture directories exist.

- [ ] **Step 2: Create design directories**

Run:

```bash
mkdir -p docs/设计参考/references docs/设计参考/snapshots
```

Expected: local design reference directories exist but are ignored by git.

---

## Task 2: Create Architecture Entry Documents

**Files:**
- Create: `docs/架构设计/README.md`
- Create: `docs/架构设计/PetClaw架构总览.md`

- [ ] **Step 1: Write architecture README**

`docs/架构设计/README.md` must explain:

- `PetClaw架构总览.md` is the system map.
- `shared/` documents the only shared package dependency surface.
- `desktop/` contains current detailed product runtime architecture.
- `web/` and `api/` are workspace boundaries, not implemented detail sources yet.
- `engineering/` contains repository engineering workflows such as AI context and CI/CD.
- `decisions/` contains ADRs.
- `legacy/` contains obsolete or historical context.

- [ ] **Step 2: Write system overview**

`PetClaw架构总览.md` should be concise and include:

- PetClaw product positioning.
- monorepo package roles.
- package dependency direction:

```text
petclaw-shared
  ↑
  ├── petclaw-desktop
  ├── petclaw-web
  └── petclaw-api
```

- desktop module list.
- high-level data flow summaries.
- links to detailed module documents.

It must not copy the full old `PetClaw总体架构设计.md`.

---

## Task 3: Move Engineering Docs

**Files:**
- Move: `docs/架构设计/AI代码上下文工程设计.md`
- Create: `docs/架构设计/engineering/CI-CD架构设计.md`

- [ ] **Step 1: Move AI context engineering doc**

Run:

```bash
mv docs/架构设计/AI代码上下文工程设计.md docs/架构设计/engineering/AI代码上下文工程设计.md
```

Expected: AI context doc now lives under `engineering/`.

- [ ] **Step 2: Create CI/CD architecture doc**

Create `docs/架构设计/engineering/CI-CD架构设计.md` with sections:

```markdown
# CI/CD 架构设计

## 1. 流水线总览
## 2. 触发策略
## 3. Workflow 划分
## 4. PR 校验流水线
## 5. Electron 验证流水线
## 6. OpenClaw 集成校验流水线
## 7. 安全扫描流水线
## 8. 多平台构建与 Release 流水线
## 9. Secrets 与权限边界
## 10. Artifact 与发布产物
## 11. 失败处理与重跑策略
```

Map existing workflows:

```text
质量门禁: .github/workflows/ci.yml
Electron 验证: .github/workflows/electron-verify.yml
OpenClaw 集成校验: .github/workflows/openclaw-check.yml
安全扫描: .github/workflows/security.yml
多平台构建与 Release: .github/workflows/build-platforms.yml
```

---

## Task 4: Create Desktop Architecture Documents

**Files:**
- Create: `docs/架构设计/desktop/overview/Desktop架构设计.md`
- Create: `docs/架构设计/desktop/foundation/Renderer架构设计.md`
- Create module skeletons under `docs/架构设计/desktop/`

- [ ] **Step 1: Create desktop overview**

`Desktop架构设计.md` should be a desktop-domain map covering:

- Electron Main / Preload / Renderer / Pet Window.
- SQLite and store ownership.
- OpenClaw runtime and Gateway.
- system integration boundaries.
- links to every desktop module doc.

It must not replace module details.

- [ ] **Step 2: Move frontend architecture role into renderer doc**

Create `Renderer架构设计.md` using the current `PetClaw前端架构设计.md` as the source, but rename the scope explicitly to desktop renderer.

It should cover:

- renderer window boundaries.
- global layout.
- Zustand/store rules.
- permission queue UI.
- loading / empty / error / disabled states.
- i18n and visible text rules.
- preload API usage constraints.

- [ ] **Step 3: Create desktop module skeletons**

Create these files with the standard module template:

```text
docs/架构设计/desktop/foundation/IPCPreload架构设计.md
docs/架构设计/desktop/foundation/DataStorage架构设计.md
docs/架构设计/desktop/runtime/RuntimeGateway架构设计.md
docs/架构设计/desktop/runtime/ConfigSync架构设计.md
docs/架构设计/desktop/domains/Cowork架构设计.md
docs/架构设计/desktop/domains/Pet事件架构设计.md
docs/架构设计/desktop/domains/IM架构设计.md
docs/架构设计/desktop/domains/Cron架构设计.md
docs/架构设计/desktop/domains/Skills架构设计.md
docs/架构设计/desktop/domains/Models架构设计.md
docs/架构设计/desktop/domains/MCP架构设计.md
docs/架构设计/desktop/domains/Memory架构设计.md
docs/架构设计/desktop/runtime/SystemIntegration架构设计.md
docs/架构设计/desktop/runtime/Desktop打包架构设计.md
```

Each module document must use this structure:

```markdown
# 模块名称 架构设计

## 1. 模块定位
## 2. 核心概念
## 3. 总体架构
## 4. 端到端数据流
## 5. 状态机与生命周期
## 6. 数据模型
## 7. IPC / Preload 契约
## 8. Renderer 布局、状态与交互
## 9. Runtime / Gateway 集成
## 10. 错误态、安全和权限
## 11. 与其它模块的关系
## 12. 测试策略
```

Do not leave empty sections. If a section has no direct dependency, state that explicitly.

---

## Task 5: Create Package Boundary Docs

**Files:**
- Create: `docs/架构设计/shared/README.md`
- Create: `docs/架构设计/web/README.md`
- Create: `docs/架构设计/api/README.md`

- [ ] **Step 1: Write shared boundary**

`shared/README.md` must state:

- `petclaw-shared` is the only shared bottom layer.
- It may contain i18n, shared types, protocol types, constants, and pure functions.
- It must not depend on desktop, web, or api packages.

- [ ] **Step 2: Write web and api placeholders**

`web/README.md` and `api/README.md` should be honest boundary documents:

- These workspace packages are reserved.
- Do not invent implementation details before the packages exist.
- Future docs must use `petclaw-shared` for shared contracts and protocols for runtime communication.

---

## Task 6: Reorganize Design Docs

**Files:**
- Keep local-only `docs/设计参考/references/`
- Keep local-only `docs/设计参考/snapshots/`

- [ ] **Step 1: Document design reference boundary in architecture docs**

Architecture docs must define:

- `references/`: external product references only, not PetClaw facts.
- `snapshots/`: PetClaw current implementation screenshots and visual regression baseline.
- Desktop visual, component, and page layout specifications live under `docs/架构设计/desktop/`.
- `docs/设计参考/` is local-only and ignored by git.

- [ ] **Step 2: Move external reference assets**

Move current external reference folders under local `docs/设计参考/references/`.

Preserve file names and directory names. Do not rewrite image files.

- [ ] **Step 3: Create visual spec placeholders**

Create under `docs/架构设计/desktop/`:

```text
Desktop视觉规范.md
Desktop组件规范.md
Desktop页面布局规范.md
```

Each file should start with scope, source-of-truth rules, and relationship to `docs/架构设计/desktop/foundation/Renderer架构设计.md`.

---

## Task 7: Record Decision

**Files:**
- Create: `docs/架构设计/decisions/ADR-0001-architecture-docs-restructure.md`

- [ ] **Step 1: Write ADR**

The ADR must record:

- Decision: architecture docs are split by system map, package boundaries, desktop function modules, engineering workflows, and design facts.
- Context: previous overall/frontend docs were too broad or incorrectly named.
- Consequences: more files, but clearer ownership and better AI context retrieval.
- Rejected options: package-only split, frontend/backend split, and keeping two giant docs.

---

## Task 8: Update Active References

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify active docs that refer to current architecture paths.

- [ ] **Step 1: Find references**

Run:

```bash
rg "PetClaw总体架构设计|PetClaw前端架构设计|AI代码上下文工程设计|docs/设计参考" AGENTS.md CLAUDE.md README.md docs/架构设计 docs/superpowers/specs
```

Expected: all current references are known before editing.

- [ ] **Step 2: Update architecture source references**

Use these new current paths:

```text
docs/架构设计/PetClaw架构总览.md
docs/架构设计/desktop/foundation/Renderer架构设计.md
docs/架构设计/engineering/AI代码上下文工程设计.md
docs/架构设计/engineering/CI-CD架构设计.md
```

Do not bulk-edit historical `docs/superpowers/plans/**` records unless they are used as active instructions.

---

## Task 9: Verify

**Files:**
- All changed docs and moved assets.

- [ ] **Step 1: Check document paths**

Run:

```bash
test -f docs/架构设计/README.md
test -f docs/架构设计/PetClaw架构总览.md
test -f docs/架构设计/desktop/overview/Desktop架构设计.md
test -f docs/架构设计/desktop/foundation/Renderer架构设计.md
test -f docs/架构设计/engineering/AI代码上下文工程设计.md
test -f docs/架构设计/engineering/CI-CD架构设计.md
git check-ignore -q docs/设计参考/references/example.png
```

Expected: command exits 0.

- [ ] **Step 2: Check stale active references**

Run:

```bash
rg "docs/架构设计/AI代码上下文工程设计.md|docs/架构设计/PetClaw前端架构设计.md" AGENTS.md CLAUDE.md README.md docs/架构设计
```

Expected: no active references to stale paths.

- [ ] **Step 3: Check reference-source wording**

Run:

```bash
rg "references/.*事实源|外部产品参考.*事实源" docs/设计参考 docs/架构设计
```

Expected: no wording that treats external references as PetClaw facts.

- [ ] **Step 4: Documentation-only validation**

Run:

```bash
git diff --check
```

Expected: exits 0.

If only Markdown and image moves changed, TypeScript tests are not required. If implementation files are touched accidentally, stop and review the diff before continuing.
