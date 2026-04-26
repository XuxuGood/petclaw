// src/main/ipc/im-ipc.ts
import { ipcMain } from 'electron'

import type { ImGatewayManager } from '../im/im-gateway-manager'
import type { Platform } from '../im/types'

export interface ImIpcDeps {
  imGatewayManager: ImGatewayManager
}

export function registerImIpcHandlers(deps: ImIpcDeps): void {
  const { imGatewayManager } = deps

  // 列出所有 IM 实例
  ipcMain.handle('im:load-config', async () => {
    return { instances: imGatewayManager.listInstances() }
  })

  // 创建实例
  ipcMain.handle(
    'im:create-instance',
    async (_event, platform: Platform, credentials: Record<string, unknown>, name?: string) => {
      return imGatewayManager.createInstance(platform, credentials, name)
    }
  )

  // 更新实例
  ipcMain.handle('im:save-config', async (_event, id: string, patch: Record<string, unknown>) => {
    imGatewayManager.updateInstance(id, patch)
  })

  // 删除实例
  ipcMain.handle('im:delete-instance', async (_event, id: string) => {
    imGatewayManager.deleteInstance(id)
  })

  // 获取状态（enabled 列表）
  ipcMain.handle('im:get-status', async () => {
    const instances = imGatewayManager.listInstances()
    const result: Record<string, { enabled: boolean; platform: string }> = {}
    for (const inst of instances) {
      result[inst.id] = { enabled: inst.enabled, platform: inst.platform }
    }
    return result
  })

  // 对话绑定
  ipcMain.handle(
    'im:set-binding',
    async (
      _event,
      conversationId: string,
      instanceId: string,
      peerKind: 'dm' | 'group',
      directoryPath: string,
      agentId: string
    ) => {
      imGatewayManager.setConversationBinding(
        conversationId,
        instanceId,
        peerKind,
        directoryPath,
        agentId
      )
    }
  )

  // 旧 settings handlers 降级兼容（IMSettings 已删除，返回空对象避免 preload 引用报错）
  ipcMain.handle('im:load-settings', async () => ({}))
  ipcMain.handle('im:save-settings', async () => {})
}
