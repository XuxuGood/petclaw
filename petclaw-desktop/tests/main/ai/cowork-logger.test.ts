import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// electron mock 由 vitest.config.ts alias 注入，app.getPath 指向 /tmp/test
// 这里在每个用例前重定向到临时目录，确保测试隔离
import { app } from 'electron'

import {
  coworkLog,
  getCoworkLogPath,
  resetLogFilePathForTest
} from '../../../src/main/ai/cowork-logger'

// 每个测试用例使用独立 tmpDir 避免相互污染
let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-logger-'))
  // 重定向 electron mock 的 userData 到临时目录
  vi.mocked(app.getPath).mockReturnValue(tmpDir)
  // 重置模块内部的路径缓存，使 getLogFilePath 重新初始化
  resetLogFilePathForTest()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

// ── 辅助函数 ──

function logFilePath(): string {
  return path.join(tmpDir, 'logs', 'cowork.log')
}

function readLog(): string {
  return fs.readFileSync(logFilePath(), 'utf-8')
}

describe('coworkLog 基本写入', () => {
  it('首次写入时自动创建 logs 目录和 cowork.log', () => {
    coworkLog('INFO', 'test', 'hello')
    expect(fs.existsSync(logFilePath())).toBe(true)
  })

  it('写入 INFO 条目，包含时间戳、级别、tag 和消息', () => {
    coworkLog('INFO', 'boot', 'system started')
    const content = readLog()
    expect(content).toContain('[INFO]')
    expect(content).toContain('[boot]')
    expect(content).toContain('system started')
  })

  it('写入 WARN 条目', () => {
    coworkLog('WARN', 'session', 'connection slow')
    expect(readLog()).toContain('[WARN]')
  })

  it('写入 ERROR 条目', () => {
    coworkLog('ERROR', 'engine', 'process crashed')
    expect(readLog()).toContain('[ERROR]')
  })

  it('时间戳符合 ISO 8601 格式（含时区偏移）', () => {
    coworkLog('INFO', 'ts-test', 'timestamp check')
    const content = readLog()
    // 匹配形如 2026-04-26T12:30:00.123+08:00 或 +00:00 的时间戳
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}\]/)
  })

  it('多次调用追加写入（而非覆盖）', () => {
    coworkLog('INFO', 'a', 'first')
    coworkLog('INFO', 'b', 'second')
    const content = readLog()
    expect(content).toContain('first')
    expect(content).toContain('second')
  })

  it('条目之间有空行分隔', () => {
    coworkLog('INFO', 'a', 'msg1')
    coworkLog('INFO', 'b', 'msg2')
    const content = readLog()
    // 两条日志之间必有空行
    expect(content).toMatch(/\n\n/)
  })
})

describe('coworkLog extra 字段序列化', () => {
  it('string 类型的 extra 值直接写入，不加引号', () => {
    coworkLog('INFO', 'tag', 'msg', { reason: 'timeout' })
    expect(readLog()).toContain('  reason: timeout')
  })

  it('object 类型的 extra 值用 JSON.stringify 序列化', () => {
    coworkLog('INFO', 'tag', 'msg', { err: { code: 42 } })
    expect(readLog()).toContain('"code": 42')
  })

  it('number 类型的 extra 值序列化为数字字符串', () => {
    coworkLog('INFO', 'tag', 'msg', { count: 5 })
    expect(readLog()).toContain('  count: 5')
  })

  it('extra 为 undefined 时不写入额外行', () => {
    coworkLog('INFO', 'tag', 'msg')
    const content = readLog()
    // 只有一行日志行 + 空行
    const lines = content.split('\n').filter((l) => l.trim() !== '')
    expect(lines).toHaveLength(1)
  })

  it('extra 含多个字段时每个字段各占一行', () => {
    coworkLog('INFO', 'tag', 'msg', { a: 'val-a', b: 'val-b' })
    const content = readLog()
    expect(content).toContain('  a: val-a')
    expect(content).toContain('  b: val-b')
  })
})

describe('coworkLog 日志轮转', () => {
  it('文件超过 5MB 时将当前日志重命名为 .old', () => {
    const logsDir = path.join(tmpDir, 'logs')
    fs.mkdirSync(logsDir, { recursive: true })
    // 写入一个超过 5MB 的假日志文件
    fs.writeFileSync(logFilePath(), Buffer.alloc(6 * 1024 * 1024, 'x'))

    coworkLog('INFO', 'rotate', 'trigger rotation')

    expect(fs.existsSync(logFilePath() + '.old')).toBe(true)
    // 新日志文件应已被创建且比 5MB 小
    expect(fs.statSync(logFilePath()).size).toBeLessThan(5 * 1024 * 1024)
  })

  it('轮转时若 .old 已存在则先删除', () => {
    const logsDir = path.join(tmpDir, 'logs')
    fs.mkdirSync(logsDir, { recursive: true })
    fs.writeFileSync(logFilePath(), Buffer.alloc(6 * 1024 * 1024, 'x'))
    // 预先写入旧备份
    fs.writeFileSync(logFilePath() + '.old', 'old backup content')

    coworkLog('INFO', 'rotate', 'overwrite old backup')

    // 旧备份已被替换，内容不再是 'old backup content'
    const backupContent = fs.readFileSync(logFilePath() + '.old', 'utf-8')
    expect(backupContent).not.toBe('old backup content')
  })

  it('文件未超过 5MB 时不触发轮转', () => {
    coworkLog('INFO', 'no-rotate', 'small log')
    expect(fs.existsSync(logFilePath() + '.old')).toBe(false)
  })
})

describe('coworkLog 错误容忍', () => {
  it('fs 操作抛出异常时不向上抛出', () => {
    // 模拟 appendFileSync 抛出
    const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('disk full')
    })
    // 不应抛出
    expect(() => coworkLog('ERROR', 'test', 'should not throw')).not.toThrow()
    appendSpy.mockRestore()
  })
})

describe('getCoworkLogPath', () => {
  it('返回 userData/logs/cowork.log 路径', () => {
    const p = getCoworkLogPath()
    expect(p).toBe(path.join(tmpDir, 'logs', 'cowork.log'))
  })

  it('多次调用返回相同路径（缓存有效）', () => {
    const p1 = getCoworkLogPath()
    const p2 = getCoworkLogPath()
    expect(p1).toBe(p2)
  })
})
