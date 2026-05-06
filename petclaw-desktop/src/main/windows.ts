import path from 'path'
import fs from 'fs'

import { app, BrowserWindow, shell, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import type Database from 'better-sqlite3'

import { kvGet, kvSet } from './data/db'
import { registerEditShortcuts } from './system/edit-shortcuts'
import { activateMainWindow } from './system/window-activation'
import {
  CHAT_H_MIN,
  CHAT_W_MIN,
  PET_COMPOSER_RIGHT_GAP,
  PET_COMPOSER_TOP_GAP,
  PET_H,
  PET_VISUAL_BOTTOM_EDGE,
  PET_VISUAL_RIGHT_EDGE,
  PET_W,
  resolveMainWindowBounds,
  resolvePetWindowBounds,
  type Point,
  type WindowBounds
} from './window-layout'

let petWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
let chatBoundsBeforeHide: Electron.Rectangle | null = null
let programmaticPetPosition: Point | null = null
let latestComposerBounds: WindowBounds | null = null
let petPositionLockedByUser = false

const MAIN_WINDOW_BOUNDS_KEY = 'window.mainBounds'
const PET_WINDOW_POSITION_KEY = 'window.petPosition'

export interface WindowIconPathOptions {
  platform?: NodeJS.Platform
  appPath?: string
  exists?: (filePath: string) => boolean
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseJsonConfig(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function isWindowBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    isFiniteNumber(record.x) &&
    isFiniteNumber(record.y) &&
    isFiniteNumber(record.width) &&
    isFiniteNumber(record.height)
  )
}

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return isFiniteNumber(record.x) && isFiniteNumber(record.y)
}

function readWindowBounds(db: Database.Database): WindowBounds | undefined {
  const parsed = parseJsonConfig(kvGet(db, MAIN_WINDOW_BOUNDS_KEY))
  return isWindowBounds(parsed) ? parsed : undefined
}

function readPetPosition(db: Database.Database): Point | undefined {
  const parsed = parseJsonConfig(kvGet(db, PET_WINDOW_POSITION_KEY))
  return isPoint(parsed) ? parsed : undefined
}

function writeWindowBounds(db: Database.Database, bounds: WindowBounds): void {
  kvSet(db, MAIN_WINDOW_BOUNDS_KEY, JSON.stringify(bounds))
}

function writePetPosition(db: Database.Database, position: Point): void {
  kvSet(db, PET_WINDOW_POSITION_KEY, JSON.stringify(position))
}

function getCurrentAppPath(): string | undefined {
  const electronApp = app as unknown as { getAppPath?: () => string } | undefined
  return electronApp?.getAppPath?.()
}

export function resolveWindowIconPath(options: WindowIconPathOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform
  if (platform === 'darwin') return undefined

  const appPath = options.appPath ?? getCurrentAppPath()
  if (!appPath) return undefined

  const iconPath =
    platform === 'win32'
      ? path.join(appPath, 'build', 'icons', 'win', 'icon.ico')
      : path.join(appPath, 'build', 'icons', 'png', '512x512.png')
  const exists = options.exists ?? fs.existsSync

  return exists(iconPath) ? iconPath : undefined
}

function clamp(value: number, min: number, max: number): number {
  const normalizedMax = Math.max(min, max)
  return Math.min(Math.max(value, min), normalizedMax)
}

function isValidPetPosition(
  point: Point | undefined,
  screenSize: { width: number; height: number }
): boolean {
  if (!point) return false
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= screenSize.width - PET_W &&
    point.y <= screenSize.height - PET_H
  )
}

function getVisibleMainWindowBounds(): WindowBounds | undefined {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return undefined
  return mainWindow.getBounds() as WindowBounds
}

function resolvePetBoundsNearVisibleMainWindow(): Point | undefined {
  const chatBounds = getVisibleMainWindowBounds()
  if (!chatBounds) return undefined
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  return resolvePetWindowBounds({
    screen: { width, height },
    chatBounds
  })
}

