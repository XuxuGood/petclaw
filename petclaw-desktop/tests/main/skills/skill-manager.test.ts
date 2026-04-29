import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { initDatabase } from '../../../src/main/data/db'
import { SkillManager } from '../../../src/main/skills/skill-manager'

describe('SkillManager', () => {
  let db: Database.Database
  let tmpDir: string
  let manager: SkillManager

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-skills-'))

    // 创建模拟 Skill 目录
    const skill1 = path.join(tmpDir, 'web-search')
    fs.mkdirSync(skill1)
    fs.writeFileSync(
      path.join(skill1, 'SKILL.md'),
      '---\nname: web-search\ndescription: Search the web\nversion: 1.0.0\n---\nUse web search for current information.\n'
    )

    const skill2 = path.join(tmpDir, 'code-analyzer')
    fs.mkdirSync(skill2)
    fs.writeFileSync(
      path.join(skill2, 'SKILL.md'),
      '---\nname: code-analyzer\ndescription: Analyze code\n---\nAnalyze code structure.\n'
    )

    manager = new SkillManager(db, tmpDir)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should scan skills from directory', async () => {
    const skills = await manager.scan()
    expect(skills.length).toBe(2)
    expect(skills.find((s) => s.id === 'web-search')?.description).toBe('Search the web')
  })

  it('should set enabled state', async () => {
    await manager.scan()
    manager.setEnabled('web-search', false)
    const skills = manager.list()
    expect(skills.find((s) => s.id === 'web-search')?.enabled).toBe(false)
  })

  it('should persist enabled state across scans', async () => {
    await manager.scan()
    manager.setEnabled('web-search', false)
    await manager.scan()
    expect(manager.list().find((s) => s.id === 'web-search')?.enabled).toBe(false)
  })

  it('should emit change on setEnabled', async () => {
    await manager.scan()
    let fired = false
    manager.on('change', () => {
      fired = true
    })
    manager.setEnabled('web-search', false)
    expect(fired).toBe(true)
  })

  it('should generate toOpenclawConfig', async () => {
    await manager.scan()
    manager.setEnabled('code-analyzer', false)
    const config = manager.toOpenclawConfig()
    expect(config.entries['web-search'].enabled).toBe(true)
    expect(config.entries['code-analyzer'].enabled).toBe(false)
    expect(config.load.extraDirs).toContain(tmpDir)
  })

  it('should build selected skill prompt from enabled SKILL.md content', async () => {
    await manager.scan()

    const prompt = manager.buildSelectedSkillPrompt(['web-search'])

    expect(prompt).toContain('## Skill: web-search')
    expect(prompt).toContain(`<location>${path.join(tmpDir, 'web-search', 'SKILL.md')}</location>`)
    expect(prompt).toContain(`<directory>${path.join(tmpDir, 'web-search')}</directory>`)
    expect(prompt).toContain(
      'Resolve relative file references from this skill against <directory>.'
    )
    expect(prompt).toContain('Use web search for current information.')
    expect(prompt).not.toContain('---')
  })

  it('should ignore disabled and unknown skills when building selected skill prompt', async () => {
    await manager.scan()
    manager.setEnabled('web-search', false)

    const prompt = manager.buildSelectedSkillPrompt(['web-search', 'missing'])

    expect(prompt).toBe('')
  })
})
