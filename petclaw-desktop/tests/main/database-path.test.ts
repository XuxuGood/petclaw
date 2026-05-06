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

  it('stores sqlite database under Electron userData', () => {
    const userDataPath = path.join(tmpDir, 'userData')
    const dbPath = resolveDatabasePath({
      userDataPath
    })

    expect(dbPath).toBe(path.join(userDataPath, 'petclaw.db'))
  })

  it('creates the userData directory when resolving the database path', () => {
    const userDataPath = path.join(tmpDir, 'userData')

    const dbPath = resolveDatabasePath({ userDataPath })

    expect(dbPath).toBe(path.join(userDataPath, 'petclaw.db'))
    expect(fs.existsSync(userDataPath)).toBe(true)
  })
})
