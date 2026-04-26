import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

import { initDatabase, kvGet } from '../../src/main/data/db'
import { initI18n, t, setLanguage, getLanguage } from '../../src/main/i18n'

describe('main process i18n', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('initI18n defaults to zh when system locale is zh', () => {
    initI18n(db, 'zh-CN')
    expect(getLanguage()).toBe('zh')
  })

  it('initI18n defaults to en for non-zh system locale', () => {
    initI18n(db, 'en-US')
    expect(getLanguage()).toBe('en')
  })

  it('initI18n reads stored language from app_config', () => {
    db.prepare('INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)').run(
      'language',
      'en',
      Date.now()
    )
    initI18n(db, 'zh-CN')
    expect(getLanguage()).toBe('en')
  })

  it('t() returns translated text for current locale', () => {
    initI18n(db, 'zh-CN')
    expect(t('common.confirm')).toBe('确认')
    setLanguage('en')
    expect(t('common.confirm')).toBe('Confirm')
  })

  it('t() supports interpolation', () => {
    initI18n(db, 'zh-CN')
    expect(t('error.dirNotFound', { path: '/test' })).toBe('工作目录不存在：/test')
  })

  it('t() returns key when key not found', () => {
    initI18n(db, 'zh-CN')
    expect(t('nonexistent.key')).toBe('nonexistent.key')
  })

  it('setLanguage persists to app_config', () => {
    initI18n(db, 'zh-CN')
    setLanguage('en')
    expect(kvGet(db, 'language')).toBe('en')
  })
})
