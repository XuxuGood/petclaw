import { describe, it, expect } from 'vitest'
import os from 'os'

import {
  buildLocalTimeContext,
  buildSkillCreationPrompt,
  buildScheduledTaskPrompt,
  buildManagedSections,
  MANAGED_MARKER,
  readAgentsTemplate,
  MANAGED_WEB_SEARCH_POLICY,
  MANAGED_EXEC_SAFETY,
  MANAGED_MEMORY_POLICY
} from '../../../src/main/ai/managed-prompts'

describe('managed-prompts', () => {
  describe('buildLocalTimeContext', () => {
    it('should contain current datetime and timezone', () => {
      const now = new Date('2026-04-26T10:30:00+08:00')
      const result = buildLocalTimeContext(now)

      expect(result).toContain('## Local Time Context')
      expect(result).toContain('2026-04-26')
      expect(result).toContain(String(now.getTime()))
      expect(result).toContain('cron.add')
    })

    it('should produce valid UTC offset format', () => {
      const result = buildLocalTimeContext(new Date())
      // 匹配 UTC+HH:MM 或 UTC-HH:MM 格式
      expect(result).toMatch(/UTC[+-]\d{2}:\d{2}/)
    })
  })

  describe('buildSkillCreationPrompt', () => {
    it('should include skill dir path', () => {
      const result = buildSkillCreationPrompt(
        '/Users/test/Library/Application Support/PetClaw/skills'
      )
      expect(result).toContain('## Skill Creation')
      expect(result).toContain('skills')
      expect(result).toContain('SKILL.md')
    })

    it('should compact home directory to ~', () => {
      const home = os.homedir()
      const result = buildSkillCreationPrompt(`${home}/Library/Application Support/PetClaw/skills`)
      expect(result).toContain('~/Library/Application Support/PetClaw/skills')
      expect(result).not.toContain(home)
    })
  })

  describe('buildScheduledTaskPrompt', () => {
    it('should contain cron usage instructions', () => {
      const result = buildScheduledTaskPrompt()
      expect(result).toContain('## Scheduled Tasks')
      expect(result).toContain('cron.add')
      expect(result).toContain('sessionTarget')
    })
  })

  describe('buildManagedSections', () => {
    it('should return all AGENTS.md managed sections including scheduled task prompt', () => {
      const sections = buildManagedSections('/tmp/skills')
      expect(sections).toHaveLength(5)
      expect(sections.join('\n\n')).toContain('## Scheduled Tasks')
    })
  })

  describe('constants', () => {
    it('MANAGED_MARKER should be an HTML comment', () => {
      expect(MANAGED_MARKER).toContain('<!--')
      expect(MANAGED_MARKER).toContain('-->')
      expect(MANAGED_MARKER).toContain('PetClaw')
    })

    it('readAgentsTemplate(null) should return fallback template', () => {
      const template = readAgentsTemplate(null)
      expect(template.length).toBeGreaterThan(100)
      expect(template).toContain('# AGENTS.md')
    })

    it('managed prompts should be non-empty', () => {
      expect(MANAGED_WEB_SEARCH_POLICY).toContain('## Web Search')
      expect(MANAGED_EXEC_SAFETY).toContain('## Command Execution')
      expect(MANAGED_MEMORY_POLICY).toContain('## Memory Policy')
    })
  })
})
