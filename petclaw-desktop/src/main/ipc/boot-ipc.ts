import { app } from 'electron'

import type Database from 'better-sqlite3'

import { safeHandle } from './ipc-registry'
import { getLanguage, setLanguage } from '../i18n'
import type { Locale } from '@petclaw/shared/i18n'

export interface BootIpcDeps {
  db: Database.Database
  refreshSystemMenus?: () => void
}

export function registerBootIpcHandlers(deps: BootIpcDeps): void {
  safeHandle('app:version', async () => app.getVersion())

  // i18n 语言查询与切换
  safeHandle('i18n:get-language', () => getLanguage())

  safeHandle('i18n:set-language', (_event, locale: string) => {
    if (locale === 'zh' || locale === 'en') {
      setLanguage(locale as Locale)
      deps.refreshSystemMenus?.()
    }
  })
}
