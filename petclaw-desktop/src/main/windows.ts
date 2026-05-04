import path from 'path'

import { app, BrowserWindow, shell, screen } from 'electron'
import { is } from '@electron-toolkit/utils'

import { readAppSettings, writeAppSettings } from './app-settings'
import {
  CHAT_H_MIN,
  CHAT_W_MIN,
  PET_H,
  PET_W,
  resolveMainWindowBounds,
  resolvePetWindowBounds,
  type WindowBounds
} from './window-layout'

let petWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
let chatBoundsBeforeHide: Electron.Rectangle | null = null

function getSettingsPath(): string {
  return path.join(app.getPath('home'), '.petclaw', 'petclaw-settings.json')
}

export function createPetWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const settingsPath = getSettingsPath()
  const savedPetPosition = readAppSettings(settingsPath).petPosition
  const chatBounds =
    mainWindow && mainWindow.isVisible() ? (mainWindow.getBounds() as WindowBounds) : undefined
  const petBounds = resolvePetWindowBounds({
    screen: { width, height },
    savedPetPosition,
    chatBounds
  })

  petWindow = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: petBounds.x,
    y: petBounds.y,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: is.dev
    }
  })

  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  petWindow.setAlwaysOnTop(true, 'floating')

  petWindow.on('ready-to-show', () => {
    petWindow?.show()
  })

  petWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    petWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/pet.html')
  } else {
    petWindow.loadFile(path.join(__dirname, '../renderer/pet.html'))
  }

  let petPosTimer: ReturnType<typeof setTimeout> | null = null
  petWindow.on('move', () => {
    if (petPosTimer) clearTimeout(petPosTimer)
    petPosTimer = setTimeout(() => {
      if (!petWindow || petWindow.isDestroyed()) return
      const [x, y] = petWindow.getPosition()
      const settings = readAppSettings(settingsPath)
      settings.petPosition = { x, y }
      writeAppSettings(settingsPath, settings)
    }, 500)
  })

  return petWindow
}

export function createMainWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const settingsPath = getSettingsPath()
  const savedBounds = readAppSettings(settingsPath).windowBounds
  const initialBounds = resolveMainWindowBounds({
    screen: { width, height },
    savedBounds
  })

  mainWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    ...(initialBounds.x !== undefined && initialBounds.y !== undefined
      ? { x: initialBounds.x, y: initialBounds.y }
      : {}),
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 21 },
    // 主窗口必须透明，renderer 的 backdrop-filter 才能读到底层桌面并形成真正毛玻璃。
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    // 毛玻璃跟随窗口焦点：失焦时整窗自然变暗，避免 hiddenInset 原生红绿灯
    // 退色成浅灰后压在常亮毛玻璃上泛白的视觉问题，保持与 macOS 其它 app 一致的失焦表现。
    visualEffectState: 'followWindow',
    show: false,
    minWidth: CHAT_W_MIN,
    minHeight: CHAT_H_MIN,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: is.dev
    }
  })

  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  const saveBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const bounds = mainWindow.getBounds()
      const settings = readAppSettings(settingsPath)
      settings.windowBounds = bounds
      writeAppSettings(settingsPath, settings)
    }, 500)
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)

  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.on('will-resize', (e, _newBounds, details) => {
    if (details.edge === 'top-left' || details.edge === 'top-right') {
      e.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

export function toggleMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isVisible()) {
    chatBoundsBeforeHide = mainWindow.getBounds()
    mainWindow.hide()
  } else {
    if (chatBoundsBeforeHide) {
      mainWindow.setBounds(chatBoundsBeforeHide)
    }
    mainWindow.show()
    mainWindow.focus()
  }
}

export function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (chatBoundsBeforeHide && !mainWindow.isVisible()) {
    mainWindow.setBounds(chatBoundsBeforeHide)
  }
  mainWindow.show()
  mainWindow.focus()
}

export function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.focus()
}

export function showPetWindow(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  petWindow.show()
}

export function hidePetWindow(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  petWindow.hide()
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function closeMainWindowForQuit(): void {
  mainWindow?.removeAllListeners('close')
  mainWindow?.close()
}
