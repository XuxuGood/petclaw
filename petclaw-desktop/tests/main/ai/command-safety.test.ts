import { describe, it, expect } from 'vitest'
import { isDeleteCommand, getCommandDangerLevel } from '../../../src/main/ai/command-safety'

describe('command-safety', () => {
  describe('isDeleteCommand', () => {
    it('rm 命令识别为删除', () => {
      expect(isDeleteCommand('rm file.txt')).toBe(true)
      expect(isDeleteCommand('rm -rf /tmp/test')).toBe(true)
    })

    it('rmdir 命令识别为删除', () => {
      expect(isDeleteCommand('rmdir mydir')).toBe(true)
    })

    it('find -delete 识别为删除', () => {
      expect(isDeleteCommand('find . -name "*.tmp" -delete')).toBe(true)
    })

    it('git clean 识别为删除', () => {
      expect(isDeleteCommand('git clean -fd')).toBe(true)
    })

    it('安全命令不识别为删除', () => {
      expect(isDeleteCommand('ls -la')).toBe(false)
      expect(isDeleteCommand('cat file.txt')).toBe(false)
      expect(isDeleteCommand('git push')).toBe(false)
      expect(isDeleteCommand('echo hello')).toBe(false)
    })
  })

  describe('getCommandDangerLevel', () => {
    it('rm -rf 返回 destructive', () => {
      const result = getCommandDangerLevel('rm -rf /tmp/test')
      expect(result.level).toBe('destructive')
      expect(result.reason).toBe('recursive-delete')
    })

    it('git push --force 返回 destructive', () => {
      const result = getCommandDangerLevel('git push --force origin main')
      expect(result.level).toBe('destructive')
      expect(result.reason).toBe('git-force-push')
    })

    it('git reset --hard 返回 destructive', () => {
      const result = getCommandDangerLevel('git reset --hard HEAD~1')
      expect(result.level).toBe('destructive')
      expect(result.reason).toBe('git-reset-hard')
    })

    it('rm file.txt 返回 caution（非递归删除）', () => {
      const result = getCommandDangerLevel('rm file.txt')
      expect(result.level).toBe('caution')
      expect(result.reason).toBe('file-delete')
    })

    it('git push 返回 caution', () => {
      const result = getCommandDangerLevel('git push origin main')
      expect(result.level).toBe('caution')
      expect(result.reason).toBe('git-push')
    })

    it('kill 返回 caution', () => {
      const result = getCommandDangerLevel('kill -9 1234')
      expect(result.level).toBe('caution')
      expect(result.reason).toBe('process-kill')
    })

    it('chmod 返回 caution', () => {
      const result = getCommandDangerLevel('chmod 777 /tmp/file')
      expect(result.level).toBe('caution')
      expect(result.reason).toBe('permission-change')
    })

    it('安全命令返回 safe', () => {
      const result = getCommandDangerLevel('ls -la')
      expect(result.level).toBe('safe')
      expect(result.reason).toBe('')
    })

    it('echo 返回 safe', () => {
      const result = getCommandDangerLevel('echo hello > file.txt')
      expect(result.level).toBe('safe')
      expect(result.reason).toBe('')
    })
  })
})
