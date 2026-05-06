interface ElectronAPI {
  moveWindow: (dx: number, dy: number) => void
  toggleMainWindow: () => void
  updateComposerBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
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
  getLanguage: () => Promise<string>
  setLanguage: (locale: string) => Promise<void>
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
  // Chat (附件对话框)
  chat: {
    selectAttachments: (options?: {
      defaultPath?: string
      mode?: 'auto' | 'file' | 'directory'
    }) => Promise<
      Array<{
        path: string
        kind: 'file' | 'directory' | 'image'
        mimeType?: string
        base64Data?: string
      }>
    >
  }
  // Cowork
  cowork: {
    startSession: (options: {
      prompt: string
      cwd?: string
      systemPrompt?: string
      imageAttachments?: Array<{ name: string; mimeType: string; base64Data: string }>
      pathReferences?: Array<{ path: string; kind: 'file' | 'directory' }>
      skillIds?: string[]
      selectedModel?: { providerId: string; modelId: string }
    }) => Promise<unknown>
    continueSession: (options: {
      sessionId: string
      prompt: string
      systemPrompt?: string
      imageAttachments?: Array<{ name: string; mimeType: string; base64Data: string }>
      pathReferences?: Array<{ path: string; kind: 'file' | 'directory' }>
      skillIds?: string[]
      selectedModel?: { providerId: string; modelId: string }
    }) => Promise<void>
    getConfig: () => Promise<unknown>
    setConfig: (patch: {
      defaultDirectory?: string
      systemPrompt?: string
      memoryEnabled?: boolean
      skipMissedJobs?: boolean
    }) => Promise<unknown>
    stopSession: (sessionId: string) => Promise<void>
    listSessions: () => Promise<unknown[]>
    getSession: (id: string) => Promise<unknown>
    deleteSession: (id: string) => Promise<void>
    respondPermission: (requestId: string, result: unknown) => Promise<void>
    onMessage: (cb: (data: unknown) => void) => () => void
    onMessageUpdate: (cb: (data: unknown) => void) => () => void
    onPermission: (cb: (data: unknown) => void) => () => void
    onPermissionDismiss: (cb: (data: unknown) => void) => () => void
    onComplete: (cb: (data: unknown) => void) => () => void
    onError: (cb: (data: unknown) => void) => () => void
    onSessionStopped: (cb: (data: unknown) => void) => () => void
  }
  // Pet
  pet: {
    onStateEvent: (cb: (data: unknown) => void) => () => void
    onBubble: (cb: (data: unknown) => void) => () => void
  }
  // Engine
  engine: {
    onStatus: (cb: (status: unknown) => void) => () => void
  }
  // Auto-updater
  updater: {
    check: () => Promise<void>
    download: () => Promise<void>
    install: () => Promise<void>
    onStatus: (
      cb: (data: {
        status: 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'
        info?: { version: string; releaseDate: string; releaseNotes: string | null }
        progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number }
        error?: string
      }) => void
    ) => () => void
  }
  // Logging / Diagnostics
  logging: {
    report: (event: {
      level: 'warn' | 'error'
      module: string
      event: string
      message: string
      fields?: Record<string, unknown>
    }) => Promise<void>
    snapshot: () => Promise<unknown>
    exportDiagnostics: (options: { timeRangeDays: 1 | 3 | 7 }) => Promise<unknown>
    openLogFolder: () => Promise<void>
  }
  // Manager APIs
  directories: {
    list: () => Promise<unknown>
    get: (agentId: string) => Promise<unknown>
    getByPath: (path: string) => Promise<unknown>
    updateName: (agentId: string, name: string) => Promise<void>
    updateModel: (agentId: string, model: string) => Promise<void>
    updateSkills: (agentId: string, skillIds: string[]) => Promise<void>
    selectDirectory: (options?: { defaultPath?: string }) => Promise<string | null>
  }
  models: {
    providers: () => Promise<unknown>
    provider: (id: string) => Promise<unknown>
    addProvider: (data: unknown) => Promise<unknown>
    updateProvider: (id: string, patch: unknown) => Promise<unknown>
    removeProvider: (id: string) => Promise<unknown>
    toggleProvider: (id: string, enabled: boolean) => Promise<unknown>
    defaultModel: () => Promise<unknown>
    setDefaultModel: (selected: unknown) => Promise<unknown>
    setApiKey: (providerId: string, apiKey: string) => Promise<unknown>
    clearApiKey: (providerId: string) => Promise<unknown>
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
    refreshBridge: () => Promise<{ success: boolean; error?: string }>
    onBridgeSyncStart: (cb: () => void) => () => void
    onBridgeSyncDone: (cb: (data: { tools: number; error?: string }) => void) => () => void
  }
  memory: {
    read: (workspace: string) => Promise<unknown>
    append: (workspace: string, entry: string) => Promise<unknown>
    remove: (workspace: string, text: string) => Promise<unknown>
    search: (workspace: string, keyword: string) => Promise<unknown>
    listEntries: (workspace: string) => Promise<unknown>
    updateEntry: (workspace: string, oldText: string, newText: string) => Promise<unknown>
  }
  // Scheduler
  scheduler: {
    list: () => Promise<unknown>
    create: (input: unknown) => Promise<unknown>
    update: (id: string, input: unknown) => Promise<unknown>
    delete: (id: string) => Promise<unknown>
    toggle: (id: string, enabled: boolean) => Promise<unknown>
    runManually: (id: string) => Promise<unknown>
    listRuns: (jobId: string, limit?: number, offset?: number) => Promise<unknown>
    listAllRuns: (limit?: number, offset?: number) => Promise<unknown>
    onStatusUpdate: (cb: (data: unknown) => void) => () => void
    onRefresh: (cb: () => void) => () => void
  }
  // IM
  im: {
    listInstances: () => Promise<unknown>
    createInstance: (
      platform: string,
      credentials: Record<string, unknown>,
      name?: string
    ) => Promise<unknown>
    updateInstance: (id: string, patch: Record<string, unknown>) => Promise<void>
    deleteInstance: (id: string) => Promise<void>
    getStatus: () => Promise<unknown>
    setBinding: (
      conversationId: string,
      instanceId: string,
      peerKind: 'dm' | 'group',
      directoryPath: string,
      agentId: string
    ) => Promise<void>
    onStatusUpdate: (cb: (data: unknown) => void) => () => void
  }
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
