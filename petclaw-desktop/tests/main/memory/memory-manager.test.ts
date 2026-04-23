// tests/main/memory/memory-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { MemoryManager } from '../../../src/main/memory/memory-manager'

describe('MemoryManager', () => {
  let tmpDir: string
  let manager: MemoryManager

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-memory-'))
    manager = new MemoryManager()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should read empty memory when file does not exist', () => {
    expect(manager.readMemory(tmpDir)).toBe('')
  })

  it('should append and read memory', () => {
    manager.appendMemory(tmpDir, '用户喜欢深色主题')
    manager.appendMemory(tmpDir, '项目使用 TypeScript')
    const content = manager.readMemory(tmpDir)
    expect(content).toContain('用户喜欢深色主题')
    expect(content).toContain('项目使用 TypeScript')
  })

  it('should remove a memory entry', () => {
    manager.appendMemory(tmpDir, 'keep this')
    manager.appendMemory(tmpDir, 'remove this')
    manager.removeMemory(tmpDir, 'remove this')
    const content = manager.readMemory(tmpDir)
    expect(content).toContain('keep this')
    expect(content).not.toContain('remove this')
  })

  it('should search memory', () => {
    manager.appendMemory(tmpDir, '用户喜欢深色主题')
    manager.appendMemory(tmpDir, '项目使用 TypeScript')
    const results = manager.searchMemory(tmpDir, '深色')
    expect(results.length).toBe(1)
    expect(results[0]).toContain('深色主题')
  })

  it('should list entries with line numbers', () => {
    manager.appendMemory(tmpDir, 'entry 1')
    manager.appendMemory(tmpDir, 'entry 2')
    const entries = manager.listEntries(tmpDir)
    expect(entries.length).toBe(2)
    expect(entries[0].text).toContain('entry 1')
  })

  it('should update an entry', () => {
    manager.appendMemory(tmpDir, 'old text')
    manager.updateEntry(tmpDir, 'old text', 'new text')
    const content = manager.readMemory(tmpDir)
    expect(content).not.toContain('old text')
    expect(content).toContain('new text')
  })
})
