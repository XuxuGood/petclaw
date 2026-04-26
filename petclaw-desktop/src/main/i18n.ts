import { zh, en, interpolate, resolveLocale } from '@petclaw/shared/i18n'
import type { Locale } from '@petclaw/shared/i18n'
import type Database from 'better-sqlite3'

import { kvGet, kvSet } from './data/db'

const locales: Record<Locale, Record<string, string>> = { zh, en }

let currentLocale: Locale = 'zh'
let dbRef: Database.Database | null = null

export function initI18n(db: Database.Database, systemLocale?: string): void {
  dbRef = db
  const stored = kvGet(db, 'language')
  if (stored === 'zh' || stored === 'en') {
    currentLocale = stored
  } else {
    currentLocale = resolveLocale(systemLocale ?? 'en')
    kvSet(db, 'language', currentLocale)
  }
}

export function t(key: string, params?: Record<string, string>): string {
  const template = locales[currentLocale]?.[key]
  if (!template) return key
  return interpolate(template, params)
}

export function setLanguage(locale: Locale): void {
  currentLocale = locale
  if (dbRef) {
    kvSet(dbRef, 'language', locale)
  }
}

export function getLanguage(): Locale {
  return currentLocale
}
