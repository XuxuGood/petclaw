// tests/main/ai/directory-manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

import { initDatabase } from '../../../src/main/data/db'
import { DirectoryManager } from '../../../src/main/ai/directory-manager'

describe('DirectoryManager', () => {
  let db: Database.Database
  let dm: DirectoryManager

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    dm = new DirectoryManager(db, '/default/workspace')
  })

  describe('ensureRegistered', () => {
    it('should register a new directory and return it', () => {
      const dir = dm.ensureRegistered('/tmp/my-project')
      expect(dir.path).toBe('/tmp/my-project')
      expect(dir.agentId).toMatch(/^ws-[0-9a-f]{12}$/)
      expect(dir.modelOverride).toBe('')
      expect(dir.skillIds).toEqual([])
    })

    it('should be idempotent', () => {
      const dir1 = dm.ensureRegistered('/tmp/my-project')
      const dir2 = dm.ensureRegistered('/tmp/my-project')
      expect(dir1.agentId).toBe(dir2.agentId)
    })

    it('should emit change on first registration', () => {
      let changed = false
      dm.on('change', () => {
        changed = true
      })
      dm.ensureRegistered('/tmp/new-project')
      expect(changed).toBe(true)
    })

    it('should not emit change on re-registration', () => {
      dm.ensureRegistered('/tmp/project')
      let changed = false
      dm.on('change', () => {
        changed = true
      })
      dm.ensureRegistered('/tmp/project')
      expect(changed).toBe(false)
    })
  })

  describe('get / getByPath / list', () => {
    it('should get by agentId', () => {
      const dir = dm.ensureRegistered('/tmp/proj')
      expect(dm.get(dir.agentId)?.path).toBe('/tmp/proj')
    })

    it('should get by path', () => {
      dm.ensureRegistered('/tmp/proj')
      expect(dm.getByPath('/tmp/proj')?.agentId).toMatch(/^ws-/)
    })

    it('should list all directories', () => {
      dm.ensureRegistered('/tmp/a')
      dm.ensureRegistered('/tmp/b')
      expect(dm.list()).toHaveLength(2)
    })
  })

  describe('updateName / updateModelOverride / updateSkillIds', () => {
    it('should update name', () => {
      const dir = dm.ensureRegistered('/tmp/proj')
      dm.updateName(dir.agentId, 'My Project')
      expect(dm.get(dir.agentId)?.name).toBe('My Project')
    })

    it('should update model override', () => {
      const dir = dm.ensureRegistered('/tmp/proj')
      dm.updateModelOverride(dir.agentId, 'gpt-4o')
      expect(dm.get(dir.agentId)?.modelOverride).toBe('gpt-4o')
    })

    it('should update skill ids', () => {
      const dir = dm.ensureRegistered('/tmp/proj')
      dm.updateSkillIds(dir.agentId, ['deep-research', 'docx'])
      expect(dm.get(dir.agentId)?.skillIds).toEqual(['deep-research', 'docx'])
    })
  })

  describe('toOpenclawConfig', () => {
    it('should generate config with main default and directory agents', () => {
      dm.ensureRegistered('/tmp/proj-a')
      const config = dm.toOpenclawConfig()
      expect(config.defaults.workspace).toBe('/default/workspace')
      expect(config.list[0]).toEqual({ id: 'main', default: true })
      expect(config.list).toHaveLength(2) // main + proj-a
      expect(config.list[1].id).toMatch(/^ws-/)
      expect(config.list[1].workspace).toBe('/tmp/proj-a')
    })

    it('should include model override in agent config', () => {
      const dir = dm.ensureRegistered('/tmp/proj')
      dm.updateModelOverride(dir.agentId, 'gpt-4o')
      const config = dm.toOpenclawConfig()
      const agent = config.list.find((a: { id: string }) => a.id === dir.agentId)
      expect(agent?.model).toEqual({ primary: 'gpt-4o' })
    })
  })
})
