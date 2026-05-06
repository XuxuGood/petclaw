import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

import type { createPetWindow } from '../../src/main/windows'
import { resolveMainWindowBounds, resolvePetWindowBounds } from '../../src/main/window-layout'

type WindowDatabase = Parameters<typeof createPetWindow>[0]

function mockDataStore(initialValues: Record<string, string> = {}) {
  const values = new Map<string, string>(Object.entries(initialValues))
  const kvGet = vi.fn((_db: WindowDatabase, key: string) => values.get(key) ?? null)
  const kvSet = vi.fn((_db: WindowDatabase, key: string, value: string) => {
    values.set(key, value)
  })

  vi.doMock('../../src/main/data/db', () => ({ kvGet, kvSet }))

  return {
    db: {} as WindowDatabase,
    kvGet,
    kvSet,
    values
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('windows layout helpers', () => {
  it('uses a roomy default main window size on common laptop work areas', () => {
    const bounds = resolveMainWindowBounds({
      screen: { width: 1440, height: 900 }
    })

    expect(bounds).toMatchObject({ x: 173, y: 72, width: 1094, height: 756 })
  })

  it('restores saved main window bounds when they are valid', () => {
    const bounds = resolveMainWindowBounds({
      screen: { width: 1440, height: 900 },
      savedBounds: { x: 100, y: 80, width: 900, height: 700 }
    })

    expect(bounds).toMatchObject({ x: 100, y: 80, width: 900, height: 700 })
  })

  it('keeps saved main window size but centers it when saved position is off screen', () => {
    const bounds = resolveMainWindowBounds({
      screen: { width: 1440, height: 900 },
      savedBounds: { x: 3000, y: 80, width: 900, height: 700 }
    })

    expect(bounds).toMatchObject({ x: 270, y: 100, width: 900, height: 700 })
  })

  it('clamps old tiny saved main window bounds to compact minimum size', () => {
    const bounds = resolveMainWindowBounds({
      screen: { width: 1440, height: 900 },
      savedBounds: { x: 100, y: 80, width: 640, height: 500 }
    })

    expect(bounds).toMatchObject({ x: 100, y: 80, width: 760, height: 500 })
  })

  it('clamps extremely small saved main window bounds to mobile-like minimum size', () => {
    const bounds = resolveMainWindowBounds({
      screen: { width: 1440, height: 900 },
      savedBounds: { x: 100, y: 80, width: 420, height: 360 }
    })

    expect(bounds).toMatchObject({ x: 100, y: 80, width: 760, height: 460 })
  })

  it('anchors pet window to the chat window when no saved pet position exists', () => {
    const bounds = resolvePetWindowBounds({
      screen: { width: 1440, height: 900 },
      chatBounds: { x: 200, y: 100, width: 900, height: 700 }
    })

    expect(bounds).toEqual({ x: 950, y: 544 })
  })

  it('keeps valid saved pet position even when it overlaps the main window', () => {
    const bounds = resolvePetWindowBounds({
      screen: { width: 1440, height: 900 },
      savedPetPosition: { x: 950, y: 600 },
      chatBounds: { x: 200, y: 100, width: 900, height: 700 }
    })

    expect(bounds).toEqual({ x: 950, y: 600 })
  })

  it('keeps pet near the composer top-right on narrow screens', () => {
    const bounds = resolvePetWindowBounds({
      screen: { width: 1280, height: 900 },
      chatBounds: { x: 400, y: 100, width: 750, height: 700 }
    })

    expect(bounds).toEqual({ x: 1000, y: 544 })
  })

  it('prefers valid saved pet position when it does not overlap the main window', () => {
    const bounds = resolvePetWindowBounds({
      screen: { width: 1440, height: 900 },
      savedPetPosition: { x: 10, y: 10 },
      chatBounds: { x: 200, y: 100, width: 900, height: 700 }
    })

    expect(bounds).toEqual({ x: 10, y: 10 })
  })

  it('resolves packaged window icon paths for Windows and Linux dev windows', async () => {
    vi.doMock('electron', () => ({
      app: {
        getAppPath: vi.fn(() => '/app')
      },
      BrowserWindow: vi.fn(),
      shell: {
        openExternal: vi.fn()
      },
      screen: {}
    }))
    vi.doMock('@electron-toolkit/utils', () => ({
      is: { dev: false }
    }))
    vi.doMock('../../src/main/system/edit-shortcuts', () => ({ registerEditShortcuts: vi.fn() }))

    const { resolveWindowIconPath } = await import('../../src/main/windows')
    const existingPaths = new Set([
      '/app/build/icons/win/icon.ico',
      '/app/build/icons/png/512x512.png'
    ])

    expect(
      resolveWindowIconPath({
        platform: 'darwin',
        appPath: '/app',
        exists: () => true
      })
    ).toBeUndefined()
    expect(
      resolveWindowIconPath({
        platform: 'win32',
        appPath: '/app',
        exists: (filePath) => existingPaths.has(filePath)
      })
    ).toBe('/app/build/icons/win/icon.ico')
    expect(
      resolveWindowIconPath({
        platform: 'linux',
        appPath: '/app',
        exists: (filePath) => existingPaths.has(filePath)
      })
    ).toBe('/app/build/icons/png/512x512.png')
  })

  it('omits the dev window icon when platform icon assets are missing', async () => {
    vi.doMock('electron', () => ({
      app: {
        getAppPath: vi.fn(() => '/app')
      },
      BrowserWindow: vi.fn(),
      shell: {
        openExternal: vi.fn()
      },
      screen: {}
    }))
    vi.doMock('@electron-toolkit/utils', () => ({
      is: { dev: false }
    }))
    vi.doMock('../../src/main/system/edit-shortcuts', () => ({ registerEditShortcuts: vi.fn() }))

    const { resolveWindowIconPath } = await import('../../src/main/windows')

    expect(
      resolveWindowIconPath({
        platform: 'win32',
        appPath: '/app',
        exists: () => false
      })
    ).toBeUndefined()
  })

  it('creates the pet window as a non-focusable floating overlay', async () => {
    const { db } = mockDataStore()
    const petWindow = {
      excludedFromShownWindowsMenu: false,
      setVisibleOnAllWorkspaces: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      on: vi.fn(),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const BrowserWindow = vi.fn(() => petWindow)

    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => '/tmp')
      },
      BrowserWindow,
      shell: {
        openExternal: vi.fn()
      },
      screen: {
        getPrimaryDisplay: vi.fn(() => ({
          workAreaSize: { width: 1440, height: 900 }
        }))
      }
    }))
    vi.doMock('@electron-toolkit/utils', () => ({
      is: { dev: false }
    }))
    vi.doMock('../../src/main/system/edit-shortcuts', () => ({ registerEditShortcuts: vi.fn() }))

    const { createPetWindow } = await import('../../src/main/windows')

    createPetWindow(db)

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        alwaysOnTop: true,
        focusable: false,
        skipTaskbar: true,
        transparent: true
      })
    )
    expect(petWindow.excludedFromShownWindowsMenu).toBe(true)
    expect(petWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
  })

  it('restores main window bounds from SQLite app_config', async () => {
    const { db } = mockDataStore({
      'window.mainBounds': JSON.stringify({ x: 100, y: 80, width: 900, height: 700 })
    })

    const mainWindow = {
      on: vi.fn(),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const BrowserWindow = vi.fn(() => mainWindow)

    vi.doMock('electron', () => ({
      BrowserWindow,
      shell: {
        openExternal: vi.fn()
      },
      screen: {
        getPrimaryDisplay: vi.fn(() => ({
          workAreaSize: { width: 1440, height: 900 }
        }))
      }
    }))
    vi.doMock('@electron-toolkit/utils', () => ({
      is: { dev: false }
    }))
    vi.doMock('../../src/main/system/edit-shortcuts', () => ({ registerEditShortcuts: vi.fn() }))

    const { createMainWindow } = await import('../../src/main/windows')

    createMainWindow(db)

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 100,
        y: 80,
        width: 900,
        height: 700
      })
    )
  })

  it('persists main window bounds to SQLite app_config after resize', async () => {
    vi.useFakeTimers()
    const { db, values } = mockDataStore()
    const handlers: Record<string, () => void> = {}
    const mainWindow = {
      on: vi.fn((event: string, handler: () => void) => {
        handlers[event] = handler
      }),
      getBounds: vi.fn(() => ({ x: 24, y: 32, width: 1024, height: 768 })),
      isDestroyed: vi.fn(() => false),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const BrowserWindow = vi.fn(() => mainWindow)

    vi.doMock('electron', () => ({
      BrowserWindow,
      shell: {
        openExternal: vi.fn()
      },
      screen: {
        getPrimaryDisplay: vi.fn(() => ({
          workAreaSize: { width: 1440, height: 900 }
        }))
      }
    }))
    vi.doMock('@electron-toolkit/utils', () => ({
      is: { dev: false }
    }))
    vi.doMock('../../src/main/system/edit-shortcuts', () => ({ registerEditShortcuts: vi.fn() }))

    const { createMainWindow } = await import('../../src/main/windows')

    createMainWindow(db)
    handlers.resize()
    vi.advanceTimersByTime(500)

    expect(values.get('window.mainBounds')).toBe(
      JSON.stringify({ x: 24, y: 32, width: 1024, height: 768 })
    )
  })

  it('persists pet window position to SQLite app_config after move', async () => {
    vi.useFakeTimers()
    const { db, values } = mockDataStore()
    const handlers: Record<string, () => void> = {}
    const petWindow = {
      setVisibleOnAllWorkspaces: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        handlers[event] = handler
      }),
      getPosition: vi.fn(() => [320, 240] as [number, number]),
      isDestroyed: vi.fn(() => false),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const BrowserWindow = vi.fn(() => petWindow)

    vi.doMock('electron', () => ({
      BrowserWindow,
      shell: {
        openExternal: vi.fn()
      },
      screen: {
        getPrimaryDisplay: vi.fn(() => ({
          workAreaSize: { width: 1440, height: 900 }
        }))
      }
    }))
    vi.doMock('@electron-toolkit/utils', () => ({
      is: { dev: false }
    }))
    vi.doMock('../../src/main/system/edit-shortcuts', () => ({ registerEditShortcuts: vi.fn() }))

    const { createPetWindow } = await import('../../src/main/windows')

    createPetWindow(db)
    handlers.move()
    vi.advanceTimersByTime(500)

    expect(values.get('window.petPosition')).toBe(JSON.stringify({ x: 320, y: 240 }))
  })

  it('keeps saved pet position on creation without moving the visible main window', async () => {
    const { db } = mockDataStore({
      'window.petPosition': JSON.stringify({ x: 950, y: 600 })
    })
    const mainWindow = {
      on: vi.fn(),
      isVisible: vi.fn(() => true),
      isDestroyed: vi.fn(() => false),
      getBounds: vi.fn(() => ({ x: 200, y: 100, width: 900, height: 700 })),
      setBounds: vi.fn(),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const petWindow = {
      setVisibleOnAllWorkspaces: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      on: vi.fn(),
      getPosition: vi.fn(() => [950, 600] as [number, number]),
      isDestroyed: vi.fn(() => false),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const BrowserWindow = vi.fn().mockReturnValueOnce(mainWindow).mockReturnValueOnce(petWindow)

    vi.doMock('electron', () => ({
      BrowserWindow,
      shell: {
        openExternal: vi.fn()
      },
      screen: {
        getPrimaryDisplay: vi.fn(() => ({
          workAreaSize: { width: 1440, height: 900 }
        }))
      }
    }))
    vi.doMock('@electron-toolkit/utils', () => ({
      is: { dev: false }
    }))
    vi.doMock('../../src/main/system/edit-shortcuts', () => ({ registerEditShortcuts: vi.fn() }))

    const { createMainWindow, createPetWindow } = await import('../../src/main/windows')

    createMainWindow(db)
    createPetWindow(db)

    expect(BrowserWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 950,
        y: 600
      })
    )
    expect(mainWindow.setBounds).not.toHaveBeenCalled()
  })

  it('anchors the first pet position when the main window becomes visible', async () => {
    vi.useFakeTimers()
    const { db, values } = mockDataStore()
    const petHandlers: Record<string, () => void> = {}
    const mainWindow = {
      on: vi.fn(),
      once: vi.fn(),
      isVisible: vi.fn(() => false),
      isDestroyed: vi.fn(() => false),
      getBounds: vi.fn(() => ({ x: 173, y: 72, width: 1094, height: 756 })),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const petWindow = {
      setVisibleOnAllWorkspaces: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        petHandlers[event] = handler
      }),
      getPosition: vi.fn(() => [1117, 572] as [number, number]),
      setPosition: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const BrowserWindow = vi.fn().mockReturnValueOnce(mainWindow).mockReturnValueOnce(petWindow)

    vi.doMock('electron', () => ({
      BrowserWindow,
      shell: {
        openExternal: vi.fn()
      },
      screen: {
        getPrimaryDisplay: vi.fn(() => ({
          workAreaSize: { width: 1440, height: 900 }
        }))
      }
    }))
    vi.doMock('@electron-toolkit/utils', () => ({
      is: { dev: false }
    }))
    vi.doMock('../../src/main/system/edit-shortcuts', () => ({ registerEditShortcuts: vi.fn() }))

    const { createMainWindow, createPetWindow } = await import('../../src/main/windows')

    createMainWindow(db)
    createPetWindow(db)

    expect(mainWindow.once).toHaveBeenCalledWith('show', expect.any(Function))
    const showHandler = mainWindow.once.mock.calls.find(([event]) => event === 'show')?.[1]
    expect(showHandler).toBeDefined()

    mainWindow.isVisible.mockReturnValue(true)
    showHandler?.()

    expect(petWindow.setPosition).toHaveBeenCalledWith(1117, 572)

    petHandlers.move()
    vi.advanceTimersByTime(500)

    expect(values.get('window.petPosition')).toBeUndefined()
  })

  it('positions the first pet window from the reported composer bounds', async () => {
    vi.useFakeTimers()
    const { db, values } = mockDataStore()
    const petHandlers: Record<string, () => void> = {}
    const mainWindow = {
      on: vi.fn(),
      once: vi.fn(),
      isVisible: vi.fn(() => true),
      isDestroyed: vi.fn(() => false),
      getBounds: vi.fn(() => ({ x: 173, y: 72, width: 1094, height: 756 })),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const petWindow = {
      setVisibleOnAllWorkspaces: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        petHandlers[event] = handler
      }),
      getPosition: vi.fn(() => [960, 484] as [number, number]),
      setPosition: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const BrowserWindow = vi.fn().mockReturnValueOnce(mainWindow).mockReturnValueOnce(petWindow)
    const appMock = {
      show: vi.fn(),
      focus: vi.fn()
    }

    vi.doMock('electron', () => ({
      app: appMock,
      BrowserWindow,
      shell: {
        openExternal: vi.fn()
      },
      screen: {
        getPrimaryDisplay: vi.fn(() => ({
          workAreaSize: { width: 1440, height: 900 },
          workArea: { x: 0, y: 0, width: 1440, height: 900 }
        })),
        getDisplayMatching: vi.fn(() => ({
          workArea: { x: 0, y: 0, width: 1440, height: 900 }
        }))
      }
    }))
    vi.doMock('@electron-toolkit/utils', () => ({
      is: { dev: false }
    }))
    vi.doMock('../../src/main/system/edit-shortcuts', () => ({ registerEditShortcuts: vi.fn() }))

    const { createMainWindow, createPetWindow, updatePetWindowComposerAnchor } =
      await import('../../src/main/windows')

    createMainWindow(db)
    createPetWindow(db)
    updatePetWindowComposerAnchor({ x: 280, y: 528, width: 657, height: 108 })

    expect(petWindow.setPosition).toHaveBeenCalledWith(960, 484)

    petHandlers.move()
    vi.advanceTimersByTime(500)

    expect(values.get('window.petPosition')).toBeUndefined()
  })

  it('does not persist the composer anchor reported before pet window creation', async () => {
    vi.useFakeTimers()
    const { db, values } = mockDataStore()
    const petHandlers: Record<string, () => void> = {}
    const mainWindow = {
      on: vi.fn(),
      once: vi.fn(),
      isVisible: vi.fn(() => true),
      isDestroyed: vi.fn(() => false),
      getBounds: vi.fn(() => ({ x: 173, y: 72, width: 1094, height: 756 })),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const petWindow = {
      setVisibleOnAllWorkspaces: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        petHandlers[event] = handler
      }),
      getPosition: vi.fn(() => [960, 484] as [number, number]),
      setPosition: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const BrowserWindow = vi.fn().mockReturnValueOnce(mainWindow).mockReturnValueOnce(petWindow)

    vi.doMock('electron', () => ({
      BrowserWindow,
      shell: {
        openExternal: vi.fn()
      },
      screen: {
        getPrimaryDisplay: vi.fn(() => ({
          workAreaSize: { width: 1440, height: 900 },
          workArea: { x: 0, y: 0, width: 1440, height: 900 }
        })),
        getDisplayMatching: vi.fn(() => ({
          workArea: { x: 0, y: 0, width: 1440, height: 900 }
        }))
      }
    }))
    vi.doMock('@electron-toolkit/utils', () => ({
      is: { dev: false }
    }))
    vi.doMock('../../src/main/system/edit-shortcuts', () => ({ registerEditShortcuts: vi.fn() }))

    const { createMainWindow, createPetWindow, updatePetWindowComposerAnchor } =
      await import('../../src/main/windows')

    createMainWindow(db)
    updatePetWindowComposerAnchor({ x: 280, y: 528, width: 657, height: 108 })
    createPetWindow(db)

    expect(BrowserWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 960,
        y: 484
      })
    )

    petHandlers.move()
    vi.advanceTimersByTime(500)

    expect(values.get('window.petPosition')).toBeUndefined()
  })

  it('shows the main window without repositioning it around the pet window', async () => {
    const { db } = mockDataStore()
    const mainWindow = {
      on: vi.fn(),
      once: vi.fn(),
      isVisible: vi.fn(() => false),
      isDestroyed: vi.fn(() => false),
      getBounds: vi.fn(() => ({ x: 200, y: 100, width: 900, height: 700 })),
      setBounds: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const petWindow = {
      setVisibleOnAllWorkspaces: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      on: vi.fn(),
      getPosition: vi.fn(() => [950, 600] as [number, number]),
      setPosition: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: {
        setWindowOpenHandler: vi.fn()
      },
      loadFile: vi.fn()
    }
    const BrowserWindow = vi.fn().mockReturnValueOnce(mainWindow).mockReturnValueOnce(petWindow)
    const appMock = {
      show: vi.fn(),
      focus: vi.fn()
    }

    vi.doMock('electron', () => ({
      app: appMock,
      BrowserWindow,
      shell: {
        openExternal: vi.fn()
      },
      screen: {
        getPrimaryDisplay: vi.fn(() => ({
          workAreaSize: { width: 1440, height: 900 }
        }))
      }
    }))
    vi.doMock('@electron-toolkit/utils', () => ({
      is: { dev: false }
    }))
    vi.doMock('../../src/main/system/edit-shortcuts', () => ({ registerEditShortcuts: vi.fn() }))

    const { createMainWindow, createPetWindow, toggleMainWindow } =
      await import('../../src/main/windows')

    createMainWindow(db)
    createPetWindow(db)
    toggleMainWindow()

    expect(mainWindow.setBounds).not.toHaveBeenCalled()
    expect(petWindow.setPosition).not.toHaveBeenCalled()
    expect(mainWindow.show).toHaveBeenCalledOnce()
    expect(mainWindow.focus).toHaveBeenCalledOnce()
    if (process.platform === 'darwin') {
      expect(appMock.show).toHaveBeenCalledOnce()
      expect(appMock.focus).toHaveBeenCalledWith({ steal: true })
    }
  })
})
