// tests/main/im/im-gateway-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

import { initDatabase } from '../../../src/main/data/db'
import { ImGatewayManager } from '../../../src/main/im/im-gateway-manager'

describe('ImGatewayManager', () => {
  let db: Database.Database
  let manager: ImGatewayManager

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    manager = new ImGatewayManager(db)
  })

  afterEach(() => db.close())

  describe('instance CRUD', () => {
    it('should create and retrieve an instance', () => {
      const inst = manager.createInstance('dingtalk', { appKey: 'abc' }, 'Test DingTalk')
      expect(inst.platform).toBe('dingtalk')
      expect(inst.name).toBe('Test DingTalk')
      expect(inst.enabled).toBe(true)
      expect(inst.credentials).toEqual({ appKey: 'abc' })
    })

    it('should list all instances', () => {
      manager.createInstance('dingtalk', { appKey: 'a' })
      manager.createInstance('feishu', { appKey: 'b' })
      expect(manager.listInstances()).toHaveLength(2)
    })

    it('should update instance fields', () => {
      const inst = manager.createInstance('dingtalk', { appKey: 'a' })
      manager.updateInstance(inst.id, { name: 'Updated', enabled: false })
      const updated = manager.getInstance(inst.id)
      expect(updated?.name).toBe('Updated')
      expect(updated?.enabled).toBe(false)
    })

    it('should delete instance', () => {
      const inst = manager.createInstance('dingtalk', { appKey: 'a' })
      manager.deleteInstance(inst.id)
      expect(manager.getInstance(inst.id)).toBeNull()
    })

    it('should emit change on create/update/delete', () => {
      let changes = 0
      manager.on('change', () => {
        changes++
      })
      const inst = manager.createInstance('dingtalk', {})
      manager.updateInstance(inst.id, { name: 'x' })
      manager.deleteInstance(inst.id)
      expect(changes).toBe(3)
    })
  })

  describe('conversation binding', () => {
    it('should set and get a binding', () => {
      const inst = manager.createInstance('dingtalk', {})
      manager.setConversationBinding('conv-1', inst.id, 'group', '/tmp/proj', 'ws-abc')
      const binding = manager.getConversationBinding('conv-1', inst.id)
      expect(binding?.directoryPath).toBe('/tmp/proj')
      expect(binding?.agentId).toBe('ws-abc')
    })

    it('should remove a binding', () => {
      const inst = manager.createInstance('dingtalk', {})
      manager.setConversationBinding('conv-1', inst.id, 'dm', '/tmp', 'ws-x')
      manager.removeConversationBinding('conv-1', inst.id)
      expect(manager.getConversationBinding('conv-1', inst.id)).toBeNull()
    })
  })

  describe('resolveAgent', () => {
    it('should return binding agent when conversation binding exists (Tier 1)', () => {
      const inst = manager.createInstance('dingtalk', {})
      manager.updateInstance(inst.id, { directoryPath: '/default', agentId: 'ws-default' })
      manager.setConversationBinding('conv-1', inst.id, 'group', '/override', 'ws-override')
      const result = manager.resolveAgent(inst.id, 'conv-1')
      expect(result.agentId).toBe('ws-override')
      expect(result.directoryPath).toBe('/override')
    })

    it('should return instance default when no binding (Tier 6)', () => {
      const inst = manager.createInstance('dingtalk', {})
      manager.updateInstance(inst.id, { directoryPath: '/proj', agentId: 'ws-proj' })
      const result = manager.resolveAgent(inst.id, 'unknown-conv')
      expect(result.agentId).toBe('ws-proj')
    })

    it('should fallback to main when no binding and no instance default', () => {
      const inst = manager.createInstance('dingtalk', {})
      const result = manager.resolveAgent(inst.id, 'conv-1')
      expect(result.agentId).toBe('main')
      expect(result.directoryPath).toBeNull()
    })
  })

  describe('session mapping', () => {
    it('should upsert and get a session mapping', () => {
      const inst = manager.createInstance('dingtalk', {})
      // 需要先创建 session 以满足外键约束
      const now = Date.now()
      db.prepare(
        'INSERT INTO sessions (id, title, directory_path, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('sess-1', 'Test', '/tmp', 'main', now, now)
      manager.upsertSessionMapping('conv-1', inst.id, 'sess-1', 'main')
      const mapping = manager.getSessionMapping('conv-1', inst.id)
      expect(mapping?.session_id).toBe('sess-1')
    })
  })

  describe('toOpenclawConfig', () => {
    it('should only export enabled instances', () => {
      const inst1 = manager.createInstance('dingtalk', { appKey: 'a' }, 'Enabled')
      const inst2 = manager.createInstance('feishu', { appKey: 'b' }, 'Disabled')
      manager.updateInstance(inst2.id, { enabled: false })
      const config = manager.toOpenclawConfig()
      expect(Object.keys(config)).toHaveLength(1)
      expect(config[`dingtalk:${inst1.id}`]).toBeDefined()
    })
  })
})
