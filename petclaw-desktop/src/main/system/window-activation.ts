import type { App, BrowserWindow } from 'electron'

export interface MainWindowActivationOptions {
  app: Pick<App, 'show' | 'focus'> & Partial<Pick<App, 'setActivationPolicy' | 'dock'>>
  window: Pick<BrowserWindow, 'show' | 'focus'> &
    Partial<Pick<BrowserWindow, 'isMinimized' | 'restore' | 'moveTop'>>
  platform?: NodeJS.Platform
}

export function activateMainWindow(options: MainWindowActivationOptions): void {
  const platform = options.platform ?? process.platform

  if (platform === 'darwin') {
    options.app.setActivationPolicy?.('regular')
    void options.app.dock?.show().catch((error) => {
      console.warn('[WindowActivation] failed to show Dock icon:', error)
    })
    options.app.show()
  }

  if (options.window.isMinimized?.()) {
    options.window.restore?.()
  }
  options.window.show()
  options.window.moveTop?.()
  if (platform === 'darwin') {
    options.app.focus({ steal: true })
  }
  options.window.focus()
}
