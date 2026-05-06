import { app } from 'electron'

import { getLogger } from '../logging'

function startupLogger() {
  return getLogger('StartupDiagnostics', 'startup')
}

function writeDiagFields(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    ...extra
  }
}

export function diagAppReady(): void {
  try {
    startupLogger().info('app.ready', 'Electron app ready event fired', writeDiagFields())
  } catch {
    // 诊断日志失败不影响启动主流程。
  }
}

export function diagBootResult(success: boolean, error?: string): void {
  try {
    startupLogger().info(
      'bootCheck.completed',
      'Boot check completed',
      writeDiagFields({
        success,
        ...(error ? { error } : {})
      })
    )
  } catch {
    // 诊断日志失败不影响启动主流程。
  }
}

export function diagWindowLoad(window: string, url?: string): void {
  try {
    startupLogger().info(
      'windowLoad.completed',
      'Window finished loading',
      writeDiagFields({ window, url })
    )
  } catch {
    // 诊断日志失败不影响启动主流程。
  }
}

export function diagError(message: string, stack?: string): void {
  try {
    startupLogger().info(
      'diagnostic.error',
      'Startup diagnostic error was captured',
      writeDiagFields({ message, stack })
    )
  } catch {
    // 诊断日志失败不影响启动主流程。
  }
}
