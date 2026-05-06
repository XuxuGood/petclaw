// src/main/auto-updater.ts
// electron-updater 自动更新逻辑
// 通过 GitHub Releases 检测和分发更新

import { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

import { safeHandle } from './ipc/ipc-registry'
import { getLogger } from './logging'

function updaterLogger() {
  return getLogger('AutoUpdater', 'updater')
}

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
    updaterLogger().info('updater.check.started', 'Auto updater check started')
    mainWindow.webContents.send('updater:status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    const updateInfo: UpdateInfo = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    }
    updaterLogger().info('updater.update.available', 'Application update is available', {
      version: updateInfo.version
    })
    mainWindow.webContents.send('updater:status', { status: 'available', info: updateInfo })
  })

  autoUpdater.on('update-not-available', () => {
    updaterLogger().info('updater.update.notAvailable', 'Application update is not available')
    mainWindow.webContents.send('updater:status', { status: 'up-to-date' })
  })

  autoUpdater.on('download-progress', (progress) => {
    updaterLogger().debug('updater.download.progress', 'Auto updater download progress changed', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total
    })
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
    updaterLogger().info('updater.download.completed', 'Application update download completed')
    mainWindow.webContents.send('updater:status', { status: 'downloaded' })
  })

  autoUpdater.on('error', (err) => {
    updaterLogger().error('updater.error', 'Auto updater failed', err)
    mainWindow.webContents.send('updater:status', { status: 'error', error: err.message })
  })

  // 注册 IPC handlers
  safeHandle('updater:check', async () => {
    updaterLogger().info('updater.check.requested', 'Auto updater check was requested')
    autoUpdater.checkForUpdates()
  })
  safeHandle('updater:download', async () => {
    updaterLogger().info('updater.download.requested', 'Auto updater download was requested')
    autoUpdater.downloadUpdate()
  })
  safeHandle('updater:install', async () => {
    updaterLogger().info('updater.install.requested', 'Auto updater install was requested')
    autoUpdater.quitAndInstall()
  })

  // 启动后延迟检查更新（避免启动性能影响）
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // 静默失败（离线等情况）
    })
  }, 10_000)
}
