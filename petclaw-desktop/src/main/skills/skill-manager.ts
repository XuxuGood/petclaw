// SkillManager：扫描本地 Skill 目录，管理启用/禁用状态，并生成 Openclaw 配置
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'

import type { Skill } from '../ai/types'
import { kvGet, kvSet } from '../data/db'
import { cpRecursiveSync } from '../fs-compat'
import { getLogger } from '../logging/facade'

const SKILL_FILE_NAME = 'SKILL.md'
const SKILLS_CONFIG_FILE_NAME = 'skills.config.json'
const SKILL_ENV_FILE_NAME = '.env'
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const RUNTIME_REPAIR_PATHS = ['package.json', 'node_modules', 'scripts', 'dist']
const WEB_SEARCH_REPAIR_MARKERS: Record<string, string[]> = {
  'scripts/start-server.sh': ['WEB_SEARCH_FORCE_REPAIR', 'detect_healthy_bridge_server'],
  'scripts/search.sh': ['ACTIVE_SERVER_URL'],
  'dist/server/index.js': ['createBridgeServer']
}
const logger = getLogger('SkillManager')

type JsonRecord = Record<string, unknown>

interface SyncBundledSkillsOptions {
  bundledRoot?: string | null
}

export class SkillManager extends EventEmitter {
  private skills: Skill[] = []
  // enabledState 从 kv 表持久化，key 为 skill id，value 为是否启用
  private enabledState: Record<string, boolean> = {}

  constructor(
    private db: Database.Database,
    private skillsRoot: string
  ) {
    super()
    // 构造时立即加载持久化状态，保证后续 scan 能正确合并
    this.loadEnabledState()
  }

  getSkillsRoot(): string {
    return this.skillsRoot
  }

  /** 扫描 skillsRoot 下所有含 SKILL.md 的子目录，返回 Skill 列表 */
  async scan(): Promise<Skill[]> {
    // 每次 scan 前重新加载 kv，确保跨 scan 持久化状态生效
    this.loadEnabledState()
    this.skills = []

    if (!fs.existsSync(this.skillsRoot)) return this.skills

    const builtInSkillIds = this.loadConfiguredSkillIds(this.skillsRoot) ?? new Set<string>()
    const entries = fs.readdirSync(this.skillsRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillMdPath = path.join(this.skillsRoot, entry.name, SKILL_FILE_NAME)
      if (!fs.existsSync(skillMdPath)) continue

      const content = fs.readFileSync(skillMdPath, 'utf8')
      const metadata = this.parseFrontmatter(content)

      // 优先使用 frontmatter 中的 name，fallback 到目录名
      const id = metadata.name || entry.name
      this.skills.push({
        id,
        name: metadata.name || entry.name,
        description: metadata.description || '',
        // 未显式设置过的 skill 默认启用
        enabled: this.enabledState[id] ?? true,
        isBuiltIn: builtInSkillIds.has(id) || builtInSkillIds.has(entry.name),
        skillPath: path.join(this.skillsRoot, entry.name),
        version: metadata.version
      })
    }

    return this.skills
  }

  /**
   * 将打包在 Resources/skills 下的内置技能同步到 userData/skills。
   *
   * Resources 是只读目录，Openclaw 运行时和 UI 只消费 userData 下的可写技能根目录。
   * 同步时仅保留用户本地 .env，避免内置技能升级覆盖用户填过的密钥。
   */
  syncBundledSkillsToUserData(options: SyncBundledSkillsOptions = {}): void {
    const bundledRoot = options.bundledRoot ? path.resolve(options.bundledRoot) : null
    if (!bundledRoot || !fs.existsSync(bundledRoot)) return

    const userRoot = path.resolve(this.skillsRoot)
    if (bundledRoot === userRoot) return

    let configuredSkillIds: Set<string> | null = null
    try {
      fs.mkdirSync(userRoot, { recursive: true })
      configuredSkillIds = this.loadConfiguredSkillIds(bundledRoot)
    } catch (error) {
      logger.warn(
        'bundledSkills.prepareSync.failed',
        'Failed to prepare bundled skills sync',
        error
      )
      return
    }

    for (const dirName of this.listSkillDirs(bundledRoot)) {
      const sourceDir = path.join(bundledRoot, dirName)
      const skillId = this.readSkillId(sourceDir, dirName)
      if (
        configuredSkillIds &&
        !configuredSkillIds.has(skillId) &&
        !configuredSkillIds.has(dirName)
      ) {
        continue
      }

      try {
        this.syncBundledSkill(sourceDir, path.join(userRoot, dirName), skillId)
      } catch (error) {
        logger.warn(
          'bundledSkills.syncSkill.failed',
          'Failed to sync bundled skill',
          { skillId },
          error
        )
      }
    }

    try {
      this.syncSkillsConfig(bundledRoot, userRoot)
    } catch (error) {
      logger.warn('bundledSkills.syncConfig.failed', 'Failed to sync bundled skills config', error)
    }
  }

