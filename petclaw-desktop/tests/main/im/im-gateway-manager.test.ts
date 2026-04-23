// tests/main/im/im-gateway-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase } from '../../../src/main/data/db'

describe('ImGatewayManager', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  afterEach(() => db.close())

  it('should save and load platform config', async () => {
    const { ImGatewayManager } = await import('../../../src/main/im/im-gateway-manager')
    const manager = new ImGatewayManager(db)
    manager.savePlatformConfig('telegram', {
      enabled: true,
      dmPolicy: 'open',
      groupPolicy: 'disabled',
      allowFrom: [],
      debug: false
    })
    const config = manager.loadPlatformConfig('telegram')
    expect(config).toBeTruthy()
    expect(config!.enabled).toBe(true)
  })

  it('should save and load IM settings', async () => {
    const { ImGatewayManager } = await import('../../../src/main/im/im-gateway-manager')
    const manager = new ImGatewayManager(db)
    manager.saveSettings({
      systemPrompt: 'You are helpful',
      skillsEnabled: true,
      platformAgentBindings: { telegram: 'main', 'dingtalk:inst-1': 'work-agent' }
    })
    const settings = manager.loadSettings()
    expect(settings.platformAgentBindings['telegram']).toBe('main')
    expect(settings.platformAgentBindings['dingtalk:inst-1']).toBe('work-agent')
  })

  it('should manage session mappings', async () => {
    const { ImGatewayManager } = await import('../../../src/main/im/im-gateway-manager')
    const manager = new ImGatewayManager(db)
    manager.upsertSessionMapping('conv-1', 'telegram', 'session-abc', 'main')
    const mapping = manager.getSessionMapping('conv-1', 'telegram')
    expect(mapping).toBeTruthy()
    expect(mapping!.cowork_session_id).toBe('session-abc')
  })

  it('should emit change event on config save', async () => {
    const { ImGatewayManager } = await import('../../../src/main/im/im-gateway-manager')
    const manager = new ImGatewayManager(db)
    let changed = false
    manager.on('change', () => {
      changed = true
    })
    manager.savePlatformConfig('telegram', {
      enabled: true,
      dmPolicy: 'open',
      groupPolicy: 'disabled',
      allowFrom: [],
      debug: false
    })
    expect(changed).toBe(true)
  })

  it('should return agent for platform binding', async () => {
    const { ImGatewayManager } = await import('../../../src/main/im/im-gateway-manager')
    const manager = new ImGatewayManager(db)
    manager.saveSettings({
      systemPrompt: '',
      skillsEnabled: true,
      platformAgentBindings: { telegram: 'news-agent' }
    })
    expect(manager.getAgentForPlatform('telegram')).toBe('news-agent')
    expect(manager.getAgentForPlatform('dingtalk')).toBe('main') // 默认 main
  })
})
