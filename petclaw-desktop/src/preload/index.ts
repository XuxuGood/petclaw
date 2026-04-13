import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Window
  moveWindow: (dx: number, dy: number) => ipcRenderer.send('window:move', dx, dy),

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
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
}
