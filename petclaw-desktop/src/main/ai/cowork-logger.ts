import { app } from 'electron'
import fs from 'fs'
import path from 'path'

// 单个日志文件上限 5MB，超出则轮转到 .old 备份
const MAX_LOG_SIZE = 5 * 1024 * 1024

// 延迟初始化：Electron app ready 前不能调用 getPath
let logFilePath: string | null = null

function getLogFilePath(): string {
  if (!logFilePath) {
    const logDir = path.join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }
    logFilePath = path.join(logDir, 'cowork.log')
  }
  return logFilePath
}

// 超过大小上限时将当前日志重命名为 .old，旧备份直接覆盖
function rotateIfNeeded(): void {
  try {
    const filePath = getLogFilePath()
    if (!fs.existsSync(filePath)) return
    const stat = fs.statSync(filePath)
    if (stat.size > MAX_LOG_SIZE) {
      const backupPath = filePath + '.old'
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath)
      }
      fs.renameSync(filePath, backupPath)
    }
  } catch {
    // 轮转失败不影响主流程
  }
}

// 格式化为带时区偏移的 ISO 8601 时间戳，精确到毫秒
function formatTimestamp(): string {
  const date = new Date()
  const pad = (value: number, length = 2): string => value.toString().padStart(length, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const minute = pad(date.getMinutes())
  const second = pad(date.getSeconds())
  const millisecond = pad(date.getMilliseconds(), 3)

  // 时区偏移：getTimezoneOffset 返回 UTC - 本地 分钟数，取反得到本地偏移
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const offsetHour = pad(Math.floor(absOffset / 60))
  const offsetMinute = pad(absOffset % 60)

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}${sign}${offsetHour}:${offsetMinute}`
}

/**
 * 写入一条结构化日志到 cowork.log。
 * 格式：[时间戳] [LEVEL] [tag] message\n  key: value\n
 * 日志写入失败时静默忽略，避免影响主流程。
 */
export function coworkLog(
  level: 'INFO' | 'WARN' | 'ERROR',
  tag: string,
  message: string,
  extra?: Record<string, unknown>
): void {
  try {
    rotateIfNeeded()
    const parts = [`[${formatTimestamp()}] [${level}] [${tag}] ${message}`]
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        parts.push(`  ${key}: ${serialized}`)
      }
    }
    // 条目末尾加两个换行，确保相邻日志之间有一个空行
    fs.appendFileSync(getLogFilePath(), parts.join('\n') + '\n\n', 'utf-8')
  } catch {
    // 日志写入不能抛出异常
  }
}

/** 获取当前日志文件路径，供外部展示或上传使用 */
export function getCoworkLogPath(): string {
  return getLogFilePath()
}

/** 仅测试用：重置路径缓存，使下次调用重新计算日志路径 */
export function resetLogFilePathForTest(): void {
  logFilePath = null
}
