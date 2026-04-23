import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import Database from 'better-sqlite3'

import { initDatabase } from '../../../src/main/data/db'
import { AgentManager } from '../../../src/main/agents/agent-manager'
import { ModelRegistry } from '../../../src/main/models/model-registry'
import { SkillManager } from '../../../src/main/skills/skill-manager'
import { McpManager } from '../../../src/main/mcp/mcp-manager'
import { ConfigSync } from '../../../src/main/ai/config-sync'

describe('ConfigSync v2', () => {
  let db: Database.Database
  let tmpDir: string
  let configPath: string
  let configSync: ConfigSync

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-config-v2-'))
    configPath = path.join(tmpDir, 'openclaw.json')

    const skillsDir = path.join(tmpDir, 'skills')
    fs.mkdirSync(skillsDir, { recursive: true })
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    const agentManager = new AgentManager(db, workspacePath)
    agentManager.ensurePresetAgents()

    const modelRegistry = new ModelRegistry(db)
    modelRegistry.load()

    const skillManager = new SkillManager(db, skillsDir)

    const mcpManager = new McpManager(db)

    configSync = new ConfigSync({
      configPath,
      stateDir: tmpDir,
      agentManager,
      modelRegistry,
      skillManager,
      mcpManager,
      workspacePath
    })
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should generate openclaw.json on sync', () => {
    const result = configSync.sync('test')
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    expect(fs.existsSync(configPath)).toBe(true)

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(config.models).toBeTruthy()
    expect(config.agents).toBeTruthy()
    expect(config.skills).toBeTruthy()
    expect(config.commands).toBeTruthy()
  })

  it('should return changed=false when config unchanged', () => {
    configSync.sync('first')
    const result = configSync.sync('second')
    expect(result.changed).toBe(false)
  })

  it('should collect secret env vars from ModelRegistry', () => {
    const vars = configSync.collectSecretEnvVars()
    expect(typeof vars).toBe('object')
  })
})
