import path from 'path'

import { app, Menu, nativeImage } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import { t } from '../i18n'
import type { SystemActions } from './system-actions'

const APP_NAME = 'PetClaw'

export interface MacosIntegrationOptions {
  actions: SystemActions
  platform?: NodeJS.Platform
  appName?: string
  dockIconPath?: string
}

export interface MacosApplicationIdentityOptions {
  platform?: NodeJS.Platform
  appName?: string
}

export function initializeMacosApplicationIdentity(
  options: MacosApplicationIdentityOptions = {}
): void {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') return

  const appName = options.appName ?? APP_NAME
  app.name = appName
  app.setName(appName)
  app.setActivationPolicy('regular')
}

export function buildDockMenuTemplate(actions: SystemActions): MenuItemConstructorOptions[] {
  return [
    {
      label: t('system.open'),
      click: actions.openPetClaw
    },
    {
      label: t('system.togglePet'),
      click: actions.togglePet
    },
    {
      label: t('system.settings'),
      click: actions.showSettings
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
        {
          label: t('system.services'),
          role: 'services'
        },
        { type: 'separator' },
        {
          label: t('system.hidePetClaw'),
          role: 'hide'
        },
        {
          label: t('system.hideOthers'),
          role: 'hideOthers'
        },
        {
          label: t('system.showAll'),
          role: 'unhide'
        },
        { type: 'separator' },
        {
          label: t('system.quit'),
          accelerator: 'Command+Q',
          click: actions.quitPetClaw
        }
      ]
    },
    {
      label: t('system.edit'),
      submenu: [
        {
          label: t('system.undo'),
          role: 'undo'
        },
        {
          label: t('system.redo'),
          role: 'redo'
        },
        { type: 'separator' },
        {
          label: t('system.cut'),
          role: 'cut'
        },
        {
          label: t('system.copy'),
          role: 'copy'
        },
        {
          label: t('system.paste'),
          role: 'paste'
        },
        {
          label: t('system.pasteAndMatchStyle'),
          role: 'pasteAndMatchStyle'
        },
        {
          label: t('system.delete'),
          role: 'delete'
        },
        { type: 'separator' },
        {
          label: t('system.selectAll'),
          role: 'selectAll'
        }
      ]
    },
    {
      label: t('system.window'),
      submenu: [
        {
          label: t('system.minimize'),
          role: 'minimize'
        },
        {
          label: t('system.closeWindow'),
          role: 'close'
        },
        { type: 'separator' },
        {
          label: t('system.bringAllToFront'),
          role: 'front'
        }
      ]
    }
  ]
}

export function initializeMacosIntegration(options: MacosIntegrationOptions): void {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') return

  const appName = options.appName ?? APP_NAME

  initializeMacosApplicationIdentity({ platform, appName })

  if (!app.isPackaged) {
    // 正式包的 Dock/Finder/Launchpad 图标以 .app bundle 的 .icns 为唯一事实源；
    // dev runner 才用 PNG 覆盖 Dock 图标，便于本地开发识别。
    const dockIconPath =
      options.dockIconPath ?? path.join(app.getAppPath(), 'resources', 'icon.png')
    const dockIcon = nativeImage.createFromPath(dockIconPath)
    if (!dockIcon.isEmpty()) {
      app.dock?.setIcon(dockIcon)
    }
  }

  void app.dock?.show().catch((error) => {
    // Dock show 失败不应阻塞启动；常见于测试环境或系统策略拒绝。
    console.warn('[MacosIntegration] failed to show Dock icon:', error)
  })
  refreshMacosMenus({ actions: options.actions, platform })
  app.on('activate', options.actions.openPetClaw)
}

export function refreshMacosMenus(options: MacosIntegrationOptions): void {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') return

  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenuTemplate(options.actions)))
  app.dock?.setMenu(Menu.buildFromTemplate(buildDockMenuTemplate(options.actions)))
}
