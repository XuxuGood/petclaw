import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SkillMarketService } from '../../../src/main/skills/skill-market-service'
import type { SkillMarketResponse } from '../../../src/main/skills/skill-types'

const updatedAt = 1778076273994

const marketResponse: SkillMarketResponse = {
  version: 1,
  updatedAt,
  marketSkills: [
    {
      id: 'deep-research',
      slug: 'deep-research',
      name: { zh: '深度研究', en: 'Deep Research' },
      description: { zh: '研究助手', en: 'Research assistant' },
      version: '1.0.0',
      tags: ['research'],
      source: { id: 'official', name: 'PetClaw 官方' },
      package: { type: 'zip', url: 'https://example.com/deep-research.zip' }
    }
  ]
}

describe('SkillMarketService', () => {
  let tmpDir: string
  let cacheDir: string
  let metadataRoot: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-market-'))
    cacheDir = path.join(tmpDir, 'Cache', 'skills')
    metadataRoot = path.join(tmpDir, 'skills-market')
    fs.mkdirSync(metadataRoot, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('validates endpoint responses and writes flattened skills cache', async () => {
    const service = new SkillMarketService({
      cacheDir,
      metadataRoot,
      sources: [{ id: 'official', name: 'PetClaw 官方', endpoint: 'https://example.com/skills' }],
      fetchJson: async () => marketResponse,
      now: () => updatedAt + 1
    })

    const result = await service.listMarketplace({ refresh: true })

    expect(result.fromCache).toBe(false)
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0].slug).toBe('deep-research')
    const cached = JSON.parse(fs.readFileSync(path.join(cacheDir, 'skills.json'), 'utf8')) as {
      version: number
      lastFetch: number
      skills: unknown[]
      sourceErrors: unknown[]
    }
    expect(cached).toMatchObject({ version: 1, lastFetch: updatedAt + 1, sourceErrors: [] })
    expect(cached.skills).toHaveLength(1)
  })

  it('rejects invalid endpoint responses without losing valid sources', async () => {
    const service = new SkillMarketService({
      cacheDir,
      metadataRoot,
      sources: [
        { id: 'broken', name: 'Broken', endpoint: 'https://broken.example/skills' },
        { id: 'official', name: 'PetClaw 官方', endpoint: 'https://official.example/skills' }
      ],
      fetchJson: async (endpoint) => {
        if (endpoint.includes('broken')) return { version: 2, marketSkills: [] }
        return marketResponse
      }
    })

    const result = await service.listMarketplace({ refresh: true })

    expect(result.skills.map((skill) => skill.slug)).toEqual(['deep-research'])
    expect(result.sourceErrors).toEqual([
      { sourceId: 'broken', message: 'Invalid skill market response' }
    ])
  })

  it('uses official source first when multiple sources return the same normalized slug', async () => {
    const calls: string[] = []
    const service = new SkillMarketService({
      cacheDir,
      metadataRoot,
      sources: [
        { id: 'community', name: 'Community', endpoint: 'https://community.example/skills' },
        { id: 'petclaw-official', name: 'PetClaw 官方', endpoint: 'https://official.example/skills' }
      ],
      fetchJson: async (endpoint) => {
        calls.push(endpoint)
        return {
          ...marketResponse,
          marketSkills: [
            {
              ...marketResponse.marketSkills[0],
              source: {
                id: endpoint.includes('official') ? 'petclaw-official' : 'community',
                name: endpoint.includes('official') ? 'PetClaw 官方' : 'Community'
              },
              slug: endpoint.includes('official') ? 'Deep-Research' : 'deep-research',
              version: endpoint.includes('official') ? '1.0.0' : '2.0.0'
            }
          ]
        }
      }
    })

    const result = await service.listMarketplace({ refresh: true })

    expect(calls).toEqual(['https://official.example/skills', 'https://community.example/skills'])
    expect(calls).toHaveLength(2)
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0].slug).toBe('deep-research')
    expect(result.skills[0].source.id).toBe('petclaw-official')
    expect(result.skills[0].version).toBe('1.0.0')
    expect(result.sourceConflicts).toEqual([
      { slug: 'deep-research', keptSourceId: 'petclaw-official', droppedSourceId: 'community' }
    ])
  })

  it('falls back to disk cache when every endpoint fails', async () => {
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(
      path.join(cacheDir, 'skills.json'),
      JSON.stringify({
        version: 1,
        lastFetch: 100,
        skills: marketResponse.marketSkills,
        sourceErrors: []
      })
    )

    const service = new SkillMarketService({
      cacheDir,
      metadataRoot,
      sources: [{ id: 'official', name: 'PetClaw 官方', endpoint: 'https://example.com/skills' }],
      fetchJson: async () => {
        throw new Error('offline')
      }
    })

    const result = await service.listMarketplace({ refresh: true })

    expect(result.fromCache).toBe(true)
    expect(result.skills[0].slug).toBe('deep-research')
    expect(result.sourceErrors).toEqual([{ sourceId: 'official', message: 'offline' }])
  })

  it('loads valid examples from .skill-metadata.yaml and ignores invalid entries', () => {
    const skillDir = path.join(metadataRoot, 'deep-research')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, '.skill-metadata.yaml'),
      [
        'examples:',
        '  - id: literature-review',
        '    title:',
        '      zh: 学术文献综述',
        '      en: Literature review',
        '    description:',
        '      zh: 综合学术资料',
        '      en: Synthesize academic sources',
        '    prompt:',
        '      zh: |-',
        '        请帮我做文献综述。',
        '      en: |-',
        '        Please help me write a literature review.',
        '  - id: missing-prompt'
      ].join('\n')
    )

    const service = new SkillMarketService({ cacheDir, metadataRoot, sources: [] })

    expect(service.loadBundledExamples('missing')).toEqual([])
    expect(service.loadBundledExamples('deep-research')).toEqual([
      {
        id: 'literature-review',
        title: { zh: '学术文献综述', en: 'Literature review' },
        description: { zh: '综合学术资料', en: 'Synthesize academic sources' },
        prompt: {
          zh: '请帮我做文献综述。',
          en: 'Please help me write a literature review.'
        }
      }
    ])
    expect(service.loadBundledExamples('../deep-research')).toEqual([])
  })

  it('loads bundled examples for skill-creator metadata', () => {
    const bundledMetadataRoot = path.resolve(process.cwd(), 'skills-market')

    const service = new SkillMarketService({
      cacheDir,
      metadataRoot: bundledMetadataRoot,
      sources: []
    })

    expect(service.loadBundledExamples('skill-creator')).toEqual(
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

  it('uses five minute memory cache when refresh is false', async () => {
    let callCount = 0
    let currentTime = 1000
    const service = new SkillMarketService({
      cacheDir,
      metadataRoot,
      sources: [{ id: 'official', name: 'PetClaw 官方', endpoint: 'https://example.com/skills' }],
      fetchJson: async () => {
        callCount += 1
        return marketResponse
      },
      now: () => currentTime
    })

    await service.listMarketplace({ refresh: true })
    currentTime += 60_000
    const cached = await service.listMarketplace({ refresh: false })
    currentTime += 60_000
    const refreshed = await service.listMarketplace({ refresh: true })

    expect(cached.skills[0].slug).toBe('deep-research')
    expect(refreshed.skills[0].slug).toBe('deep-research')
    expect(callCount).toBe(2)
  })

  it('filters removed skills and ignores invalid skills', async () => {
    const service = new SkillMarketService({
      cacheDir,
      metadataRoot,
      sources: [{ id: 'official', name: 'PetClaw 官方', endpoint: 'https://example.com/skills' }],
      fetchJson: async () => ({
        version: 1,
        updatedAt,
        marketSkills: [
          { ...marketResponse.marketSkills[0], status: 'removed' },
          { ...marketResponse.marketSkills[0], id: 'active', slug: 'active' },
          { ...marketResponse.marketSkills[0], id: 'unsafe', slug: '../unsafe' },
          { id: 'invalid-skill', slug: 'invalid-skill' }
        ]
      })
    })

    const result = await service.listMarketplace({ refresh: true })

    expect(result.skills.map((skill) => skill.slug)).toEqual(['active'])
  })

  it('tests a single market source endpoint without writing marketplace cache', async () => {
    const service = new SkillMarketService({
      cacheDir,
      metadataRoot,
      sources: [],
      fetchJson: async () => marketResponse
    })

    const result = await service.testSource({
      id: 'custom-1',
      name: 'Community',
      endpoint: 'https://community.example/skills.json',
      enabled: true
    })

    expect(result).toEqual({ ok: true, skillCount: 1, updatedAt })
    expect(fs.existsSync(path.join(cacheDir, 'skills.json'))).toBe(false)
  })

  it('reports invalid market source test responses', async () => {
    const service = new SkillMarketService({
      cacheDir,
      metadataRoot,
      sources: [],
      fetchJson: async () => ({ version: 2, marketSkills: [] })
    })

    const result = await service.testSource({
      id: 'custom-1',
      name: 'Community',
      endpoint: 'https://community.example/skills.json',
      enabled: true
    })

    expect(result).toEqual({ ok: false, error: 'Invalid skill market response' })
  })
})
