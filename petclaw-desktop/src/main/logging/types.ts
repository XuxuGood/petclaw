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
