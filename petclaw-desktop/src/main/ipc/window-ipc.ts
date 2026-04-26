import { ipcMain, BrowserWindow, Menu, app } from 'electron'

export interface WindowIpcDeps {
  getPetWindow: () => BrowserWindow | null
  toggleMainWindow: () => void
}

export function registerWindowIpcHandlers(deps: WindowIpcDeps): void {
  const { getPetWindow, toggleMainWindow } = deps

  ipcMain.on('window:move', (event, dx: number, dy: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + dx, y + dy)
  })

  ipcMain.on('chat:toggle', () => {
    toggleMainWindow()
  })

  ipcMain.on('pet:context-menu', (_event, paused: boolean) => {
    const petWin = getPetWindow()
    if (!petWin) return
    const menu = Menu.buildFromTemplate([
      {
        label: paused ? '继续' : '停一下',
        click: () => petWin.webContents.send('pet:toggle-pause')
      },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ])
    menu.popup({ window: petWin })
  })

  ipcMain.on('app:quit', () => {
    app.quit()
  })
}
