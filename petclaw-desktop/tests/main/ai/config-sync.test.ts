import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

import { ConfigSync, type ConfigSyncDeps } from '../../../src/main/ai/config-sync'

function createMockDeps(tmpDir: string): ConfigSyncDeps {
  return {
    getConfigPath: () => path.join(tmpDir, 'openclaw.json'),
    getStateDir: () => tmpDir,
    getModelConfig: () => ({
      primary: 'claude-sonnet-4-6',
      providers: { anthropic: { apiKey: '${ANTHROPIC_API_KEY}' } }
    }),
    getSkillsExtraDirs: () => ['/tmp/skills'],
    getWorkspacePath: () => '/tmp/workspace',
    collectSecretEnvVars: () => ({ ANTHROPIC_API_KEY: 'sk-test' })
  }
}

describe('ConfigSync', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-config-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should generate openclaw.json on first sync', () => {
    const sync = new ConfigSync(createMockDeps(tmpDir))
    const result = sync.sync('boot')
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8'))
    expect(config.models.providers.anthropic).toBeDefined()
    expect(config.agents.defaults.model.primary).toBe('claude-sonnet-4-6')
    expect(config.skills.load.extraDirs).toEqual(['/tmp/skills'])
  })

  it('should return changed=false when config unchanged', () => {
    const sync = new ConfigSync(createMockDeps(tmpDir))
    sync.sync('boot')
    const result = sync.sync('check')
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(false)
  })

  it('should preserve existing gateway/plugins fields', () => {
    const configPath = path.join(tmpDir, 'openclaw.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          gateway: { mode: 'local', auth: { mode: 'token', token: 'existing' } },
          plugins: { customPlugin: { enabled: true } }
        },
        null,
        2
      )
    )
    const sync = new ConfigSync(createMockDeps(tmpDir))
    const result = sync.sync('update')
    expect(result.changed).toBe(true)
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(config.gateway.auth.token).toBe('existing')
    expect(config.plugins.customPlugin.enabled).toBe(true)
  })

  it('should do atomic write (no partial files)', () => {
    const sync = new ConfigSync(createMockDeps(tmpDir))
    sync.sync('boot')
    // 验证没有残留的 .tmp 文件
    const files = fs.readdirSync(tmpDir)
    expect(files.filter((f) => f.includes('.tmp'))).toHaveLength(0)
  })

  it('should expose collectSecretEnvVars', () => {
    const sync = new ConfigSync(createMockDeps(tmpDir))
    expect(sync.collectSecretEnvVars()).toEqual({ ANTHROPIC_API_KEY: 'sk-test' })
  })
})
