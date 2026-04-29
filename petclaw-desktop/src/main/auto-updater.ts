// src/main/auto-updater.ts
// electron-updater 自动更新逻辑
// 通过 GitHub Releases 检测和分发更新

import { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

import { safeHandle } from './ipc/ipc-registry'

// electron-updater 使用 electron-log 输出日志
autoUpdater.logger = log
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

export interface UpdateInfo {
  version: string
  releaseDate: string
  releaseNotes: string | null
}

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.on('checking-for-update', () => {
    mainWindow.webContents.send('updater:status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    const updateInfo: UpdateInfo = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    }
    mainWindow.webContents.send('updater:status', { status: 'available', info: updateInfo })
  })

  autoUpdater.on('update-not-available', () => {
    mainWindow.webContents.send('updater:status', { status: 'up-to-date' })
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('updater:status', {
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
    mainWindow.webContents.send('updater:status', { status: 'downloaded' })
  })

  autoUpdater.on('error', (err) => {
    mainWindow.webContents.send('updater:status', { status: 'error', error: err.message })
  })

  // 注册 IPC handlers
  safeHandle('updater:check', async () => {
    autoUpdater.checkForUpdates()
  })
  safeHandle('updater:download', async () => {
    autoUpdater.downloadUpdate()
  })
  safeHandle('updater:install', async () => {
    autoUpdater.quitAndInstall()
  })

  // 启动后延迟检查更新（避免启动性能影响）
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // 静默失败（离线等情况）
    })
  }, 10_000)
}
