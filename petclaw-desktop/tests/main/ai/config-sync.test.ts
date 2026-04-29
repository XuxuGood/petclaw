import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import Database from 'better-sqlite3'

import { initDatabase } from '../../../src/main/data/db'
import { DirectoryStore } from '../../../src/main/data/directory-store'
import { McpStore } from '../../../src/main/data/mcp-store'
import { CoworkConfigStore } from '../../../src/main/data/cowork-config-store'
import { ImStore } from '../../../src/main/data/im-store'
import { DirectoryManager } from '../../../src/main/ai/directory-manager'
import { ProviderRegistry } from '../../../src/shared/models/provider-registry'
import { ModelConfigStore } from '../../../src/main/models/model-config-store'
import { ModelRegistry } from '../../../src/main/models/model-registry'
import { SkillManager } from '../../../src/main/skills/skill-manager'
import { McpManager } from '../../../src/main/mcp/mcp-manager'
import { ImGatewayManager } from '../../../src/main/im/im-gateway-manager'
import { MemorySearchConfigStore } from '../../../src/main/memory/memory-search-config-store'
import { ConfigSync } from '../../../src/main/ai/config-sync'

describe('ConfigSync', () => {
  let db: Database.Database
  let tmpDir: string
  let workspacePath: string
  let skillsDir: string
  let directoryManager: DirectoryManager
  let modelRegistry: ModelRegistry
  let skillManager: SkillManager
  let mcpManager: McpManager
  let imGatewayManager: ImGatewayManager
  let coworkConfigStore: CoworkConfigStore
  let memorySearchConfigStore: MemorySearchConfigStore

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-config-'))

    workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    skillsDir = path.join(tmpDir, 'skills')
    fs.mkdirSync(skillsDir, { recursive: true })

    directoryManager = new DirectoryManager(new DirectoryStore(db))
    coworkConfigStore = new CoworkConfigStore(db, workspacePath)

    modelRegistry = new ModelRegistry(new ModelConfigStore(db), new ProviderRegistry())
    modelRegistry.load()

    skillManager = new SkillManager(db, skillsDir)
    mcpManager = new McpManager(new McpStore(db))
    imGatewayManager = new ImGatewayManager(new ImStore(db))
    memorySearchConfigStore = new MemorySearchConfigStore(db)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createSync(overridePath?: string): ConfigSync {
    return new ConfigSync({
      configPath: overridePath ?? path.join(tmpDir, 'openclaw.json'),
      stateDir: tmpDir,
      workspacePath,
      skillsDir,
      coworkConfigStore,
      directoryManager,
      modelRegistry,
      skillManager,
      mcpManager,
      imGatewayManager,
      memorySearchConfigStore
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

  it('should generate managed OpenClaw baseline fields', () => {
    const sync = createSync()
    const result = sync.sync('boot')

    expect(result.ok).toBe(true)
    const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8'))

    expect(config.gateway).toMatchObject({
      mode: 'local',
      auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' },
      tailscale: { mode: 'off' }
    })
    expect(config.agents.defaults.sandbox).toEqual({ mode: 'off' })
    expect(config.tools).toEqual({
      deny: ['web_search'],
      web: { search: { enabled: false } }
    })
    expect(config.browser).toEqual({ enabled: true })
    expect(config.cron).toEqual({
      enabled: true,
      skipMissedJobs: true,
      maxConcurrentRuns: 3,
      sessionRetention: '7d'
    })
    expect(config.commands).toEqual({ ownerAllowFrom: ['gateway-client', '*'] })
  })

  it('should compose agents defaults from runtime workspace and default model', () => {
    modelRegistry.setDefaultModel({ providerId: 'openai', modelId: 'gpt-4o' })
    directoryManager.ensureRegistered('/tmp/project-a')

    const sync = createSync()
    const result = sync.sync('directory-change')

    expect(result.ok).toBe(true)
    const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8'))
    expect(config.agents.defaults).toMatchObject({
      timeoutSeconds: 3600,
      model: { primary: 'openai/gpt-4o' },
      workspace: workspacePath
    })
    expect(config.agents.list[0]).toEqual({ id: 'main', default: true })
    const projectAgent = config.agents.list.find((agent: { workspace?: string }) => {
      return agent.workspace === '/tmp/project-a'
    })
    expect(projectAgent).toBeTruthy()
  })

  it('should generate AGENTS.md with managed prompt sections', () => {
    coworkConfigStore.setConfig({ systemPrompt: 'custom cowork prompt' })

    const sync = createSync()
    const result = sync.sync('boot')

    expect(result.ok).toBe(true)
    const agentsMd = fs.readFileSync(path.join(tmpDir, 'workspace', 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('# AGENTS.md - Your Workspace')
    expect(agentsMd).toContain('<!-- PetClaw managed: do not edit below this line -->')
    expect(agentsMd).toContain('## System Prompt')
    expect(agentsMd).toContain('custom cowork prompt')
    expect(agentsMd).toContain('## Scheduled Tasks')
  })

  it('should report changed when only AGENTS.md changes', () => {
    const sync = createSync()
    sync.sync('boot')

    coworkConfigStore.setConfig({ systemPrompt: 'updated cowork prompt' })
    const result = sync.sync('cowork-config-change')

    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)

    const agentsMd = fs.readFileSync(path.join(tmpDir, 'workspace', 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('updated cowork prompt')
  })

  it('should return changed=false when config unchanged', () => {
    const sync = createSync()
    sync.sync('boot')
    const result = sync.sync('check')
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(false)
  })

  it('should enforce managed gateway fields while preserving custom gateway fields', () => {
    const configPath = path.join(tmpDir, 'openclaw.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          gateway: {
            mode: 'remote',
            auth: { mode: 'token', token: 'existing' },
            customField: 'keep-me'
          }
        },
        null,
        2
      )
    )
    const sync = createSync(configPath)
    const result = sync.sync('update')
    expect(result.changed).toBe(true)
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(config.gateway).toMatchObject({
      mode: 'local',
      auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' },
      tailscale: { mode: 'off' },
      customField: 'keep-me'
    })
  })

  it('should create exec approval defaults for main agent', () => {
    const sync = createSync()
    const result = sync.sync('boot')

    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)

    const approvalsPath = path.join(tmpDir, '.openclaw', 'exec-approvals.json')
    const approvals = JSON.parse(fs.readFileSync(approvalsPath, 'utf8'))

    expect(approvals).toMatchObject({
      version: 1,
      agents: {
        main: {
          security: 'full',
          ask: 'off'
        }
      }
    })
  })

  it('should preserve unknown exec approval fields', () => {
    const approvalsDir = path.join(tmpDir, '.openclaw')
    fs.mkdirSync(approvalsDir, { recursive: true })
    const approvalsPath = path.join(approvalsDir, 'exec-approvals.json')
    fs.writeFileSync(
      approvalsPath,
      JSON.stringify(
        {
          version: 1,
          customRoot: true,
          agents: {
            main: {
              ask: 'on',
              customAgent: 'keep'
            },
            other: {
              security: 'limited'
            }
          }
        },
        null,
        2
      )
    )

    const sync = createSync()
    const result = sync.sync('boot')

    expect(result.ok).toBe(true)
    const approvals = JSON.parse(fs.readFileSync(approvalsPath, 'utf8'))
    expect(approvals.customRoot).toBe(true)
    expect(approvals.agents.main).toEqual({
      ask: 'off',
      customAgent: 'keep',
      security: 'full'
    })
    expect(approvals.agents.other).toEqual({ security: 'limited' })
  })

  it('should normalize malformed exec approval agent fields', () => {
    const approvalsDir = path.join(tmpDir, '.openclaw')
    fs.mkdirSync(approvalsDir, { recursive: true })
    const approvalsPath = path.join(approvalsDir, 'exec-approvals.json')
    fs.writeFileSync(
      approvalsPath,
      JSON.stringify(
        {
          version: 1,
          customRoot: true,
          agents: []
        },
        null,
        2
      )
    )

    const sync = createSync()
    const first = sync.sync('boot')
    const second = sync.sync('boot')

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(second.changed).toBe(false)
    const approvals = JSON.parse(fs.readFileSync(approvalsPath, 'utf8'))
    expect(approvals.customRoot).toBe(true)
    expect(approvals.agents).toEqual({
      main: {
        security: 'full',
        ask: 'off'
      }
    })

    fs.writeFileSync(
      approvalsPath,
      JSON.stringify(
        {
          version: 1,
          customRoot: true,
          agents: {
            main: 'bad',
            other: { security: 'limited' }
          }
        },
        null,
        2
      )
    )

    const third = sync.sync('boot')
    const fourth = sync.sync('boot')

    expect(third.ok).toBe(true)
    expect(fourth.ok).toBe(true)
    expect(fourth.changed).toBe(false)
    const normalized = JSON.parse(fs.readFileSync(approvalsPath, 'utf8'))
    expect(normalized.customRoot).toBe(true)
    expect(normalized.agents).toEqual({
      main: {
        security: 'full',
        ask: 'off'
      },
      other: { security: 'limited' }
    })
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

  it('should include IM channels and bindings when configured', () => {
    const instance = imGatewayManager.createInstance(
      'feishu',
      { appSecret: 'secret-token' },
      'Feishu Bot'
    )
    imGatewayManager.updateInstance(instance.id, {
      enabled: true,
      agentId: 'main',
      config: {
        dmPolicy: 'open',
        groupPolicy: 'disabled',
        allowFrom: [],
        debug: false
      }
    })

    const sync = createSync()
    const result = sync.sync('im-change')

    expect(result.ok).toBe(true)
    const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8'))
    expect(config.channels[`feishu:${instance.id}`]).toEqual({
      enabled: true,
      platform: 'feishu',
      name: 'Feishu Bot',
      dmPolicy: 'open',
      groupPolicy: 'disabled',
      allowFrom: [],
      debug: false,
      credentials: {
        appSecret: `\${PETCLAW_IM_FEISHU_${instance.id.replace(/-/g, '_').toUpperCase()}_APPSECRET}`
      }
    })
    expect(config.bindings).toEqual([
      {
        agentId: 'main',
        match: { channel: `feishu:${instance.id}` }
      }
    ])
    expect(JSON.stringify(config)).not.toContain('secret-token')
  })

  it('should collect IM secret env vars', () => {
    const instance = imGatewayManager.createInstance('feishu', { appSecret: 'secret-token' })
    imGatewayManager.updateInstance(instance.id, { enabled: true })

    const sync = createSync()
    const vars = sync.collectSecretEnvVars()

    expect(vars).toMatchObject({
      [`PETCLAW_IM_FEISHU_${instance.id.replace(/-/g, '_').toUpperCase()}_APPSECRET`]:
        'secret-token'
    })
  })

  it('should omit memorySearch when disabled', () => {
    const sync = createSync()
    const result = sync.sync('boot')
    const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8'))

    expect(config.agents.defaults.memorySearch).toBeUndefined()
  })

  it('should write global memorySearch to agents defaults when enabled', () => {
    memorySearchConfigStore.setConfig({
      enabled: true,
      provider: 'gemini',
      model: 'text-embedding-004',
      remoteApiKey: 'secret-key'
    })

    const sync = createSync()
    const result = sync.sync('memory-search-change')
    const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8'))

    expect(config.agents.defaults.memorySearch).toMatchObject({
      enabled: true,
      provider: 'gemini',
      model: 'text-embedding-004',
      remote: { apiKey: '${PETCLAW_MEMORY_SEARCH_API_KEY}' }
    })
    expect(JSON.stringify(config)).not.toContain('secret-key')
    expect(sync.collectSecretEnvVars()).toMatchObject({
      PETCLAW_MEMORY_SEARCH_API_KEY: 'secret-key'
    })
  })
})
