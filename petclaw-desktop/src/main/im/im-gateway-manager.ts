// src/main/im/im-gateway-manager.ts
// ImGatewayManager 管理 IM 实例 CRUD 和两层 Agent 路由。
// SQL 操作委托给 ImStore，Manager 只含业务逻辑和事件通知。
import { EventEmitter } from 'events'

import type { ImStore } from '../data/im-store'
import { PLATFORM_INFO, type ImConversationBinding, type ImInstance, type Platform } from './types'

function normalizeEnvToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()
}

function buildImSecretEnvName(
  platform: Platform,
  instanceId: string,
  credentialKey: string
): string {
  return `PETCLAW_IM_${normalizeEnvToken(platform)}_${normalizeEnvToken(instanceId)}_${normalizeEnvToken(credentialKey)}`
}

function buildEnvPlaceholder(envName: string): string {
  return `\${${envName}}`
}

function isSecretCredentialKey(key: string): boolean {
  return /(?:token|secret|password|api_?key|key)/i.test(key)
}

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
    // 平台实例数量是后端能力约束，不能只依赖 UI 隐藏入口；微信必须保持单实例模型。
    const existingCount = this.store
      .listInstances()
      .filter((inst) => inst.platform === platform).length
    const platformInfo = PLATFORM_INFO[platform]
    if (existingCount >= platformInfo.maxInstances) {
      throw new Error(`${platformInfo.name}最多只能创建 ${platformInfo.maxInstances} 个实例`)
    }

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

  toOpenclawChannelsConfig(): Record<string, unknown> {
    const instances = this.store.listInstances()
    const result: Record<string, unknown> = {}
    for (const inst of instances) {
      if (!inst.enabled) continue

      result[this.buildChannelKey(inst)] = {
        enabled: true,
        platform: inst.platform,
        ...(inst.name ? { name: inst.name } : {}),
        ...inst.config,
        credentials: this.buildOpenclawCredentials(inst)
      }
    }
    return result
  }

  toOpenclawBindingsConfig(): { bindings?: Array<Record<string, unknown>> } {
    const bindings: Array<Record<string, unknown>> = []
    for (const inst of this.store.listInstances()) {
      if (!inst.enabled || !inst.agentId) continue

      bindings.push({
        agentId: inst.agentId,
        match: { channel: this.buildChannelKey(inst) }
      })
    }

    return bindings.length > 0 ? { bindings } : {}
  }

  toOpenclawPluginEntries(): Record<string, { enabled: boolean }> {
    const result: Record<string, { enabled: boolean }> = {}
    for (const inst of this.store.listInstances()) {
      result[inst.platform] = {
        enabled: Boolean(result[inst.platform]?.enabled || inst.enabled)
      }
    }
    return result
  }

  collectSecretEnvVars(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const inst of this.store.listInstances()) {
      if (!inst.enabled) continue

      for (const [key, value] of Object.entries(inst.credentials)) {
        if (typeof value !== 'string' || !isSecretCredentialKey(key)) continue

        result[buildImSecretEnvName(inst.platform, inst.id, key)] = value
      }
    }
    return result
  }

  // 只导出已启用的实例配置，用于推送给 OpenClaw runtime
  toOpenclawConfig(): Record<string, unknown> {
    return this.toOpenclawChannelsConfig()
  }

  private buildChannelKey(inst: ImInstance): string {
    return `${inst.platform}:${inst.id}`
  }

  private buildOpenclawCredentials(inst: ImInstance): Record<string, unknown> {
    const credentials: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(inst.credentials)) {
      credentials[key] =
        typeof value === 'string' && isSecretCredentialKey(key)
          ? buildEnvPlaceholder(buildImSecretEnvName(inst.platform, inst.id, key))
          : value
    }
    return credentials
  }
}
