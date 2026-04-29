import { describe, it, expect } from 'vitest'
import {
  truncateForLog,
  serializeForLog,
  serializeToolContentForLog,
  getToolTextPreview,
  looksLikeTransportErrorText
} from '../../../src/main/mcp/mcp-log'

describe('mcp-log', () => {
  describe('truncateForLog', () => {
    it('短文本不截断', () => {
      expect(truncateForLog('hello', 100)).toBe('hello')
    })

    it('超长文本截断并加省略号', () => {
      const long = 'a'.repeat(500)
      const result = truncateForLog(long, 100)
      expect(result.length).toBeLessThanOrEqual(101) // 100 + '…'
      expect(result.endsWith('…')).toBe(true)
    })
  })

  describe('serializeForLog', () => {
    it('序列化简单对象', () => {
      expect(serializeForLog({ key: 'value' })).toBe('{"key":"value"}')
    })

    it('脱敏 api_key 字段', () => {
      const result = serializeForLog({ api_key: 'sk-secret-123' })
      expect(result).toContain('[redacted]')
      expect(result).not.toContain('sk-secret-123')
    })

    it('脱敏 token 字段', () => {
      const result = serializeForLog({ token: 'my-token' })
      expect(result).toContain('[redacted]')
    })

    it('脱敏 authorization 字段', () => {
      const result = serializeForLog({ authorization: 'Bearer xxx' })
      expect(result).toContain('[redacted]')
    })

    it('处理循环引用', () => {
      const obj: Record<string, unknown> = { name: 'test' }
      obj.self = obj
      const result = serializeForLog(obj)
      expect(result).toContain('[circular]')
    })

    it('截断超长数组', () => {
      const arr = Array.from({ length: 20 }, (_, i) => i)
      const result = serializeForLog(arr)
      expect(result).toContain('__truncatedItems')
    })

    it('截断超长对象', () => {
      const obj: Record<string, number> = {}
      for (let i = 0; i < 30; i++) {
        obj[`key${i}`] = i
      }
      const result = serializeForLog(obj)
      expect(result).toContain('__truncatedKeys')
    })
  })

  describe('serializeToolContentForLog', () => {
    it('序列化 tool content 数组', () => {
      const content = [{ type: 'text', text: 'hello world' }]
      const result = serializeToolContentForLog(content)
      expect(result).toContain('hello world')
    })
  })

  describe('getToolTextPreview', () => {
    it('提取 text block 内容', () => {
      const content = [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' }
      ]
      expect(getToolTextPreview(content)).toBe('first second')
    })

    it('忽略非 text block', () => {
      const content = [
        { type: 'image', data: 'base64...' },
        { type: 'text', text: 'only text' }
      ]
      expect(getToolTextPreview(content)).toBe('only text')
    })

    it('空 content 返回空字符串', () => {
      expect(getToolTextPreview([])).toBe('')
    })
  })

  describe('looksLikeTransportErrorText', () => {
    it('ECONNREFUSED 识别为传输错误', () => {
      expect(looksLikeTransportErrorText('connect ECONNREFUSED 127.0.0.1:3000')).toBe(true)
    })

    it('ENOTFOUND 识别为传输错误', () => {
      expect(looksLikeTransportErrorText('getaddrinfo ENOTFOUND example.com')).toBe(true)
    })

    it('ETIMEDOUT 识别为传输错误', () => {
      expect(looksLikeTransportErrorText('connect ETIMEDOUT')).toBe(true)
    })

    it('fetch failed 识别为传输错误', () => {
      expect(looksLikeTransportErrorText('fetch failed')).toBe(true)
    })

    it('socket hang up 识别为传输错误', () => {
      expect(looksLikeTransportErrorText('socket hang up')).toBe(true)
    })

    it('certificate 识别为传输错误', () => {
      expect(looksLikeTransportErrorText('unable to verify the first certificate')).toBe(true)
    })

    it('正常业务错误不识别为传输错误', () => {
      expect(looksLikeTransportErrorText('Invalid argument: foo must be a string')).toBe(false)
    })

    it('空字符串返回 false', () => {
      expect(looksLikeTransportErrorText('')).toBe(false)
      expect(looksLikeTransportErrorText('   ')).toBe(false)
    })
  })
})
