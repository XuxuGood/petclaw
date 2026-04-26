import { execFile } from 'child_process'
import { ConfigInstaller } from './hooks/installer'

export async function checkEnvironment(): Promise<{
  nodeOk: boolean
  nodeVersion: string | null
}> {
  return new Promise((resolve) => {
    execFile('node', ['--version'], { timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve({ nodeOk: false, nodeVersion: null })
      } else {
        resolve({ nodeOk: true, nodeVersion: stdout.trim() })
      }
    })
  })
}

/**
 * 通过 HTTP /health 端点检测 Gateway 连通性
 */
export async function checkGatewayConnectivity(
  url: string
): Promise<{ connected: boolean; latencyMs: number | null }> {
  const start = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    // 将 ws:// 转换为 http://，拼接 /health 路径
    const httpUrl = url.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/$/, '') + '/health'
    const res = await fetch(httpUrl, { signal: controller.signal })
    clearTimeout(timeout)
    const latencyMs = Date.now() - start
    return { connected: res.status < 500, latencyMs }
  } catch {
    clearTimeout(timeout)
    return { connected: false, latencyMs: null }
  }
}

export function installHooks(
  installer: ConfigInstaller,
  settingsPath: string
): { success: boolean; alreadyInstalled: boolean; error?: string } {
  try {
    installer.installClaudeHooks(settingsPath)
    return { success: true, alreadyInstalled: false }
  } catch (err) {
    return { success: false, alreadyInstalled: false, error: (err as Error).message }
  }
}
