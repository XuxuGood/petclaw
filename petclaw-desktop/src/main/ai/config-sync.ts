import fs from 'fs'

export interface ConfigSyncDeps {
  getConfigPath: () => string
  getStateDir: () => string
  getModelConfig: () => { primary: string; providers: Record<string, unknown> }
  getSkillsExtraDirs: () => string[]
  getWorkspacePath: () => string
  collectSecretEnvVars: () => Record<string, string>
}

export interface ConfigSyncResult {
  ok: boolean
  changed: boolean
  configPath: string
  error?: string
}

export class ConfigSync {
  constructor(private deps: ConfigSyncDeps) {}

  sync(_reason: string): ConfigSyncResult {
    const configPath = this.deps.getConfigPath()

    try {
      const existing = this.readExistingConfig(configPath)
      const nextConfig = this.buildConfig(existing)
      const nextContent = JSON.stringify(nextConfig, null, 2)
      const prevContent = this.readFileOrNull(configPath)

      if (nextContent === prevContent) {
        return { ok: true, changed: false, configPath }
      }

      // 原子写入
      const tmpPath = `${configPath}.tmp-${Date.now()}`
      fs.writeFileSync(tmpPath, nextContent, 'utf8')
      fs.renameSync(tmpPath, configPath)

      return { ok: true, changed: true, configPath }
    } catch (err) {
      return {
        ok: false,
        changed: false,
        configPath,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  collectSecretEnvVars(): Record<string, string> {
    return this.deps.collectSecretEnvVars()
  }

  private buildConfig(existing: Record<string, unknown>): Record<string, unknown> {
    const model = this.deps.getModelConfig()
    return {
      gateway: existing.gateway ?? {
        mode: 'local',
        auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' }
      },
      models: {
        mode: 'replace',
        providers: model.providers
      },
      agents: {
        defaults: {
          timeoutSeconds: 3600,
          model: { primary: model.primary },
          workspace: this.deps.getWorkspacePath()
        }
      },
      skills: {
        load: {
          extraDirs: this.deps.getSkillsExtraDirs(),
          watch: true
        }
      },
      commands: { ownerAllowFrom: ['gateway-client', '*'] },
      plugins: existing.plugins ?? {}
    }
  }

  private readExistingConfig(configPath: string): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch {
      return {}
    }
  }

  private readFileOrNull(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, 'utf8')
    } catch {
      return null
    }
  }
}
