// Cowork 共享类型

import crypto from 'crypto'
import path from 'path'

export type CoworkSessionStatus = 'idle' | 'running' | 'completed' | 'error'
export type CoworkMessageType = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system'

export interface CoworkMessage {
  id: string
  type: CoworkMessageType
  content: string
  timestamp: number
  metadata?: CoworkMessageMetadata
}

export interface CoworkMessageMetadata {
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  toolUseId?: string | null
  error?: string
  isStreaming?: boolean
  skillIds?: string[]
  [key: string]: unknown
}

export interface CoworkSession {
  id: string
  title: string
  directoryPath: string
  agentId: string // deriveAgentId(directoryPath)
  engineSessionId: string | null
  status: CoworkSessionStatus
  modelOverride: string // 会话级模型覆盖
  pinned: boolean
  messages: CoworkMessage[]
  createdAt: number
  updatedAt: number
}

export interface PermissionRequest {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId?: string | null
}

export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean }

export interface CoworkRuntimeEvents {
  message: (sessionId: string, message: CoworkMessage) => void
  messageUpdate: (sessionId: string, messageId: string, content: string) => void
  permissionRequest: (sessionId: string, request: PermissionRequest) => void
  complete: (sessionId: string, engineSessionId: string | null) => void
  error: (sessionId: string, error: string) => void
  sessionStopped: (sessionId: string) => void
}

export interface CoworkStartOptions {
  autoApprove?: boolean
  confirmationMode?: 'modal' | 'text'
}

export type EnginePhase = 'not_installed' | 'starting' | 'ready' | 'running' | 'error'

export interface EngineStatus {
  phase: EnginePhase
  version: string | null
  progressPercent?: number
  message: string
  canRetry: boolean
}

export interface GatewayConnectionInfo {
  version: string | null
  port: number | null
  token: string | null
  url: string | null
  clientEntryPath: string | null
}

export interface RuntimeMetadata {
  root: string | null
  version: string | null
  expectedPathHint: string
}

// ── Directory ──

export interface Directory {
  agentId: string // deriveAgentId(path)
  path: string // 绝对路径
  name: string | null // 用户自定义别名
  modelOverride: string // 空=跟全局
  skillIds: string[] // skill 白名单
  createdAt: number
  updatedAt: number
}

// 由目录绝对路径派生确定性 Agent ID
export function deriveAgentId(dir: string): string {
  const resolved = path.resolve(dir)
  const hash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 12)
  return `ws-${hash}`
}

// ── Model ──

export interface ModelProvider {
  id: string
  name: string
  logo: string
  baseUrl: string
  apiKey: string
  apiFormat: 'openai-completions' | 'anthropic'
  enabled: boolean
  isPreset: boolean
  isCustom: boolean
  models: ModelDefinition[]
}

export interface ModelDefinition {
  id: string
  name: string
  reasoning: boolean
  supportsImage: boolean
  contextWindow: number
  maxTokens: number
}

// ── Skill ──

export interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
  isBuiltIn: boolean
  skillPath: string
  version?: string
}

// ── MCP ──

export interface McpServer {
  id: string
  name: string
  description: string
  enabled: boolean
  transportType: 'stdio' | 'sse' | 'streamable-http'
  config: StdioConfig | HttpConfig
  createdAt: number
  updatedAt: number
}

export interface StdioConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface HttpConfig {
  url: string
  headers?: Record<string, string>
}

// ── Memory ──

export interface MemoryEntry {
  text: string
  line: number
}
