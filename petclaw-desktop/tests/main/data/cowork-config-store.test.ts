import fs from 'fs'
import os from 'os'
import path from 'path'

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

import { CoworkConfigStore } from '../../../src/main/data/cowork-config-store'
import { initDatabase, kvSet } from '../../../src/main/data/db'

describe('CoworkConfigStore', () => {
  let db: Database.Database
  let store: CoworkConfigStore
  let tmpDir: string
  let promptPath: string

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-cowork-config-'))
    promptPath = path.join(tmpDir, 'SYSTEM_PROMPT.md')
    fs.writeFileSync(promptPath, ' default resource prompt \n', 'utf8')
    store = new CoworkConfigStore(db, '/user-data/openclaw/workspace', {
      defaultSystemPromptPath: promptPath
    })
  })

  it('缺失配置时返回 main agent 默认 workspace 和资源默认 systemPrompt', () => {
    expect(store.getConfig()).toEqual({
      defaultDirectory: '/user-data/openclaw/workspace',
      systemPrompt: 'default resource prompt',
      memoryEnabled: true,
      skipMissedJobs: true
    })
    expect(store.hasDefaultDirectory()).toBe(false)
  })

  it('setConfig 只持久化传入字段并保留其他默认值', () => {
    const config = store.setConfig({
      defaultDirectory: '  /workspace/project  ',
      systemPrompt: '  custom prompt  '
    })

    expect(config).toEqual({
      defaultDirectory: '/workspace/project',
      systemPrompt: 'custom prompt',
      memoryEnabled: true,
      skipMissedJobs: true
    })
    expect(store.hasDefaultDirectory()).toBe(true)
  })

  it('空 defaultDirectory 视为未配置并回落到 main workspace', () => {
    store.setConfig({ defaultDirectory: '   ' })

    expect(store.getConfig().defaultDirectory).toBe('/user-data/openclaw/workspace')
    expect(store.hasDefaultDirectory()).toBe(false)
  })

  it('持久化 boolean 字段并可重新加载', () => {
    store.setConfig({
      memoryEnabled: false,
      skipMissedJobs: false
    })

    const reloaded = new CoworkConfigStore(db, '/user-data/openclaw/workspace', {
      defaultSystemPromptPath: promptPath
    })
    expect(reloaded.getConfig().memoryEnabled).toBe(false)
    expect(reloaded.getConfig().skipMissedJobs).toBe(false)
  })

  it('非法 boolean 值回退默认值', () => {
    kvSet(db, 'cowork.memoryEnabled', 'maybe')
    kvSet(db, 'cowork.skipMissedJobs', 'invalid')

    expect(store.getConfig().memoryEnabled).toBe(true)
    expect(store.getConfig().skipMissedJobs).toBe(true)
  })

  it('显式保存空 systemPrompt 时不回退资源默认值', () => {
    store.setConfig({ systemPrompt: '   ' })

    expect(store.getConfig().systemPrompt).toBe('')
  })

  it('默认 systemPrompt 资源缺失时回退空字符串', () => {
    const missingResourceStore = new CoworkConfigStore(db, '/user-data/openclaw/workspace', {
      defaultSystemPromptPath: path.join(tmpDir, 'missing.md')
    })

    expect(missingResourceStore.getConfig().systemPrompt).toBe('')
  })
})
