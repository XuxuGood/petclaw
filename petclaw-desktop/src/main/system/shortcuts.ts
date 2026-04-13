import { globalShortcut, BrowserWindow } from 'electron'

export function registerShortcuts(mainWindow: BrowserWindow): void {
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  globalShortcut.register('CommandOrControl+Shift+C', () => {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('panel:open', 'chat')
  })
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
