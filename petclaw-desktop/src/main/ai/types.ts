// v3 Cowork 共享类型

export type CoworkExecutionMode = 'auto' | 'local' | 'sandbox'
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
  claudeSessionId: string | null
  status: CoworkSessionStatus
  pinned: boolean
  cwd: string
  systemPrompt: string
  modelOverride: string
  executionMode: CoworkExecutionMode
  activeSkillIds: string[]
  agentId: string
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
  complete: (sessionId: string, claudeSessionId: string | null) => void
  error: (sessionId: string, error: string) => void
  sessionStopped: (sessionId: string) => void
}

export interface CoworkStartOptions {
  skillIds?: string[]
  systemPrompt?: string
  autoApprove?: boolean
  workspaceRoot?: string
  confirmationMode?: 'modal' | 'text'
  agentId?: string
}

export type EnginePhase = 'not_installed' | 'starting' | 'ready' | 'error'

export interface EngineStatus {
  phase: EnginePhase
  version: string | null
  message: string
  canRetry: boolean
}

export interface RuntimeMetadata {
  root: string | null
  version: string | null
  expectedPathHint: string
}
