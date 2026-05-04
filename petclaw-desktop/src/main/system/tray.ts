import { Tray, Menu, nativeImage } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import { t } from '../i18n'
import type { SystemActions } from './system-actions'

export function shouldCreateFallbackTray(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'darwin'
}

export function buildTrayMenuTemplate(actions: SystemActions): MenuItemConstructorOptions[] {
  return [
    {
      label: t('system.openPetClaw'),
      click: actions.openPetClaw
    },
    {
      label: t('system.togglePet'),
      click: actions.togglePet
    },
    { type: 'separator' },
    {
      label: t('system.quit'),
      click: actions.quitPetClaw
    }
  ]
}

export function createTray(actions: SystemActions): Tray {
  // fallback tray 只服务非 macOS 平台，macOS 的常驻入口由 Dock 和桌面宠物承担。
  const icon = nativeImage.createEmpty()
  const tray = new Tray(icon)

  tray.setToolTip('PetClaw')

  const contextMenu = Menu.buildFromTemplate(buildTrayMenuTemplate(actions))

  tray.setContextMenu(contextMenu)

  tray.on('click', actions.openPetClaw)

  return tray
}
