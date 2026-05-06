import { describe, expect, it, vi } from 'vitest'

import { createSystemActions } from '../../../src/main/system/system-actions'

function makeWindow(visible = false) {
  return {
    isDestroyed: vi.fn().mockReturnValue(false),
    isVisible: vi.fn().mockReturnValue(visible),
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    webContents: {
      send: vi.fn()
    }
  }
}

function makeApp() {
  return {
    quit: vi.fn(),
    show: vi.fn(),
    focus: vi.fn()
  }
}

describe('createSystemActions', () => {
  it('openPetClaw activates the macOS app before focusing the main window', () => {
    const mainWindow = makeWindow(false)
    const app = makeApp()
    const actions = createSystemActions({
      app,
      getMainWindow: () => mainWindow as never,
      getPetWindow: () => null,
      platform: 'darwin'
    })

    actions.openPetClaw()

    expect(app.show).toHaveBeenCalledOnce()
    expect(app.focus).toHaveBeenCalledWith({ steal: true })
    expect(mainWindow.show).toHaveBeenCalledOnce()
    expect(mainWindow.focus).toHaveBeenCalledOnce()
  })

  it('showSettings opens the main window and requests the settings view', () => {
    const mainWindow = makeWindow(false)
    const app = makeApp()
    const actions = createSystemActions({
      app,
      getMainWindow: () => mainWindow as never,
      getPetWindow: () => null,
      platform: 'darwin'
    })

    actions.showSettings()

    expect(app.show).toHaveBeenCalledOnce()
    expect(app.focus).toHaveBeenCalledWith({ steal: true })
    expect(mainWindow.show).toHaveBeenCalledOnce()
    expect(mainWindow.focus).toHaveBeenCalledOnce()
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('panel:open', 'settings')
  })

  it('showPet and hidePet only affect the pet window', () => {
    const petWindow = makeWindow(false)
    const actions = createSystemActions({
      app: makeApp(),
      getMainWindow: () => null,
      getPetWindow: () => petWindow as never
    })

    actions.showPet()
    actions.hidePet()

    expect(petWindow.show).toHaveBeenCalledOnce()
    expect(petWindow.hide).toHaveBeenCalledOnce()
  })

  it('togglePet hides visible pet window and shows hidden pet window', () => {
    const petWindow = makeWindow(true)
    const actions = createSystemActions({
      app: makeApp(),
      getMainWindow: () => null,
      getPetWindow: () => petWindow as never
    })

    actions.togglePet()
    petWindow.isVisible.mockReturnValue(false)
    actions.togglePet()

    expect(petWindow.hide).toHaveBeenCalledOnce()
    expect(petWindow.show).toHaveBeenCalledOnce()
  })

  it('ignores missing or destroyed windows', () => {
    const destroyedWindow = makeWindow(false)
    destroyedWindow.isDestroyed.mockReturnValue(true)
    const actions = createSystemActions({
      app: makeApp(),
      getMainWindow: () => destroyedWindow as never,
      getPetWindow: () => destroyedWindow as never
    })

    actions.openPetClaw()
    actions.showPet()

    expect(destroyedWindow.show).not.toHaveBeenCalled()
  })

  it('quitPetClaw delegates to app.quit', () => {
    const app = makeApp()
    const actions = createSystemActions({
      app,
      getMainWindow: () => null,
      getPetWindow: () => null
    })

    actions.quitPetClaw()

    expect(app.quit).toHaveBeenCalledOnce()
  })
})
