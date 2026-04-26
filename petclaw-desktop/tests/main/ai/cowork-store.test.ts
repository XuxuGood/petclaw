import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

import { CoworkStore } from '../../../src/main/ai/cowork-store'
import { initDatabase } from '../../../src/main/data/db'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  initDatabase(db)
  return db
}

describe('CoworkStore', () => {
  let db: Database.Database
  let store: CoworkStore

  beforeEach(() => {
    db = createTestDb()
    store = new CoworkStore(db)
  })

  describe('createSession', () => {
    it('返回完整 CoworkSession 对象', () => {
      const session = store.createSession('测试会话', '/workspace/test', 'agent-1')
      expect(session.id).toBeTruthy()
      expect(session.title).toBe('测试会话')
      expect(session.directoryPath).toBe('/workspace/test')
      expect(session.agentId).toBe('agent-1')
      expect(session.status).toBe('idle')
      expect(session.pinned).toBe(false)
      expect(session.claudeSessionId).toBeNull()
      expect(session.modelOverride).toBe('')
      expect(session.messages).toEqual([])
      expect(typeof session.createdAt).toBe('number')
      expect(typeof session.updatedAt).toBe('number')
    })
  })

  describe('getSession', () => {
    it('包含 messages 数组', () => {
      const session = store.createSession('测试', '/workspace', 'agent-1')
      store.addMessage(session.id, 'user', '你好')
      store.addMessage(session.id, 'assistant', '你好！')

      const fetched = store.getSession(session.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.messages).toHaveLength(2)
      expect(fetched!.messages[0].content).toBe('你好')
      expect(fetched!.messages[1].content).toBe('你好！')
    })

    it('不存在时返回 null', () => {
      expect(store.getSession('non-existent-id')).toBeNull()
    })
  })

  describe('getSessions', () => {
    it('按 updatedAt 倒序', async () => {
      const s1 = store.createSession('会话1', '/workspace/1', 'a1')
      await new Promise((resolve) => setTimeout(resolve, 10))
      const s2 = store.createSession('会话2', '/workspace/2', 'a2')
      await new Promise((resolve) => setTimeout(resolve, 10))
      const s3 = store.createSession('会话3', '/workspace/3', 'a3')

      const sessions = store.getSessions()
      expect(sessions).toHaveLength(3)
      expect(sessions[0].id).toBe(s3.id)
      expect(sessions[1].id).toBe(s2.id)
      expect(sessions[2].id).toBe(s1.id)
    })

    it('返回空数组当无会话', () => {
      expect(store.getSessions()).toEqual([])
    })
  })

  describe('updateSession', () => {
    it('部分更新字段', () => {
      const session = store.createSession('原标题', '/workspace', 'a1')
      store.updateSession(session.id, { title: '新标题', status: 'running' })

      const updated = store.getSession(session.id)
      expect(updated!.title).toBe('新标题')
      expect(updated!.status).toBe('running')
      expect(updated!.directoryPath).toBe('/workspace')
    })

    it('更新 claudeSessionId', () => {
      const session = store.createSession('会话', '/workspace', 'a1')
      store.updateSession(session.id, { claudeSessionId: 'claude-123' })

      const updated = store.getSession(session.id)
      expect(updated!.claudeSessionId).toBe('claude-123')
    })

    it('空 updates 不报错', () => {
      const session = store.createSession('会话', '/workspace', 'a1')
      expect(() => store.updateSession(session.id, {})).not.toThrow()
    })
  })

  describe('deleteSession', () => {
    it('级联删除 messages', () => {
      const session = store.createSession('会话', '/workspace', 'a1')
      store.addMessage(session.id, 'user', '消息1')
      store.addMessage(session.id, 'assistant', '消息2')

      store.deleteSession(session.id)

      expect(store.getSession(session.id)).toBeNull()
      expect(store.getMessages(session.id)).toEqual([])
    })
  })

  describe('addMessage', () => {
    it('自动生成 id', () => {
      const session = store.createSession('会话', '/workspace', 'a1')
      const msg = store.addMessage(session.id, 'user', '你好')

      expect(msg.id).toBeTruthy()
      expect(typeof msg.id).toBe('string')
      expect(msg.type).toBe('user')
      expect(msg.content).toBe('你好')
      expect(typeof msg.timestamp).toBe('number')
    })

    it('支持 metadata', () => {
      const session = store.createSession('会话', '/workspace', 'a1')
      const metadata = { toolName: 'bash', toolInput: { command: 'ls' } }
      const msg = store.addMessage(session.id, 'tool_use', '执行命令', metadata)

      expect(msg.metadata).toEqual(metadata)
    })

    it('更新 session 的 updated_at', async () => {
      const session = store.createSession('会话', '/workspace', 'a1')
      const originalUpdatedAt = session.updatedAt
      await new Promise((resolve) => setTimeout(resolve, 10))

      store.addMessage(session.id, 'user', '消息')
      const updated = store.getSession(session.id)
      expect(updated!.updatedAt).toBeGreaterThan(originalUpdatedAt)
    })
  })

  describe('updateMessageContent', () => {
    it('更新内容', () => {
      const session = store.createSession('会话', '/workspace', 'a1')
      const msg = store.addMessage(session.id, 'assistant', '原始内容')

      store.updateMessageContent(msg.id, '更新后内容')

      const messages = store.getMessages(session.id)
      expect(messages[0].content).toBe('更新后内容')
    })
  })

  describe('getMessages', () => {
    it('按 timestamp 正序', async () => {
      const session = store.createSession('会话', '/workspace', 'a1')
      store.addMessage(session.id, 'user', '第一条')
      await new Promise((resolve) => setTimeout(resolve, 10))
      store.addMessage(session.id, 'assistant', '第二条')
      await new Promise((resolve) => setTimeout(resolve, 10))
      store.addMessage(session.id, 'user', '第三条')

      const messages = store.getMessages(session.id)
      expect(messages).toHaveLength(3)
      expect(messages[0].content).toBe('第一条')
      expect(messages[1].content).toBe('第二条')
      expect(messages[2].content).toBe('第三条')
      expect(messages[0].timestamp).toBeLessThanOrEqual(messages[1].timestamp)
      expect(messages[1].timestamp).toBeLessThanOrEqual(messages[2].timestamp)
    })

    it('无消息返回空数组', () => {
      const session = store.createSession('会话', '/workspace', 'a1')
      expect(store.getMessages(session.id)).toEqual([])
    })
  })

  describe('resetRunningSessions', () => {
    it('running → idle', () => {
      const s1 = store.createSession('会话1', '/workspace/1', 'a1')
      const s2 = store.createSession('会话2', '/workspace/2', 'a2')
      const s3 = store.createSession('会话3', '/workspace/3', 'a3')

      store.updateSession(s1.id, { status: 'running' })
      store.updateSession(s2.id, { status: 'running' })
      store.updateSession(s3.id, { status: 'completed' })

      store.resetRunningSessions()

      expect(store.getSession(s1.id)!.status).toBe('idle')
      expect(store.getSession(s2.id)!.status).toBe('idle')
      expect(store.getSession(s3.id)!.status).toBe('completed')
    })
  })

  describe('getRecentDirectories', () => {
    it('去重 + 限制数量', async () => {
      store.createSession('会话1', '/workspace/a', 'a1')
      await new Promise((resolve) => setTimeout(resolve, 5))
      store.createSession('会话2', '/workspace/b', 'a2')
      await new Promise((resolve) => setTimeout(resolve, 5))
      store.createSession('会话3', '/workspace/a', 'a1') // 重复路径
      await new Promise((resolve) => setTimeout(resolve, 5))
      store.createSession('会话4', '/workspace/c', 'a3')
      await new Promise((resolve) => setTimeout(resolve, 5))
      store.createSession('会话5', '/workspace/d', 'a4')

      const dirs = store.getRecentDirectories(3)
      expect(dirs).toHaveLength(3)
      // 去重后应包含不重复路径
      const unique = new Set(dirs)
      expect(unique.size).toBe(3)
    })

    it('默认限制 8 个', () => {
      for (let i = 0; i < 10; i++) {
        store.createSession(`会话${i}`, `/workspace/dir${i}`, `a${i}`)
      }
      const dirs = store.getRecentDirectories()
      expect(dirs.length).toBeLessThanOrEqual(8)
    })
  })
})
