import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import Database from 'better-sqlite3'

import { initDatabase } from '../../../src/main/data/db'
import { DirectoryManager } from '../../../src/main/ai/directory-manager'
import { ModelRegistry } from '../../../src/main/models/model-registry'
import { SkillManager } from '../../../src/main/skills/skill-manager'
import { McpManager } from '../../../src/main/mcp/mcp-manager'
import { ConfigSync } from '../../../src/main/ai/config-sync'

describe('ConfigSync', () => {
  let db: Database.Database
  let tmpDir: string
  let directoryManager: DirectoryManager
  let modelRegistry: ModelRegistry
  let skillManager: SkillManager
  let mcpManager: McpManager

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-config-'))

    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    const skillsDir = path.join(tmpDir, 'skills')
    fs.mkdirSync(skillsDir, { recursive: true })

    directoryManager = new DirectoryManager(db, workspacePath)

    modelRegistry = new ModelRegistry(db)
    modelRegistry.load()

    skillManager = new SkillManager(db, skillsDir)
    mcpManager = new McpManager(db)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createSync(overridePath?: string): ConfigSync {
    return new ConfigSync({
      configPath: overridePath ?? path.join(tmpDir, 'openclaw.json'),
      stateDir: tmpDir,
      directoryManager,
      modelRegistry,
      skillManager,
      mcpManager
    })
  }

  it('should generate openclaw.json on first sync', () => {
    const sync = createSync()
    const result = sync.sync('boot')
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8'))
    // ModelRegistry 默认启用 petclaw provider，故 providers 中应有 petclaw
    expect(config.models.providers).toBeTruthy()
    expect(config.agents.defaults.model.primary).toBeTruthy()
    expect(config.skills.load.extraDirs).toBeTruthy()
  })

  it('should return changed=false when config unchanged', () => {
    const sync = createSync()
    sync.sync('boot')
    const result = sync.sync('check')
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(false)
  })

  it('should preserve existing gateway field', () => {
    const configPath = path.join(tmpDir, 'openclaw.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          gateway: { mode: 'local', auth: { mode: 'token', token: 'existing' } }
        },
        null,
        2
      )
    )
    const sync = createSync(configPath)
    const result = sync.sync('update')
    expect(result.changed).toBe(true)
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    // gateway 字段应保留已有配置，不被覆盖
    expect(config.gateway.auth.token).toBe('existing')
  })

  it('should do atomic write (no partial files)', () => {
    const sync = createSync()
    sync.sync('boot')
    // 验证没有残留的 .tmp 文件
    const files = fs.readdirSync(tmpDir)
    expect(files.filter((f) => f.includes('.tmp'))).toHaveLength(0)
  })

  it('should expose collectSecretEnvVars', () => {
    const sync = createSync()
    const vars = sync.collectSecretEnvVars()
    expect(typeof vars).toBe('object')
  })
})
