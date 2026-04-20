import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron'

export function createTray(
  petWindow: BrowserWindow,
  chatWindow: BrowserWindow,
  toggleChatWindow: () => void
): Tray {
  const icon = nativeImage.createEmpty()
  const tray = new Tray(icon)
  tray.setTitle('🐱')

  tray.setToolTip('PetClaw - AI Desktop Pet')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏宠物',
      click: () => {
        if (petWindow.isVisible()) {
          petWindow.hide()
        } else {
          petWindow.show()
        }
      }
    },
    {
      label: '打开聊天',
      click: () => {
        chatWindow.show()
        chatWindow.focus()
      }
    },
    {
      label: 'AI 工具监控',
      click: () => {
        chatWindow.show()
        chatWindow.focus()
        chatWindow.webContents.send('panel:open', 'monitor')
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
    toggleChatWindow()
  })

  return tray
}
