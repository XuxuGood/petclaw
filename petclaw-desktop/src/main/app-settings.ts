import fs from 'fs'
import path from 'path'

// 窗口/宠物位置持久化用的本地 JSON 文件接口。
// 仅 windows.ts 读写 windowBounds/petPosition，其余设置已迁移到 SQLite app_config。
export interface PetclawSettings {
  windowBounds?: { x: number; y: number; width: number; height: number }
  petPosition?: { x: number; y: number }
  // v1 遗留字段兼容：JSON 文件中可能仍存在其他字段，允许反序列化不报错
  [key: string]: unknown
}

function ensureParentDir(settingsPath: string): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
}

export function readAppSettings(settingsPath: string): PetclawSettings {
  if (!fs.existsSync(settingsPath)) return {}

  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as PetclawSettings
  } catch {
    return {}
  }
}

export function writeAppSettings(settingsPath: string, settings: PetclawSettings): void {
  ensureParentDir(settingsPath)
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}
