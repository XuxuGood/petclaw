import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron'

export function createTray(mainWindow: BrowserWindow): Tray {
  const icon = nativeImage.createEmpty()
  const tray = new Tray(icon)

  tray.setToolTip('PetClaw - AI Desktop Pet')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏宠物',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
        }
      }
    },
    {
      label: '打开聊天',
      click: () => {
        mainWindow.show()
        mainWindow.webContents.send('panel:open', 'chat')
      }
    },
    {
      label: 'AI 工具监控',
      click: () => {
        mainWindow.show()
        mainWindow.webContents.send('panel:open', 'monitor')
      }
    },
    { type: 'separator' },
    {
      label: '退出 PetClaw',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
    }
  })

  return tray
}
