import { app } from 'electron'

import { createLogStorage, type LogStorage } from './storage'
import type { LogLevel, LogSource } from './types'

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

  function write(
    level: LogLevel,
    source: LogSource,
    module: string,
    event: string,
    fields?: Record<string, unknown>,
    error?: unknown
  ): void {
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
