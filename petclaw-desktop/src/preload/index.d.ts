interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ElectronAPI {
  moveWindow: (dx: number, dy: number) => void
  toggleChatWindow: () => void
  sendChat: (message: string) => Promise<void>
  loadHistory: (limit: number) => Promise<ChatMessage[]>
  onChatChunk: (callback: (chunk: string) => void) => () => void
  onChatDone: (callback: () => void) => () => void
  onChatError: (callback: (error: string) => void) => () => void
  onAIResponding: (callback: () => void) => () => void
  onChatSent: (callback: () => void) => () => void
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
  checkEnv: () => Promise<{ nodeOk: boolean; nodeVersion: string | null }>
  checkGateway: (url: string) => Promise<{ connected: boolean; latencyMs: number | null }>
  installHooks: () => Promise<{ success: boolean; alreadyInstalled: boolean; error?: string }>
  saveOnboardingConfig: (data: {
    nickname: string
    roles: string[]
    selectedSkills: string[]
    voiceShortcut: string
    language: string
  }) => Promise<{ success: boolean }>
  onBootStepUpdate: (
    callback: (
      steps: Array<{
        id: string
        label: string
        status: 'pending' | 'running' | 'done' | 'error'
        error?: string
        hint?: string
      }>
    ) => void
  ) => () => void
  onBootComplete: (callback: (success: boolean) => void) => () => void
  retryBoot: () => void
  petReady: () => void
  getBootStatus: () => Promise<boolean | null>
  quitApp: () => void
  showPetContextMenu: (paused: boolean) => void
  onPetTogglePause: (callback: () => void) => () => void
  // v3 Cowork
  cowork: {
    send: (message: string, cwd: string) => Promise<unknown>
    continue: (sessionId: string, message: string) => Promise<void>
    stop: (sessionId: string) => Promise<void>
    sessions: () => Promise<unknown[]>
    session: (id: string) => Promise<unknown>
    deleteSession: (id: string) => Promise<void>
    respondPermission: (requestId: string, result: unknown) => Promise<void>
    onMessage: (cb: (data: unknown) => void) => () => void
    onMessageUpdate: (cb: (data: unknown) => void) => () => void
    onPermission: (cb: (data: unknown) => void) => () => void
    onComplete: (cb: (data: unknown) => void) => () => void
    onError: (cb: (data: unknown) => void) => () => void
  }
  // v3 Pet
  pet: {
    onStateEvent: (cb: (data: unknown) => void) => () => void
    onBubble: (cb: (data: unknown) => void) => () => void
  }
  // v3 Engine
  engine: {
    onStatus: (cb: (status: unknown) => void) => () => void
  }
  // v3 Phase 2: Manager APIs
  agents: {
    list: () => Promise<unknown>
    get: (id: string) => Promise<unknown>
    create: (data: unknown) => Promise<unknown>
    update: (id: string, patch: unknown) => Promise<unknown>
    delete: (id: string) => Promise<unknown>
  }
  models: {
    providers: () => Promise<unknown>
    provider: (id: string) => Promise<unknown>
    addProvider: (data: unknown) => Promise<unknown>
    updateProvider: (id: string, patch: unknown) => Promise<unknown>
    removeProvider: (id: string) => Promise<unknown>
    toggleProvider: (id: string, enabled: boolean) => Promise<unknown>
    active: () => Promise<unknown>
    setActive: (id: string) => Promise<unknown>
    testConnection: (id: string) => Promise<unknown>
    addModel: (providerId: string, model: unknown) => Promise<unknown>
    removeModel: (providerId: string, modelId: string) => Promise<unknown>
  }
  skills: {
    list: () => Promise<unknown>
    setEnabled: (id: string, enabled: boolean) => Promise<unknown>
  }
  mcp: {
    list: () => Promise<unknown>
    create: (data: unknown) => Promise<unknown>
    update: (id: string, patch: unknown) => Promise<unknown>
    delete: (id: string) => Promise<unknown>
    setEnabled: (id: string, enabled: boolean) => Promise<unknown>
  }
  memory: {
    read: (workspace: string) => Promise<unknown>
    append: (workspace: string, entry: string) => Promise<unknown>
    remove: (workspace: string, text: string) => Promise<unknown>
    search: (workspace: string, keyword: string) => Promise<unknown>
    listEntries: (workspace: string) => Promise<unknown>
    updateEntry: (workspace: string, oldText: string, newText: string) => Promise<unknown>
  }
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
