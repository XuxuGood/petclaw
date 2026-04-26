import { BrowserWindow } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'

import type { ConfigSync } from './ai/config-sync'
import type { OpenclawEngineManager } from './ai/engine-manager'
import { t } from './i18n'

// ── 类型 ──

export interface BootStep {
  id: 'env' | 'engine' | 'connect'
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
  hint?: string
}

// ── 内部工具 ──

function createSteps(): BootStep[] {
  return [
    { id: 'env', label: t('boot.stepEnv'), status: 'pending', hint: t('boot.hintEnv') },
    { id: 'engine', label: t('boot.stepEngine'), status: 'pending', hint: t('boot.hintEngine') },
    { id: 'connect', label: t('boot.stepConnect'), status: 'pending', hint: t('boot.hintConnect') }
  ]
}

function sendSteps(win: BrowserWindow, steps: BootStep[]): void {
  win.webContents.send('boot:step-update', steps)
}

function updateStep(
  steps: BootStep[],
  id: string,
  status: BootStep['status'],
  error?: string
): void {
  const step = steps.find((s) => s.id === id)
  if (step) {
    step.status = status
    if (error) step.error = error
  }
}

/** 确保至少经过 ms 毫秒，避免步骤闪过太快 */
async function ensureMinDuration(start: number, ms: number): Promise<void> {
  const elapsed = Date.now() - start
  if (elapsed < ms) {
    await new Promise((r) => setTimeout(r, ms - elapsed))
  }
}

// ── 主流程 ──

/**
 * 启动检查：3 步（环境 → 引擎 → 连接）
 * EngineManager 管理 gateway 进程生命周期，ConfigSync 生成 openclaw.json
 */
export async function runBootCheck(
  mainWindow: BrowserWindow,
  engineManager: OpenclawEngineManager,
  configSync: ConfigSync
): Promise<{ success: boolean; port?: number; token?: string }> {
  const steps = createSteps()
  sendSteps(mainWindow, steps)

  const MIN_STEP_MS = 500

  // Step 1: env — 确保工作目录存在
  updateStep(steps, 'env', 'running')
  sendSteps(mainWindow, steps)
  let stepStart = Date.now()
  try {
    const baseDir = engineManager.getBaseDir()
    mkdirSync(join(baseDir, 'workspace'), { recursive: true })
    mkdirSync(join(baseDir, 'skills'), { recursive: true })

    await ensureMinDuration(stepStart, MIN_STEP_MS)
    updateStep(steps, 'env', 'done')
  } catch (err) {
    updateStep(steps, 'env', 'error', (err as Error).message)
    sendSteps(mainWindow, steps)
    return { success: false }
  }
  sendSteps(mainWindow, steps)

  // Step 2: engine — 同步配置 + 启动 gateway
  updateStep(steps, 'engine', 'running')
  sendSteps(mainWindow, steps)
  stepStart = Date.now()
  try {
    // ConfigSync 生成/更新 openclaw.json
    const syncResult = configSync.sync('boot')
    if (!syncResult.ok) {
      throw new Error(syncResult.error ?? 'ConfigSync failed')
    }

    // EngineManager 启动 gateway 进程并等待就绪
    const status = await engineManager.startGateway()
    if (status.phase !== 'ready') {
      throw new Error(status.message || t('boot.gatewayFailed'))
    }

    await ensureMinDuration(stepStart, MIN_STEP_MS)
    updateStep(steps, 'engine', 'done')
  } catch (err) {
    updateStep(steps, 'engine', 'error', (err as Error).message)
    sendSteps(mainWindow, steps)
    return { success: false }
  }
  sendSteps(mainWindow, steps)

  // Step 3: connect — 验证 gateway 健康并读取连接信息
  updateStep(steps, 'connect', 'running')
  sendSteps(mainWindow, steps)
  stepStart = Date.now()
  try {
    // startGateway 内部已等待就绪，这里读取最终连接信息
    const connInfo = engineManager.getGatewayConnectionInfo()
    if (!connInfo.port || !connInfo.token) {
      throw new Error(t('boot.gatewayIncomplete'))
    }

    await ensureMinDuration(stepStart, MIN_STEP_MS)
    updateStep(steps, 'connect', 'done')
    sendSteps(mainWindow, steps)
    return { success: true, port: connInfo.port, token: connInfo.token }
  } catch (err) {
    updateStep(steps, 'connect', 'error', (err as Error).message)
    sendSteps(mainWindow, steps)
    return { success: false }
  }
}
