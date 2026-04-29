// Cowork 共享类型

import crypto from 'crypto'
import path from 'path'

// 模型相关类型从 shared 导入并 re-export，保持 main 内部已有 import 路径不变
export type {
  ModelApiFormat,
  ModelAuthMode,
  ModelDefinition,
  ModelPreference,
  ModelProviderConfig,
  ProviderDefinition,
  SelectedModel
} from '../../shared/models/types'
import type { SelectedModel } from '../../shared/models/types'

export type CoworkSessionStatus = 'idle' | 'running' | 'completed' | 'error'
export type CoworkSessionOrigin = 'chat' | 'im' | 'scheduler' | 'hook'
export type CoworkMessageType = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system'

export interface CoworkMessage {
  id: string
  type: CoworkMessageType
  content: string
  timestamp: number
  metadata?: CoworkMessageMetadata
}

export interface ImageAttachment {
  name: string
  mimeType: string
  base64Data: string
}

export interface CoworkMessageMetadata {
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  toolUseId?: string | null
  error?: string
  isStreaming?: boolean
  isThinking?: boolean
  isTimeout?: boolean
  isFinal?: boolean
  imageAttachments?: ImageAttachment[]
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
  origin: CoworkSessionOrigin // 会话触发来源：chat=用户手动发起, im=IM 消息触发, scheduler=定时任务, hook=hook 触发
  selectedModel: SelectedModel | null // 会话级模型选择
  systemPrompt: string // 创建会话时固化的系统提示词
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
  permissionDismiss: (requestId: string) => void
  complete: (sessionId: string, engineSessionId: string | null) => void
  error: (sessionId: string, error: string) => void
  sessionStopped: (sessionId: string) => void
}

export interface CoworkStartOptions {
  autoApprove?: boolean
  confirmationMode?: 'modal' | 'text'
  imageAttachments?: ImageAttachment[]
  skillIds?: string[]
  skillPrompt?: string
  selectedModel?: SelectedModel
  systemPrompt?: string
  useMainAgent?: boolean
  origin?: CoworkSessionOrigin
}

export interface CoworkContinueOptions {
  systemPrompt?: string
  skillIds?: string[]
  skillPrompt?: string
  selectedModel?: SelectedModel
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

// 生成 gateway 侧 session key，格式：agent:{agentId}:petclaw:{sessionId}
// OpenClaw 运行时用此 key 做 workspace 路由和会话标识
export function buildSessionKey(agentId: string, sessionId: string): string {
  return `agent:${agentId}:petclaw:${sessionId}`
}

export type TextStreamMode = 'unknown' | 'snapshot' | 'delta'

// 一个正在运行的 turn 的完整状态，由 CoworkController.runTurn 创建
export interface ActiveTurn {
  sessionId: string
  sessionKey: string // gateway 侧 key
  runId: string // 幂等 ID
  turnToken: number // 单调递增，用于区分新旧 turn
  startedAtMs: number
  assistantMessageId: string | null
  stopRequested: boolean
  timeoutTimer?: ReturnType<typeof setTimeout>
  // 一个 turn 可能跨多个 runId（重试等场景）
  knownRunIds: Set<string>
  // 流式文本累积
  currentText: string
  textStreamMode: TextStreamMode
  // 文本分段（多 tool 场景下 assistant 文本在 tool 边界自动切分）
  committedAssistantText: string
  // tool 消息映射
  // hwm：agentText 累积文本长度高水位，用于检测文本回退（新 model call 边界）
  agentAssistantTextLength: number
  toolUseMessageIdByToolCallId: Map<string, string>
  toolResultMessageIdByToolCallId: Map<string, string>
  toolResultTextByToolCallId: Map<string, string>
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

/** MCP Bridge 工具清单条目：由 McpServerManager 发现后传给 ConfigSync */
export interface McpToolManifestEntry {
  server: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

// ── Memory ──

export interface MemoryEntry {
  text: string
  line: number
}
