interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ElectronAPI {
  moveWindow: (dx: number, dy: number) => void
  sendChat: (message: string) => Promise<void>
  loadHistory: (limit: number) => Promise<ChatMessage[]>
  onChatChunk: (callback: (chunk: string) => void) => () => void
  onChatDone: (callback: () => void) => () => void
  onChatError: (callback: (error: string) => void) => () => void
  onAIResponding: (callback: () => void) => () => void
  onHookEvent: (
    callback: (event: {
      type: string
      tool: string
      sessionId: string
      data: Record<string, unknown>
      timestamp: number
    }) => void
  ) => () => void
  onPanelOpen: (callback: (panel: string) => void) => () => void
  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<void>
  getAppVersion: () => Promise<string>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
