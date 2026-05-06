import { app } from 'electron'

import { getLogger } from './logging'

function startupLogger() {
  return getLogger('StartupDiagnostics', 'startup')
}

function writeDiag(event: string, extra?: Record<string, unknown>): void {
  try {
    startupLogger().info(event, {
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
      ...extra
    })
  } catch {
    // 诊断日志失败不影响启动主流程。
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
