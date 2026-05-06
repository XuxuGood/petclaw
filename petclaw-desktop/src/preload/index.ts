import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Window
  moveWindow: (dx: number, dy: number) => ipcRenderer.send('window:move', dx, dy),
  toggleMainWindow: () => ipcRenderer.send('chat:toggle'),
  updateComposerBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('window:composer-bounds:update', bounds),

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
  // i18n 语言查询与切换
  getLanguage: (): Promise<string> => ipcRenderer.invoke('i18n:get-language'),
  setLanguage: (locale: string): Promise<void> => ipcRenderer.invoke('i18n:set-language', locale),

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

  // ── Chat (附件对话框) ──
  chat: {
    // 调用原生对话框选择文件和/或目录绝对路径；返回空数组即表示取消。
    // kind='image' 的条目额外带 base64Data+mimeType，供 chip 内联缩略图预览。
    selectAttachments: (options?: {
      defaultPath?: string
      mode?: 'auto' | 'file' | 'directory'
    }): Promise<
      Array<{
        path: string
        kind: 'file' | 'directory' | 'image'
        mimeType?: string
        base64Data?: string
      }>
    > => ipcRenderer.invoke('dialog:select-attachments', options)
  },

  // ── Cowork ──
  cowork: {
    startSession: (options: {
      prompt: string
      cwd?: string
      systemPrompt?: string
      imageAttachments?: Array<{ name: string; mimeType: string; base64Data: string }>
      pathReferences?: Array<{ path: string; kind: 'file' | 'directory' }>
      skillIds?: string[]
      selectedModel?: { providerId: string; modelId: string }
    }) => ipcRenderer.invoke('cowork:session:start', options),
    continueSession: (options: {
      sessionId: string
      prompt: string
      systemPrompt?: string
      imageAttachments?: Array<{ name: string; mimeType: string; base64Data: string }>
      pathReferences?: Array<{ path: string; kind: 'file' | 'directory' }>
      skillIds?: string[]
      selectedModel?: { providerId: string; modelId: string }
    }) => ipcRenderer.invoke('cowork:session:continue', options),
    getConfig: () => ipcRenderer.invoke('cowork:config:get'),
    setConfig: (patch: {
      defaultDirectory?: string
      systemPrompt?: string
      memoryEnabled?: boolean
      skipMissedJobs?: boolean
    }) => ipcRenderer.invoke('cowork:config:set', patch),
    stopSession: (sessionId: string) => ipcRenderer.invoke('cowork:session:stop', sessionId),
    listSessions: () => ipcRenderer.invoke('cowork:session:list'),
    getSession: (id: string) => ipcRenderer.invoke('cowork:session:get', id),
    deleteSession: (id: string) => ipcRenderer.invoke('cowork:session:delete', id),
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
    onPermissionDismiss: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('cowork:stream:permission-dismiss', handler)
      return () => ipcRenderer.removeListener('cowork:stream:permission-dismiss', handler)
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
    },
    onSessionStopped: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('cowork:stream:session-stopped', handler)
      return () => ipcRenderer.removeListener('cowork:stream:session-stopped', handler)
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

  // ── Logging / Diagnostics ──
  logging: {
    report: (event: {
      level: 'warn' | 'error'
      module: string
      event: string
      message: string
      fields?: Record<string, unknown>
    }): Promise<void> => ipcRenderer.invoke('logging:report', event),
    snapshot: (): Promise<unknown> => ipcRenderer.invoke('logging:snapshot'),
    exportDiagnostics: (options: { timeRangeDays: 1 | 3 | 7 }): Promise<unknown> =>
      ipcRenderer.invoke('logging:export-diagnostics', options),
    openLogFolder: (): Promise<void> => ipcRenderer.invoke('logging:open-log-folder')
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
      ipcRenderer.invoke('directory:update-skills', agentId, skillIds),
    // 调用系统原生目录选择对话框；用户取消返回 null
    selectDirectory: (options?: { defaultPath?: string }): Promise<string | null> =>
      ipcRenderer.invoke('dialog:select-directory', options)
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
    defaultModel: () => ipcRenderer.invoke('models:default'),
    setDefaultModel: (selected: unknown) => ipcRenderer.invoke('models:set-default', selected),
    setApiKey: (providerId: string, apiKey: string) =>
      ipcRenderer.invoke('models:set-api-key', providerId, apiKey),
    clearApiKey: (providerId: string) => ipcRenderer.invoke('models:clear-api-key', providerId),
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
    setEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('mcp:set-enabled', id, enabled),
    refreshBridge: () => ipcRenderer.invoke('mcp:bridge:refresh'),
    // MCP Bridge 同步状态事件
    onBridgeSyncStart: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('mcp:bridge:syncStart', handler)
      return () => ipcRenderer.removeListener('mcp:bridge:syncStart', handler)
    },
    onBridgeSyncDone: (cb: (data: { tools: number; error?: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { tools: number; error?: string }) =>
        cb(data)
      ipcRenderer.on('mcp:bridge:syncDone', handler)
      return () => ipcRenderer.removeListener('mcp:bridge:syncDone', handler)
    }
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
    listInstances: () => ipcRenderer.invoke('im:load-config'),
    createInstance: (platform: string, credentials: Record<string, unknown>, name?: string) =>
      ipcRenderer.invoke('im:create-instance', platform, credentials, name),
    updateInstance: (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('im:save-config', id, patch),
    deleteInstance: (id: string) => ipcRenderer.invoke('im:delete-instance', id),
    getStatus: () => ipcRenderer.invoke('im:get-status'),
    setBinding: (
      conversationId: string,
      instanceId: string,
      peerKind: 'dm' | 'group',
      directoryPath: string,
      agentId: string
    ) =>
      ipcRenderer.invoke(
        'im:set-binding',
        conversationId,
        instanceId,
        peerKind,
        directoryPath,
        agentId
      ),
    onStatusUpdate: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('im:status-update', handler)
      return () => ipcRenderer.removeListener('im:status-update', handler)
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
}