function setInitialPetPosition(position: Point): void {
  if (!petWindow || petWindow.isDestroyed()) return
  programmaticPetPosition = position
  petWindow.setPosition(position.x, position.y)
}

function resolveAbsoluteComposerBounds(bounds: WindowBounds): WindowBounds | undefined {
  if (!mainWindow || mainWindow.isDestroyed()) return undefined
  const mainBounds = mainWindow.getBounds()

  return {
    x: mainBounds.x + bounds.x,
    y: mainBounds.y + bounds.y,
    width: bounds.width,
    height: bounds.height
  }
}

function resolvePetBoundsNearComposerBounds(bounds: WindowBounds): Point | undefined {
  const composerBounds = resolveAbsoluteComposerBounds(bounds)
  if (!composerBounds) return undefined
  const display = screen.getDisplayMatching(composerBounds)
  const workArea = display.workArea

  return {
    x: clamp(
      composerBounds.x + composerBounds.width - PET_VISUAL_RIGHT_EDGE - PET_COMPOSER_RIGHT_GAP,
      workArea.x,
      workArea.x + workArea.width - PET_W
    ),
    y: clamp(
      composerBounds.y - PET_VISUAL_BOTTOM_EDGE - PET_COMPOSER_TOP_GAP,
      workArea.y,
      workArea.y + workArea.height - PET_H
    )
  }
}

export function updatePetWindowComposerAnchor(bounds: WindowBounds): void {
  latestComposerBounds = bounds
  if (petPositionLockedByUser) return
  const petBounds = resolvePetBoundsNearComposerBounds(bounds)
  if (petBounds) setInitialPetPosition(petBounds)
}

export function createPetWindow(db: Database.Database): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const savedPetPosition = readPetPosition(db)
  petPositionLockedByUser = isValidPetPosition(savedPetPosition, { width, height })
  const chatBounds = getVisibleMainWindowBounds()
  const composerPetBounds =
    !petPositionLockedByUser && latestComposerBounds
      ? resolvePetBoundsNearComposerBounds(latestComposerBounds)
      : undefined
  const petBounds = resolvePetWindowBounds({
    screen: { width, height },
    savedPetPosition,
    chatBounds
  })
  const initialPetBounds = composerPetBounds ?? petBounds
  programmaticPetPosition = petPositionLockedByUser ? null : initialPetBounds

  petWindow = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: initialPetBounds.x,
    y: initialPetBounds.y,
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

  // 宠物窗是桌面覆盖层，不应进入 macOS Dock/Window 菜单的可切换窗口列表。
  petWindow.excludedFromShownWindowsMenu = true
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  petWindow.setAlwaysOnTop(true, 'floating')

  petWindow.on('ready-to-show', () => {
    petWindow?.show()
  })

  if (!savedPetPosition && !chatBounds && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.once('show', () => {
      const visibleMainPetBounds = resolvePetBoundsNearVisibleMainWindow()
      if (visibleMainPetBounds) setInitialPetPosition(visibleMainPetBounds)
    })
  }

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
      if (programmaticPetPosition?.x === x && programmaticPetPosition.y === y) {
        programmaticPetPosition = null
        return
      }
      petPositionLockedByUser = true
      writePetPosition(db, { x, y })
    }, 500)
  })

  return petWindow
}

export function createMainWindow(db: Database.Database): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const savedBounds = readWindowBounds(db)
  const initialBounds = resolveMainWindowBounds({
    screen: { width, height },
    savedBounds
  })
  const windowIcon = resolveWindowIconPath()

  mainWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    ...(windowIcon ? { icon: windowIcon } : {}),
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
      writeWindowBounds(db, bounds)
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
  registerEditShortcuts(mainWindow.webContents)

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
    activateMainWindow({ app, window: mainWindow })
  }
}

export function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (chatBoundsBeforeHide && !mainWindow.isVisible()) {
    mainWindow.setBounds(chatBoundsBeforeHide)
  }
  activateMainWindow({ app, window: mainWindow })
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
