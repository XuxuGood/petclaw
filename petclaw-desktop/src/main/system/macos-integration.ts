import { app, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import { t } from '../i18n'
import type { SystemActions } from './system-actions'

export interface MacosIntegrationOptions {
  actions: SystemActions
  platform?: NodeJS.Platform
}

export function buildDockMenuTemplate(actions: SystemActions): MenuItemConstructorOptions[] {
  return [
    {
      label: t('system.openPetClaw'),
      click: actions.openPetClaw
    },
    {
      label: t('system.togglePet'),
      click: actions.togglePet
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
  ]
}

export function buildApplicationMenuTemplate(actions: SystemActions): MenuItemConstructorOptions[] {
  // Application Menu 只承载 macOS 标准项和系统级入口；复杂业务导航留在应用内部。
  return [
    {
      label: 'PetClaw',
      submenu: [
        {
          label: t('system.about'),
          role: 'about'
        },
        {
          label: t('system.settings'),
          accelerator: 'Command+,',
          click: actions.showSettings
        },
        { type: 'separator' },
        {
          label: t('system.openPetClaw'),
          click: actions.openPetClaw
        },
        {
          label: t('system.togglePet'),
          click: actions.togglePet
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: t('system.quit'),
          accelerator: 'Command+Q',
          click: actions.quitPetClaw
        }
      ]
    },
    {
      label: t('system.window'),
      submenu: [{ role: 'minimize' }, { role: 'close' }, { type: 'separator' }, { role: 'front' }]
    }
  ]
}

export function initializeMacosIntegration(options: MacosIntegrationOptions): void {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') return

  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenuTemplate(options.actions)))
  app.dock?.setMenu(Menu.buildFromTemplate(buildDockMenuTemplate(options.actions)))
  app.on('activate', options.actions.openPetClaw)
}
