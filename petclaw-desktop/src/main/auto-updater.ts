// src/main/auto-updater.ts
// electron-updater 自动更新逻辑
// 通过 GitHub Releases 检测和分发更新

import { BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

// electron-updater 使用 electron-log 输出日志
autoUpdater.logger = log
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

export interface UpdateInfo {
  version: string
  releaseDate: string
  releaseNotes: string | null
}

export function initAutoUpdater(chatWindow: BrowserWindow): void {
  autoUpdater.on('checking-for-update', () => {
    chatWindow.webContents.send('updater:status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    const updateInfo: UpdateInfo = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    }
    chatWindow.webContents.send('updater:status', { status: 'available', info: updateInfo })
  })

  autoUpdater.on('update-not-available', () => {
    chatWindow.webContents.send('updater:status', { status: 'up-to-date' })
  })

  autoUpdater.on('download-progress', (progress) => {
    chatWindow.webContents.send('updater:status', {
      status: 'downloading',
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      }
    })
  })

  autoUpdater.on('update-downloaded', () => {
    chatWindow.webContents.send('updater:status', { status: 'downloaded' })
  })

  autoUpdater.on('error', (err) => {
    chatWindow.webContents.send('updater:status', { status: 'error', error: err.message })
  })

  // 注册 IPC handlers
  ipcMain.handle('updater:check', async () => {
    autoUpdater.checkForUpdates()
  })
  ipcMain.handle('updater:download', async () => {
    autoUpdater.downloadUpdate()
  })
  ipcMain.handle('updater:install', async () => {
    autoUpdater.quitAndInstall()
  })

  // 启动后延迟检查更新（避免启动性能影响）
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // 静默失败（离线等情况）
    })
  }, 10_000)
}
