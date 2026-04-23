import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase } from '../../../src/main/data/db'
import { AgentManager } from '../../../src/main/agents/agent-manager'

describe('AgentManager', () => {
  let db: Database.Database
  let manager: AgentManager

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    manager = new AgentManager(db, '/tmp/workspace')
  })

  afterEach(() => {
    db.close()
  })

  it('should install preset agents on first call', () => {
    manager.ensurePresetAgents()
    const agents = manager.list()
    expect(agents.length).toBe(4)
    expect(agents.find((a) => a.id === 'main')?.isDefault).toBe(true)
  })

  it('should not duplicate presets on second call', () => {
    manager.ensurePresetAgents()
    manager.ensurePresetAgents()
    expect(manager.list().length).toBe(4)
  })

  it('should create a custom agent', () => {
    const agent = manager.create({
      name: 'Test Agent',
      description: 'desc',
      systemPrompt: 'prompt',
      identity: '',
      model: 'llm/openai/gpt-4o',
      icon: '🤖',
      skillIds: ['web-search'],
      enabled: true,
      isDefault: false,
      source: 'custom',
      presetId: ''
    })
    expect(agent.id).toBeTruthy()
    expect(manager.get(agent.id)?.name).toBe('Test Agent')
  })

  it('should update an agent', () => {
    manager.ensurePresetAgents()
    manager.update('code-expert', { name: '高级代码专家' })
    expect(manager.get('code-expert')?.name).toBe('高级代码专家')
  })

  it('should not delete the main agent', () => {
    manager.ensurePresetAgents()
    expect(() => manager.delete('main')).toThrow()
  })

  it('should delete a custom agent', () => {
    const agent = manager.create({
      name: 'Temp',
      description: '',
      systemPrompt: '',
      identity: '',
      model: '',
      icon: '',
      skillIds: [],
      enabled: true,
      isDefault: false,
      source: 'custom',
      presetId: ''
    })
    manager.delete(agent.id)
    expect(manager.get(agent.id)).toBeUndefined()
  })

  it('should emit change event on create', () => {
    let fired = false
    manager.on('change', () => {
      fired = true
    })
    manager.create({
      name: 'X',
      description: '',
      systemPrompt: '',
      identity: '',
      model: '',
      icon: '',
      skillIds: [],
      enabled: true,
      isDefault: false,
      source: 'custom',
      presetId: ''
    })
    expect(fired).toBe(true)
  })

  it('should generate toOpenclawConfig', () => {
    manager.ensurePresetAgents()
    const config = manager.toOpenclawConfig()
    expect(config.defaults.timeoutSeconds).toBe(3600)
    expect(config.defaults.workspace).toBe('/tmp/workspace')
  })
})
