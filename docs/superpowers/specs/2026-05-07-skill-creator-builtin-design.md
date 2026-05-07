# Skill Creator Builtin Design

## Context

PetClaw Skills has the management, marketplace, install-state, examples-to-Chat, and ConfigSync
architecture in place, but the first trusted builtin skill is not stable yet. The Skills page topbar
contains a "Create with PetClaw" entry, and the Skills architecture says that entry should use a
builtin skill to enter Chat with the right prompt and selected skill context.

The current local `petclaw-desktop/skills/create-skill/` content was copied from QoderWork and still
contains QoderWork product names and skill paths. That conflicts with PetClaw's runtime contract,
where the real skill creation directory is injected by `buildSkillCreationPrompt(skillsDir)` in the
main process.

LobsterAI already ships a mature OpenClaw-compatible `skill-creator` skill package. It is mostly
generic and includes its own Apache 2.0 license. Because PetClaw runs on OpenClaw and wants to keep
upstream skill packages easy to compare and refresh, PetClaw should vendor the LobsterAI package
directly instead of maintaining a renamed, partially rewritten fork.

## Goals

- Vendor LobsterAI's `skill-creator` package as the first PetClaw builtin skill.
- Keep the upstream `skill-creator` slug and frontmatter `name`.
- Make the Skills page "Create with PetClaw" entry hand off to Chat with `skillIds:
  ['skill-creator']` and a skill-creation prompt.
- Keep PetClaw UI copy product-friendly while preserving upstream package identity internally.
- Preserve the LobsterAI package license and bundled resources.
- Use `skills-market/skill-creator/.skill-metadata.yaml` only as examples fallback, not as the
  marketplace fact source.
- Keep skill creation paths owned by PetClaw managed prompts, not by the vendored skill body.

## Non-Goals

- Do not build the full remote skill marketplace in this phase.
- Do not add GitHub, ClawHub, or endpoint marketplace crawling.
- Do not rewrite the LobsterAI skill body unless runtime verification finds a concrete
  incompatibility.
- Do not expose LobsterAI's eval/benchmark workflow in PetClaw UI in this phase. Those files remain
  bundled resources for agents and advanced local use.
- Do not write selected skills into global `AGENTS.md`.
- Do not hardcode macOS, Windows, Linux, QoderWork, or workspace `skills/` paths in PetClaw glue code.

## Design

### Builtin Package

PetClaw will vendor the upstream package at:

```text
petclaw-desktop/skills/skill-creator/
```

The directory should preserve the upstream structure:

```text
skill-creator/
├── SKILL.md
├── LICENSE.txt
├── agents/
├── assets/
├── eval-viewer/
├── references/
└── scripts/
```

PetClaw will remove the current QoderWork-derived `petclaw-desktop/skills/create-skill/` from the
builtin distribution. Keeping both `create-skill` and `skill-creator` would create duplicate user
choices for the same intent and make ConfigSync and Chat skill selection harder to reason about.

The package should retain the upstream `name: skill-creator`. PetClaw UI can still show
"Create with PetClaw"; the internal selected skill id is `skill-creator`.

### Builtin List

`petclaw-desktop/skills/skills.config.json` will list `skill-creator` as a bundled builtin. This
keeps `SkillManager.syncBundledSkillsToUserData()` and `SkillManager.scan()` aligned with the
existing builtin detection path.

Expected effect:

```text
Resources/skills/skill-creator
→ {userData}/skills/skill-creator
→ skill_installs origin=builtin
→ Skills builtin tab
→ ConfigSync skills config
```

### Examples Fallback

PetClaw will add:

```text
petclaw-desktop/skills-market/skill-creator/.skill-metadata.yaml
```

This file only provides `examples` fallback for installed skill detail. It is not a marketplace
listing and does not replace remote endpoint data.

The initial examples should cover:

- Create a code review skill.
- Create a Conventional Commits message skill.
- Create a PDF/document processing skill.
- Extract a reusable skill from prior conversation context.

### Create With PetClaw Handoff

The Skills page topbar "Create with PetClaw" entry will not call the generic `handleNewTask`.
It will use a dedicated App-level handoff:

```text
Skills topbar click
→ App.handleCreateSkillWithPetClaw()
→ flush current Chat draft if needed
→ create or reuse editing draft
→ update draft with prompt and skillIds
→ switch active view to Chat
→ ChatInputBox shows prompt and skill chip
→ send payload includes skillIds: ['skill-creator']
```

