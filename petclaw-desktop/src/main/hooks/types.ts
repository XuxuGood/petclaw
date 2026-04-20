export enum HookEventType {
  ToolUse = 'tool_use',
  Permission = 'permission',
  Error = 'error',
  Complete = 'complete',
  SessionStart = 'session_start',
  SessionEnd = 'session_end'
}

export interface HookEvent {
  type: HookEventType | string
  tool: string
  sessionId: string
  data: Record<string, unknown>
  timestamp?: number
}
