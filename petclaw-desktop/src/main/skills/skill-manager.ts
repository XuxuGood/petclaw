// SkillManager：扫描本地 Skill 目录，管理启用/禁用状态，并生成 Openclaw 配置
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'

import type { Skill } from '../ai/types'
import { kvGet, kvSet } from '../data/db'

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

    const entries = fs.readdirSync(this.skillsRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillMdPath = path.join(this.skillsRoot, entry.name, 'SKILL.md')
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
        isBuiltIn: false,
        skillPath: path.join(this.skillsRoot, entry.name),
        version: metadata.version
      })
    }

    return this.skills
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
    const match = content.match(/^---\n([\s\S]*?)\n---/)
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
}
