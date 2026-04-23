import { ipcMain, app } from 'electron'
import { join } from 'path'

import { ConfigInstaller } from '../hooks/installer'
import { checkEnvironment, checkGatewayConnectivity, installHooks } from '../onboarding'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BootIpcDeps {
  // 暂无特殊依赖，预留
}

export function registerBootIpcHandlers(_deps: BootIpcDeps): void {
  ipcMain.handle('onboarding:check-env', async () => {
    return checkEnvironment()
  })

  ipcMain.handle('onboarding:check-gateway', async (_event, url: string) => {
    return checkGatewayConnectivity(url)
  })

  ipcMain.handle('onboarding:install-hooks', async () => {
    const settingsPath = join(app.getPath('home'), '.claude', 'settings.json')
    const bridgePath = join(app.getAppPath(), 'resources', 'petclaw-bridge')
    const installer = new ConfigInstaller(bridgePath)
    return installHooks(installer, settingsPath)
  })
}
