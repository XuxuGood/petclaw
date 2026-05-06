import { shell } from 'electron'

import { safeHandle } from './ipc-registry'
import { exportDiagnosticsBundle } from '../diagnostics'
import { getLoggingPlatform, type RendererLogReport } from '../logging/facade'
import type { DiagnosticsExportOptions, LogSource } from '../logging/types'

const ALLOWED_LOG_SOURCES: LogSource[] = [
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
    message: readString(value.message, 'message', 500),
    ...(isRecord(value.fields) ? { fields: value.fields } : {})
  }
}

function validateExportOptions(value: unknown): DiagnosticsExportOptions {
  if (!isRecord(value)) return { timeRangeDays: 3 }
  const timeRangeDays =
    value.timeRangeDays === 1 || value.timeRangeDays === 3 || value.timeRangeDays === 7
      ? value.timeRangeDays
      : 3
  const includeSources = Array.isArray(value.includeSources)
    ? value.includeSources.filter((source): source is LogSource =>
        ALLOWED_LOG_SOURCES.includes(source as LogSource)
      )
    : undefined
  return {
    timeRangeDays,
    ...(includeSources && includeSources.length > 0 ? { includeSources } : {})
  }
}

export function registerLoggingIpcHandlers(): void {
  safeHandle('logging:report', (_event, payload: unknown) => {
    getLoggingPlatform().reportRendererLog(validateRendererLogReport(payload))
  })

  safeHandle('logging:snapshot', () => getLoggingPlatform().snapshot())

  safeHandle('logging:export-diagnostics', async (_event, payload: unknown) =>
    exportDiagnosticsBundle(validateExportOptions(payload))
  )

  safeHandle('logging:open-log-folder', async () => {
    const platform = getLoggingPlatform()
    const logger = platform.getLogger('LoggingIPC')
    const snapshot = platform.snapshot()
    const mainSource = snapshot.sources.find((source) => source.source === 'main')
    if (!mainSource) {
      const error = new Error('Main log source is unavailable')
      logger.error('logging.openLogFolder.failed', 'Failed to open log folder', error)
      throw error
    }
    const error = await shell.openPath(mainSource.dir)
    if (error) {
      const openError = new Error(error)
      logger.error(
        'logging.openLogFolder.failed',
        'Failed to open log folder',
        { dir: mainSource.dir },
        openError
      )
      throw openError
    }
  })
}
