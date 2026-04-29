import { BrowserWindow, Menu, app } from 'electron'

import { safeOn } from './ipc-registry'
import { t } from '../i18n'

export interface WindowIpcDeps {
  getPetWindow: () => BrowserWindow | null
  toggleMainWindow: () => void
}

export function registerWindowIpcHandlers(deps: WindowIpcDeps): void {
  const { getPetWindow, toggleMainWindow } = deps

  safeOn('window:move', (event, dx: number, dy: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + dx, y + dy)
  })

  safeOn('chat:toggle', () => {
    toggleMainWindow()
  })

  safeOn('pet:context-menu', (_event, paused: boolean) => {
    const petWin = getPetWindow()
    if (!petWin) return
    const menu = Menu.buildFromTemplate([
      {
        label: paused ? t('pet.resume') : t('pet.pause'),
        click: () => petWin.webContents.send('pet:toggle-pause')
      },
      { type: 'separator' },
      { label: t('pet.quit'), click: () => app.quit() }
    ])
    menu.popup({ window: petWin })
  })

  safeOn('app:quit', () => {
    app.quit()
  })
}
