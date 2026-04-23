import fs from 'fs'

import type Database from 'better-sqlite3'

import { kvGet, kvSet } from './db'

/**
 * 一次性迁移：将 petclaw-settings.json 中的设置复制到 SQLite kv 表。
 * 迁移完成后将 JSON 文件重命名为 .migrated（保留备份，不删除）。
 * 如果 kv 表中已有 'settings.migrated' 标记，跳过迁移。
 */
export function migrateSettingsToKv(db: Database.Database, oldSettingsPath: string): void {
  // 已迁移则跳过
  if (kvGet(db, 'settings.migrated')) return

  if (!fs.existsSync(oldSettingsPath)) {
    // 无旧设置文件 — 标记迁移完成并返回
    kvSet(db, 'settings.migrated', JSON.stringify('true'))
    return
  }

  try {
    const raw = fs.readFileSync(oldSettingsPath, 'utf8')
    const settings = JSON.parse(raw) as Record<string, unknown>

    for (const [key, value] of Object.entries(settings)) {
      if (value === undefined || value === null) continue
      // 每个设置以 JSON 字符串形式存储
      kvSet(db, key, JSON.stringify(value))
    }

    // 标记迁移完成
    kvSet(db, 'settings.migrated', JSON.stringify('true'))

    // 重命名旧文件作为备份（不删除）
    fs.renameSync(oldSettingsPath, oldSettingsPath + '.migrated')
  } catch {
    // 迁移失败不阻塞应用启动 — 旧文件保留，下次启动可重试
  }
}
