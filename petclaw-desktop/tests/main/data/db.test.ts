import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase, saveMessage, getMessages } from '../../../src/main/data/db'

describe('Database', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('messages', () => {
    it('saves and retrieves a message', () => {
      saveMessage(db, { role: 'user', content: 'hello' })
      const messages = getMessages(db, 10)
      expect(messages).toHaveLength(1)
      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('hello')
    })

    it('returns messages in chronological order', () => {
      saveMessage(db, { role: 'user', content: 'first' })
      saveMessage(db, { role: 'assistant', content: 'second' })
      const messages = getMessages(db, 10)
      expect(messages[0].content).toBe('first')
      expect(messages[1].content).toBe('second')
    })

    it('respects limit parameter', () => {
      saveMessage(db, { role: 'user', content: 'a' })
      saveMessage(db, { role: 'user', content: 'b' })
      saveMessage(db, { role: 'user', content: 'c' })
      const messages = getMessages(db, 2)
      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe('b')
      expect(messages[1].content).toBe('c')
    })
  })
})
