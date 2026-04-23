import { ipcMain, app } from 'electron'
import type Database from 'better-sqlite3'

import { kvGet, kvSet, getMessages } from '../data/db'

export interface SettingsIpcDeps {
  db: Database.Database
}

export function registerSettingsIpcHandlers(deps: SettingsIpcDeps): void {
  ipcMain.handle('settings:get', async (_event, key: string) => {
    return kvGet(deps.db, key)
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    kvSet(deps.db, key, value)

    if (key === 'autoLaunch') {
      app.setLoginItemSettings({ openAtLogin: value === 'true' })
    }
  })

  // v1 兼容：ChatView 加载历史消息（messages 表）
  ipcMain.handle('chat:history', async (_event, limit: number) => {
    return getMessages(deps.db, limit)
  })
}
