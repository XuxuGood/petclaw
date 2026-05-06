import log from 'electron-log/main'

import { getLoggingPlatform, initLoggingPlatform } from './logging'

let initialized = false

export function initLogger(): void {
  if (initialized) return
  initialized = true

  initLoggingPlatform()
}

export function getLogFilePath(): string {
  return getLoggingPlatform().storage.getCurrentFile('main')
}

export function getRecentMainLogEntries(): Array<{ archiveName: string; filePath: string }> {
  return getLoggingPlatform().storage.getRecentEntries('main', 14)
}

export { log }
