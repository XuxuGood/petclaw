# Desktop Logging Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production-grade Desktop Logging Platform described in `docs/架构设计/desktop/foundation/Logging架构设计.md`.

**Architecture:** Introduce a focused `src/main/logging/` foundation module that owns paths, sanitization, storage, scoped loggers, child-process stream capture, diagnostics bundles, and logging IPC. Keep existing `console.*` interception as a compatibility layer while migrating Cowork, startup diagnostics, Gateway, MCP, updater, renderer reports, and user-facing diagnostics export onto the new platform.

**Tech Stack:** Electron main/preload IPC, TypeScript, Node `fs/path/os`, `electron-log`, `fflate`, Vitest, React renderer settings views, shared i18n dictionaries.

---

## Scope And Execution Notes

This plan implements the whole architecture without leaving inactive UI or undocumented behavior. It is large but integrated: the logging platform, renderer-safe IPC, diagnostics bundle, and first-party log stream migration must ship together so the user can export useful diagnostics without leaking secrets.

Before implementation, use Node 24 as required by `petclaw-desktop/package.json`. In the current machine, the default shell may resolve Node 16; run commands with:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop typecheck
```

If Node 24 is not present, use the closest installed Node 24.x or install it before running project commands.

## File Structure

Create:

- `petclaw-desktop/src/main/logging/types.ts`  
  Owns `LogLevel`, `LogSource`, `LogEventInput`, `SanitizedLogEvent`, diagnostics DTOs, and constants shared inside main logging code.
- `petclaw-desktop/src/main/logging/paths.ts`  
  Resolves all log stream directories and files from `resolveUserDataPaths(app.getPath('userData'))`; no business module builds log paths directly.
- `petclaw-desktop/src/main/logging/sanitizer.ts`  
  Redacts secrets, normalizes paths, sanitizes URLs, truncates large values, serializes circular objects, and converts `Error` objects to safe records.
- `petclaw-desktop/src/main/logging/storage.ts`  
  Writes sanitized events, enforces daily file naming, size rotation, retention, and exposes recent entries by source.
- `petclaw-desktop/src/main/logging/facade.ts`  
  Provides `getLogger(module, source?)`, `reportRendererLog`, console compatibility interception, and snapshot of logging health.
- `petclaw-desktop/src/main/logging/process-logger.ts`  
  Attaches stdout/stderr streams for Gateway and other child processes, redacts stream chunks, writes process logs, and emits milestone summaries.
- `petclaw-desktop/src/main/logging/diagnostics-bundle.ts`  
  Builds sanitized zip diagnostics archives with manifest and metadata summaries.
- `petclaw-desktop/src/main/logging/logging-ipc.ts`  
  Registers `logging:*` IPC channels through `safeHandle` and validates renderer payloads.
- `petclaw-desktop/src/main/logging/index.ts`  
  Single public export surface for main process consumers.

Modify:

- `petclaw-desktop/src/main/logger.ts`  
  Keep public compatibility exports while delegating to the new platform.
- `petclaw-desktop/src/main/diagnostics.ts`  
  Route startup JSONL through `startup` log source.
- `petclaw-desktop/src/main/ai/cowork-logger.ts`  
  Route Cowork structured logs through `cowork` log source.
- `petclaw-desktop/src/main/ai/engine-manager.ts`  
  Replace manual gateway log append with `attachProcessLogger`.
- `petclaw-desktop/src/main/mcp/mcp-bridge-server.ts` and `petclaw-desktop/src/main/mcp/mcp-server-manager.ts`  
  Use the scoped MCP logger and sanitizer helpers.
- `petclaw-desktop/src/main/auto-updater.ts`  
  Keep `electron-updater` compatibility while mirroring updater lifecycle events into `updater` source.
- `petclaw-desktop/src/main/index.ts` and `petclaw-desktop/src/main/ipc/index.ts`  
  Initialize logging early and register Phase A logging IPC.
- `petclaw-desktop/src/preload/index.ts` and `petclaw-desktop/src/preload/index.d.ts`  
  Expose `window.api.logging`.
- `petclaw-desktop/src/renderer/src/views/boot/BootCheckPanel.tsx`  
  Add real view/open/export diagnostics actions in error state.
- `petclaw-desktop/src/renderer/src/views/settings/EngineSettings.tsx`  
  Add diagnostics snapshot, open log folder, and export diagnostics actions.
- `petclaw-desktop/src/renderer/src/views/settings/AboutSettings.tsx`  
  Add support diagnostics export entry.
- `petclaw-shared/src/i18n/locales/zh.ts` and `petclaw-shared/src/i18n/locales/en.ts`  
  Add all visible logging and diagnostics strings.
- `docs/架构设计/desktop/foundation/Logging架构设计.md`  
  Update only if implementation deliberately changes a contract in the accepted architecture.

Tests:

- `petclaw-desktop/tests/main/logging/paths.test.ts`
- `petclaw-desktop/tests/main/logging/sanitizer.test.ts`
- `petclaw-desktop/tests/main/logging/storage.test.ts`
- `petclaw-desktop/tests/main/logging/facade.test.ts`
- `petclaw-desktop/tests/main/logging/process-logger.test.ts`
- `petclaw-desktop/tests/main/logging/diagnostics-bundle.test.ts`
- `petclaw-desktop/tests/main/ipc/logging-ipc.test.ts`
- `petclaw-desktop/tests/renderer/views/diagnostics-actions.test.tsx`

---

### Task 1: Logging Types And Path Resolver

**Files:**
- Create: `petclaw-desktop/src/main/logging/types.ts`
- Create: `petclaw-desktop/src/main/logging/paths.ts`
- Test: `petclaw-desktop/tests/main/logging/paths.test.ts`

- [ ] **Step 1: Write the failing path resolver tests**

Create `petclaw-desktop/tests/main/logging/paths.test.ts`:

```typescript
import path from 'path'
import { describe, expect, test } from 'vitest'

import { resolveLoggingPaths, getLogFileNameForDate } from '../../../src/main/logging/paths'

const root = path.join('Users', 'alice', 'Library', 'Application Support', 'PetClaw')

describe('resolveLoggingPaths', () => {
  test('derives all log directories from userData', () => {
    const paths = resolveLoggingPaths(root)

    expect(paths.root).toBe(path.join(root, 'logs'))
    expect(paths.sources.main.dir).toBe(path.join(root, 'logs', 'main'))
    expect(paths.sources.renderer.dir).toBe(path.join(root, 'logs', 'renderer'))
    expect(paths.sources.startup.dir).toBe(path.join(root, 'logs', 'startup'))
    expect(paths.sources.cowork.dir).toBe(path.join(root, 'logs', 'cowork'))
    expect(paths.sources.mcp.dir).toBe(path.join(root, 'logs', 'mcp'))
    expect(paths.sources.updater.dir).toBe(path.join(root, 'logs', 'updater'))
    expect(paths.sources.installer.dir).toBe(path.join(root, 'logs', 'installer'))
    expect(paths.sources.gateway.dir).toBe(path.join(root, 'openclaw', 'logs', 'gateway'))
    expect(paths.sources.runtime.dir).toBe(path.join(root, 'openclaw', 'logs', 'runtime'))
    expect(paths.diagnostics.dir).toBe(path.join(root, 'logs', 'diagnostics'))
  })

  test('builds stable daily log filenames', () => {
    const date = new Date('2026-05-05T08:15:00.000Z')

    expect(getLogFileNameForDate('main', date)).toBe('main-2026-05-05.log')
    expect(getLogFileNameForDate('renderer', date)).toBe('renderer-2026-05-05.log')
    expect(getLogFileNameForDate('startup', date)).toBe('startup-diagnostics.jsonl')
    expect(getLogFileNameForDate('installer', date)).toBe('installer.log')
  })
})
```

- [ ] **Step 2: Run the failing path resolver tests**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test -- tests/main/logging/paths.test.ts
```

Expected: FAIL because `src/main/logging/paths.ts` does not exist.

- [ ] **Step 3: Add shared logging types**

