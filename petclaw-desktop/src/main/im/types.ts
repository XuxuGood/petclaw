// src/main/im/types.ts
// IM 平台类型定义（参考 LobsterAI im/types.ts，PetClaw 简化版）

// Phase 3 只实现 4 个平台：飞书、钉钉、企微、微信
export type Platform = 'wechat' | 'wecom' | 'dingtalk' | 'feishu'

// 支持多实例的平台
export type MultiInstancePlatform = 'dingtalk' | 'feishu' | 'wecom'

export const MULTI_INSTANCE_PLATFORMS: MultiInstancePlatform[] = [
  'dingtalk', 'feishu', 'wecom'
]

// 平台显示信息
export const PLATFORM_INFO: Record<Platform, { name: string; icon: string; maxInstances: number }> = {
  feishu: { name: '飞书', icon: '🐦', maxInstances: 3 },
  dingtalk: { name: '钉钉', icon: '📌', maxInstances: 3 },
  wecom: { name: '企业微信', icon: '🏢', maxInstances: 3 },
  wechat: { name: '微信', icon: '💬', maxInstances: 1 }
}

// IM 绑定规则：
// - 一个平台实例同一时间只能被一个 Agent 持有（互斥锁）
// - 已被其他 Agent 绑定的平台在 UI 上显示灰色 + "→ AgentName"，不可点击
// - main Agent 是兜底：未绑定任何 Agent 的平台消息默认交给 main 处理
// - main Agent 不在 Agent 列表中显示，不需要显式绑定 IM

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

// IM 全局设置
export interface IMSettings {
  systemPrompt: string
  skillsEnabled: boolean
  platformAgentBindings: Record<string, string> // key 格式: 'telegram' 或 'dingtalk:instance-id'
}

// IM 平台通用配置
export interface IMPlatformConfig {
  enabled: boolean
  dmPolicy: 'open' | 'pairing' | 'allowlist' | 'disabled'
  groupPolicy: 'open' | 'allowlist' | 'disabled'
  allowFrom: string[]
  debug: boolean
}

// 多实例平台的实例配置
export interface IMInstanceConfig extends IMPlatformConfig {
  instanceId: string
  instanceName: string
}

// IPC Channel 常量
export const ImIpcChannel = {
  LoadConfig: 'im:load-config',
  SaveConfig: 'im:save-config',
  GetStatus: 'im:get-status',
  Connect: 'im:connect',
  Disconnect: 'im:disconnect',
  TestConnection: 'im:test-connection',
  // Push events
  StatusUpdate: 'im:status-update',
  MessageReceived: 'im:message-received'
} as const
