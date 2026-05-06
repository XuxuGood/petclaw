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