Create `petclaw-desktop/src/main/logging/types.ts`:

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogSource =
  | 'main'
  | 'renderer'
  | 'startup'
  | 'cowork'
  | 'mcp'
  | 'gateway'
  | 'runtime'
  | 'updater'
  | 'installer'

export interface LogEventInput {
  level: LogLevel
  source: LogSource
  module: string
  event: string
  message?: string
  fields?: Record<string, unknown>
  error?: unknown
}

export interface SanitizedError {
  name: string
  message: string
  stack?: string
}

export interface SanitizedLogEvent {
  timestamp: string
  level: LogLevel
  source: LogSource
  module: string
  event: string
  message: string
  platform: NodeJS.Platform
  arch: string
  appVersion: string
  fields: Record<string, unknown>
  error?: SanitizedError
  redactionCount: number
  truncated: boolean
}

export interface LogSourcePaths {
  dir: string
  currentFile: string
}

export type LogSourcesPathMap = Record<LogSource, LogSourcePaths>

export interface LoggingPaths {
  root: string
  diagnostics: {
    dir: string
  }
  sources: LogSourcesPathMap
}

export interface DiagnosticsSnapshot {
  writable: boolean
  sources: Array<{
    source: LogSource
    dir: string
    currentFile: string
    exists: boolean
  }>
  errors: Array<{ source: LogSource; message: string }>
}

export interface DiagnosticsExportOptions {
  timeRangeDays: 1 | 3 | 7
  includeSources?: LogSource[]
}

export interface DiagnosticsExportResult {
  filePath: string
  sizeBytes: number
  redactionCount: number
  exportWarnings: string[]
}

export const DEFAULT_LOG_RETENTION_DAYS = 14
export const DEFAULT_DIAGNOSTICS_RETAIN_COUNT = 5
export const DEFAULT_LOG_MAX_SIZE_BYTES = 20 * 1024 * 1024
export const DEFAULT_EVENT_MAX_CHARS = 8_000
```

- [ ] **Step 4: Add the path resolver**

Create `petclaw-desktop/src/main/logging/paths.ts`:

```typescript
import path from 'path'

import { resolveUserDataPaths } from '../user-data-paths'
import type { LoggingPaths, LogSource } from './types'

const DAILY_SOURCES = new Set<LogSource>([
  'main',
  'renderer',
  'cowork',
  'mcp',
  'gateway',
  'runtime',
  'updater'
])

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function getLogFileNameForDate(source: LogSource, date = new Date()): string {
  if (source === 'startup') return 'startup-diagnostics.jsonl'
  if (source === 'installer') return 'installer.log'
  if (DAILY_SOURCES.has(source)) return `${source}-${formatDate(date)}.log`
  return `${source}.log`
}

export function resolveLoggingPaths(userDataPath: string, date = new Date()): LoggingPaths {
  const userDataPaths = resolveUserDataPaths(userDataPath)
  const desktopLogsRoot = userDataPaths.logsRoot

  const sourceDirs: Record<LogSource, string> = {
    main: path.join(desktopLogsRoot, 'main'),
    renderer: path.join(desktopLogsRoot, 'renderer'),
    startup: path.join(desktopLogsRoot, 'startup'),
    cowork: path.join(desktopLogsRoot, 'cowork'),
    mcp: path.join(desktopLogsRoot, 'mcp'),
    updater: path.join(desktopLogsRoot, 'updater'),
    installer: path.join(desktopLogsRoot, 'installer'),
    gateway: path.join(userDataPaths.openclawLogs, 'gateway'),
    runtime: path.join(userDataPaths.openclawLogs, 'runtime')
  }

  return {
    root: desktopLogsRoot,
    diagnostics: {
      dir: path.join(desktopLogsRoot, 'diagnostics')
    },
    sources: Object.fromEntries(
      Object.entries(sourceDirs).map(([source, dir]) => [
        source,
        {
          dir,
          currentFile: path.join(dir, getLogFileNameForDate(source as LogSource, date))
        }
      ])
    ) as LoggingPaths['sources']
  }
}
```

- [ ] **Step 5: Run path resolver tests**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test -- tests/main/logging/paths.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add petclaw-desktop/src/main/logging/types.ts petclaw-desktop/src/main/logging/paths.ts petclaw-desktop/tests/main/logging/paths.test.ts
git commit -m "feat(desktop): add logging path resolver"
```

---

### Task 2: Sanitizer

**Files:**
- Create: `petclaw-desktop/src/main/logging/sanitizer.ts`
- Test: `petclaw-desktop/tests/main/logging/sanitizer.test.ts`

- [ ] **Step 1: Write failing sanitizer tests**

Create `petclaw-desktop/tests/main/logging/sanitizer.test.ts`:

```typescript
import path from 'path'
import { describe, expect, test } from 'vitest'

import { sanitizeLogEvent, sanitizeUnknownForLog } from '../../../src/main/logging/sanitizer'

const userData = path.join('/Users/alice/Library/Application Support/PetClaw')
const workspace = path.join('/Users/alice/work/petclaw')

describe('sanitizeUnknownForLog', () => {
  test('redacts sensitive keys recursively', () => {
    const result = sanitizeUnknownForLog({
      apiKey: 'sk-secret',
      nested: { authorization: 'Bearer abc', value: 'ok' }
    })

    expect(result.value).toEqual({
      apiKey: '[redacted]',
      nested: { authorization: '[redacted]', value: 'ok' }
    })
    expect(result.redactionCount).toBe(2)
  })

  test('redacts sensitive string values', () => {
    const result = sanitizeUnknownForLog({
      header: 'Bearer eyJhbGciOiJIUzI1NiJ9.abc.def',
      tokenValue: 'sk-live-1234567890'
    })

    expect(JSON.stringify(result.value)).not.toContain('Bearer eyJ')
    expect(JSON.stringify(result.value)).not.toContain('sk-live')
    expect(result.redactionCount).toBeGreaterThanOrEqual(2)
  })

  test('normalizes known local paths', () => {
    const result = sanitizeUnknownForLog(
      {
        db: path.join(userData, 'petclaw.db'),
        cwd: path.join(workspace, 'src/main/index.ts')
      },
      { userDataPath: userData, workspacePath: workspace }
    )

    expect(result.value).toEqual({
      db: path.join('{userData}', 'petclaw.db'),
      cwd: path.join('{workspace}', 'src/main/index.ts')
    })
  })

  test('truncates large strings', () => {
    const result = sanitizeUnknownForLog({ value: 'x'.repeat(100) }, { maxChars: 20 })

    expect(JSON.stringify(result.value).length).toBeLessThan(80)
    expect(result.truncated).toBe(true)
  })

  test('handles circular objects', () => {
    const value: Record<string, unknown> = { name: 'root' }
    value.self = value

    const result = sanitizeUnknownForLog(value)

    expect(result.value).toEqual({ name: 'root', self: '[circular]' })
  })
})

describe('sanitizeLogEvent', () => {
  test('preserves error name, message, and stack without raw fields', () => {
    const error = new Error('boom')
    error.stack = `Error: boom\n    at run (${path.join(userData, 'app.js')}:1:1)`

    const event = sanitizeLogEvent(
      {
        level: 'error',
        source: 'main',
        module: 'ConfigSync',
        event: 'sync.failed',
        fields: { token: 'secret-token' },
        error
      },
      {
        appVersion: '0.1.0',
        userDataPath: userData
      }
    )

    expect(event.error?.name).toBe('Error')
    expect(event.error?.message).toBe('boom')
    expect(event.error?.stack).toContain('{userData}')
    expect(JSON.stringify(event.fields)).not.toContain('secret-token')
  })
})
```

- [ ] **Step 2: Run sanitizer tests to verify failure**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test -- tests/main/logging/sanitizer.test.ts
```

Expected: FAIL because `sanitizer.ts` does not exist.

- [ ] **Step 3: Implement sanitizer**

Create `petclaw-desktop/src/main/logging/sanitizer.ts`:

```typescript
import os from 'os'
import path from 'path'

import {
  DEFAULT_EVENT_MAX_CHARS,
  type LogEventInput,
  type SanitizedError,
  type SanitizedLogEvent
} from './types'