The default prompt belongs in i18n:

```text
skills.createWithPetClawPrompt
```

The prompt should ask the agent to create a PetClaw/OpenClaw-compatible skill and first clarify:

- skill purpose and scope,
- trigger scenarios,
- expected output format,
- whether scripts, references, assets, or examples are needed.

The prompt must not include a concrete filesystem path. PetClaw's main process already injects the
correct skill creation directory through `buildSkillCreationPrompt(skillsDir)`.

### Runtime and ConfigSync

Chat sends `skillIds: ['skill-creator']`. Main process skill injection continues to read the
installed local `SKILL.md` through `SkillManager.buildSelectedSkillPrompt()`.

ConfigSync remains responsible for exposing PetClaw-managed skill directories to OpenClaw runtime.
This phase must not change the rule that `AGENTS.md` is not polluted with global skill lists.

If `skill-creator` is missing or disabled, the UI must avoid sending a stale selected skill id. The
click path must surface a user-visible error and keep the user in Skills instead of silently creating
an empty Chat draft. This phase will not auto-enable disabled builtin skills on click; explicit user
control over enabled skills remains the source of truth.

## Data Flow

```text
petclaw-desktop/skills/skill-creator/
  → bundled resources
  → SkillManager.syncBundledSkillsToUserData()
  → {userData}/skills/skill-creator/
  → SkillManager.scan()
  → skill_installs builtin record
  → SkillsPage builtin tab and detail
  → App create-with-PetClaw handoff
  → Cowork draft prompt + skillIds
  → ChatInputBox controlled draft
  → cowork:session:start / cowork:session:continue payload
  → selected skill prompt built from local SKILL.md
```

## Error Handling

- Missing builtin directory: Skills should show missing/repair behavior or recover on next bundled
  sync; it must not silently disappear from the expected builtin list.
- Disabled `skill-creator`: the "Create with PetClaw" handoff should tell the user to enable the
  builtin skill or route them to the builtin tab.
- Missing examples fallback: detail still works from local `SKILL.md`; usage falls back to
  `skills.createWithPetClawPrompt`.
- Script dependencies absent: PetClaw distributes the skill package but does not guarantee Python,
  Claude CLI, or other optional eval tooling is installed. The skill body owns those instructions.
- License missing: packaging should fail or tests should flag the vendored package as incomplete.

## Testing

Targeted tests should cover:

- `SkillManager.syncBundledSkillsToUserData()` copies `skill-creator` and preserves `LICENSE.txt`.
- `SkillManager.scan()` classifies `skill-creator` as builtin and enabled by default.
- `SkillManager.getSkillDetail('skill-creator')` reads local `SKILL.md` and loads examples fallback.
- Skills page builtin tab displays `skill-creator`.
- Topbar "Create with PetClaw" updates the active Chat draft with:
  - `prompt: t('skills.createWithPetClawPrompt')`
  - `skillIds: ['skill-creator']`
- Chat input displays the prompt and selected skill chip.
- Sending the draft carries `skillIds: ['skill-creator']`.
- ConfigSync still outputs skill loading configuration without writing global skill lists into
  `AGENTS.md`.

## Verification

Run targeted checks first:

```bash
pnpm --filter petclaw-desktop test -- tests/main/skills/skill-manager.test.ts
pnpm --filter petclaw-desktop test -- tests/renderer/App.test.tsx
pnpm --filter petclaw-desktop test -- tests/renderer/views/skills/SkillsPage.test.tsx
pnpm --filter petclaw-desktop test -- tests/renderer/views/chat/ChatView.test.tsx
```

Then run broad checks:

```bash
pnpm --filter petclaw-desktop typecheck
pnpm --filter petclaw-desktop test
```

## Documentation Impact

Implementation must update `docs/架构设计/desktop/domains/Skills架构设计.md` so "builtin
create-skill" becomes "builtin skill-creator". If implementation changes IPC, preload APIs,
SQLite schema, ConfigSync output, or Chat state model beyond this design, update the matching
architecture documents as well.

## Deferred Scope

Remote marketplace ingestion, skill package update channels, and UI support for the vendored eval
workflow are deferred until the builtin skill path is verified end to end.
