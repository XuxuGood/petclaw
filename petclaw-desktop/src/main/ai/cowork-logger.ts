import { getLogger, getLoggingPlatform, resetLoggingPlatformForTest } from '../logging'

function levelToMethod(level: 'INFO' | 'WARN' | 'ERROR'): 'info' | 'warn' | 'error' {
  if (level === 'ERROR') return 'error'
  if (level === 'WARN') return 'warn'
  return 'info'
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
    const logger = getLogger(tag, 'cowork')
    logger[levelToMethod(level)](`cowork.${tag}.${message}`, extra)
  } catch {
    // 日志写入不能抛出异常
  }
}

/** 获取当前日志文件路径，供外部展示或上传使用 */
export function getCoworkLogPath(): string {
  return getLoggingPlatform().storage.getCurrentFile('cowork')
}

/** 仅测试用：重置统一日志平台，使下次调用重新读取 app.getPath('userData')。 */
export function resetLogFilePathForTest(): void {
  resetLoggingPlatformForTest()
}
