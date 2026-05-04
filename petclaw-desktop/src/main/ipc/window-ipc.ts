import { BrowserWindow, Menu } from 'electron'

import { safeOn } from './ipc-registry'
import { t } from '../i18n'
import type { SystemActions } from '../system/system-actions'

export interface WindowIpcDeps {
  getPetWindow: () => BrowserWindow | null
  actions: SystemActions
  toggleMainWindow: () => void
}

export function registerWindowIpcHandlers(deps: WindowIpcDeps): void {
  const { actions, getPetWindow, toggleMainWindow } = deps

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
    if (!petWin || petWin.isDestroyed()) return
    // Pet 右键菜单只暴露宠物自身控制；打开设置等应用级入口由 Dock/Application Menu 承担。
    const menu = Menu.buildFromTemplate([
      {
        label: paused ? t('system.resumePet') : t('system.pausePet'),
        click: () => petWin.webContents.send('pet:toggle-pause')
      },
      { type: 'separator' },
      {
        label: t('system.quit'),
        click: actions.quitPetClaw
      }
    ])
    menu.popup({ window: petWin })
  })

  safeOn('app:quit', () => {
    actions.quitPetClaw()
  })
}
