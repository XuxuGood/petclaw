import fs from 'fs'
import path from 'path'

import type Database from 'better-sqlite3'
import { app } from 'electron'

import { kvGet, kvSet } from './db'

export interface CoworkConfig {
  defaultDirectory: string
  systemPrompt: string
  memoryEnabled: boolean
  skipMissedJobs: boolean
}

export interface CoworkConfigUpdate {
  defaultDirectory?: string
  systemPrompt?: string
  memoryEnabled?: boolean
  skipMissedJobs?: boolean
}

const COWORK_CONFIG_KEYS = {
  defaultDirectory: 'cowork.defaultDirectory',
  systemPrompt: 'cowork.systemPrompt',
  memoryEnabled: 'cowork.memoryEnabled',
  skipMissedJobs: 'cowork.skipMissedJobs'
} as const

const DEFAULT_COWORK_CONFIG: CoworkConfig = {
  defaultDirectory: '',
  systemPrompt: '',
  memoryEnabled: true,
  skipMissedJobs: true
}

const SYSTEM_PROMPT_RESOURCE_PATH = ['resources', 'SYSTEM_PROMPT.md'] as const

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

export function resolveDefaultSystemPromptPath(appPath = app.getAppPath()): string {
  return path.join(appPath, ...SYSTEM_PROMPT_RESOURCE_PATH)
}

export interface CoworkConfigStoreOptions {
  defaultSystemPromptPath?: string
}

export class CoworkConfigStore {
  private cachedDefaultSystemPrompt: string | null = null

  constructor(
    private db: Database.Database,
    private defaultDirectory: string,
    private options: CoworkConfigStoreOptions = {}
  ) {}

  hasDefaultDirectory(): boolean {
    return (kvGet(this.db, COWORK_CONFIG_KEYS.defaultDirectory)?.trim().length ?? 0) > 0
  }

  getConfig(): CoworkConfig {
    const configuredDefaultDirectory = kvGet(this.db, COWORK_CONFIG_KEYS.defaultDirectory)?.trim()

    return {
      defaultDirectory:
        configuredDefaultDirectory ||
        this.defaultDirectory.trim() ||
        DEFAULT_COWORK_CONFIG.defaultDirectory,
      systemPrompt: this.getSystemPrompt(),
      memoryEnabled: parseBoolean(
        kvGet(this.db, COWORK_CONFIG_KEYS.memoryEnabled),
        DEFAULT_COWORK_CONFIG.memoryEnabled
      ),
      skipMissedJobs: parseBoolean(
        kvGet(this.db, COWORK_CONFIG_KEYS.skipMissedJobs),
        DEFAULT_COWORK_CONFIG.skipMissedJobs
      )
    }
  }

  setConfig(patch: CoworkConfigUpdate): CoworkConfig {
    if (patch.defaultDirectory !== undefined) {
      kvSet(this.db, COWORK_CONFIG_KEYS.defaultDirectory, patch.defaultDirectory.trim())
    }
    if (patch.systemPrompt !== undefined) {
      kvSet(this.db, COWORK_CONFIG_KEYS.systemPrompt, patch.systemPrompt.trim())
    }
    if (patch.memoryEnabled !== undefined) {
      kvSet(this.db, COWORK_CONFIG_KEYS.memoryEnabled, patch.memoryEnabled ? 'true' : 'false')
    }
    if (patch.skipMissedJobs !== undefined) {
      kvSet(this.db, COWORK_CONFIG_KEYS.skipMissedJobs, patch.skipMissedJobs ? 'true' : 'false')
    }

    return this.getConfig()
  }

  private getSystemPrompt(): string {
    const configuredSystemPrompt = kvGet(this.db, COWORK_CONFIG_KEYS.systemPrompt)
    if (configuredSystemPrompt !== null) {
      return configuredSystemPrompt.trim()
    }

    return this.getDefaultSystemPrompt()
  }

  private getDefaultSystemPrompt(): string {
    if (this.cachedDefaultSystemPrompt !== null) {
      return this.cachedDefaultSystemPrompt
    }

    const promptPath = this.options.defaultSystemPromptPath ?? resolveDefaultSystemPromptPath()

    try {
      this.cachedDefaultSystemPrompt = fs.readFileSync(promptPath, 'utf8').trim()
    } catch {
      // 资源缺失时回退空字符串，避免启动阶段因默认提示词文件损坏而阻断应用。
      this.cachedDefaultSystemPrompt = DEFAULT_COWORK_CONFIG.systemPrompt
    }

    return this.cachedDefaultSystemPrompt
  }
}