const REDACTED = '[redacted]'
const CIRCULAR = '[circular]'

const SENSITIVE_KEY_PATTERN =
  /(api[-_]?key|token|secret|password|authorization|cookie|session|refresh[-_]?token|access[-_]?token|gateway[-_]?token)/i

const SENSITIVE_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/g,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
]

export interface SanitizeOptions {
  maxChars?: number
  userDataPath?: string
  workspacePath?: string
  tempPath?: string
  homePath?: string
}

export interface SanitizedValue {
  value: unknown
  redactionCount: number
  truncated: boolean
}

function replaceAllPathSeparators(value: string): string {
  return value.split(path.sep).join('/')
}

function normalizePathText(value: string, options: SanitizeOptions): string {
  const replacements: Array<[string | undefined, string]> = [
    [options.userDataPath, '{userData}'],
    [options.workspacePath, '{workspace}'],
    [options.tempPath ?? os.tmpdir(), '{temp}'],
    [options.homePath ?? os.homedir(), '{home}']
  ]

  let next = value
  for (const [sourcePath, label] of replacements) {
    if (!sourcePath) continue
    next = next.split(sourcePath).join(label)
    next = next.split(replaceAllPathSeparators(sourcePath)).join(label)
  }
  return next
}

function redactString(value: string): { value: string; redactionCount: number } {
  let redactionCount = 0
  let next = value
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    next = next.replace(pattern, () => {
      redactionCount += 1
      return REDACTED
    })
  }
  return { value: next, redactionCount }
}

function truncateString(value: string, maxChars: number): { value: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { value, truncated: false }
  }
  return {
    value: `${value.slice(0, maxChars)}[truncated:${value.length - maxChars}]`,
    truncated: true
  }
}

function sanitizeInternal(
  value: unknown,
  options: Required<Pick<SanitizeOptions, 'maxChars'>> & SanitizeOptions,
  seen: WeakSet<object>,
  keyName?: string
): SanitizedValue {
  if (typeof value === 'string') {
    if (keyName && SENSITIVE_KEY_PATTERN.test(keyName)) {
      return { value: REDACTED, redactionCount: 1, truncated: false }
    }
    const normalized = normalizePathText(value, options)
    const redacted = redactString(normalized)
    const truncated = truncateString(redacted.value, options.maxChars)
    return {
      value: truncated.value,
      redactionCount: redacted.redactionCount,
      truncated: truncated.truncated
    }
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return { value, redactionCount: 0, truncated: false }
  }

  if (typeof value === 'bigint') {
    return { value: value.toString(), redactionCount: 0, truncated: false }
  }

  if (Array.isArray(value)) {
    let redactionCount = 0
    let truncated = false
    const next = value.slice(0, 50).map((item) => {
      const result = sanitizeInternal(item, options, seen)
      redactionCount += result.redactionCount
      truncated ||= result.truncated
      return result.value
    })
    if (value.length > 50) {
      next.push(`[truncatedItems:${value.length - 50}]`)
      truncated = true
    }
    return { value: next, redactionCount, truncated }
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return { value: CIRCULAR, redactionCount: 0, truncated: false }
    }
    seen.add(value)
    let redactionCount = 0
    let truncated = false
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 50)
    const next: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of entries) {
      const result = sanitizeInternal(entryValue, options, seen, entryKey)
      next[entryKey] = result.value
      redactionCount += result.redactionCount
      truncated ||= result.truncated
    }
    const originalCount = Object.keys(value as Record<string, unknown>).length
    if (originalCount > 50) {
      next.__truncatedKeys = originalCount - 50
      truncated = true
    }
    return { value: next, redactionCount, truncated }
  }

  return { value: String(value), redactionCount: 0, truncated: false }
}

export function sanitizeUnknownForLog(value: unknown, options: SanitizeOptions = {}): SanitizedValue {
  return sanitizeInternal(
    value,
    {
      ...options,
      maxChars: options.maxChars ?? DEFAULT_EVENT_MAX_CHARS
    },
    new WeakSet<object>()
  )
}

function sanitizeError(error: unknown, options: SanitizeOptions): SanitizedError | undefined {
  if (!(error instanceof Error)) return undefined
  const stack = error.stack
    ? String(sanitizeUnknownForLog(error.stack, options).value)
    : undefined
  return {
    name: error.name,
    message: String(sanitizeUnknownForLog(error.message, options).value),
    ...(stack ? { stack } : {})
  }
}

export function sanitizeLogEvent(
  input: LogEventInput,
  options: SanitizeOptions & { appVersion: string }
): SanitizedLogEvent {
  const fields = sanitizeUnknownForLog(input.fields ?? {}, options)
  const message = input.message
    ? String(sanitizeUnknownForLog(input.message, options).value)
    : input.event
  const error = sanitizeError(input.error, options)

  return {
    timestamp: new Date().toISOString(),
    level: input.level,
    source: input.source,
    module: input.module,
    event: input.event,
    message,
    platform: process.platform,
    arch: process.arch,
    appVersion: options.appVersion,
    fields: fields.value as Record<string, unknown>,
    ...(error ? { error } : {}),
    redactionCount: fields.redactionCount,
    truncated: fields.truncated
  }
}
```

- [ ] **Step 4: Run sanitizer tests**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test -- tests/main/logging/sanitizer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/main/logging/sanitizer.ts petclaw-desktop/tests/main/logging/sanitizer.test.ts
git commit -m "feat(desktop): add log sanitizer"
```

---

### Task 3: Log Storage And Facade

**Files:**
- Create: `petclaw-desktop/src/main/logging/storage.ts`
- Create: `petclaw-desktop/src/main/logging/facade.ts`
- Create: `petclaw-desktop/src/main/logging/index.ts`
- Modify: `petclaw-desktop/src/main/logger.ts`
- Test: `petclaw-desktop/tests/main/logging/storage.test.ts`
- Test: `petclaw-desktop/tests/main/logging/facade.test.ts`

- [ ] **Step 1: Write failing storage tests**

Create `petclaw-desktop/tests/main/logging/storage.test.ts`:

```typescript
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createLogStorage } from '../../../src/main/logging/storage'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-log-storage-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('createLogStorage', () => {
  test('writes json lines into the source daily file', () => {
    const storage = createLogStorage({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })

    storage.write({
      level: 'info',
      source: 'main',
      module: 'App',
      event: 'app.started',
      fields: { token: 'secret-token' }
    })

    const filePath = path.join(root, 'logs', 'main', 'main-2026-05-05.log')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).toContain('"event":"app.started"')
    expect(content).toContain('[redacted]')
    expect(content).not.toContain('secret-token')
  })

  test('reports snapshot entries for every source', () => {
    const storage = createLogStorage({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })

    const snapshot = storage.snapshot()

    expect(snapshot.writable).toBe(true)
    expect(snapshot.sources.some((source) => source.source === 'main')).toBe(true)
    expect(snapshot.sources.some((source) => source.source === 'gateway')).toBe(true)
  })
})
```

- [ ] **Step 2: Write failing facade tests**

Create `petclaw-desktop/tests/main/logging/facade.test.ts`:

```typescript
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createLoggingPlatform } from '../../../src/main/logging/facade'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-log-facade-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('createLoggingPlatform', () => {
  test('creates scoped loggers that write sanitized events', () => {
    const platform = createLoggingPlatform({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })

    const logger = platform.getLogger('ConfigSync')
    logger.error('sync.failed', { gatewayToken: 'secret-token' }, new Error('boom'))

    const filePath = path.join(root, 'logs', 'main', 'main-2026-05-05.log')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).toContain('"module":"ConfigSync"')
    expect(content).toContain('"event":"sync.failed"')
    expect(content).toContain('"message":"boom"')
    expect(content).not.toContain('secret-token')
  })

  test('supports renderer reports as renderer source events', () => {
    const platform = createLoggingPlatform({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })

    platform.reportRendererLog({
      level: 'error',
      module: 'BootCheckPanel',
      event: 'renderer.render.failed',
      message: 'render failed',
      fields: { apiKey: 'secret' }
    })

    const filePath = path.join(root, 'logs', 'renderer', 'renderer-2026-05-05.log')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).toContain('"source":"renderer"')
    expect(content).not.toContain('secret')
  })
})
```

