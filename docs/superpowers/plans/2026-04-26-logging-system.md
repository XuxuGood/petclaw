# Logging System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified logging system to PetClaw's main process that intercepts `console.*` calls, writes to daily-rotated log files, and auto-prunes old logs.

**Architecture:** Single module `logger.ts` based on `electron-log` (already a dependency). Intercepts `console.*` globally so existing code needs zero changes. Separate task converts existing Chinese log messages to English.

**Tech Stack:** `electron-log` v5, Vitest

**Spec:** `docs/superpowers/specs/2026-04-26-logging-system-design.md`

**Reference impl:** LobsterAI `src/main/logger.ts` + `src/main/logger.test.ts`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `petclaw-desktop/src/main/logger.ts` | Logger module: init, console interception, pruning, log file queries |
| Create | `petclaw-desktop/tests/main/logger.test.ts` | Unit tests for pure logic (regex, pruning, recent entries) |
| Modify | `petclaw-desktop/src/main/index.ts` | Call `initLogger()` at startup, convert Chinese log to English |
| Modify | `petclaw-desktop/src/main/ai/engine-manager.ts` | Convert ~20 Chinese log messages to English |

---

### Task 1: Write logger unit tests

**Files:**
- Create: `petclaw-desktop/tests/main/logger.test.ts`

