import * as electron from 'electron'
import os from 'os'
import path from 'path'

import { createLogStorage, type LogStorage } from './storage'
import type { LogLevel, LogSource } from './types'

type LogFields = Record<string, unknown>

export interface ScopedLogger {
  debug(event: string, message: string, fields?: LogFields): void
  info(event: string, message: string, fields?: LogFields): void
  warn(event: string, message: string): void
  warn(event: string, message: string, error: unknown): void
  warn(event: string, message: string, fields?: LogFields, error?: unknown): void
  error(event: string, message: string): void
  error(event: string, message: string, error: unknown): void
  error(event: string, message: string, fields?: LogFields, error?: unknown): void
}

export interface RendererLogReport {
  level: Extract<LogLevel, 'warn' | 'error'>
  module: string
  event: string
  message: string
  fields?: LogFields
}

export interface LoggingPlatform {
  userDataPath: string
  appVersion: string
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

interface ElectronAppLike {
  getPath?: (name: string) => string
  getVersion?: () => string
}

function getElectronApp(): ElectronAppLike | undefined {
  return 'app' in electron ? (electron.app as ElectronAppLike | undefined) : undefined
}

function resolveElectronUserDataPath(): string {
  const app = getElectronApp()
  return typeof app?.getPath === 'function'
    ? app.getPath('userData')
    : path.join(os.tmpdir(), 'petclaw-logging-fallback')
}

function resolveElectronAppVersion(): string {
  const app = getElectronApp()
  return typeof app?.getVersion === 'function' ? app.getVersion() : '0.0.0'
}

export function createLoggingPlatform(options: LoggingPlatformOptions): LoggingPlatform {
  const storage = createLogStorage(options)

  function write(
    level: LogLevel,
    source: LogSource,
    module: string,
    event: string,
    message: string,
    fields?: LogFields,
    error?: unknown
  ): void {
    storage.write({ level, source, module, event, message, fields, error })
  }

  function resolveFieldsAndError(
    fieldsOrError?: LogFields | unknown,
    error?: unknown
  ): { fields?: LogFields; error?: unknown } {
    if (error !== undefined) {
      return { fields: fieldsOrError as LogFields | undefined, error }
    }

    if (fieldsOrError instanceof Error || typeof fieldsOrError === 'string') {
      return { error: fieldsOrError }
    }

    return { fields: fieldsOrError as LogFields | undefined }
  }

  const platform: LoggingPlatform = {
    userDataPath: options.userDataPath,
    appVersion: options.appVersion,
    storage,
    getLogger(module: string, source: LogSource = 'main'): ScopedLogger {
      return {
        debug(event, message, fields): void {
          write('debug', source, module, event, message, fields)
        },
        info(event, message, fields): void {
          write('info', source, module, event, message, fields)
        },
        warn(event, message, fieldsOrError?: LogFields | unknown, error?: unknown): void {
          const resolved = resolveFieldsAndError(fieldsOrError, error)
          write('warn', source, module, event, message, resolved.fields, resolved.error)
        },
        error(event, message, fieldsOrError?: LogFields | unknown, error?: unknown): void {
          const resolved = resolveFieldsAndError(fieldsOrError, error)
          write('error', source, module, event, message, resolved.fields, resolved.error)
        }
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
    userDataPath: resolveElectronUserDataPath(),
    appVersion: resolveElectronAppVersion()
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

export function resetLoggingPlatformForTest(): void {
  activePlatform = null
}