- [ ] **Step 3: Run failing storage and facade tests**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test -- tests/main/logging/storage.test.ts tests/main/logging/facade.test.ts
```

Expected: FAIL because storage and facade do not exist.

- [ ] **Step 4: Implement storage**

Create `petclaw-desktop/src/main/logging/storage.ts`:

```typescript
import fs from 'fs'
import path from 'path'

import { resolveLoggingPaths } from './paths'
import { sanitizeLogEvent } from './sanitizer'
import {
  DEFAULT_LOG_MAX_SIZE_BYTES,
  DEFAULT_LOG_RETENTION_DAYS,
  type DiagnosticsSnapshot,
  type LogEventInput,
  type LogSource
} from './types'

export interface LogStorageOptions {
  userDataPath: string
  appVersion: string
  now?: () => Date
  maxSizeBytes?: number
  retentionDays?: number
}

export interface LogStorage {
  write(input: LogEventInput): void
  snapshot(): DiagnosticsSnapshot
  getCurrentFile(source: LogSource): string
  getRecentEntries(source: LogSource, days: number): Array<{ archiveName: string; filePath: string }>
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function rotateIfNeeded(filePath: string, maxSizeBytes: number): void {
  if (!fs.existsSync(filePath)) return
  const stat = fs.statSync(filePath)
  if (stat.size < maxSizeBytes) return

  let index = 1
  let rotated = filePath.replace(/\.log$/, `.${index}.log`)
  while (fs.existsSync(rotated)) {
    index += 1
    rotated = filePath.replace(/\.log$/, `.${index}.log`)
  }
  fs.renameSync(filePath, rotated)
}

function sourceFilePattern(source: LogSource): RegExp {
  if (source === 'startup') return /^startup-diagnostics\.jsonl$/
  if (source === 'installer') return /^installer\.log$/
  return new RegExp(`^${source}-\\d{4}-\\d{2}-\\d{2}(?:\\.\\d+)?\\.log$`)
}

export function createLogStorage(options: LogStorageOptions): LogStorage {
  const now = options.now ?? (() => new Date())
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_LOG_MAX_SIZE_BYTES
  const paths = resolveLoggingPaths(options.userDataPath, now())
  const errors: DiagnosticsSnapshot['errors'] = []

  function getCurrentFile(source: LogSource): string {
    return resolveLoggingPaths(options.userDataPath, now()).sources[source].currentFile
  }

  function write(input: LogEventInput): void {
    const filePath = getCurrentFile(input.source)
    try {
      ensureDir(path.dirname(filePath))
      rotateIfNeeded(filePath, maxSizeBytes)
      const event = sanitizeLogEvent(input, {
        appVersion: options.appVersion,
        userDataPath: options.userDataPath
      })
      fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ source: input.source, message })
    }
  }

  function snapshot(): DiagnosticsSnapshot {
    return {
      writable: errors.length === 0,
      sources: Object.entries(paths.sources).map(([source, sourcePaths]) => ({
        source: source as LogSource,
        dir: sourcePaths.dir,
        currentFile: getCurrentFile(source as LogSource),
        exists: fs.existsSync(sourcePaths.dir)
      })),
      errors: [...errors]
    }
  }

  function getRecentEntries(
    source: LogSource,
    days: number
  ): Array<{ archiveName: string; filePath: string }> {
    const dir = paths.sources[source].dir
    if (!fs.existsSync(dir)) return []
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000
    const pattern = sourceFilePattern(source)
    return fs
      .readdirSync(dir)
      .filter((name) => pattern.test(name))
      .map((name) => ({ archiveName: `${source}/${name}`, filePath: path.join(dir, name) }))
      .filter(({ filePath }) => {
        try {
          return fs.statSync(filePath).mtimeMs >= cutoffMs
        } catch {
          return false
        }
      })
      .sort((a, b) => a.archiveName.localeCompare(b.archiveName))
  }

  return {
    write,
    snapshot,
    getCurrentFile,
    getRecentEntries
  }
}
```

- [ ] **Step 5: Implement facade and index exports**

Create `petclaw-desktop/src/main/logging/facade.ts`:

```typescript
import { app } from 'electron'

import { createLogStorage, type LogStorage } from './storage'
import type { LogEventInput, LogLevel, LogSource } from './types'

export interface ScopedLogger {
  debug(event: string, fields?: Record<string, unknown>, error?: unknown): void
  info(event: string, fields?: Record<string, unknown>, error?: unknown): void
  warn(event: string, fields?: Record<string, unknown>, error?: unknown): void
  error(event: string, fields?: Record<string, unknown>, error?: unknown): void
}

export interface RendererLogReport {
  level: Extract<LogLevel, 'warn' | 'error'>
  module: string
  event: string
  message?: string
  fields?: Record<string, unknown>
}

export interface LoggingPlatform {
  storage: LogStorage
  getLogger(module: string, source?: LogSource): ScopedLogger
  reportRendererLog(report: RendererLogReport): void
  snapshot: LogStorage['snapshot']
}

export interface LoggingPlatformOptions {
  userDataPath: string
  appVersion: string
  now?: () => Date
}

let activePlatform: LoggingPlatform | null = null

export function createLoggingPlatform(options: LoggingPlatformOptions): LoggingPlatform {
  const storage = createLogStorage(options)

  function write(level: LogLevel, source: LogSource, module: string, event: string, fields?: Record<string, unknown>, error?: unknown): void {
    const message = error instanceof Error ? error.message : event
    storage.write({ level, source, module, event, message, fields, error })
  }

  const platform: LoggingPlatform = {
    storage,
    getLogger(module: string, source: LogSource = 'main'): ScopedLogger {
      return {
        debug: (event, fields, error) => write('debug', source, module, event, fields, error),
        info: (event, fields, error) => write('info', source, module, event, fields, error),
        warn: (event, fields, error) => write('warn', source, module, event, fields, error),
        error: (event, fields, error) => write('error', source, module, event, fields, error)
      }
    },
    reportRendererLog(report: RendererLogReport): void {
      storage.write({
        level: report.level,
        source: 'renderer',
        module: report.module,
        event: report.event,
        message: report.message,
        fields: report.fields
      })
    },
    snapshot: storage.snapshot
  }

  return platform
}

export function initLoggingPlatform(): LoggingPlatform {
  activePlatform = createLoggingPlatform({
    userDataPath: app.getPath('userData'),
    appVersion: app.getVersion()
  })
  return activePlatform
}

export function getLoggingPlatform(): LoggingPlatform {
  if (!activePlatform) {
    return initLoggingPlatform()
  }
  return activePlatform
}

export function getLogger(module: string, source?: LogSource): ScopedLogger {
  return getLoggingPlatform().getLogger(module, source)
}
```

Create `petclaw-desktop/src/main/logging/index.ts`:

```typescript
export * from './types'
export * from './paths'
export * from './sanitizer'
export * from './storage'
export * from './facade'
```

- [ ] **Step 6: Keep `logger.ts` compatibility**

Modify `petclaw-desktop/src/main/logger.ts` so its public functions delegate to the new platform while preserving existing imports:

```typescript
import log from 'electron-log/main'

import { getLoggingPlatform, initLoggingPlatform } from './logging'

let initialized = false

export function initLogger(): void {
  if (initialized) return
  initialized = true

  const platform = initLoggingPlatform()
  const originalLog = console.log
  const originalError = console.error
  const originalWarn = console.warn
  const originalInfo = console.info
  const originalDebug = console.debug

  const consoleLogger = platform.getLogger('ConsoleCompat')

  console.log = (...args: unknown[]) => {
    originalLog.apply(console, args)
    consoleLogger.info('console.log', { args })
  }
  console.error = (...args: unknown[]) => {
    originalError.apply(console, args)
    const last = args.at(-1)
    consoleLogger.error('console.error', { args }, last instanceof Error ? last : undefined)
  }
  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args)
    const last = args.at(-1)
    consoleLogger.warn('console.warn', { args }, last instanceof Error ? last : undefined)
  }
  console.info = (...args: unknown[]) => {
    originalInfo.apply(console, args)
    consoleLogger.info('console.info', { args })
  }
  console.debug = (...args: unknown[]) => {
    originalDebug.apply(console, args)
    consoleLogger.debug('console.debug', { args })
  }
}