  /** 设置 skill 启用/禁用状态，并持久化到 kv，触发 change 事件 */
  setEnabled(id: string, enabled: boolean): void {
    // 同步更新内存中的 skill 对象
    const skill = this.skills.find((s) => s.id === id)
    if (skill) skill.enabled = enabled
    // 更新 enabledState 并持久化
    this.enabledState[id] = enabled
    this.saveEnabledState()
    // 通知外部监听者（如 IPC 层）状态变化
    this.emit('change')
  }

  /** 返回当前已扫描的所有 Skill */
  list(): Skill[] {
    return this.skills
  }

  /** 返回所有已启用的 Skill */
  getEnabled(): Skill[] {
    return this.skills.filter((s) => s.enabled)
  }

  buildSelectedSkillPrompt(skillIds: string[]): string {
    const uniqueIds = Array.from(new Set(skillIds.map((id) => id.trim()).filter(Boolean)))
    if (uniqueIds.length === 0) return ''

    const sections: string[] = []
    for (const id of uniqueIds) {
      const skill = this.skills.find((item) => item.id === id)
      if (!skill?.enabled) continue

      const prompt = this.readSkillPrompt(skill)
      if (!prompt) continue

      sections.push(this.buildInlinedSkillPrompt(skill, prompt))
    }

    return sections.join('\n\n')
  }

  /**
   * 生成传给 Openclaw 运行时的 Skill 配置结构：
   * - entries：每个 skill 的启用状态
   * - load.extraDirs：需要加载的 skill 根目录，watch 模式热重载
   */
  toOpenclawConfig(): {
    entries: Record<string, { enabled: boolean }>
    load: { extraDirs: string[]; watch: boolean }
  } {
    const entries: Record<string, { enabled: boolean }> = {}
    for (const skill of this.skills) {
      entries[skill.id] = { enabled: skill.enabled }
    }
    return {
      entries,
      load: { extraDirs: [this.skillsRoot], watch: true }
    }
  }

  /** 从 kv 表读取持久化的启用状态 */
  private loadEnabledState(): void {
    const saved = kvGet(this.db, 'skills_state')
    if (saved) {
      this.enabledState = JSON.parse(saved) as Record<string, boolean>
    }
  }

  /** 将当前启用状态序列化写入 kv 表 */
  private saveEnabledState(): void {
    kvSet(this.db, 'skills_state', JSON.stringify(this.enabledState))
  }

  /**
   * 解析 SKILL.md 文件头的 YAML frontmatter
   * 只做简单的行解析（key: value），不依赖 yaml 库
   */
  private parseFrontmatter(content: string): Record<string, string> {
    const match = content.match(FRONTMATTER_RE)
    if (!match) return {}
    const result: Record<string, string> = {}
    for (const line of match[1].split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      result[key] = value
    }
    return result
  }

  private listSkillDirs(root: string): string[] {
    try {
      return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((dirName) => fs.existsSync(path.join(root, dirName, SKILL_FILE_NAME)))
        .sort((left, right) => left.localeCompare(right))
    } catch {
      return []
    }
  }

  private readSkillMetadata(skillDir: string): Record<string, string> {
    try {
      const content = fs.readFileSync(path.join(skillDir, SKILL_FILE_NAME), 'utf8')
      return this.parseFrontmatter(content)
    } catch {
      return {}
    }
  }

  private readSkillId(skillDir: string, fallback: string): string {
    return this.readSkillMetadata(skillDir).name || fallback
  }

