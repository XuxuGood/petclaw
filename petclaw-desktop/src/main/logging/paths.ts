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
