import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Window
  moveWindow: (dx: number, dy: number) => ipcRenderer.send('window:move', dx, dy),
  toggleMainWindow: () => ipcRenderer.send('chat:toggle'),

  // Chat
  sendChat: (message: string): Promise<void> => ipcRenderer.invoke('chat:send', message),
  loadHistory: (limit: number): Promise<Array<{ role: string; content: string }>> =>
    ipcRenderer.invoke('chat:history', limit),
  onChatChunk: (callback: (chunk: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, chunk: string) => callback(chunk)
    ipcRenderer.on('chat:chunk', handler)
    return () => ipcRenderer.removeListener('chat:chunk', handler)
  },
  onChatDone: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('chat:done', handler)
    return () => ipcRenderer.removeListener('chat:done', handler)
  },
  onChatError: (callback: (error: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, error: string) => callback(error)
    ipcRenderer.on('chat:error', handler)
    return () => ipcRenderer.removeListener('chat:error', handler)
  },
  onAIResponding: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('chat:ai-responding', handler)
    return () => ipcRenderer.removeListener('chat:ai-responding', handler)
  },
  onChatSent: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('pet:chat-sent', handler)
    return () => ipcRenderer.removeListener('pet:chat-sent', handler)
  },
  onHookEvent: (
    callback: (event: {
      type: string
      tool: string
      sessionId: string
      data: Record<string, unknown>
      timestamp: number
    }) => void
  ) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      event: {
        type: string
        tool: string
        sessionId: string
        data: Record<string, unknown>
        timestamp: number
      }
    ) => callback(event)
    ipcRenderer.on('hook:event', handler)
    return () => ipcRenderer.removeListener('hook:event', handler)
  },
  onPanelOpen: (callback: (panel: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, panel: string) => callback(panel)
    ipcRenderer.on('panel:open', handler)
    return () => ipcRenderer.removeListener('panel:open', handler)
  },
  getSetting: (key: string): Promise<string | null> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string): Promise<void> =>
    ipcRenderer.invoke('settings:set', key, value),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

  // Onboarding
  checkEnv: (): Promise<{ nodeOk: boolean; nodeVersion: string | null }> =>
    ipcRenderer.invoke('onboarding:check-env'),
  checkGateway: (url: string): Promise<{ connected: boolean; latencyMs: number | null }> =>
    ipcRenderer.invoke('onboarding:check-gateway', url),
  installHooks: (): Promise<{
    success: boolean
    alreadyInstalled: boolean
    error?: string
  }> => ipcRenderer.invoke('onboarding:install-hooks'),
  saveOnboardingConfig: (data: {
    nickname: string
    roles: string[]
    selectedSkills: string[]
    voiceShortcut: string
    language: string
  }): Promise<{ success: boolean }> => ipcRenderer.invoke('onboarding:save-config', data),

  // BootCheck
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
  ) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      steps: Array<{
        id: string
        label: string
        status: 'pending' | 'running' | 'done' | 'error'
        error?: string
        hint?: string
      }>
    ) => callback(steps)
    ipcRenderer.on('boot:step-update', handler)
    return () => ipcRenderer.removeListener('boot:step-update', handler)
  },
  onBootComplete: (callback: (success: boolean) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, success: boolean) => callback(success)
    ipcRenderer.on('boot:complete', handler)
    return () => ipcRenderer.removeListener('boot:complete', handler)
  },
  retryBoot: () => ipcRenderer.send('boot:retry'),

  // App lifecycle
  petReady: () => ipcRenderer.send('app:pet-ready'),
  getBootStatus: (): Promise<boolean | null> => ipcRenderer.invoke('boot:status'),
  quitApp: () => ipcRenderer.send('app:quit'),
  showPetContextMenu: (paused: boolean) => ipcRenderer.send('pet:context-menu', paused),
  onPetTogglePause: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('pet:toggle-pause', handler)
    return () => ipcRenderer.removeListener('pet:toggle-pause', handler)
  },

  // ── Cowork ──
  cowork: {
    send: (message: string, cwd: string) => ipcRenderer.invoke('chat:send', message, cwd),
    continue: (sessionId: string, message: string) =>
      ipcRenderer.invoke('chat:continue', sessionId, message),
    stop: (sessionId: string) => ipcRenderer.invoke('chat:stop', sessionId),
    sessions: () => ipcRenderer.invoke('chat:sessions'),
    session: (id: string) => ipcRenderer.invoke('chat:session', id),
    deleteSession: (id: string) => ipcRenderer.invoke('chat:delete-session', id),
    respondPermission: (requestId: string, result: unknown) =>
      ipcRenderer.invoke('cowork:permission:respond', requestId, result),
    onMessage: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('cowork:stream:message', handler)
      return () => ipcRenderer.removeListener('cowork:stream:message', handler)
    },
    onMessageUpdate: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('cowork:stream:message-update', handler)
      return () => ipcRenderer.removeListener('cowork:stream:message-update', handler)
    },
    onPermission: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('cowork:stream:permission', handler)
      return () => ipcRenderer.removeListener('cowork:stream:permission', handler)
    },
    onComplete: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('cowork:stream:complete', handler)
      return () => ipcRenderer.removeListener('cowork:stream:complete', handler)
    },
    onError: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('cowork:stream:error', handler)
      return () => ipcRenderer.removeListener('cowork:stream:error', handler)
    }
  },

  // ── Pet 统一入口 ──
  pet: {
    onStateEvent: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('pet:state-event', handler)
      return () => ipcRenderer.removeListener('pet:state-event', handler)
    },
    onBubble: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('pet:bubble', handler)
      return () => ipcRenderer.removeListener('pet:bubble', handler)
    }
  },

  // ── Engine 状态 ──
  engine: {
    onStatus: (cb: (status: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, status: unknown) => cb(status)
      ipcRenderer.on('engine:status', handler)
      return () => ipcRenderer.removeListener('engine:status', handler)
    }
  },

  // ── Auto-updater ──
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('updater:status', handler)
      return () => ipcRenderer.removeListener('updater:status', handler)
    }
  },

  // ── Manager APIs ──
  directories: {
    list: () => ipcRenderer.invoke('directory:list'),
    get: (agentId: string) => ipcRenderer.invoke('directory:get', agentId),
    getByPath: (path: string) => ipcRenderer.invoke('directory:get-by-path', path),
    updateName: (agentId: string, name: string) =>
      ipcRenderer.invoke('directory:update-name', agentId, name),
    updateModel: (agentId: string, model: string) =>
      ipcRenderer.invoke('directory:update-model', agentId, model),
    updateSkills: (agentId: string, skillIds: string[]) =>
      ipcRenderer.invoke('directory:update-skills', agentId, skillIds)
  },
  models: {
    providers: () => ipcRenderer.invoke('models:providers'),
    provider: (id: string) => ipcRenderer.invoke('models:provider', id),
    addProvider: (data: unknown) => ipcRenderer.invoke('models:add-provider', data),
    updateProvider: (id: string, patch: unknown) =>
      ipcRenderer.invoke('models:update-provider', id, patch),
    removeProvider: (id: string) => ipcRenderer.invoke('models:remove-provider', id),
    toggleProvider: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('models:toggle-provider', id, enabled),
    active: () => ipcRenderer.invoke('models:active'),
    setActive: (id: string) => ipcRenderer.invoke('models:set-active', id),
    testConnection: (id: string) => ipcRenderer.invoke('models:test-connection', id),
    addModel: (providerId: string, model: unknown) =>
      ipcRenderer.invoke('models:add-model', providerId, model),
    removeModel: (providerId: string, modelId: string) =>
      ipcRenderer.invoke('models:remove-model', providerId, modelId)
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    setEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('skills:set-enabled', id, enabled)
  },
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    create: (data: unknown) => ipcRenderer.invoke('mcp:create', data),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('mcp:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('mcp:delete', id),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('mcp:set-enabled', id, enabled)
  },
  memory: {
    read: (workspace: string) => ipcRenderer.invoke('memory:read', workspace),
    append: (workspace: string, entry: string) =>
      ipcRenderer.invoke('memory:append', workspace, entry),
    remove: (workspace: string, text: string) =>
      ipcRenderer.invoke('memory:remove', workspace, text),
    search: (workspace: string, keyword: string) =>
      ipcRenderer.invoke('memory:search', workspace, keyword),
    listEntries: (workspace: string) => ipcRenderer.invoke('memory:list-entries', workspace),
    updateEntry: (workspace: string, oldText: string, newText: string) =>
      ipcRenderer.invoke('memory:update-entry', workspace, oldText, newText)
  },

  // ── Scheduler ──
  scheduler: {
    list: () => ipcRenderer.invoke('scheduler:list'),
    create: (input: unknown) => ipcRenderer.invoke('scheduler:create', input),
    update: (id: string, input: unknown) => ipcRenderer.invoke('scheduler:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('scheduler:delete', id),
    toggle: (id: string, enabled: boolean) => ipcRenderer.invoke('scheduler:toggle', id, enabled),
    runManually: (id: string) => ipcRenderer.invoke('scheduler:run-manually', id),
    listRuns: (jobId: string, limit?: number, offset?: number) =>
      ipcRenderer.invoke('scheduler:list-runs', jobId, limit, offset),
    listAllRuns: (limit?: number, offset?: number) =>
      ipcRenderer.invoke('scheduler:list-all-runs', limit, offset),
    onStatusUpdate: (cb: (data: unknown) => void) => {
      // 监听调度任务状态推送，返回取消订阅函数
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('scheduler:status-update', handler)
      return () => ipcRenderer.removeListener('scheduler:status-update', handler)
    },
    onRefresh: (cb: () => void) => {
      // 监听调度列表刷新通知（任务增删后主进程广播）
      const handler = () => cb()
      ipcRenderer.on('scheduler:refresh', handler)
      return () => ipcRenderer.removeListener('scheduler:refresh', handler)
    }
  },

  // ── IM ──
  im: {
    loadConfig: () => ipcRenderer.invoke('im:load-config'),
    saveConfig: (key: string, config: unknown) => ipcRenderer.invoke('im:save-config', key, config),
    getStatus: () => ipcRenderer.invoke('im:get-status'),
    loadSettings: () => ipcRenderer.invoke('im:load-settings'),
    saveSettings: (settings: unknown) => ipcRenderer.invoke('im:save-settings', settings),
    onStatusUpdate: (cb: (data: unknown) => void) => {
      // 监听 IM 连接状态变更推送，返回取消订阅函数
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('im:status-update', handler)
      return () => ipcRenderer.removeListener('im:status-update', handler)
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
}
