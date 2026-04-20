import { app } from 'electron'
import { join } from 'path'
import { appendFileSync, mkdirSync } from 'fs'

const PETCLAW_HOME = join(app.getPath('home'), '.petclaw')
const LOGS_DIR = join(PETCLAW_HOME, 'logs')
const DIAG_FILE = join(LOGS_DIR, 'startup-diagnostics.log')

function writeDiag(event: string, extra?: Record<string, unknown>): void {
  try {
    mkdirSync(LOGS_DIR, { recursive: true })
    const entry = {
      ts: new Date().toISOString(),
      event,
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
      ...extra
    }
    appendFileSync(DIAG_FILE, JSON.stringify(entry) + '\n')
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
