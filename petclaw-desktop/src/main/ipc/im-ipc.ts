// src/main/ipc/im-ipc.ts
import { ipcMain } from 'electron'

import type { ImGatewayManager } from '../im/im-gateway-manager'
import type { IMPlatformConfig, IMSettings } from '../im/types'
import { ImIpcChannel } from '../im/types'

export interface ImIpcDeps {
  imGatewayManager: ImGatewayManager
}

export function registerImIpcHandlers(deps: ImIpcDeps): void {
  const { imGatewayManager } = deps

  // 加载所有 IM 平台配置和全局设置
  ipcMain.handle(ImIpcChannel.LoadConfig, async () => {
    return {
      platforms: imGatewayManager.listPlatformConfigs(),
      settings: imGatewayManager.loadSettings()
    }
  })

  // 保存单个 IM 平台配置
  ipcMain.handle(ImIpcChannel.SaveConfig, async (_event, key: string, config: IMPlatformConfig) => {
    imGatewayManager.savePlatformConfig(key, config)
  })

  // 获取各 IM 平台的启用状态
  // 注意：实际连接状态由 OpenClaw 插件管理，此处仅返回 PetClaw 侧配置中的 enabled 字段
  ipcMain.handle(ImIpcChannel.GetStatus, async () => {
    const platforms = imGatewayManager.listPlatformConfigs()
    const result: Record<string, { enabled: boolean }> = {}
    for (const { key, config } of platforms) {
      result[key] = { enabled: config.enabled }
    }
    return result
  })

  // IM 全局设置读取
  ipcMain.handle('im:load-settings', async () => {
    return imGatewayManager.loadSettings()
  })

  // IM 全局设置保存
  ipcMain.handle('im:save-settings', async (_event, settings: IMSettings) => {
    imGatewayManager.saveSettings(settings)
  })
}