  private readSkillVersion(skillDir: string): string | undefined {
    return this.readSkillMetadata(skillDir).version
  }

  private syncBundledSkill(sourceDir: string, targetDir: string, skillId: string): void {
    if (!fs.existsSync(targetDir)) {
      this.copyBundledSkill(sourceDir, targetDir)
      return
    }

    if (this.shouldReplaceBundledSkill(sourceDir, targetDir, skillId)) {
      this.replaceBundledSkill(sourceDir, targetDir)
    }
  }

  private shouldReplaceBundledSkill(
    sourceDir: string,
    targetDir: string,
    skillId: string
  ): boolean {
    if (!isDirectory(targetDir)) return true

    const sourceVersion = this.readSkillVersion(sourceDir)
    const targetVersion = this.readSkillVersion(targetDir)
    if (
      sourceVersion &&
      (!targetVersion || compareSkillVersions(sourceVersion, targetVersion) > 0)
    ) {
      return true
    }

    return this.shouldRepairBundledSkillRuntime(sourceDir, targetDir, skillId)
  }

  private shouldRepairBundledSkillRuntime(
    sourceDir: string,
    targetDir: string,
    skillId: string
  ): boolean {
    for (const relativePath of RUNTIME_REPAIR_PATHS) {
      if (
        fs.existsSync(path.join(sourceDir, relativePath)) &&
        !fs.existsSync(path.join(targetDir, relativePath))
      ) {
        return true
      }
    }

    return skillId === 'web-search' && isWebSearchSkillBroken(sourceDir, targetDir)
  }

  private copyBundledSkill(sourceDir: string, targetDir: string): void {
    replaceDirectoryAtomically(sourceDir, targetDir)
  }

  private replaceBundledSkill(sourceDir: string, targetDir: string): void {
    const preservedEnv = this.readOptionalFileBuffer(path.join(targetDir, SKILL_ENV_FILE_NAME))
    replaceDirectoryAtomically(sourceDir, targetDir, preservedEnv)
  }

  private readOptionalFileBuffer(filePath: string): Buffer | null {
    try {
      return fs.readFileSync(filePath)
    } catch {
      return null
    }
  }

  private syncSkillsConfig(bundledRoot: string, userRoot: string): void {
    const bundledConfigPath = path.join(bundledRoot, SKILLS_CONFIG_FILE_NAME)
    if (!fs.existsSync(bundledConfigPath)) return

    const userConfigPath = path.join(userRoot, SKILLS_CONFIG_FILE_NAME)
    if (!fs.existsSync(userConfigPath)) {
      copyFileAtomically(bundledConfigPath, userConfigPath)
      return
    }

    const bundledConfig = readJsonRecord(bundledConfigPath)
    const userConfig = readJsonRecord(userConfigPath)
    if (!bundledConfig || !userConfig) return

    const mergedConfig = mergeSkillsConfig(userConfig, bundledConfig)
    if (JSON.stringify(mergedConfig) !== JSON.stringify(userConfig)) {
      writeJsonRecord(userConfigPath, mergedConfig)
    }
  }

  private loadConfiguredSkillIds(root: string): Set<string> | null {
    const config = readJsonRecord(path.join(root, SKILLS_CONFIG_FILE_NAME))
    if (!config || !isJsonRecord(config.defaults)) return null
    return new Set(Object.keys(config.defaults))
  }

  private readSkillPrompt(skill: Skill): string {
    const skillFilePath = path.join(skill.skillPath, SKILL_FILE_NAME)
    try {
      const content = fs.readFileSync(skillFilePath, 'utf8').replace(/^\uFEFF/, '')
      return content.replace(FRONTMATTER_RE, '').trim()
    } catch {
      return ''
    }
  }