Since `electron-log` cannot be imported outside Electron main process, tests mirror the pure logic inline (same approach as LobsterAI's `logger.test.ts`).

- [ ] **Step 1: Create test file with mirrored constants and helpers**

```typescript
/**
 * Unit tests for logger.ts logic:
 *   - Log filename pattern (daily rotation naming)
 *   - pruneOldLogs: which files get deleted
 *   - getRecentMainLogEntries: which files are included and ordering
 *
 * Logic is mirrored inline because electron-log cannot be loaded outside the
 * Electron main process. Any change to logger.ts constants or regexes must be
 * reflected here.
 */
import { test, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Mirrors from logger.ts
// ---------------------------------------------------------------------------

const LOG_RETENTION_DAYS = 7
const LOG_FILE_RE = /^main-\d{4}-\d{2}-\d{2}(\.old)?\.log$/

type FileEntry = { name: string; mtimeMs: number }

/** Returns true when the file mtime is old enough to be pruned. */
function isPrunable(mtimeMs: number, nowMs: number): boolean {
  return mtimeMs < nowMs - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
}

/** Returns true when the file mtime falls within the retention window. */
function isRecent(mtimeMs: number, nowMs: number): boolean {
  return mtimeMs >= nowMs - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
}

/** Simulates getRecentMainLogEntries over a virtual directory. */
function recentEntries(files: FileEntry[], nowMs: number): Array<{ archiveName: string }> {
  return files
    .filter((f) => LOG_FILE_RE.test(f.name))
    .filter((f) => isRecent(f.mtimeMs, nowMs))
    .map((f) => ({ archiveName: f.name }))
    .sort((a, b) => a.archiveName.localeCompare(b.archiveName))
}

/** Simulates pruneOldLogs: returns names of files that would be deleted. */
function filesToPrune(files: FileEntry[], nowMs: number): string[] {
  return files
    .filter((f) => LOG_FILE_RE.test(f.name))
    .filter((f) => isPrunable(f.mtimeMs, nowMs))
    .map((f) => f.name)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-04-26T12:00:00Z').getTime()
const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(n: number): number {
  return NOW - n * DAY_MS
}

// ---------------------------------------------------------------------------
// Filename pattern
// ---------------------------------------------------------------------------

test('pattern: matches normal daily log', () => {
  expect(LOG_FILE_RE.test('main-2026-04-26.log')).toBeTruthy()
})

test('pattern: matches .old variant', () => {
  expect(LOG_FILE_RE.test('main-2026-04-25.old.log')).toBeTruthy()
})

test('pattern: rejects plain main.log', () => {
  expect(LOG_FILE_RE.test('main.log')).toBeFalsy()
})

test('pattern: rejects cowork log', () => {
  expect(LOG_FILE_RE.test('cowork.log')).toBeFalsy()
})

test('pattern: rejects partial date', () => {
  expect(LOG_FILE_RE.test('main-2026-04.log')).toBeFalsy()
})

test('pattern: rejects non-log extension', () => {
  expect(LOG_FILE_RE.test('main-2026-04-26.txt')).toBeFalsy()
})

test('pattern: rejects different prefix', () => {
  expect(LOG_FILE_RE.test('renderer-2026-04-26.log')).toBeFalsy()
})

// ---------------------------------------------------------------------------
// pruneOldLogs — boundary behavior
// ---------------------------------------------------------------------------

test('prune: file exactly at retention boundary is kept', () => {
  const cutoffMs = NOW - LOG_RETENTION_DAYS * DAY_MS
  const files = [{ name: 'main-2026-04-19.log', mtimeMs: cutoffMs }]
  expect(filesToPrune(files, NOW)).toEqual([])
})

test('prune: file 1 ms before boundary is deleted', () => {
  const cutoffMs = NOW - LOG_RETENTION_DAYS * DAY_MS
  const files = [{ name: 'main-2026-04-19.log', mtimeMs: cutoffMs - 1 }]
  expect(filesToPrune(files, NOW)).toEqual(['main-2026-04-19.log'])
})

test("prune: today's file is not deleted", () => {
  const files = [{ name: 'main-2026-04-26.log', mtimeMs: daysAgo(0) }]
  expect(filesToPrune(files, NOW)).toEqual([])
})

test('prune: file from 6 days ago is kept', () => {
  const files = [{ name: 'main-2026-04-20.log', mtimeMs: daysAgo(6) }]
  expect(filesToPrune(files, NOW)).toEqual([])
})

test('prune: file from 8 days ago is deleted', () => {
  const files = [{ name: 'main-2026-04-18.log', mtimeMs: daysAgo(8) }]
  expect(filesToPrune(files, NOW)).toEqual(['main-2026-04-18.log'])
})

test('prune: .old variant from 8 days ago is deleted', () => {
  const files = [{ name: 'main-2026-04-18.old.log', mtimeMs: daysAgo(8) }]
  expect(filesToPrune(files, NOW)).toEqual(['main-2026-04-18.old.log'])
})

test('prune: non-matching files are never pruned', () => {
  const files = [
    { name: 'cowork.log', mtimeMs: daysAgo(30) },
    { name: 'renderer.log', mtimeMs: daysAgo(30) },
    { name: 'main.log', mtimeMs: daysAgo(30) }
  ]
  expect(filesToPrune(files, NOW)).toEqual([])
})

test('prune: mixed — only old main-date files are deleted', () => {
  const files = [
    { name: 'main-2026-04-26.log', mtimeMs: daysAgo(0) },
    { name: 'main-2026-04-21.log', mtimeMs: daysAgo(5) },
    { name: 'main-2026-04-18.log', mtimeMs: daysAgo(8) },
    { name: 'cowork.log', mtimeMs: daysAgo(30) }
  ]
  expect(filesToPrune(files, NOW)).toEqual(['main-2026-04-18.log'])
})

// ---------------------------------------------------------------------------
// getRecentMainLogEntries — filtering and ordering
// ---------------------------------------------------------------------------

test('entries: empty dir returns empty array', () => {
  expect(recentEntries([], NOW)).toEqual([])
})

test('entries: only non-matching files returns empty array', () => {
  const files = [
    { name: 'cowork.log', mtimeMs: daysAgo(1) },
    { name: 'main.log', mtimeMs: daysAgo(1) }
  ]
  expect(recentEntries(files, NOW)).toEqual([])
})

test("entries: today's file is included", () => {
  const files = [{ name: 'main-2026-04-26.log', mtimeMs: daysAgo(0) }]
  const result = recentEntries(files, NOW)
  expect(result.length).toBe(1)
  expect(result[0].archiveName).toBe('main-2026-04-26.log')
})

test('entries: file from exactly 7 days ago (at cutoff) is included', () => {
  const cutoffMs = NOW - LOG_RETENTION_DAYS * DAY_MS
  const files = [{ name: 'main-2026-04-19.log', mtimeMs: cutoffMs }]
  expect(recentEntries(files, NOW).length).toBe(1)
})

test('entries: file older than 7 days is excluded', () => {
  const files = [{ name: 'main-2026-04-18.log', mtimeMs: daysAgo(8) }]
  expect(recentEntries(files, NOW).length).toBe(0)
})

test('entries: .old variant within retention is included', () => {
  const files = [{ name: 'main-2026-04-25.old.log', mtimeMs: daysAgo(1) }]
  const result = recentEntries(files, NOW)
  expect(result.length).toBe(1)
  expect(result[0].archiveName).toBe('main-2026-04-25.old.log')
})

test('entries: results are sorted alphabetically', () => {
  const files = [
    { name: 'main-2026-04-26.log', mtimeMs: daysAgo(0) },
    { name: 'main-2026-04-23.log', mtimeMs: daysAgo(3) },
    { name: 'main-2026-04-25.log', mtimeMs: daysAgo(1) },
    { name: 'main-2026-04-24.log', mtimeMs: daysAgo(2) }
  ]
  const names = recentEntries(files, NOW).map((e) => e.archiveName)
  expect(names).toEqual([
    'main-2026-04-23.log',
    'main-2026-04-24.log',
    'main-2026-04-25.log',
    'main-2026-04-26.log'
  ])
})

test('entries: full 7-day window all included, day 8 excluded', () => {
  const files = Array.from({ length: 9 }, (_, i) => ({
    name: `main-2026-04-${String(26 - i).padStart(2, '0')}.log`,
    mtimeMs: daysAgo(i)
  }))
  const result = recentEntries(files, NOW)
  expect(result.length >= 7).toBeTruthy()
  expect(result.some((e) => e.archiveName === 'main-2026-04-18.log')).toBeFalsy()
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd petclaw-desktop && npx vitest run tests/main/logger.test.ts`

Expected: All 22 tests PASS (tests exercise mirrored pure logic, no implementation dependency)

- [ ] **Step 3: Commit**

```bash
git add petclaw-desktop/tests/main/logger.test.ts
git commit -m "test(logger): add unit tests for log file pattern, pruning, and recent entries"
```

---

### Task 2: Implement logger module

**Files:**
- Create: `petclaw-desktop/src/main/logger.ts`

- [ ] **Step 1: Create logger.ts**

```typescript
/**
 * Logger module using electron-log.
 * Intercepts console.* methods and writes to file + console simultaneously.
 *
 * Log file locations (electron-log defaults):
 *   macOS:   ~/Library/Logs/PetClaw/main-YYYY-MM-DD.log
 *   Windows: %USERPROFILE%\AppData\Roaming\PetClaw\logs\main-YYYY-MM-DD.log
 *   Linux:   ~/.config/PetClaw/logs/main-YYYY-MM-DD.log
 *
 * Rotation policy:
 *   - Daily log files (one file per calendar day)
 *   - Max 80 MB per file; on overflow electron-log rotates to .old.log
 *   - Files older than 7 days are pruned on startup
 */

import path from 'path'
import fs from 'fs'
import log from 'electron-log/main'

const LOG_RETENTION_DAYS = 7
const LOG_MAX_SIZE = 80 * 1024 * 1024 // 80 MB

/** Captured on first resolvePathFn call; used for pruning and export. */
let _logDir: string | undefined

function todayStr(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function logDir(): string {
  return _logDir ?? path.dirname(log.transports.file.getFile().path)
}

/**
 * Initialize logging system.
 * Must be called early in main process, before any console output.
 */
export function initLogger(): void {
  // Daily rotation: one file per calendar day
  log.transports.file.resolvePathFn = (vars) => {
    _logDir = vars.libraryDefaultDir
    return path.join(vars.libraryDefaultDir, `main-${todayStr()}.log`)
  }

  // File transport config
  log.transports.file.level = 'debug'
  log.transports.file.maxSize = LOG_MAX_SIZE
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

  // Console transport config
  log.transports.console.level = 'debug'
  log.transports.console.format = '{text}'

  // Intercept console.* methods so all existing console.log/error/warn
  // across the codebase are automatically captured without any code changes.
  // electron-log correctly serializes Error objects (with stack traces),
  // unlike JSON.stringify which outputs '{}' for Error instances.
  const originalLog = console.log
  const originalError = console.error
  const originalWarn = console.warn
  const originalInfo = console.info
  const originalDebug = console.debug

  console.log = (...args: unknown[]) => {
    originalLog.apply(console, args)
    log.info(...args)
  }
  console.error = (...args: unknown[]) => {
    originalError.apply(console, args)
    log.error(...args)
  }
  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args)
    log.warn(...args)
  }
  console.info = (...args: unknown[]) => {
    originalInfo.apply(console, args)
    log.info(...args)
  }
  console.debug = (...args: unknown[]) => {
    originalDebug.apply(console, args)
    log.debug(...args)
  }

  // Disable electron-log's own console transport to avoid double printing
  // (we already call originalLog above, so electron-log only needs to write to file)
  log.transports.console.level = false

  // Remove log files older than retention window
  pruneOldLogs()

  // Log startup marker
  log.info('='.repeat(60))
  log.info(`PetClaw started (${process.platform} ${process.arch})`)
  log.info('='.repeat(60))
}

/** Delete daily main-*.log files whose mtime exceeds the retention window. */
function pruneOldLogs(): void {
  const dir = logDir()
  if (!fs.existsSync(dir)) return

  const cutoffMs = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000

  for (const file of fs.readdirSync(dir)) {
    if (!/^main-\d{4}-\d{2}-\d{2}(\.old)?\.log$/.test(file)) continue
    const filePath = path.join(dir, file)
    try {
      if (fs.statSync(filePath).mtimeMs < cutoffMs) {
        fs.unlinkSync(filePath)
      }
    } catch {
      // ignore individual failures
    }
  }
}

/**
 * Get today's log file path (for display / open-in-folder).
 */
export function getLogFilePath(): string {
  return log.transports.file.getFile().path
}

/**
 * Return archive entries for all daily main log files within the last 7 days.
 * Suitable for passing directly to a zip export function.
 */
export function getRecentMainLogEntries(): Array<{ archiveName: string; filePath: string }> {
  const dir = logDir()
  if (!fs.existsSync(dir)) return []

  const cutoffMs = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000

  return fs
    .readdirSync(dir)
    .filter((f) => /^main-\d{4}-\d{2}-\d{2}(\.old)?\.log$/.test(f))
    .map((f) => ({ archiveName: f, filePath: path.join(dir, f) }))
    .filter(({ filePath }) => {
      try {
        return fs.statSync(filePath).mtimeMs >= cutoffMs
      } catch {
        return false
      }
    })
    .sort((a, b) => a.archiveName.localeCompare(b.archiveName))
}

/**
 * Log instance for direct usage if needed.
 */
export { log }
```

- [ ] **Step 2: Verify tests still pass**

Run: `cd petclaw-desktop && npx vitest run tests/main/logger.test.ts`

Expected: All 22 tests PASS (tests don't import logger.ts directly)

- [ ] **Step 3: Commit**

```bash
git add petclaw-desktop/src/main/logger.ts
git commit -m "feat(logger): add main process logging with daily rotation and auto-pruning"
```

---

### Task 3: Wire initLogger into main process startup

**Files:**
- Modify: `petclaw-desktop/src/main/index.ts`

- [ ] **Step 1: Add import at the top of index.ts**

Add after the existing `import fs from 'fs'` line (line 1):

```typescript
import { initLogger } from './logger'
```

- [ ] **Step 2: Call initLogger() as the first statement after imports**

Add `initLogger()` right after all the imports and variable declarations, before `app.whenReady()`. Find the line that contains `app.whenReady()` (around line 60-80) and add `initLogger()` immediately before it:

```typescript
// Initialize logging before anything else
initLogger()
```

- [ ] **Step 3: Run typecheck to verify**

Run: `cd petclaw-desktop && npx tsc -p tsconfig.node.json --noEmit`

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add petclaw-desktop/src/main/index.ts
git commit -m "feat(logger): wire initLogger into main process startup"
```

---

### Task 4: Convert Chinese log messages to English

**Files:**
- Modify: `petclaw-desktop/src/main/index.ts`
- Modify: `petclaw-desktop/src/main/ai/engine-manager.ts`

Only two files have Chinese in `console.*` calls. All other files (`config-sync.ts`, `cowork-controller.ts`, `cron-job-service.ts`, `hooks/installer.ts`, `shortcuts.ts`) already use English.

- [ ] **Step 1: Convert index.ts Chinese logs (2 lines)**

Line 289 — change:
```typescript
console.warn('Gateway 连接失败:', err instanceof Error ? err.message : err)
```
to:
```typescript
console.warn('[Gateway] connection failed:', err instanceof Error ? err.message : err)
```

Line 440 — change:
```typescript
console.warn('Hook server listening on:', socketPath)
```
to:
```typescript
console.info('[HookServer] listening on:', socketPath)
```
Note: this is also a level change from `warn` to `info` since a successful listen is a lifecycle event, not a warning.

- [ ] **Step 2: Convert engine-manager.ts Chinese logs (~20 lines)**

Apply the following replacements in `petclaw-desktop/src/main/ai/engine-manager.ts`:

| Line | Chinese | English |
|------|---------|---------|
| 288 | `'[OpenClaw] startGateway: 已在启动中，复用现有 Promise'` | `'[OpenClaw] startGateway: already starting, reusing existing promise'` |
| 307 | `'[OpenClaw] 正在停止 gateway 进程...'` | `'[OpenClaw] stopping gateway process...'` |
| 309 | `'[OpenClaw] gateway 进程已停止'` | `'[OpenClaw] gateway process stopped'` |
| 326 | `'[OpenClaw] restartGateway: 停止现有 gateway...'` | `'[OpenClaw] restartGateway: stopping existing gateway...'` |
| 329 | `'[OpenClaw] restartGateway: 启动新 gateway...'` | `'[OpenClaw] restartGateway: starting new gateway...'` |
| 341 | `` `[OpenClaw] startGateway: ensureReady 完成 (${elapsed()})，phase=${ensured.phase}` `` | `` `[OpenClaw] startGateway: ensureReady done (${elapsed()}), phase=${ensured.phase}` `` |
| 351 | `` `[OpenClaw] 现有进程健康检查 (${elapsed()})，healthy=${healthy}` `` | `` `[OpenClaw] existing process health check (${elapsed()}), healthy=${healthy}` `` |
| 367-369 | `` `[OpenClaw] resolveRuntimeMetadata 完成 (${elapsed()})，root=${runtime.root ? '找到' : '缺失'}` `` | `` `[OpenClaw] resolveRuntimeMetadata done (${elapsed()}), root=${runtime.root ? 'found' : 'missing'}` `` |
| 381 | `` `[OpenClaw] resolveOpenClawEntry 完成 (${elapsed()})，entry=${openclawEntry}` `` | `` `[OpenClaw] resolveOpenClawEntry done (${elapsed()}), entry=${openclawEntry}` `` |
| 393 | `` `[OpenClaw] ensureGatewayToken 完成 (${elapsed()})` `` | `` `[OpenClaw] ensureGatewayToken done (${elapsed()})` `` |
| 395 | `` `[OpenClaw] resolveGatewayPort 完成 (${elapsed()})，port=${port}` `` | `` `[OpenClaw] resolveGatewayPort done (${elapsed()}), port=${port}` `` |
| 467 | `` `[OpenClaw] gateway 进程已 spawn (${elapsed()})，pid=${child.pid}` `` | `` `[OpenClaw] gateway process spawned (${elapsed()}), pid=${child.pid}` `` |
| 471 | `` `[OpenClaw] waitForGatewayReady 返回 (${elapsed()})，ready=${ready}` `` | `` `[OpenClaw] waitForGatewayReady returned (${elapsed()}), ready=${ready}` `` |
| 715 | `` `[OpenClaw] 健康探针详情: tcp=${tcpResult}, ${httpResults.join(', ')}` `` | `` `[OpenClaw] health probe details: tcp=${tcpResult}, ${httpResults.join(', ')}` `` |
| 728 | `'[OpenClaw] waitForGatewayReady: 收到关闭请求，放弃等待'` | `'[OpenClaw] waitForGatewayReady: shutdown requested, aborting'` |
| 734 | `'[OpenClaw] waitForGatewayReady: gateway 进程已退出，放弃等待'` | `'[OpenClaw] waitForGatewayReady: gateway process exited, aborting'` |
| 745-747 | `` `[OpenClaw] waitForGatewayReady: gateway 就绪，耗时 ${elapsedMs}ms（${pollCount} 次轮询）` `` | `` `[OpenClaw] waitForGatewayReady: gateway ready in ${elapsedMs}ms (${pollCount} polls)` `` |
| 753 | `` `[OpenClaw] waitForGatewayReady: 超时 ${timeoutMs}ms（${pollCount} 次轮询）` `` | `` `[OpenClaw] waitForGatewayReady: timed out after ${timeoutMs}ms (${pollCount} polls)` `` |
| 835 | `` `[OpenClaw] 启动里程碑 (${elapsed}ms): ${summary}` `` | `` `[OpenClaw] startup milestone (${elapsed}ms): ${summary}` `` |
| 858 | `` `[OpenClaw] gateway 进程错误: ${errorMsg}` `` | `` `[OpenClaw] gateway process error: ${errorMsg}` `` |
| 875 | `` `[OpenClaw] gateway 进程按预期退出，code=${code}` `` | `` `[OpenClaw] gateway process exited as expected, code=${code}` `` |
| 879 | `` `[OpenClaw] gateway 进程在关闭流程中退出，code=${code}` `` | `` `[OpenClaw] gateway process exited during shutdown, code=${code}` `` |
| 883 | `` `[OpenClaw] gateway 进程意外退出，code=${code}` `` | `` `[OpenClaw] gateway process exited unexpectedly, code=${code}` `` |
| 900-901 | `` `[OpenClaw] 自动重启次数已达上限（${GATEWAY_MAX_RESTART_ATTEMPTS} 次），放弃重启` `` | `` `[OpenClaw] max restart attempts reached (${GATEWAY_MAX_RESTART_ATTEMPTS}), giving up` `` |
| 917-918 | `` `[OpenClaw] 调度重启 #${this.gatewayRestartAttempt}/${GATEWAY_MAX_RESTART_ATTEMPTS}，延迟 ${delay}ms` `` | `` `[OpenClaw] scheduling restart #${this.gatewayRestartAttempt}/${GATEWAY_MAX_RESTART_ATTEMPTS}, delay ${delay}ms` `` |

- [ ] **Step 3: Run typecheck**

Run: `cd petclaw-desktop && npx tsc -p tsconfig.node.json --noEmit`

Expected: No errors

- [ ] **Step 4: Verify no remaining Chinese in console calls**

Run: `grep -rn 'console\.\(log\|error\|warn\|debug\|info\)' petclaw-desktop/src/main/ | grep -P '[\x{4e00}-\x{9fff}]'`

Expected: No output (no Chinese characters left in console calls)

- [ ] **Step 5: Run all tests**

Run: `cd petclaw-desktop && npx vitest run`

Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add petclaw-desktop/src/main/index.ts petclaw-desktop/src/main/ai/engine-manager.ts
git commit -m "refactor: convert Chinese log messages to English"
```
