import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Window
  moveWindow: (dx: number, dy: number) => ipcRenderer.send('window:move', dx, dy),
  toggleChatWindow: () => ipcRenderer.send('chat:toggle'),

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
    ipcRenderer.invoke('onboarding:checkEnv'),
  checkGateway: (url: string): Promise<{ connected: boolean; latencyMs: number | null }> =>
    ipcRenderer.invoke('onboarding:checkGateway', url),
  installHooks: (): Promise<{
    success: boolean
    alreadyInstalled: boolean
    error?: string
  }> => ipcRenderer.invoke('onboarding:installHooks'),
  saveOnboardingConfig: (data: {
    nickname: string
    roles: string[]
    selectedSkills: string[]
    voiceShortcut: string
    language: string
  }): Promise<{ success: boolean }> => ipcRenderer.invoke('onboarding:saveConfig', data),

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

  // ── v3 Cowork ──
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

  // ── v3 Pet 统一入口 ──
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

  // ── v3 Engine 状态 ──
  engine: {
    onStatus: (cb: (status: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, status: unknown) => cb(status)
      ipcRenderer.on('engine:status', handler)
      return () => ipcRenderer.removeListener('engine:status', handler)
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
}
