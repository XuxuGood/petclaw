import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { app } from 'electron'

import {
  coworkLog,
  getCoworkLogPath,
  resetLogFilePathForTest
} from '../../../src/main/ai/cowork-logger'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-logger-'))
  vi.mocked(app.getPath).mockReturnValue(tmpDir)
  vi.mocked(app.getVersion).mockReturnValue('0.0.0-test')
  resetLogFilePathForTest()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
  resetLogFilePathForTest()
})

function logFilePath(): string {
  const today = new Date().toISOString().slice(0, 10)
  return path.join(tmpDir, 'logs', 'cowork', `cowork-${today}.log`)
}

function readEvents(): Array<Record<string, unknown>> {
  return fs
    .readFileSync(logFilePath(), 'utf-8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('coworkLog', () => {
  it('writes structured cowork logs through the unified logging platform', () => {
    coworkLog('INFO', 'boot', 'system started', { reason: 'manual' })

    const [event] = readEvents()
    expect(event.level).toBe('info')
    expect(event.source).toBe('cowork')
    expect(event.module).toBe('boot')
    expect(event.event).toBe('cowork.boot.system started')
    expect(event.fields).toEqual({ reason: 'manual' })
  })

  it('maps WARN and ERROR levels', () => {
    coworkLog('WARN', 'session', 'connection slow')
    coworkLog('ERROR', 'engine', 'process crashed')

    const events = readEvents()
    expect(events.map((event) => event.level)).toEqual(['warn', 'error'])
  })

  it('redacts sensitive extra fields', () => {
    coworkLog('INFO', 'config', 'sync', { token: 'secret-token' })

    const content = fs.readFileSync(logFilePath(), 'utf-8')
    expect(content).toContain('[redacted]')
    expect(content).not.toContain('secret-token')
  })

  it('does not throw when storage write fails', () => {
    const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('disk full')
    })

    expect(() => coworkLog('ERROR', 'test', 'should not throw')).not.toThrow()
    appendSpy.mockRestore()
  })
})

describe('getCoworkLogPath', () => {
  it('returns the current unified cowork log file path', () => {
    expect(getCoworkLogPath()).toBe(logFilePath())
  })
})