export function getLogFilePath(): string {
  return getLoggingPlatform().storage.getCurrentFile('main')
}

export function getRecentMainLogEntries(): Array<{ archiveName: string; filePath: string }> {
  return getLoggingPlatform().storage.getRecentEntries('main', 14)
}

export { log }
```

- [ ] **Step 7: Run storage and facade tests**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test -- tests/main/logging/storage.test.ts tests/main/logging/facade.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run existing logger compatibility tests**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test -- tests/main/logger.test.ts
```

Expected: tests should be updated if they assert the old 7-day retention or `.old` generation. The accepted architecture uses 14-day retention and indexed rotation. Change mirrored constants in `tests/main/logger.test.ts` to:

```typescript
const LOG_RETENTION_DAYS = 14
const LOG_FILE_RE = /^main-\d{4}-\d{2}-\d{2}(\.\d+)?\.log$/
```

Expected after test update: PASS.

- [ ] **Step 9: Commit**

```bash
git add petclaw-desktop/src/main/logging/storage.ts petclaw-desktop/src/main/logging/facade.ts petclaw-desktop/src/main/logging/index.ts petclaw-desktop/src/main/logger.ts petclaw-desktop/tests/main/logging/storage.test.ts petclaw-desktop/tests/main/logging/facade.test.ts petclaw-desktop/tests/main/logger.test.ts
git commit -m "feat(desktop): add logging storage and facade"
```

---

### Task 4: Logging IPC And Preload API

**Files:**
- Create: `petclaw-desktop/src/main/logging/logging-ipc.ts`
- Modify: `petclaw-desktop/src/main/ipc/index.ts`
- Modify: `petclaw-desktop/src/main/index.ts`
- Modify: `petclaw-desktop/src/preload/index.ts`
- Modify: `petclaw-desktop/src/preload/index.d.ts`
- Test: `petclaw-desktop/tests/main/ipc/logging-ipc.test.ts`

- [ ] **Step 1: Write failing IPC tests**

Create `petclaw-desktop/tests/main/ipc/logging-ipc.test.ts`:

```typescript
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createLoggingPlatform } from '../../../src/main/logging/facade'
import { validateRendererLogReport } from '../../../src/main/logging/logging-ipc'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-logging-ipc-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('validateRendererLogReport', () => {
  test('accepts warn and error reports', () => {
    expect(
      validateRendererLogReport({
        level: 'error',
        module: 'BootCheckPanel',
        event: 'renderer.render.failed',
        message: 'failed',
        fields: { retry: true }
      })
    ).toEqual({
      level: 'error',
      module: 'BootCheckPanel',
      event: 'renderer.render.failed',
      message: 'failed',
      fields: { retry: true }
    })
  })

  test('rejects info reports from renderer', () => {
    expect(() =>
      validateRendererLogReport({
        level: 'info',
        module: 'BootCheckPanel',
        event: 'renderer.click'
      })
    ).toThrow('Invalid renderer log level')
  })

  test('rejects oversized event names', () => {
    expect(() =>
      validateRendererLogReport({
        level: 'error',
        module: 'BootCheckPanel',
        event: 'x'.repeat(200)
      })
    ).toThrow('Invalid renderer log event')
  })
})
```

- [ ] **Step 2: Run failing IPC tests**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test -- tests/main/ipc/logging-ipc.test.ts
```

Expected: FAIL because `logging-ipc.ts` does not exist.

- [ ] **Step 3: Implement logging IPC validation and registration**

Create `petclaw-desktop/src/main/logging/logging-ipc.ts`:

```typescript
import { shell } from 'electron'

import { safeHandle } from '../ipc/ipc-registry'
import { getLoggingPlatform, type RendererLogReport } from './facade'
import { exportDiagnosticsBundle } from './diagnostics-bundle'
import type { DiagnosticsExportOptions } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`Invalid renderer log ${label}`)
  }
  return value
}

export function validateRendererLogReport(value: unknown): RendererLogReport {
  if (!isRecord(value)) throw new Error('Invalid renderer log report')
  if (value.level !== 'warn' && value.level !== 'error') {
    throw new Error('Invalid renderer log level')
  }

  return {
    level: value.level,
    module: readString(value.module, 'module', 80),
    event: readString(value.event, 'event', 120),
    ...(typeof value.message === 'string' ? { message: value.message.slice(0, 500) } : {}),
    ...(isRecord(value.fields) ? { fields: value.fields } : {})
  }
}

function validateExportOptions(value: unknown): DiagnosticsExportOptions {
  if (!isRecord(value)) return { timeRangeDays: 3 }
  const timeRangeDays =
    value.timeRangeDays === 1 || value.timeRangeDays === 3 || value.timeRangeDays === 7
      ? value.timeRangeDays
      : 3
  return { timeRangeDays }
}

export function registerLoggingIpcHandlers(): void {
  safeHandle('logging:report', (_event, payload: unknown) => {
    getLoggingPlatform().reportRendererLog(validateRendererLogReport(payload))
  })

  safeHandle('logging:snapshot', () => getLoggingPlatform().snapshot())

  safeHandle('logging:export-diagnostics', async (_event, payload: unknown) => {
    return exportDiagnosticsBundle(validateExportOptions(payload))
  })

  safeHandle('logging:open-log-folder', async () => {
    const snapshot = getLoggingPlatform().snapshot()
    const mainSource = snapshot.sources.find((source) => source.source === 'main')
    if (!mainSource) throw new Error('Main log source is unavailable')
    await shell.openPath(mainSource.dir)
  })
}
```

- [ ] **Step 4: Wire IPC registration**

Modify `petclaw-desktop/src/main/ipc/index.ts`:

```typescript
import { registerLoggingIpcHandlers } from '../logging/logging-ipc'
```

Add this export at the bottom:

```typescript
export { registerBootIpcHandlers, registerSettingsIpcHandlers, registerLoggingIpcHandlers }
```

Modify `petclaw-desktop/src/main/index.ts` in the Phase A registration block. Register logging IPC with boot/settings IPC before boot check starts:

```typescript
registerLoggingIpcHandlers()
```

- [ ] **Step 5: Expose preload API**

Modify `petclaw-desktop/src/preload/index.ts` by adding a top-level `logging` object inside `api`:

```typescript
  logging: {
    report: (event: {
      level: 'warn' | 'error'
      module: string
      event: string
      message?: string
      fields?: Record<string, unknown>
    }): Promise<void> => ipcRenderer.invoke('logging:report', event),
    snapshot: (): Promise<unknown> => ipcRenderer.invoke('logging:snapshot'),
    exportDiagnostics: (options: { timeRangeDays: 1 | 3 | 7 }): Promise<unknown> =>
      ipcRenderer.invoke('logging:export-diagnostics', options),
    openLogFolder: (): Promise<void> => ipcRenderer.invoke('logging:open-log-folder')
  },
```

Modify `petclaw-desktop/src/preload/index.d.ts` by adding this property to `ElectronAPI`:

```typescript
  logging: {
    report: (event: {
      level: 'warn' | 'error'
      module: string
      event: string
      message?: string
      fields?: Record<string, unknown>
    }) => Promise<void>
    snapshot: () => Promise<unknown>
    exportDiagnostics: (options: { timeRangeDays: 1 | 3 | 7 }) => Promise<unknown>
    openLogFolder: () => Promise<void>
  }
```

- [ ] **Step 6: Run IPC tests and typecheck**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test -- tests/main/ipc/logging-ipc.test.ts
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add petclaw-desktop/src/main/logging/logging-ipc.ts petclaw-desktop/src/main/ipc/index.ts petclaw-desktop/src/main/index.ts petclaw-desktop/src/preload/index.ts petclaw-desktop/src/preload/index.d.ts petclaw-desktop/tests/main/ipc/logging-ipc.test.ts
git commit -m "feat(desktop): expose logging diagnostics ipc"
```

