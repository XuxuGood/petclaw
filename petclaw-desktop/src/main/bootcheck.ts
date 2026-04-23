import { BrowserWindow } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'

import type { ConfigSync } from './ai/config-sync'
import type { OpenclawEngineManager } from './ai/engine-manager'

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
    { id: 'env', label: '准备环境', status: 'pending', hint: '~1秒' },
    { id: 'engine', label: '启动引擎', status: 'pending', hint: '~10秒' },
    { id: 'connect', label: '连接服务', status: 'pending', hint: '~5秒' }
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
 * v3 启动检查：3 步（环境 → 引擎 → 连接）
 * EngineManager 管理 gateway 进程生命周期，ConfigSync 生成 openclaw.json
 */
export async function runBootCheck(
  chatWindow: BrowserWindow,
  engineManager: OpenclawEngineManager,
  configSync: ConfigSync
): Promise<{ success: boolean; port?: number; token?: string }> {
  const steps = createSteps()
  sendSteps(chatWindow, steps)

  const MIN_STEP_MS = 500

  // Step 1: env — 确保工作目录存在
  updateStep(steps, 'env', 'running')
  sendSteps(chatWindow, steps)
  let stepStart = Date.now()
  try {
    const baseDir = engineManager.getBaseDir()
    mkdirSync(join(baseDir, 'workspace'), { recursive: true })
    mkdirSync(join(baseDir, 'skills'), { recursive: true })

    await ensureMinDuration(stepStart, MIN_STEP_MS)
    updateStep(steps, 'env', 'done')
  } catch (err) {
    updateStep(steps, 'env', 'error', (err as Error).message)
    sendSteps(chatWindow, steps)
    return { success: false }
  }
  sendSteps(chatWindow, steps)

  // Step 2: engine — 同步配置 + 启动 gateway
  updateStep(steps, 'engine', 'running')
  sendSteps(chatWindow, steps)
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
      throw new Error(status.message || 'Gateway 启动失败')
    }

    await ensureMinDuration(stepStart, MIN_STEP_MS)
    updateStep(steps, 'engine', 'done')
  } catch (err) {
    updateStep(steps, 'engine', 'error', (err as Error).message)
    sendSteps(chatWindow, steps)
    return { success: false }
  }
  sendSteps(chatWindow, steps)

  // Step 3: connect — 验证 gateway 健康并读取连接信息
  updateStep(steps, 'connect', 'running')
  sendSteps(chatWindow, steps)
  stepStart = Date.now()
  try {
    // startGateway 内部已等待就绪，这里读取最终连接信息
    const connInfo = engineManager.getGatewayConnectionInfo()
    if (!connInfo.port || !connInfo.token) {
      throw new Error('Gateway 连接信息不完整')
    }

    await ensureMinDuration(stepStart, MIN_STEP_MS)
    updateStep(steps, 'connect', 'done')
    sendSteps(chatWindow, steps)
    return { success: true, port: connInfo.port, token: connInfo.token }
  } catch (err) {
    updateStep(steps, 'connect', 'error', (err as Error).message)
    sendSteps(chatWindow, steps)
    return { success: false }
  }
}
