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
      }>
    ) => callback(steps)
    ipcRenderer.on('boot:step-update', handler)
    return () => ipcRenderer.removeListener('boot:step-update', handler)
  },
  onBootComplete: (callback: (success: boolean) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, success: boolean) => callback(success)
    ipcRenderer.on('boot:complete', handler)
    return () => ipcRenderer.removeListener('boot:complete', handler)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
}
