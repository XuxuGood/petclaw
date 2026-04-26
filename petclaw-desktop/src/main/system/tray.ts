import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron'

import { t } from '../i18n'

export function createTray(
  petWindow: BrowserWindow,
  mainWindow: BrowserWindow,
  toggleMainWindow: () => void
): Tray {
  const icon = nativeImage.createEmpty()
  const tray = new Tray(icon)
  tray.setTitle('🐱')

  tray.setToolTip('PetClaw - AI Desktop Pet')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: t('tray.togglePet'),
      click: () => {
        if (petWindow.isVisible()) {
          petWindow.hide()
        } else {
          petWindow.show()
        }
      }
    },
    {
      label: t('tray.openChat'),
      click: () => {
        mainWindow.show()
        mainWindow.focus()
      }
    },
    {
      label: t('tray.monitor'),
      click: () => {
        mainWindow.show()
        mainWindow.focus()
        mainWindow.webContents.send('panel:open', 'monitor')
      }
    },
    { type: 'separator' },
    {
      label: t('tray.quit'),
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    toggleMainWindow()
  })

  return tray
}
