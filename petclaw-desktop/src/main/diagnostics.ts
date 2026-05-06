import { app } from 'electron'
import { join } from 'path'
import { appendFileSync, mkdirSync } from 'fs'

import { resolveUserDataPaths } from './user-data-paths'

const DIAGNOSTICS_LOG_FILE_NAME = 'startup-diagnostics.log'

function resolveDiagnosticsLogPath(): { logsDir: string; filePath: string } {
  const logsDir = resolveUserDataPaths(app.getPath('userData')).logsRoot

  return {
    logsDir,
    filePath: join(logsDir, DIAGNOSTICS_LOG_FILE_NAME)
  }
}

function writeDiag(event: string, extra?: Record<string, unknown>): void {
  try {
    const { logsDir, filePath } = resolveDiagnosticsLogPath()
    mkdirSync(logsDir, { recursive: true })
    const entry = {
      ts: new Date().toISOString(),
      event,
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
      ...extra
    }
    appendFileSync(filePath, JSON.stringify(entry) + '\n')
  } catch {
    // 日志写入失败不应影响主流程
  }
}

export function diagAppReady(): void {
  writeDiag('app-when-ready')
}

export function diagBootResult(success: boolean, error?: string): void {
  writeDiag('boot-check-result', { success, ...(error ? { error } : {}) })
}

export function diagWindowLoad(window: string, url?: string): void {
  writeDiag(`${window}-did-finish-load`, { url })
}

export function diagError(message: string, stack?: string): void {
  writeDiag('error', { message, stack })
}
