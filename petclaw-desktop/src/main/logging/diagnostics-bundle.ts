import fs from 'fs'
import path from 'path'
import { strToU8, zipSync } from 'fflate'

import { getLoggingPlatform } from './facade'
import { resolveLoggingPaths } from './paths'
import { sanitizeUnknownForLog } from './sanitizer'
import type { LogStorage } from './storage'
import {
  DEFAULT_DIAGNOSTICS_RETAIN_COUNT,
  type DiagnosticsExportOptions,
  type DiagnosticsExportResult,
  type LogSource
} from './types'

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

export interface CreateDiagnosticsBundleOptions {
  userDataPath: string
  appVersion: string
  storage: LogStorage
  options: DiagnosticsExportOptions
  now?: () => Date
}

function formatBundleTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function addJsonFile(files: Record<string, Uint8Array>, archiveName: string, value: unknown): void {
  files[archiveName] = strToU8(JSON.stringify(value, null, 2))
}

function countEmbeddedRedactions(content: string): number {
  let count = 0
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as unknown
      if (
        typeof event === 'object' &&
        event !== null &&
        'redactionCount' in event &&
        typeof event.redactionCount === 'number'
      ) {
        count += event.redactionCount
      }
    } catch {
      // 日志文件允许混入历史纯文本行；无法解析的行仍会按原始文本重新脱敏。
    }
  }
  return count
}

function sanitizeExportWarning(source: LogSource, error: unknown, userDataPath: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return `${source}: ${String(sanitizeUnknownForLog(message, { userDataPath }).value)}`
}

function pruneOldDiagnosticsBundles(dir: string, retainCount: number): void {
  if (!fs.existsSync(dir)) return
  const entries = fs
    .readdirSync(dir)
    .filter((name) => /^petclaw-diagnostics-\d{8}T\d{6}\.zip$/.test(name))
    .map((name) => {
      const filePath = path.join(dir, name)
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  for (const entry of entries.slice(retainCount)) {
    try {
      fs.unlinkSync(entry.filePath)
    } catch {
      // 旧诊断包清理失败不影响本次导出结果。
    }
  }
}

export async function createDiagnosticsBundle(
  input: CreateDiagnosticsBundleOptions
): Promise<DiagnosticsExportResult> {
  const now = input.now ?? (() => new Date())
  const createdAt = now()
  const paths = resolveLoggingPaths(input.userDataPath, createdAt)
  ensureDir(paths.diagnostics.dir)

  const exportWarnings: string[] = []
  let redactionCount = 0
  const sources = input.options.includeSources ?? DEFAULT_SOURCES
  const filePath = path.join(
    paths.diagnostics.dir,
    `petclaw-diagnostics-${formatBundleTimestamp(createdAt)}.zip`
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
        redactionCount += sanitized.redactionCount + countEmbeddedRedactions(raw)
        files[`logs/${entry.archiveName}`] = strToU8(String(sanitized.value))
      } catch (error) {
        exportWarnings.push(sanitizeExportWarning(source, error, input.userDataPath))
      }
    }
  }

  addJsonFile(files, 'manifest.json', {
    createdAt: createdAt.toISOString(),
    appVersion: input.appVersion,
    platform: process.platform,
    arch: process.arch,
    logTimeRange: input.options.timeRangeDays,
    includedSources: sources,
    redactionVersion: 1,
    redactionCounts: redactionCount,
    exportErrors: exportWarnings
  })

  fs.writeFileSync(filePath, Buffer.from(zipSync(files)))
  pruneOldDiagnosticsBundles(paths.diagnostics.dir, DEFAULT_DIAGNOSTICS_RETAIN_COUNT)
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
