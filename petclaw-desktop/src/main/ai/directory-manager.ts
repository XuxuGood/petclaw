// src/main/ai/directory-manager.ts
// DirectoryManager：目录注册 + deriveAgentId + openclaw.json 配置生成
import { EventEmitter } from 'events'

import type { DirectoryStore } from '../data/directory-store'
import { deriveAgentId, type Directory } from './types'

interface OpenclawAgentEntry {
  id: string
  default?: boolean
  workspace?: string
  model?: { primary: string }
  skills?: string[]
}

interface OpenclawAgentsConfig {
  list: OpenclawAgentEntry[]
}

export class DirectoryManager extends EventEmitter {
  constructor(private store: DirectoryStore) {
    super()
  }

  // 注册目录（首次使用时自动调用，幂等）
  ensureRegistered(directoryPath: string): Directory {
    const agentId = deriveAgentId(directoryPath)
    const existing = this.store.get(agentId)
    if (existing) return existing

    this.store.insert(agentId, directoryPath)
    this.emit('change')
    return this.store.get(agentId)!
  }

  get(agentId: string): Directory | null {
    return this.store.get(agentId)
  }

  getByPath(directoryPath: string): Directory | null {
    return this.store.getByPath(directoryPath)
  }

  list(): Directory[] {
    return this.store.list()
  }

  updateName(agentId: string, name: string): void {
    this.store.updateName(agentId, name)
    this.emit('change')
  }

  updateModelOverride(agentId: string, model: string): void {
    this.store.updateModelOverride(agentId, model)
    this.emit('change')
  }

  updateSkillIds(agentId: string, skillIds: string[]): void {
    this.store.updateSkillIds(agentId, skillIds)
    this.emit('change')
  }

  // 序列化为 openclaw.json agents 配置段
  toOpenclawConfig(): OpenclawAgentsConfig {
    const directories = this.store.list()
    const list: OpenclawAgentEntry[] = [{ id: 'main', default: true }]

    for (const dir of directories) {
      const entry: OpenclawAgentEntry = {
        id: dir.agentId,
        workspace: dir.path
      }
      if (dir.modelOverride) {
        entry.model = { primary: dir.modelOverride }
      }
      if (dir.skillIds.length > 0) {
        entry.skills = dir.skillIds
      }
      list.push(entry)
    }

    return { list }
  }
}