---

### Task 5: Diagnostics Bundle Export

**Files:**
- Modify: `petclaw-desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `petclaw-desktop/src/main/logging/diagnostics-bundle.ts`
- Modify: `petclaw-desktop/src/main/logging/facade.ts`
- Modify: `petclaw-desktop/src/main/logging/index.ts`
- Test: `petclaw-desktop/tests/main/logging/diagnostics-bundle.test.ts`

- [ ] **Step 1: Add zip dependency**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop add fflate
```

Expected: `fflate` is added to `petclaw-desktop/package.json` dependencies and `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Write failing diagnostics bundle tests**

Create `petclaw-desktop/tests/main/logging/diagnostics-bundle.test.ts`:

```typescript
import fs from 'fs'
import os from 'os'
import path from 'path'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createLogStorage } from '../../../src/main/logging/storage'
import { createDiagnosticsBundle } from '../../../src/main/logging/diagnostics-bundle'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-diagnostics-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('createDiagnosticsBundle', () => {
  test('exports sanitized logs and manifest', async () => {
    const storage = createLogStorage({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })
    storage.write({
      level: 'error',
      source: 'main',
      module: 'ConfigSync',
      event: 'sync.failed',
      fields: { token: 'secret-token' }
    })

    const result = await createDiagnosticsBundle({
      userDataPath: root,
      appVersion: '0.1.0',
      storage,
      options: { timeRangeDays: 3 },
      now: () => new Date('2026-05-05T10:05:00.000Z')
    })

    expect(fs.existsSync(result.filePath)).toBe(true)
    expect(result.filePath.endsWith('.zip')).toBe(true)

    const archive = unzipSync(fs.readFileSync(result.filePath))
    const manifest = JSON.parse(strFromU8(archive['manifest.json']))
    const mainLog = strFromU8(archive['logs/main/main-2026-05-05.log'])

    expect(manifest.includedSources).toContain('main')
    expect(manifest.redactionCounts).toBeGreaterThanOrEqual(1)
    expect(mainLog).toContain('[redacted]')
    expect(mainLog).not.toContain('secret-token')
  })
})
```

- [ ] **Step 3: Run failing diagnostics bundle test**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test -- tests/main/logging/diagnostics-bundle.test.ts
```

Expected: FAIL because diagnostics bundle does not exist.

- [ ] **Step 4: Store userDataPath and appVersion on the platform**

Modify `petclaw-desktop/src/main/logging/facade.ts` so `LoggingPlatform` exposes the values diagnostics export needs:

```typescript
export interface LoggingPlatform {
  userDataPath: string
  appVersion: string
  storage: LogStorage
  getLogger(module: string, source?: LogSource): ScopedLogger
  reportRendererLog(report: RendererLogReport): void
  snapshot: LogStorage['snapshot']
}
```

Update the `platform` object inside `createLoggingPlatform`:

```typescript
const platform: LoggingPlatform = {
  userDataPath: options.userDataPath,
  appVersion: options.appVersion,
  storage,
  getLogger(module: string, source: LogSource = 'main'): ScopedLogger {
    return {
      debug: (event, fields, error) => write('debug', source, module, event, fields, error),
      info: (event, fields, error) => write('info', source, module, event, fields, error),
      warn: (event, fields, error) => write('warn', source, module, event, fields, error),
      error: (event, fields, error) => write('error', source, module, event, fields, error)
    }
  },
  reportRendererLog(report: RendererLogReport): void {
    storage.write({
      level: report.level,
      source: 'renderer',
      module: report.module,
      event: report.event,
      message: report.message,
      fields: report.fields
    })
  },
  snapshot: storage.snapshot
}
```

- [ ] **Step 5: Implement deterministic zip diagnostics archive**

Create `petclaw-desktop/src/main/logging/diagnostics-bundle.ts`:

```typescript
import fs from 'fs'
import path from 'path'
import { strToU8, zipSync } from 'fflate'

import { resolveLoggingPaths } from './paths'
import { sanitizeUnknownForLog } from './sanitizer'
import { getLoggingPlatform } from './facade'
import type {
  DiagnosticsExportOptions,
  DiagnosticsExportResult,
  LogSource
} from './types'
import type { LogStorage } from './storage'

const DEFAULT_SOURCES: LogSource[] = [
  'main',
  'renderer',
  'startup',
  'cowork',
  'mcp',
  'gateway',
  'runtime',
  'updater',
  'installer'
]

function formatBundleTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '')
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function addJsonFile(files: Record<string, Uint8Array>, archiveName: string, value: unknown): void {
  files[archiveName] = strToU8(JSON.stringify(value, null, 2))
}

interface CreateDiagnosticsBundleOptions {
  userDataPath: string
  appVersion: string
  storage: LogStorage
  options: DiagnosticsExportOptions
  now?: () => Date
}

export async function createDiagnosticsBundle(
  input: CreateDiagnosticsBundleOptions
): Promise<DiagnosticsExportResult> {
  const now = input.now ?? (() => new Date())
  const paths = resolveLoggingPaths(input.userDataPath, now())
  ensureDir(paths.diagnostics.dir)

  const exportWarnings: string[] = []
  let redactionCount = 0
  const sources = input.options.includeSources ?? DEFAULT_SOURCES
  const filePath = path.join(
    paths.diagnostics.dir,
    `petclaw-diagnostics-${formatBundleTimestamp(now())}.zip`
  )
  const files: Record<string, Uint8Array> = {}

  addJsonFile(files, 'metadata/app.json', {
    appVersion: input.appVersion
  })
  addJsonFile(files, 'metadata/platform.json', {
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    chrome: process.versions.chrome ?? null
  })

  for (const source of sources) {
    const entries = input.storage.getRecentEntries(source, input.options.timeRangeDays)
    for (const entry of entries) {
      try {
        const raw = fs.readFileSync(entry.filePath, 'utf8')
        const sanitized = sanitizeUnknownForLog(raw, { userDataPath: input.userDataPath })
        redactionCount += sanitized.redactionCount
        files[`logs/${entry.archiveName}`] = strToU8(String(sanitized.value))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        exportWarnings.push(`${source}: ${message}`)
      }
    }
  }

  addJsonFile(files, 'manifest.json', {
    createdAt: now().toISOString(),
    appVersion: input.appVersion,
    platform: process.platform,
    arch: process.arch,
    logTimeRange: input.options.timeRangeDays,
    includedSources: sources,
    redactionVersion: 1,
    redactionCounts: redactionCount,
    exportErrors: exportWarnings
  })

  fs.writeFileSync(filePath, zipSync(files), 'binary')
  const sizeBytes = fs.statSync(filePath).size
  return { filePath, sizeBytes, redactionCount, exportWarnings }
}

export async function exportDiagnosticsBundle(
  options: DiagnosticsExportOptions
): Promise<DiagnosticsExportResult> {
  const platform = getLoggingPlatform()
  return createDiagnosticsBundle({
    userDataPath: platform.userDataPath,
    appVersion: platform.appVersion,
    storage: platform.storage,
    options
  })
}
```

- [ ] **Step 6: Export diagnostics bundle APIs**

Modify `petclaw-desktop/src/main/logging/index.ts`:

```typescript
export * from './diagnostics-bundle'
```

