import type { App, BrowserWindow } from 'electron'

export interface SystemActions {
  openPetClaw: () => void
  showSettings: () => void
  showPet: () => void
  hidePet: () => void
  togglePet: () => void
  quitPetClaw: () => void
}

export interface SystemActionDeps {
  app: Pick<App, 'quit'>
  getMainWindow: () => BrowserWindow | null
  getPetWindow: () => BrowserWindow | null
}

function getLiveWindow(getWindow: () => BrowserWindow | null): BrowserWindow | null {
  const win = getWindow()
  if (!win || win.isDestroyed()) return null
  return win
}

export function createSystemActions(deps: SystemActionDeps): SystemActions {
  const openPetClaw = (): void => {
    const mainWindow = getLiveWindow(deps.getMainWindow)
    if (!mainWindow) return
    mainWindow.show()
    mainWindow.focus()
  }

  const showSettings = (): void => {
    const mainWindow = getLiveWindow(deps.getMainWindow)
    if (!mainWindow) return
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('app:open-settings')
  }

  const showPet = (): void => {
    const petWindow = getLiveWindow(deps.getPetWindow)
    if (!petWindow) return
    petWindow.show()
  }

  const hidePet = (): void => {
    const petWindow = getLiveWindow(deps.getPetWindow)
    if (!petWindow) return
    petWindow.hide()
  }

  const togglePet = (): void => {
    const petWindow = getLiveWindow(deps.getPetWindow)
    if (!petWindow) return
    if (petWindow.isVisible()) {
      petWindow.hide()
    } else {
      petWindow.show()
    }
  }

  return {
    openPetClaw,
    showSettings,
    showPet,
    hidePet,
    togglePet,
    quitPetClaw: () => deps.app.quit()
  }
}
