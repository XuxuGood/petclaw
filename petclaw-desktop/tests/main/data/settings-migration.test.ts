import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import Database from 'better-sqlite3'

import { migrateSettingsToKv } from '../../../src/main/data/settings-migration'
import { kvGet, initDatabase } from '../../../src/main/data/db'

describe('migrateSettingsToKv', () => {
  let tmpDir: string
  let db: Database.Database
  let settingsPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-migration-'))
    settingsPath = path.join(tmpDir, 'petclaw-settings.json')

    // 创建内存数据库并初始化完整 schema（app_config 表）
    db = new Database(':memory:')
    initDatabase(db)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should migrate settings from JSON to kv table', () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        language: 'zh',
        theme: 'dark',
        gatewayPort: 29890,
        autoLaunch: true,
        windowBounds: { x: 100, y: 200, width: 800, height: 600 }
      })
    )

    migrateSettingsToKv(db, settingsPath)

    expect(kvGet(db, 'language')).toBe('"zh"')
    expect(kvGet(db, 'theme')).toBe('"dark"')
    expect(kvGet(db, 'gatewayPort')).toBe('29890')
    expect(kvGet(db, 'autoLaunch')).toBe('true')
    expect(JSON.parse(kvGet(db, 'windowBounds')!)).toEqual({
      x: 100,
      y: 200,
      width: 800,
      height: 600
    })
    expect(kvGet(db, 'settings.migrated')).toBe('"true"')
  })

  it('should rename old file to .migrated', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'light' }))
    migrateSettingsToKv(db, settingsPath)

    expect(fs.existsSync(settingsPath)).toBe(false)
    expect(fs.existsSync(settingsPath + '.migrated')).toBe(true)
  })

  it('should skip if already migrated', () => {
    db.prepare('INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)').run(
      'settings.migrated',
      '"true"',
      Date.now()
    )
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dark' }))

    migrateSettingsToKv(db, settingsPath)

    // theme 不应被迁移（已跳过）
    expect(kvGet(db, 'theme')).toBeNull()
    // 原始文件应仍然存在
    expect(fs.existsSync(settingsPath)).toBe(true)
  })

  it('should handle missing settings file gracefully', () => {
    migrateSettingsToKv(db, path.join(tmpDir, 'nonexistent.json'))
    expect(kvGet(db, 'settings.migrated')).toBe('"true"')
  })

  it('should skip null/undefined values', () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        language: 'zh',
        brainApiKey: null
      })
    )

    migrateSettingsToKv(db, settingsPath)

    expect(kvGet(db, 'language')).toBe('"zh"')
    expect(kvGet(db, 'brainApiKey')).toBeNull()
  })
})