- [ ] **Step 7: Run diagnostics bundle tests**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test -- tests/main/logging/diagnostics-bundle.test.ts tests/main/logging/facade.test.ts tests/main/ipc/logging-ipc.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add petclaw-desktop/package.json pnpm-lock.yaml petclaw-desktop/src/main/logging/diagnostics-bundle.ts petclaw-desktop/src/main/logging/facade.ts petclaw-desktop/src/main/logging/index.ts petclaw-desktop/tests/main/logging/diagnostics-bundle.test.ts
git commit -m "feat(desktop): add diagnostics bundle export"
```

---

### Task 6: Migrate Startup, Cowork, Gateway, MCP, And Updater Logs

**Files:**
- Create: `petclaw-desktop/src/main/logging/process-logger.ts`
- Modify: `petclaw-desktop/src/main/diagnostics.ts`
- Modify: `petclaw-desktop/src/main/ai/cowork-logger.ts`
- Modify: `petclaw-desktop/src/main/ai/engine-manager.ts`
- Modify: `petclaw-desktop/src/main/mcp/mcp-bridge-server.ts`
- Modify: `petclaw-desktop/src/main/mcp/mcp-server-manager.ts`
- Modify: `petclaw-desktop/src/main/auto-updater.ts`
- Test: `petclaw-desktop/tests/main/logging/process-logger.test.ts`
- Test: existing targeted tests for each touched module.

- [ ] **Step 1: Write process logger tests**

Create `petclaw-desktop/tests/main/logging/process-logger.test.ts`:

```typescript
import { PassThrough } from 'stream'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createLoggingPlatform } from '../../../src/main/logging/facade'
import { attachProcessLogger } from '../../../src/main/logging/process-logger'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-process-logger-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('attachProcessLogger', () => {
  test('writes stdout and stderr to the selected source with redaction', () => {
    const platform = createLoggingPlatform({
      userDataPath: root,
      appVersion: '0.1.0',
      now: () => new Date('2026-05-05T10:00:00.000Z')
    })
    const stdout = new PassThrough()
    const stderr = new PassThrough()

    attachProcessLogger({
      platform,
      source: 'gateway',
      module: 'OpenClaw',
      stdout,
      stderr
    })

    stdout.write('[gateway] started token=secret-token\n')
    stderr.write('Bearer eyJhbGciOiJIUzI1NiJ9.abc.def\n')

    const filePath = path.join(root, 'openclaw', 'logs', 'gateway', 'gateway-2026-05-05.log')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).toContain('[redacted]')
    expect(content).not.toContain('secret-token')
    expect(content).not.toContain('Bearer eyJ')
  })
})
```

- [ ] **Step 2: Implement process logger**

Create `petclaw-desktop/src/main/logging/process-logger.ts`:

```typescript
import type { Readable } from 'stream'

import type { LoggingPlatform } from './facade'
import type { LogSource } from './types'

export interface AttachProcessLoggerOptions {
  platform: LoggingPlatform
  source: Extract<LogSource, 'gateway' | 'runtime' | 'installer' | 'updater'>
  module: string
  stdout?: Readable | null
  stderr?: Readable | null
}

function chunkToText(chunk: Buffer | string): string {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf8')
}

export function attachProcessLogger(options: AttachProcessLoggerOptions): void {
  const logger = options.platform.getLogger(options.module, options.source)

  options.stdout?.on('data', (chunk: Buffer | string) => {
    const text = chunkToText(chunk)
    logger.info('process.stdout', { text })
    if (/\[gateway\]/.test(text)) {
      options.platform.getLogger(options.module).warn('process.milestone', {
        source: options.source,
        summary: text.replace(/\n+$/g, '').split('\n')[0]
      })
    }
  })

  options.stderr?.on('data', (chunk: Buffer | string) => {
    logger.warn('process.stderr', { text: chunkToText(chunk) })
  })
}
```

- [ ] **Step 3: Migrate startup diagnostics**

Modify `petclaw-desktop/src/main/diagnostics.ts` so `writeDiag` uses startup logger:

```typescript
import { app } from 'electron'

import { getLogger } from './logging'

const startupLogger = () => getLogger('StartupDiagnostics', 'startup')

function writeDiag(event: string, extra?: Record<string, unknown>): void {
  try {
    startupLogger().info(event, {
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
      ...extra
    })
  } catch {
    // 诊断日志失败不影响启动主流程。
  }
}
```

Keep existing exported functions unchanged: `diagAppReady`, `diagBootResult`, `diagWindowLoad`, `diagError`.

- [ ] **Step 4: Migrate Cowork logger**

Modify `petclaw-desktop/src/main/ai/cowork-logger.ts`:

```typescript
import { getLogger, getLoggingPlatform } from '../logging'

function levelToMethod(level: 'INFO' | 'WARN' | 'ERROR'): 'info' | 'warn' | 'error' {
  if (level === 'ERROR') return 'error'
  if (level === 'WARN') return 'warn'
  return 'info'
}

export function coworkLog(
  level: 'INFO' | 'WARN' | 'ERROR',
  tag: string,
  message: string,
  extra?: Record<string, unknown>
): void {
  const logger = getLogger(tag, 'cowork')
  logger[levelToMethod(level)](`cowork.${tag}.${message}`, extra)
}

export function getCoworkLogPath(): string {
  return getLoggingPlatform().storage.getCurrentFile('cowork')
}

export function resetLogFilePathForTest(): void {
  // Kept for old tests; path cache no longer exists.
}
```

Update `petclaw-desktop/tests/main/ai/cowork-logger.test.ts` to assert the current file path comes from `{userData}/logs/cowork/cowork-YYYY-MM-DD.log` and that redaction applies.

- [ ] **Step 5: Migrate Gateway process capture**

In `petclaw-desktop/src/main/ai/engine-manager.ts`, replace manual append logic inside `attachGatewayProcessLogs` with:

```typescript
import { attachProcessLogger, getLoggingPlatform } from '../logging'
```

Then implement:

```typescript
private attachGatewayProcessLogs(child: GatewayProcess): void {
  attachProcessLogger({
    platform: getLoggingPlatform(),
    source: 'gateway',
    module: 'OpenClaw',
    stdout: child.stdout,
    stderr: child.stderr
  })
}
```

Keep `rewriteUtcTimestamps` if other tests or UI depend on it. If no callers remain, remove it only after `rg "rewriteUtcTimestamps"` confirms no references outside tests, and update tests in the same commit.

- [ ] **Step 6: Migrate MCP logs**

In `petclaw-desktop/src/main/mcp/mcp-bridge-server.ts` and `petclaw-desktop/src/main/mcp/mcp-server-manager.ts`, replace local `console.log/warn/error` helpers with scoped loggers:

```typescript
import { getLogger } from '../logging'

const logger = getLogger('MCP', 'mcp')

function logMcp(level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>, error?: unknown): void {
  logger[level](event, fields, error)
}
```

Keep `mcp-log.ts` sanitizer helpers if they are used to produce safe user-facing summaries; do not duplicate the sanitizer logic into MCP modules.

- [ ] **Step 7: Mirror updater lifecycle events**

In `petclaw-desktop/src/main/auto-updater.ts`, keep `autoUpdater.logger = log` for library compatibility and add:

```typescript
import { getLogger } from './logging'

const updaterLogger = getLogger('AutoUpdater', 'updater')
```

For updater status transitions, call:

```typescript
updaterLogger.info('updater.check.started')
updaterLogger.info('updater.download.started', { version: info.version })
updaterLogger.error('updater.download.failed', undefined, error)
```

Use existing events in that file; do not add duplicate update checks.

- [ ] **Step 8: Run targeted tests**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test -- tests/main/logging/process-logger.test.ts tests/main/ai/cowork-logger.test.ts tests/main/mcp/mcp-log.test.ts tests/main/diagnostics.test.ts
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add petclaw-desktop/src/main/logging/process-logger.ts petclaw-desktop/src/main/diagnostics.ts petclaw-desktop/src/main/ai/cowork-logger.ts petclaw-desktop/src/main/ai/engine-manager.ts petclaw-desktop/src/main/mcp/mcp-bridge-server.ts petclaw-desktop/src/main/mcp/mcp-server-manager.ts petclaw-desktop/src/main/auto-updater.ts petclaw-desktop/tests/main/logging/process-logger.test.ts petclaw-desktop/tests/main/ai/cowork-logger.test.ts petclaw-desktop/tests/main/diagnostics.test.ts
git commit -m "feat(desktop): migrate core log streams"
```

---

### Task 7: Renderer Diagnostics UI And i18n

**Files:**
- Modify: `petclaw-desktop/src/renderer/src/views/boot/BootCheckPanel.tsx`
- Modify: `petclaw-desktop/src/renderer/src/views/settings/EngineSettings.tsx`
- Modify: `petclaw-desktop/src/renderer/src/views/settings/AboutSettings.tsx`
- Modify: `petclaw-shared/src/i18n/locales/zh.ts`
- Modify: `petclaw-shared/src/i18n/locales/en.ts`
- Test: `petclaw-desktop/tests/renderer/views/diagnostics-actions.test.tsx`

