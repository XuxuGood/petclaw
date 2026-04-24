import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveDatabasePath } from '../../src/main/database-path'

describe('resolveDatabasePath', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-db-path-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('stores sqlite database under ~/.petclaw', () => {
    const dbPath = resolveDatabasePath({
      petclawHome: path.join(tmpDir, '.petclaw'),
      legacyUserDataPath: path.join(tmpDir, 'userData')
    })

    // 实现已改为在 petclawHome/data/ 子目录存储数据库
    expect(dbPath).toBe(path.join(tmpDir, '.petclaw', 'data', 'petclaw.db'))
  })

  it('migrates legacy userData database to ~/.petclaw on first run', () => {
    const petclawHome = path.join(tmpDir, '.petclaw')
    const legacyUserDataPath = path.join(tmpDir, 'userData')
    const legacyDbPath = path.join(legacyUserDataPath, 'petclaw.db')

    fs.mkdirSync(legacyUserDataPath, { recursive: true })
    fs.writeFileSync(legacyDbPath, 'legacy-db')

    const dbPath = resolveDatabasePath({ petclawHome, legacyUserDataPath })

    // 实现迁移到 petclawHome/data/ 子目录
    expect(dbPath).toBe(path.join(petclawHome, 'data', 'petclaw.db'))
    expect(fs.existsSync(dbPath)).toBe(true)
    expect(fs.readFileSync(dbPath, 'utf-8')).toBe('legacy-db')
    expect(fs.existsSync(legacyDbPath)).toBe(false)
  })
})
