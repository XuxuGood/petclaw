// src/main/im/types.ts
// IM 平台类型定义（v3 两层绑定模型）

// Phase 3 只实现 4 个平台：飞书、钉钉、企微、微信
export type Platform = 'wechat' | 'wecom' | 'dingtalk' | 'feishu'

// 支持多实例的平台
export type MultiInstancePlatform = 'dingtalk' | 'feishu' | 'wecom'

export const MULTI_INSTANCE_PLATFORMS: MultiInstancePlatform[] = ['dingtalk', 'feishu', 'wecom']

// 平台显示信息
export const PLATFORM_INFO: Record<Platform, { name: string; icon: string; maxInstances: number }> =
  {
    feishu: { name: '飞书', icon: '🐦', maxInstances: 3 },
    dingtalk: { name: '钉钉', icon: '📌', maxInstances: 3 },
    wecom: { name: '企业微信', icon: '🏢', maxInstances: 3 },
    wechat: { name: '微信', icon: '💬', maxInstances: 1 }
  }

// IM 统一消息类型
export interface IMMessage {
  platform: Platform
  messageId: string
  conversationId: string
  senderId: string
  senderName?: string
  groupName?: string
  content: string
  chatType: 'direct' | 'group'
  timestamp: number
}

// IM 平台连接状态
export interface IMPlatformStatus {
  connected: boolean
  startedAt: number | null
  lastError: string | null
  lastInboundAt: number | null
  lastOutboundAt: number | null
}

// IM 实例（替代旧 IMPlatformConfig 的 KV 模式，一行一个实例）
export interface ImInstance {
  id: string
  platform: Platform
  name: string | null
  directoryPath: string | null // 实例级默认目录（null=使用 main）
  agentId: string | null // deriveAgentId(directoryPath) 或 null
  credentials: Record<string, unknown>
  config: ImInstanceConfig
  enabled: boolean
  createdAt: number
  updatedAt: number
}

// 实例配置（嵌入 ImInstance.config 字段）
export interface ImInstanceConfig {
  dmPolicy: 'open' | 'pairing' | 'allowlist' | 'disabled'
  groupPolicy: 'open' | 'allowlist' | 'disabled'
  allowFrom: string[]
  debug: boolean
}

// 对话级绑定（Tier 1 优先级，精确匹配）
export interface ImConversationBinding {
  conversationId: string
  instanceId: string
  peerKind: 'dm' | 'group'
  directoryPath: string
  agentId: string
  createdAt: number
  updatedAt: number
}

// IPC Channel 常量
export const ImIpcChannel = {
  LoadConfig: 'im:load-config',
  SaveConfig: 'im:save-config',
  CreateInstance: 'im:create-instance',
  DeleteInstance: 'im:delete-instance',
  GetStatus: 'im:get-status',
  SetBinding: 'im:set-binding',
  Connect: 'im:connect',
  Disconnect: 'im:disconnect',
  TestConnection: 'im:test-connection',
  // Push events
  StatusUpdate: 'im:status-update',
  MessageReceived: 'im:message-received'
} as const
