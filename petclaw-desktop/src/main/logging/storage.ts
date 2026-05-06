import fs from 'fs'
import path from 'path'

import { resolveLoggingPaths } from './paths'
import { sanitizeLogEvent } from './sanitizer'
import {
  DEFAULT_LOG_MAX_SIZE_BYTES,
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
  getRecentEntries(
    source: LogSource,
    days: number
  ): Array<{ archiveName: string; filePath: string }>
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
    const cutoffMs = now().getTime() - days * 24 * 60 * 60 * 1000
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
