import { execFile } from 'child_process'
import WebSocket from 'ws'
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

export async function checkGatewayConnectivity(
  url: string
): Promise<{ connected: boolean; latencyMs: number | null }> {
  const start = Date.now()
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.close()
      resolve({ connected: false, latencyMs: null })
    }, 3000)

    const ws = new WebSocket(url)

    ws.on('open', () => {
      clearTimeout(timeout)
      const latencyMs = Date.now() - start
      ws.close()
      resolve({ connected: true, latencyMs })
    })

    ws.on('error', () => {
      clearTimeout(timeout)
      ws.close()
      resolve({ connected: false, latencyMs: null })
    })
  })
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
