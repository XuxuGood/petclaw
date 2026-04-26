// src/main/im/im-gateway-manager.ts
// ImGatewayManager 管理 IM 实例 CRUD 和两层 Agent 路由。
// SQL 操作委托给 ImStore，Manager 只含业务逻辑和事件通知。
import { EventEmitter } from 'events'

import type { ImStore } from '../data/im-store'
import type { ImConversationBinding, ImInstance, Platform } from './types'

export class ImGatewayManager extends EventEmitter {
  constructor(private store: ImStore) {
    super()
  }

  // ── 实例 CRUD ──

  createInstance(
    platform: Platform,
    credentials: Record<string, unknown>,
    name?: string
  ): ImInstance {
    const id = crypto.randomUUID()
    this.store.insertInstance(id, platform, credentials, name ?? null)
    this.emit('change')
    return this.store.getInstance(id)!
  }

  getInstance(id: string): ImInstance | null {
    return this.store.getInstance(id)
  }

  listInstances(): ImInstance[] {
    return this.store.listInstances()
  }

  updateInstance(
    id: string,
    patch: Partial<
      Pick<ImInstance, 'name' | 'directoryPath' | 'agentId' | 'credentials' | 'config' | 'enabled'>
    >
  ): void {
    this.store.updateInstance(id, patch)
    this.emit('change')
  }

  deleteInstance(id: string): void {
    this.store.deleteInstance(id)
    this.emit('change')
  }

  // ── 对话绑定 ──

  setConversationBinding(
    conversationId: string,
    instanceId: string,
    peerKind: 'dm' | 'group',
    directoryPath: string,
    agentId: string
  ): void {
    this.store.setConversationBinding(conversationId, instanceId, peerKind, directoryPath, agentId)
  }

  getConversationBinding(conversationId: string, instanceId: string): ImConversationBinding | null {
    return this.store.getConversationBinding(conversationId, instanceId)
  }

  removeConversationBinding(conversationId: string, instanceId: string): void {
    this.store.removeConversationBinding(conversationId, instanceId)
  }

  // ── 两层 Agent 路由（纯业务逻辑） ──

  // Tier 1: 对话绑定 → Tier 6: 实例默认 → 兜底: main
  resolveAgent(
    instanceId: string,
    conversationId: string
  ): { agentId: string; directoryPath: string | null } {
    // Tier 1: 对话级绑定
    const binding = this.store.getConversationBinding(conversationId, instanceId)
    if (binding) return { agentId: binding.agentId, directoryPath: binding.directoryPath }
    // Tier 6: 实例级默认
    const instance = this.store.getInstance(instanceId)
    if (instance?.agentId)
      return { agentId: instance.agentId, directoryPath: instance.directoryPath }
    // 兜底 main
    return { agentId: 'main', directoryPath: null }
  }

  // ── 会话映射 ──

  upsertSessionMapping(
    conversationId: string,
    instanceId: string,
    sessionId: string,
    agentId: string
  ): void {
    this.store.upsertSessionMapping(conversationId, instanceId, sessionId, agentId)
  }

  getSessionMapping(
    conversationId: string,
    instanceId: string
  ): { session_id: string; agent_id: string } | null {
    return this.store.getSessionMapping(conversationId, instanceId)
  }

  // ── OpenClaw 配置序列化（供 ConfigSync 使用，纯业务逻辑） ──

  // 只导出已启用的实例配置，用于推送给 OpenClaw runtime
  toOpenclawConfig(): Record<string, unknown> {
    const instances = this.store.listInstances()
    const result: Record<string, unknown> = {}
    for (const inst of instances) {
      if (inst.enabled) {
        result[`${inst.platform}:${inst.id}`] = {
          ...inst.config,
          credentials: inst.credentials
        }
      }
    }
    return result
  }
}
