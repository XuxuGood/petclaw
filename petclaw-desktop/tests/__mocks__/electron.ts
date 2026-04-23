import { vi } from 'vitest'

export const app = {
  getPath: vi.fn(() => '/tmp/test'),
  getVersion: vi.fn(() => '0.1.0'),
  getAppPath: vi.fn(() => '/tmp/test-app'),
  isPackaged: false,
  quit: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
  on: vi.fn()
}

export const ipcMain = {
  on: vi.fn(),
  handle: vi.fn(),
  removeHandler: vi.fn()
}

export const ipcRenderer = {
  on: vi.fn(),
  send: vi.fn(),
  invoke: vi.fn(),
  removeListener: vi.fn()
}

export const BrowserWindow = vi.fn()
export const shell = { openExternal: vi.fn() }
export const globalShortcut = { register: vi.fn(), unregisterAll: vi.fn() }
export const Tray = vi.fn()
export const Menu = { buildFromTemplate: vi.fn() }
export const nativeImage = { createEmpty: vi.fn() }
export const contextBridge = { exposeInMainWorld: vi.fn() }
export const session = {
  defaultSession: { webRequest: { onHeadersReceived: vi.fn() } }
}
export const utilityProcess = {
  fork: vi.fn()
}
