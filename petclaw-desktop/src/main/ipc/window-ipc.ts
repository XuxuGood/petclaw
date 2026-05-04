import { BrowserWindow, Menu } from 'electron'

import { safeOn } from './ipc-registry'
import { t } from '../i18n'
import type { SystemActions } from '../system/system-actions'

export interface WindowIpcDeps {
  getPetWindow: () => BrowserWindow | null
  actions: SystemActions
}

export function registerWindowIpcHandlers(deps: WindowIpcDeps): void {
  const { actions, getPetWindow } = deps

  safeOn('window:move', (event, dx: number, dy: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + dx, y + dy)
  })

  safeOn('chat:toggle', () => {
    actions.openPetClaw()
  })

  safeOn('pet:context-menu', (_event, paused: boolean) => {
    const petWin = getPetWindow()
    if (!petWin || petWin.isDestroyed()) return
    // Pet 右键菜单只暴露桌宠和应用级动作；任务监控、模型、技能等复杂入口留在应用内部。
    const menu = Menu.buildFromTemplate([
      {
        label: t('system.openPetClaw'),
        click: actions.openPetClaw
      },
      {
        label: t('system.togglePet'),
        click: actions.togglePet
      },
      {
        label: paused ? t('system.resumePet') : t('system.pausePet'),
        click: () => petWin.webContents.send('pet:toggle-pause')
      },
      {
        label: t('system.settings'),
        click: actions.showSettings
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
