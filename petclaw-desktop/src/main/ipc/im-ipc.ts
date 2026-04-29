// src/main/ipc/im-ipc.ts
import { safeHandle } from './ipc-registry'
import type { ImGatewayManager } from '../im/im-gateway-manager'
import type { Platform } from '../im/types'

export interface ImIpcDeps {
  imGatewayManager: ImGatewayManager
}

export function registerImIpcHandlers(deps: ImIpcDeps): void {
  const { imGatewayManager } = deps

  // 列出所有 IM 实例
  safeHandle('im:load-config', async () => {
    return { instances: imGatewayManager.listInstances() }
  })

  // 创建实例
  safeHandle(
    'im:create-instance',
    async (_event, platform: Platform, credentials: Record<string, unknown>, name?: string) => {
      return imGatewayManager.createInstance(platform, credentials, name)
    }
  )

  // 更新实例
  safeHandle('im:save-config', async (_event, id: string, patch: Record<string, unknown>) => {
    imGatewayManager.updateInstance(id, patch)
  })

  // 删除实例
  safeHandle('im:delete-instance', async (_event, id: string) => {
    imGatewayManager.deleteInstance(id)
  })

  // 获取状态（enabled 列表）
  safeHandle('im:get-status', async () => {
    const instances = imGatewayManager.listInstances()
    const result: Record<string, { enabled: boolean; platform: string }> = {}
    for (const inst of instances) {
      result[inst.id] = { enabled: inst.enabled, platform: inst.platform }
    }
    return result
  })

  // 对话绑定
  safeHandle(
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

  // IM 设置的独立 load/save — 前端尚未适配，预留 channel
  safeHandle('im:load-settings', async () => ({}))
  safeHandle('im:save-settings', async () => {})
}
