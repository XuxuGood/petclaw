import { describe, expect, it } from 'vitest'

import {
  CoworkModelProtocol,
  buildAnthropicMessagesUrl,
  buildGeminiGenerateContentUrl,
  extractApiErrorSnippet,
  extractTextFromAnthropicResponse,
  extractTextFromGeminiResponse,
  normalizeGeminiBaseUrl
} from '../../../src/main/ai/cowork-model-api'

describe('CoworkModelProtocol', () => {
  it('包含正确的协议常量值', () => {
    expect(CoworkModelProtocol.Anthropic).toBe('anthropic')
    expect(CoworkModelProtocol.GeminiNative).toBe('gemini_native')
  })

  it('枚举值唯一', () => {
    const values = Object.values(CoworkModelProtocol)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('buildAnthropicMessagesUrl', () => {
  it('空字符串返回默认路径', () => {
    expect(buildAnthropicMessagesUrl('')).toBe('/v1/messages')
    expect(buildAnthropicMessagesUrl('   ')).toBe('/v1/messages')
  })

  it('已包含完整路径时原样返回', () => {
    expect(buildAnthropicMessagesUrl('https://api.anthropic.com/v1/messages')).toBe(
      'https://api.anthropic.com/v1/messages'
    )
  })

  it('末尾有斜杠时去除后保持幂等', () => {
    expect(buildAnthropicMessagesUrl('https://api.anthropic.com/v1/messages/')).toBe(
      'https://api.anthropic.com/v1/messages'
    )
  })

  it('只有 /v1 时追加 /messages', () => {
    expect(buildAnthropicMessagesUrl('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1/messages'
    )
  })

  it('自定义 base URL 自动追加 /v1/messages', () => {
    expect(buildAnthropicMessagesUrl('https://my-proxy.example.com')).toBe(
      'https://my-proxy.example.com/v1/messages'
    )
  })

  it('去除多余尾部斜杠后追加路径', () => {
    expect(buildAnthropicMessagesUrl('https://my-proxy.example.com///')).toBe(
      'https://my-proxy.example.com/v1/messages'
    )
  })
})

describe('normalizeGeminiBaseUrl', () => {
  it('空字符串返回默认 Gemini 端点', () => {
    expect(normalizeGeminiBaseUrl('')).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(normalizeGeminiBaseUrl('  ')).toBe('https://generativelanguage.googleapis.com/v1beta')
  })

  it('非 googleapis 域名原样返回', () => {
    expect(normalizeGeminiBaseUrl('https://my-gemini-proxy.example.com')).toBe(
      'https://my-gemini-proxy.example.com'
    )
  })

  it('/v1beta 结尾原样返回', () => {
    expect(normalizeGeminiBaseUrl('https://generativelanguage.googleapis.com/v1beta')).toBe(
      'https://generativelanguage.googleapis.com/v1beta'
    )
  })

  it('/v1beta/openai 去掉 /openai 后缀', () => {
    expect(normalizeGeminiBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(
      'https://generativelanguage.googleapis.com/v1beta'
    )
  })

  it('/v1/openai 去掉 /openai 后缀', () => {
    expect(normalizeGeminiBaseUrl('https://generativelanguage.googleapis.com/v1/openai')).toBe(
      'https://generativelanguage.googleapis.com/v1'
    )
  })

  it('/v1 结尾替换为 /v1beta', () => {
    expect(normalizeGeminiBaseUrl('https://generativelanguage.googleapis.com/v1')).toBe(
      'https://generativelanguage.googleapis.com/v1beta'
    )
  })

  it('googleapis 域名但路径不匹配时回退到默认值', () => {
    expect(normalizeGeminiBaseUrl('https://generativelanguage.googleapis.com/unknown')).toBe(
      'https://generativelanguage.googleapis.com/v1beta'
    )
  })
})

describe('buildGeminiGenerateContentUrl', () => {
  it('使用默认端点构建正确 URL', () => {
    expect(buildGeminiGenerateContentUrl('', 'gemini-1.5-pro')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent'
    )
  })

  it('对模型名进行 URL 编码', () => {
    expect(buildGeminiGenerateContentUrl('', 'models/gemini-1.5-pro')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/models%2Fgemini-1.5-pro:generateContent'
    )
  })

  it('自定义 base URL 与模型名组合', () => {
    expect(buildGeminiGenerateContentUrl('https://my-proxy.example.com', 'gemini-pro')).toBe(
      'https://my-proxy.example.com/models/gemini-pro:generateContent'
    )
  })

  it('对带空格的模型名编码', () => {
    const url = buildGeminiGenerateContentUrl('', 'gemini 1.5')
    expect(url).toContain('gemini%201.5')
  })
})

describe('extractApiErrorSnippet', () => {
  it('空字符串返回空串', () => {
    expect(extractApiErrorSnippet('')).toBe('')
    expect(extractApiErrorSnippet('   ')).toBe('')
  })

  it('JSON 中 error 为字符串时提取', () => {
    const json = JSON.stringify({ error: 'Invalid API key' })
    expect(extractApiErrorSnippet(json)).toBe('Invalid API key')
  })

  it('JSON 中 error.message 时提取', () => {
    const json = JSON.stringify({ error: { message: 'Rate limit exceeded', code: 429 } })
    expect(extractApiErrorSnippet(json)).toBe('Rate limit exceeded')
  })

  it('JSON 中顶层 message 时提取', () => {
    const json = JSON.stringify({ message: 'Unauthorized' })
    expect(extractApiErrorSnippet(json)).toBe('Unauthorized')
  })

  it('纯文本非 JSON 时原样返回并压缩空白', () => {
    expect(extractApiErrorSnippet('Error   occurred\n  here')).toBe('Error occurred here')
  })

  it('超过 240 字符时截断', () => {
    const longText = 'x'.repeat(300)
    expect(extractApiErrorSnippet(longText)).toHaveLength(240)
  })

  it('JSON error 超过 240 字符时截断', () => {
    const json = JSON.stringify({ error: 'e'.repeat(300) })
    expect(extractApiErrorSnippet(json)).toHaveLength(240)
  })
})

describe('extractTextFromAnthropicResponse', () => {
  it('非对象返回空串', () => {
    expect(extractTextFromAnthropicResponse(null)).toBe('')
    expect(extractTextFromAnthropicResponse('string')).toBe('')
    expect(extractTextFromAnthropicResponse(42)).toBe('')
  })

  it('content 为 text block 数组时提取文本', () => {
    const payload = {
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' }
      ]
    }
    expect(extractTextFromAnthropicResponse(payload)).toBe('Hello\nWorld')
  })

  it('content 数组中过滤非 text 块', () => {
    const payload = {
      content: [
        { type: 'tool_use', id: 'abc' },
        { type: 'text', text: 'Response' }
      ]
    }
    expect(extractTextFromAnthropicResponse(payload)).toBe('Response')
  })

  it('content 为字符串时直接返回', () => {
    expect(extractTextFromAnthropicResponse({ content: '  Hi  ' })).toBe('Hi')
  })

  it('无 content 时读取 output_text', () => {
    expect(extractTextFromAnthropicResponse({ output_text: '  Result  ' })).toBe('Result')
  })

  it('content 和 output_text 都不存在时返回空串', () => {
    expect(extractTextFromAnthropicResponse({ id: '123' })).toBe('')
  })
})

describe('extractTextFromGeminiResponse', () => {
  it('非对象返回空串', () => {
    expect(extractTextFromGeminiResponse(null)).toBe('')
    expect(extractTextFromGeminiResponse([])).toBe('')
  })

  it('标准 candidates 结构提取文本', () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [{ text: 'Hello from Gemini' }]
          }
        }
      ]
    }
    expect(extractTextFromGeminiResponse(payload)).toBe('Hello from Gemini')
  })

  it('多个 candidate 拼接文本', () => {
    const payload = {
      candidates: [
        { content: { parts: [{ text: 'Part one' }] } },
        { content: { parts: [{ text: 'Part two' }] } }
      ]
    }
    expect(extractTextFromGeminiResponse(payload)).toBe('Part one\nPart two')
  })

  it('顶层 content 字段提取文本', () => {
    const payload = {
      content: { parts: [{ text: 'Direct content' }] }
    }
    expect(extractTextFromGeminiResponse(payload)).toBe('Direct content')
  })

  it('顶层 text 字段回退', () => {
    expect(extractTextFromGeminiResponse({ text: '  plain  ' })).toBe('plain')
  })

  it('无匹配字段返回空串', () => {
    expect(extractTextFromGeminiResponse({ model: 'gemini-pro' })).toBe('')
  })
})
