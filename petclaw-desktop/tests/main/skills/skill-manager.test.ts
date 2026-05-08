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
  let bundledDir: string
  let manager: SkillManager

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-skills-'))
    bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-bundled-skills-'))

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
    fs.rmSync(bundledDir, { recursive: true, force: true })
  })

  it('ships the LobsterAI skill-creator package as the canonical builtin skill', () => {
    const skillsRoot = path.resolve(process.cwd(), 'skills')
    const packageRoot = path.resolve(process.cwd(), 'skills', 'skill-creator')
    const skillMdPath = path.join(packageRoot, 'SKILL.md')
    const licensePath = path.join(packageRoot, 'LICENSE.txt')

    expect(JSON.parse(fs.readFileSync(path.join(skillsRoot, 'skills.config.json'), 'utf8'))).toEqual({
      defaults: {
        'skill-creator': {
          enabled: true,
          origin: 'builtin'
        }
      }
    })

    expect(fs.existsSync(skillMdPath)).toBe(true)
    expect(fs.existsSync(licensePath)).toBe(true)
    expect(fs.existsSync(path.join(packageRoot, 'agents'))).toBe(true)
    expect(fs.existsSync(path.join(packageRoot, 'references'))).toBe(true)
    expect(fs.existsSync(path.join(packageRoot, 'scripts'))).toBe(true)
    expect(fs.existsSync(path.join(packageRoot, 'eval-viewer', 'viewer.html'))).toBe(true)
    expect(fs.existsSync(path.join(packageRoot, 'eval-viewer', 'generate_review.py'))).toBe(true)
    expect(fs.existsSync(path.join(packageRoot, 'assets', 'eval_review.html'))).toBe(true)
    expect(fs.existsSync(path.join(packageRoot, 'scripts', 'package_skill.py'))).toBe(true)
    expect(fs.existsSync(path.join(packageRoot, 'scripts', 'run_eval.py'))).toBe(true)
    expect(fs.existsSync(path.join(packageRoot, 'scripts', 'run_loop.py'))).toBe(true)
    expect(fs.existsSync(path.join(packageRoot, 'references', 'schemas.md'))).toBe(true)
    expect(fs.existsSync(path.join(packageRoot, 'agents', 'analyzer.md'))).toBe(true)
    expect(fs.existsSync(path.join(packageRoot, 'agents', 'comparator.md'))).toBe(true)
    expect(fs.existsSync(path.join(packageRoot, 'agents', 'grader.md'))).toBe(true)
    expect(fs.existsSync(path.resolve(process.cwd(), 'skills', 'create-skill'))).toBe(false)
    expect(fs.existsSync(path.resolve(process.cwd(), 'skills', 'skill-creator123'))).toBe(false)

    const skillMd = fs.readFileSync(skillMdPath, 'utf8')
    expect(skillMd).toContain('name: skill-creator')
    expect(skillMd).toContain('version: 1.0.1')
    expect(skillMd).not.toContain('QoderWork')
    expect(skillMd).not.toContain('.qoderwork')

    const license = fs.readFileSync(licensePath, 'utf8')
    expect(license).toContain('Apache License')
    expect(license).toContain('Version 2.0, January 2004')
    expect(license).toContain('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION')
    expect(license).toContain('END OF TERMS AND CONDITIONS')
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

  it('should copy missing bundled skills into userData skills root', async () => {
    const bundledSkill = path.join(bundledDir, 'docx')
    fs.mkdirSync(bundledSkill, { recursive: true })
    fs.writeFileSync(
      path.join(bundledSkill, 'SKILL.md'),
      '---\nname: docx\ndescription: Edit Word documents\nversion: 1.0.0\n---\nUse docx.\n'
    )
    fs.writeFileSync(
      path.join(bundledDir, 'skills.config.json'),
      JSON.stringify({ defaults: { docx: { enabled: true } } }, null, 2)
    )

    manager.syncBundledSkillsToUserData({ bundledRoot: bundledDir })
    const skills = await manager.scan()

    expect(fs.existsSync(path.join(tmpDir, 'docx', 'SKILL.md'))).toBe(true)
    expect(skills.find((skill) => skill.id === 'docx')?.isBuiltIn).toBe(true)
  })

  it('syncs skill-creator as a builtin skill and preserves bundled resources', async () => {
    const bundledSkill = path.join(bundledDir, 'skill-creator')
    const userRoot = path.join(tmpDir, 'user-skills')
    fs.mkdirSync(path.join(bundledSkill, 'scripts'), { recursive: true })
    fs.writeFileSync(
      path.join(bundledSkill, 'SKILL.md'),
      [
        '---',
        'name: skill-creator',
        'description: Create skills',
        'version: 1.0.1',
        '---',
        'Create PetClaw/OpenClaw skills.'
      ].join('\n')
    )
    fs.writeFileSync(path.join(bundledSkill, 'LICENSE.txt'), 'Apache License\n')
    fs.writeFileSync(path.join(bundledSkill, 'scripts', 'package_skill.py'), 'print("package")\n')
    fs.writeFileSync(
      path.join(bundledDir, 'skills.config.json'),
      JSON.stringify({ defaults: { 'skill-creator': { enabled: true } } }, null, 2)
    )

    manager = new SkillManager(db, userRoot)
    manager.syncBundledSkillsToUserData({ bundledRoot: bundledDir })
    const skills = await manager.scan()

    expect(skills).toContainEqual(
      expect.objectContaining({
        id: 'skill-creator',
        name: 'skill-creator',
        enabled: true,
        isBuiltIn: true,
        version: '1.0.1'
      })
    )
    expect(fs.existsSync(path.join(userRoot, 'skill-creator', 'LICENSE.txt'))).toBe(true)
    expect(fs.existsSync(path.join(userRoot, 'skill-creator', 'scripts', 'package_skill.py'))).toBe(
      true
    )
    expect(
      fs.readFileSync(path.join(userRoot, 'skills.config.json'), 'utf8')
    ).toContain('skill-creator')
    expect(
      db.prepare('SELECT origin, enabled, missing FROM skill_installs WHERE id = ?').get(
        'skill-creator'
      )
    ).toMatchObject({ origin: 'builtin', enabled: 1, missing: 0 })
  })

  it('should skip bundled directories that are not declared in skills config defaults', () => {
    const declaredSkill = path.join(bundledDir, 'docx')
    fs.mkdirSync(declaredSkill, { recursive: true })
    fs.writeFileSync(
      path.join(declaredSkill, 'SKILL.md'),
      '---\nname: docx\ndescription: Edit Word documents\nversion: 1.0.0\n---\nUse docx.\n'
    )

    const straySkill = path.join(bundledDir, 'stray')
    fs.mkdirSync(straySkill, { recursive: true })
    fs.writeFileSync(
      path.join(straySkill, 'SKILL.md'),
      '---\nname: stray\ndescription: Stray skill\nversion: 1.0.0\n---\nDo not sync.\n'
    )
    fs.writeFileSync(
      path.join(bundledDir, 'skills.config.json'),
      JSON.stringify({ defaults: { docx: { enabled: true } } }, null, 2)
    )

    manager.syncBundledSkillsToUserData({ bundledRoot: bundledDir })

    expect(fs.existsSync(path.join(tmpDir, 'docx', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'stray'))).toBe(false)
  })

  it('should upgrade bundled skills when bundled version is newer and preserve local env', async () => {
    const targetSkill = path.join(tmpDir, 'docx')
    fs.mkdirSync(targetSkill, { recursive: true })
    fs.writeFileSync(
      path.join(targetSkill, 'SKILL.md'),
      '---\nname: docx\ndescription: Old\nversion: 1.0.0\n---\nOld prompt.\n'
    )
    fs.writeFileSync(path.join(targetSkill, '.env'), 'TOKEN=local\n')
    fs.writeFileSync(path.join(targetSkill, 'stale.js'), 'old runtime file\n')

    const bundledSkill = path.join(bundledDir, 'docx')
    fs.mkdirSync(bundledSkill, { recursive: true })
    fs.writeFileSync(
      path.join(bundledSkill, 'SKILL.md'),
      '---\nname: docx\ndescription: New\nversion: 1.1.0\n---\nNew prompt.\n'
    )

    manager.syncBundledSkillsToUserData({ bundledRoot: bundledDir })

    expect(fs.readFileSync(path.join(targetSkill, 'SKILL.md'), 'utf8')).toContain('version: 1.1.0')
    expect(fs.readFileSync(path.join(targetSkill, 'SKILL.md'), 'utf8')).toContain('New prompt.')
    expect(fs.readFileSync(path.join(targetSkill, '.env'), 'utf8')).toBe('TOKEN=local\n')
    expect(fs.existsSync(path.join(targetSkill, 'stale.js'))).toBe(false)
  })

  it('should repair bundled skill runtime dependencies from packaged resources', () => {
    const targetSkill = path.join(tmpDir, 'web-search')
    fs.writeFileSync(
      path.join(targetSkill, 'SKILL.md'),
      '---\nname: web-search\ndescription: Search the web\nversion: 1.0.0\n---\nUse web search.\n'
    )
    fs.writeFileSync(path.join(targetSkill, '.env'), 'API_KEY=local\n')

    const bundledSkill = path.join(bundledDir, 'web-search')
    fs.mkdirSync(path.join(bundledSkill, 'node_modules', 'runtime-lib'), { recursive: true })
    fs.writeFileSync(
      path.join(bundledSkill, 'SKILL.md'),
      '---\nname: web-search\ndescription: Search the web\nversion: 1.0.0\n---\nUse web search.\n'
    )
    fs.writeFileSync(
      path.join(bundledSkill, 'package.json'),
      '{"dependencies":{"runtime-lib":"1.0.0"}}\n'
    )
    fs.writeFileSync(
      path.join(bundledSkill, 'node_modules', 'runtime-lib', 'index.js'),
      'module.exports = {}\n'
    )

    manager.syncBundledSkillsToUserData({ bundledRoot: bundledDir })

    expect(fs.existsSync(path.join(targetSkill, 'node_modules', 'runtime-lib', 'index.js'))).toBe(
      true
    )
    expect(fs.readFileSync(path.join(targetSkill, '.env'), 'utf8')).toBe('API_KEY=local\n')
  })

  it('should repair broken web-search runtime files from packaged resources', () => {
    const targetSkill = path.join(tmpDir, 'web-search')
    fs.rmSync(targetSkill, { recursive: true, force: true })
    fs.mkdirSync(path.join(targetSkill, 'scripts'), { recursive: true })
    fs.writeFileSync(
      path.join(targetSkill, 'SKILL.md'),
      '---\nname: web-search\ndescription: Search the web\nversion: 1.0.0\n---\nUse web search.\n'
    )
    fs.writeFileSync(path.join(targetSkill, '.env'), 'API_KEY=local\n')
    fs.writeFileSync(path.join(targetSkill, 'scripts', 'start-server.sh'), 'legacy\n')

    const bundledSkill = path.join(bundledDir, 'web-search')
    fs.mkdirSync(path.join(bundledSkill, 'scripts'), { recursive: true })
    fs.mkdirSync(path.join(bundledSkill, 'dist', 'server'), { recursive: true })
    fs.writeFileSync(
      path.join(bundledSkill, 'SKILL.md'),
      '---\nname: web-search\ndescription: Search the web\nversion: 1.0.0\n---\nUse web search.\n'
    )
    fs.writeFileSync(
      path.join(bundledSkill, 'scripts', 'start-server.sh'),
      'WEB_SEARCH_FORCE_REPAIR\ndetect_healthy_bridge_server\n'
    )
    fs.writeFileSync(path.join(bundledSkill, 'scripts', 'search.sh'), 'ACTIVE_SERVER_URL\n')
    fs.writeFileSync(path.join(bundledSkill, 'dist', 'server', 'index.js'), 'createBridgeServer\n')

    manager.syncBundledSkillsToUserData({ bundledRoot: bundledDir })

    expect(fs.readFileSync(path.join(targetSkill, 'scripts', 'start-server.sh'), 'utf8')).toContain(
      'WEB_SEARCH_FORCE_REPAIR'
    )
    expect(fs.existsSync(path.join(targetSkill, 'dist', 'server', 'index.js'))).toBe(true)
    expect(fs.readFileSync(path.join(targetSkill, '.env'), 'utf8')).toBe('API_KEY=local\n')
  })

  it('should replace conflicting non-directory targets with bundled skill directories', () => {
    fs.writeFileSync(path.join(tmpDir, 'docx'), 'not a directory\n')
    const bundledSkill = path.join(bundledDir, 'docx')
    fs.mkdirSync(bundledSkill, { recursive: true })
    fs.writeFileSync(
      path.join(bundledSkill, 'SKILL.md'),
      '---\nname: docx\ndescription: Edit Word documents\nversion: 1.0.0\n---\nUse docx.\n'
    )

    manager.syncBundledSkillsToUserData({ bundledRoot: bundledDir })

    expect(fs.statSync(path.join(tmpDir, 'docx')).isDirectory()).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'docx', 'SKILL.md'))).toBe(true)
  })

  it('should isolate bundled skill sync failures and continue syncing other skills', () => {
    const brokenSkill = path.join(bundledDir, 'broken')
    fs.mkdirSync(brokenSkill, { recursive: true })
    fs.writeFileSync(
      path.join(brokenSkill, 'SKILL.md'),
      '---\nname: broken\ndescription: Broken skill\nversion: 1.0.0\n---\nBroken.\n'
    )
    fs.symlinkSync(path.join(brokenSkill, 'missing-target'), path.join(brokenSkill, 'broken-link'))

    const healthySkill = path.join(bundledDir, 'healthy')
    fs.mkdirSync(healthySkill, { recursive: true })
    fs.writeFileSync(
      path.join(healthySkill, 'SKILL.md'),
      '---\nname: healthy\ndescription: Healthy skill\nversion: 1.0.0\n---\nHealthy.\n'
    )

    expect(() => manager.syncBundledSkillsToUserData({ bundledRoot: bundledDir })).not.toThrow()
    expect(fs.existsSync(path.join(tmpDir, 'healthy', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'broken'))).toBe(false)
  })

  it('should merge bundled skills defaults without overwriting user config', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'skills.config.json'),
      JSON.stringify({ defaults: { docx: { enabled: false } }, custom: true }, null, 2)
    )
    fs.writeFileSync(
      path.join(bundledDir, 'skills.config.json'),
      JSON.stringify(
        { defaults: { docx: { enabled: true }, web: { enabled: true } }, bundled: true },
        null,
        2
      )
    )

    manager.syncBundledSkillsToUserData({ bundledRoot: bundledDir })

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'skills.config.json'), 'utf8')) as {
      defaults: Record<string, { enabled: boolean }>
      custom: boolean
      bundled: boolean
    }
    expect(config.defaults.docx.enabled).toBe(false)
    expect(config.defaults.web.enabled).toBe(true)
    expect(config.custom).toBe(true)
    expect(config.bundled).toBe(true)
  })
})
