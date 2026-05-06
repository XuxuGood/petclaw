import log from 'electron-log/main'

import { getLoggingPlatform, initLoggingPlatform } from './logging'
import { resolveConsoleCompatLog } from './logging/console-compat'

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

  console.log = (...args: unknown[]) => {
    originalLog.apply(console, args)
    const resolved = resolveConsoleCompatLog(args)
    platform.getLogger(resolved.module).info('console.log', { args: resolved.args })
  }
  console.error = (...args: unknown[]) => {
    originalError.apply(console, args)
    const last = args.at(-1)
    const resolved = resolveConsoleCompatLog(args)
    platform
      .getLogger(resolved.module)
      .error('console.error', { args: resolved.args }, last instanceof Error ? last : undefined)
  }
  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args)
    const last = args.at(-1)
    const resolved = resolveConsoleCompatLog(args)
    platform
      .getLogger(resolved.module)
      .warn('console.warn', { args: resolved.args }, last instanceof Error ? last : undefined)
  }
  console.info = (...args: unknown[]) => {
    originalInfo.apply(console, args)
    const resolved = resolveConsoleCompatLog(args)
    platform.getLogger(resolved.module).info('console.info', { args: resolved.args })
  }
  console.debug = (...args: unknown[]) => {
    originalDebug.apply(console, args)
    const resolved = resolveConsoleCompatLog(args)
    platform.getLogger(resolved.module).debug('console.debug', { args: resolved.args })
  }
}

export function getLogFilePath(): string {
  return getLoggingPlatform().storage.getCurrentFile('main')
}

export function getRecentMainLogEntries(): Array<{ archiveName: string; filePath: string }> {
  return getLoggingPlatform().storage.getRecentEntries('main', 14)
}

export { log }