- [ ] **Step 1: Add i18n keys**

Add to `petclaw-shared/src/i18n/locales/zh.ts`:

```typescript
'logging.openLogFolder': '打开日志目录',
'logging.exportDiagnostics': '导出诊断包',
'logging.exporting': '正在导出…',
'logging.exportSuccess': '诊断包已导出',
'logging.exportFailed': '诊断包导出失败：{error}',
'logging.snapshotUnavailable': '日志状态暂不可用',
'logging.copySummary': '复制脱敏诊断摘要',
'logging.timeRange1': '最近 1 天',
'logging.timeRange3': '最近 3 天',
'logging.timeRange7': '最近 7 天',
```

Add to `petclaw-shared/src/i18n/locales/en.ts`:

```typescript
'logging.openLogFolder': 'Open log folder',
'logging.exportDiagnostics': 'Export diagnostics',
'logging.exporting': 'Exporting…',
'logging.exportSuccess': 'Diagnostics exported',
'logging.exportFailed': 'Diagnostics export failed: {error}',
'logging.snapshotUnavailable': 'Logging status unavailable',
'logging.copySummary': 'Copy redacted diagnostics summary',
'logging.timeRange1': 'Last 1 day',
'logging.timeRange3': 'Last 3 days',
'logging.timeRange7': 'Last 7 days',
```

- [ ] **Step 2: Add diagnostics action helpers in renderer files**

In each touched renderer component, use local state and real IPC actions:

```typescript
const [diagnosticsStatus, setDiagnosticsStatus] = useState<string | null>(null)
const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false)

const handleOpenLogFolder = async () => {
  try {
    await window.api.logging.openLogFolder()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setDiagnosticsStatus(t('logging.exportFailed', { error: message }))
    await window.api.logging.report({
      level: 'error',
      module: 'EngineSettings',
      event: 'renderer.logging.openLogFolder.failed',
      message
    })
  }
}

const handleExportDiagnostics = async () => {
  setIsExportingDiagnostics(true)
  try {
    await window.api.logging.exportDiagnostics({ timeRangeDays: 3 })
    setDiagnosticsStatus(t('logging.exportSuccess'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setDiagnosticsStatus(t('logging.exportFailed', { error: message }))
    await window.api.logging.report({
      level: 'error',
      module: 'EngineSettings',
      event: 'renderer.logging.exportDiagnostics.failed',
      message
    })
  } finally {
    setIsExportingDiagnostics(false)
  }
}
```

Use module names matching the component: `BootCheckPanel`, `EngineSettings`, `AboutSettings`.

- [ ] **Step 3: Add visible buttons with real behavior**

In error state of `BootCheckPanel.tsx`, add buttons near retry:

```tsx
<button
  type="button"
  onClick={handleOpenLogFolder}
  className="h-9 px-3 rounded-[8px] border border-border text-[13px] text-text-primary hover:bg-bg-hover"
>
  {t('logging.openLogFolder')}
</button>
<button
  type="button"
  onClick={handleExportDiagnostics}
  disabled={isExportingDiagnostics}
  className="h-9 px-3 rounded-[8px] bg-text-primary text-bg-primary text-[13px] disabled:opacity-50"
>
  {isExportingDiagnostics ? t('logging.exporting') : t('logging.exportDiagnostics')}
</button>
```

In `EngineSettings.tsx` and `AboutSettings.tsx`, add the same actions inside existing settings cards. Do not create nested cards; use existing row layout with buttons on the right.

- [ ] **Step 4: Write renderer tests**

Create `petclaw-desktop/tests/renderer/views/diagnostics-actions.test.tsx`:

```typescript
import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { EngineSettings } from '../../../src/renderer/src/views/settings/EngineSettings'

describe('diagnostics actions', () => {
  test('EngineSettings exports diagnostics through preload api', async () => {
    const exportDiagnostics = vi.fn().mockResolvedValue({
      filePath: '/tmp/petclaw-diagnostics.jsonl',
      sizeBytes: 100,
      redactionCount: 0,
      exportWarnings: []
    })

    window.api = {
      ...window.api,
      engine: { onStatus: () => () => {} },
      logging: {
        openLogFolder: vi.fn().mockResolvedValue(undefined),
        exportDiagnostics,
        snapshot: vi.fn().mockResolvedValue({}),
        report: vi.fn().mockResolvedValue(undefined)
      }
    }

    render(<EngineSettings />)
    fireEvent.click(screen.getByRole('button', { name: /export diagnostics|导出诊断包/i }))

    await waitFor(() => {
      expect(exportDiagnostics).toHaveBeenCalledWith({ timeRangeDays: 3 })
    })
  })
})
```

If the test setup currently lacks `@testing-library/react`, either use the existing renderer test helper pattern in the repo or add `@testing-library/react` as a dev dependency in a separate commit with lockfile update.

- [ ] **Step 5: Run renderer and i18n checks**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test -- tests/renderer/views/diagnostics-actions.test.tsx
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop typecheck
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add petclaw-desktop/src/renderer/src/views/boot/BootCheckPanel.tsx petclaw-desktop/src/renderer/src/views/settings/EngineSettings.tsx petclaw-desktop/src/renderer/src/views/settings/AboutSettings.tsx petclaw-shared/src/i18n/locales/zh.ts petclaw-shared/src/i18n/locales/en.ts petclaw-desktop/tests/renderer/views/diagnostics-actions.test.tsx
git commit -m "feat(desktop): add diagnostics actions"
```

---

### Task 8: Documentation Sync And Final Verification

**Files:**
- Modify if implementation differs from accepted contracts: `docs/架构设计/desktop/foundation/Logging架构设计.md`
- Modify if IPC contracts changed beyond the plan: `docs/架构设计/desktop/foundation/IPCChannel契约.md`
- Modify if preload API shape changed beyond the plan: `docs/架构设计/desktop/foundation/IPCPreload架构设计.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop typecheck
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop test
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter petclaw-desktop lint
```

Expected: PASS.

- [ ] **Step 2: Run AI context change detection**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm ai:prepare-change -- --target Logging
```

Expected: report completes. If the tool reports stale index, run:

```bash
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm ai:index
PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH pnpm ai:prepare-change -- --target Logging
```

- [ ] **Step 3: Run GitNexus detect changes**

Run the MCP tool:

```text
gitnexus_detect_changes(scope: "all", repo: "petclaw")
```

Expected: changed symbols correspond to logging modules, logging IPC, renderer diagnostics UI, and migrated logging call sites. If unrelated files appear, inspect `git status --short` and avoid committing unrelated work.

- [ ] **Step 4: Check documentation routing**

Run:

```bash
git diff --name-only
```

If the implementation changed IPC channel details, preload API shape, or Logging architecture facts, update the corresponding architecture documents in the same task. If implementation matches this plan and the accepted Logging architecture, no extra docs are required.

- [ ] **Step 5: Commit final doc sync**

If docs changed:

```bash
git add docs/架构设计/desktop/foundation/Logging架构设计.md docs/架构设计/desktop/foundation/IPCChannel契约.md docs/架构设计/desktop/foundation/IPCPreload架构设计.md
git commit -m "docs: sync logging implementation"
```

If docs did not change, record that in the final implementation summary instead of creating an empty commit.

---

## Self-Review Checklist

- Spec coverage: The plan covers paths, sanitization, storage, facade, renderer IPC, child-process capture, diagnostics export, UI actions, i18n, migration, tests, and documentation routing from `Logging架构设计.md`.
- Placeholder scan: The plan contains concrete file paths, commands, expected outcomes, test bodies, and implementation snippets. No inactive UI actions are allowed.
- Type consistency: `LogSource`, `LogEventInput`, `DiagnosticsExportOptions`, `LoggingPlatform`, and renderer `window.api.logging` signatures are introduced before later tasks use them.
- Safety: All renderer input is validated in main, renderer cannot open arbitrary paths, logs are sanitized before storage, and diagnostics export sanitizes historical content again.
