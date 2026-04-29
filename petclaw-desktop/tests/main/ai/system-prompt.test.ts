import { describe, it, expect } from 'vitest'

import { mergeCoworkSystemPrompt } from '../../../src/main/ai/system-prompt'

describe('mergeCoworkSystemPrompt', () => {
  it('定时任务 prompt 始终在用户 prompt 前面', () => {
    const result = mergeCoworkSystemPrompt({
      userPrompt: 'user'
    })

    expect(result).toContain('## Scheduled Tasks')
    expect(result.indexOf('## Scheduled Tasks')).toBeLessThan(result.indexOf('user'))
    expect(result).toMatch(/\n\nuser$/)
  })

  it('会 trim 用户 prompt', () => {
    const result = mergeCoworkSystemPrompt({ userPrompt: ' user ' })

    expect(result).toContain('## Scheduled Tasks')
    expect(result.indexOf('## Scheduled Tasks')).toBeLessThan(result.indexOf('user'))
    expect(result).toMatch(/\n\nuser$/)
  })

  it('用户 prompt 为空时只返回定时任务 prompt', () => {
    const result = mergeCoworkSystemPrompt({ userPrompt: '' })
    expect(result).toContain('## Scheduled Tasks')
    expect(result).toContain('cron.add')
  })
})
