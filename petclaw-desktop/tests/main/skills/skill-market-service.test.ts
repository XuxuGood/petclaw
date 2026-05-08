import { describe, it, expect } from 'vitest'
import path from 'path'
import { SkillMarketService } from '../../../src/main/skills/skill-market-service'

describe('SkillMarketService bundled metadata', () => {
  it('loads bundled examples for skill-creator metadata', () => {
    const service = new SkillMarketService({
      cacheDir: path.join(process.cwd(), '.tmp-skill-market-cache'),
      metadataRoot: path.resolve(process.cwd(), 'skills-market'),
      sources: []
    })

    const examples = service.loadBundledExamples('skill-creator')

    expect(examples).toHaveLength(4)
    expect(examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'code-review-skill',
          title: { zh: '代码审查技能', en: 'Code review skill' },
          description: {
            zh: '创建一个能按项目规范做代码审查的技能。',
            en: 'Create a skill that reviews code against project conventions.'
          },
          prompt: {
            zh: expect.stringContaining('审查代码改动'),
            en: expect.stringContaining('reviewing code changes')
          }
        }),
        expect.objectContaining({ id: 'commit-message-skill' }),
        expect.objectContaining({ id: 'document-processing-skill' }),
        expect.objectContaining({ id: 'extract-from-conversation' })
      ])
    )
  })
})
