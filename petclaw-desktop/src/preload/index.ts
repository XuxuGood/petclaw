import { contextBridge } from 'electron'

const api = {}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
}
