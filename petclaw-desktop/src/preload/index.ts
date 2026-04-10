import { contextBridge, ipcRenderer } from 'electron'

const api = {
  moveWindow: (dx: number, dy: number) => ipcRenderer.send('window:move', dx, dy)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
}
