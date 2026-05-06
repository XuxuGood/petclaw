/**
 * Unit tests for logger.ts logic:
 *   - Log filename pattern (daily rotation naming)
 *   - retention logic: which files fall outside the window
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

const LOG_RETENTION_DAYS = 14
const LOG_FILE_RE = /^main-\d{4}-\d{2}-\d{2}(\.\d+)?\.log$/

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

test('pattern: matches indexed rotation variant', () => {
  expect(LOG_FILE_RE.test('main-2026-04-25.1.log')).toBeTruthy()
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

test('prune: file from 8 days ago is kept', () => {
  const files = [{ name: 'main-2026-04-18.log', mtimeMs: daysAgo(8) }]
  expect(filesToPrune(files, NOW)).toEqual([])
})

test('prune: file from 15 days ago is deleted', () => {
  const files = [{ name: 'main-2026-04-11.log', mtimeMs: daysAgo(15) }]
  expect(filesToPrune(files, NOW)).toEqual(['main-2026-04-11.log'])
})

test('prune: indexed rotation variant from 15 days ago is deleted', () => {
  const files = [{ name: 'main-2026-04-11.1.log', mtimeMs: daysAgo(15) }]
  expect(filesToPrune(files, NOW)).toEqual(['main-2026-04-11.1.log'])
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
    { name: 'main-2026-04-11.log', mtimeMs: daysAgo(15) },
    { name: 'cowork.log', mtimeMs: daysAgo(30) }
  ]
  expect(filesToPrune(files, NOW)).toEqual(['main-2026-04-11.log'])
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

test('entries: file from exactly 14 days ago (at cutoff) is included', () => {
  const cutoffMs = NOW - LOG_RETENTION_DAYS * DAY_MS
  const files = [{ name: 'main-2026-04-12.log', mtimeMs: cutoffMs }]
  expect(recentEntries(files, NOW).length).toBe(1)
})

test('entries: file older than 14 days is excluded', () => {
  const files = [{ name: 'main-2026-04-11.log', mtimeMs: daysAgo(15) }]
  expect(recentEntries(files, NOW).length).toBe(0)
})

test('entries: indexed rotation variant within retention is included', () => {
  const files = [{ name: 'main-2026-04-25.1.log', mtimeMs: daysAgo(1) }]
  const result = recentEntries(files, NOW)
  expect(result.length).toBe(1)
  expect(result[0].archiveName).toBe('main-2026-04-25.1.log')
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

test('entries: full 14-day window all included, day 15 excluded', () => {
  const files = Array.from({ length: 16 }, (_, i) => ({
    name: `main-2026-04-${String(26 - i).padStart(2, '0')}.log`,
    mtimeMs: daysAgo(i)
  }))
  const result = recentEntries(files, NOW)
  expect(result.length >= 14).toBeTruthy()
  expect(result.some((e) => e.archiveName === 'main-2026-04-11.log')).toBeFalsy()
})
