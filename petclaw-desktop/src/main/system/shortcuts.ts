import { globalShortcut, BrowserWindow } from 'electron'

import { getLogger } from '../logging/facade'

const logger = getLogger('Shortcuts')

export function registerShortcuts(
  petWindow: BrowserWindow,
  _mainWindow: BrowserWindow,
  toggleMainWindow: () => void
): void {
  const registered1 = globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (petWindow.isVisible()) {
      petWindow.hide()
    } else {
      petWindow.show()
      petWindow.focus()
    }
  })
  if (!registered1) {
    logger.warn('shortcut.register.failed', 'Failed to register global shortcut', {
      accelerator: 'CommandOrControl+Shift+P'
    })
  }

  const registered2 = globalShortcut.register('CommandOrControl+Shift+C', () => {
    toggleMainWindow()
  })
  if (!registered2) {
    logger.warn('shortcut.register.failed', 'Failed to register global shortcut', {
      accelerator: 'CommandOrControl+Shift+C'
    })
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