  private buildInlinedSkillPrompt(skill: Skill, prompt: string): string {
    const skillFilePath = path.join(skill.skillPath, SKILL_FILE_NAME)
    return [
      `## Skill: ${skill.name}`,
      '<skill_context>',
      `  <location>${skillFilePath}</location>`,
      `  <directory>${skill.skillPath}</directory>`,
      '  <path_rules>',
      '    Resolve relative file references from this skill against <directory>.',
      '    Do not assume skills are under the current workspace directory.',
      '  </path_rules>',
      '</skill_context>',
      '',
      prompt
    ].join('\n')
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJsonRecord(filePath: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return isJsonRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeJsonRecord(filePath: string, value: JsonRecord): void {
  writeFileAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function mergeSkillsConfig(userConfig: JsonRecord, bundledConfig: JsonRecord): JsonRecord {
  const merged: JsonRecord = { ...bundledConfig, ...userConfig }
  const bundledDefaults = isJsonRecord(bundledConfig.defaults) ? bundledConfig.defaults : {}
  const userDefaults = isJsonRecord(userConfig.defaults) ? userConfig.defaults : {}

  if (Object.keys(bundledDefaults).length > 0 || Object.keys(userDefaults).length > 0) {
    merged.defaults = { ...bundledDefaults, ...userDefaults }
  }

  return merged
}

function isDirectory(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory()
  } catch {
    return false
  }
}

function copyFileAtomically(sourcePath: string, targetPath: string): void {
  writeFileAtomically(targetPath, fs.readFileSync(sourcePath))
}

function writeFileAtomically(filePath: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmpPath = buildSiblingTempPath(filePath, 'tmp')
  try {
    fs.writeFileSync(tmpPath, content)
    fs.renameSync(tmpPath, filePath)
  } finally {
    fs.rmSync(tmpPath, { force: true })
  }
}

function replaceDirectoryAtomically(
  sourceDir: string,
  targetDir: string,
  preservedEnv: Buffer | null = null
): void {
  fs.mkdirSync(path.dirname(targetDir), { recursive: true })

  const tempDir = buildSiblingTempPath(targetDir, 'tmp')
  const backupPath = buildSiblingTempPath(targetDir, 'bak')
  let backupCreated = false

  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(backupPath, { recursive: true, force: true })

    cpRecursiveSync(sourceDir, tempDir, { force: true, dereference: true })
    if (preservedEnv) {
      fs.writeFileSync(path.join(tempDir, SKILL_ENV_FILE_NAME), preservedEnv)
    }

    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, backupPath)
      backupCreated = true
    }

    fs.renameSync(tempDir, targetDir)

    if (backupCreated) {
      fs.rmSync(backupPath, { recursive: true, force: true })
    }
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    restoreBackupIfNeeded(targetDir, backupPath, backupCreated)
    throw error
  }
}

function restoreBackupIfNeeded(
  targetDir: string,
  backupPath: string,
  backupCreated: boolean
): void {
  if (!backupCreated || !fs.existsSync(backupPath)) return

  if (!fs.existsSync(targetDir)) {
    try {
      fs.renameSync(backupPath, targetDir)
      return
    } catch (error) {
      logger.warn(
        'bundledSkills.restoreBackup.failed',
        'Failed to restore bundled skill backup',
        { targetDir },
        error
      )
    }
  }

  fs.rmSync(backupPath, { recursive: true, force: true })
}

function buildSiblingTempPath(targetPath: string, suffix: 'tmp' | 'bak'): string {
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${unique}.${suffix}`)
}

function isWebSearchSkillBroken(sourceDir: string, targetDir: string): boolean {
  for (const relativePath of Object.keys(WEB_SEARCH_REPAIR_MARKERS)) {
    const sourcePath = path.join(sourceDir, relativePath)
    if (fs.existsSync(sourcePath) && !fs.existsSync(path.join(targetDir, relativePath))) {
      return true
    }
  }

  for (const [relativePath, markers] of Object.entries(WEB_SEARCH_REPAIR_MARKERS)) {
    const sourcePath = path.join(sourceDir, relativePath)
    const targetPath = path.join(targetDir, relativePath)
    if (!fs.existsSync(sourcePath) || !fs.existsSync(targetPath)) continue

    const sourceContent = readTextFile(sourcePath)
    const targetContent = readTextFile(targetPath)
    if (!sourceContent || targetContent === null) continue

    for (const marker of markers) {
      if (sourceContent.includes(marker) && !targetContent.includes(marker)) {
        return true
      }
    }
  }

  return false
}

function readTextFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

function compareSkillVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left)
  const rightParts = parseVersionParts(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (diff !== 0) return diff
  }

  return 0
}

function parseVersionParts(version: string): number[] {
  const parts = version
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part))

  return parts.length > 0 ? parts : [0]
}
