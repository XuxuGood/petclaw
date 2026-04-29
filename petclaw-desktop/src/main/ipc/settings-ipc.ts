import { app } from 'electron'
import type Database from 'better-sqlite3'

import { safeHandle } from './ipc-registry'
import { kvGet, kvSet } from '../data/db'

export interface SettingsIpcDeps {
  db: Database.Database
}

export function registerSettingsIpcHandlers(deps: SettingsIpcDeps): void {
  safeHandle('settings:get', async (_event, key: string) => {
    return kvGet(deps.db, key)
  })

  safeHandle('settings:set', async (_event, key: string, value: string) => {
    kvSet(deps.db, key, value)

    if (key === 'autoLaunch') {
      app.setLoginItemSettings({ openAtLogin: value === 'true' })
    }
  })
}
