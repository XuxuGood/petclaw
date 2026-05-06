import * as fs from 'fs'

import { getLogger } from '../logging/facade'

const logger = getLogger('ConfigInstaller')

export class ConfigInstaller {
  private bridgePath: string

  constructor(bridgePath: string) {
    this.bridgePath = bridgePath
  }

  installClaudeHooks(settingsPath: string): void {
    const hookCommand = this.bridgePath

    let settings: Record<string, unknown> = {}
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      } catch (error) {
        logger.warn(
          'claudeHooks.settings.invalidJson',
          'Claude hooks settings file contains invalid JSON',
          { settingsPath },
          error
        )
        settings = {}
      }
    }

    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {}
    }

    const hooks = settings.hooks as Record<string, unknown>

    const hookTypes = [
      'afterToolUse',
      'afterPermissionGrant',
      'afterError',
      'afterSessionStart',
      'afterSessionEnd'
    ]

    for (const hookType of hookTypes) {
      if (!Array.isArray(hooks[hookType])) {
        hooks[hookType] = []
      }
      const hookArray = hooks[hookType] as string[]
      if (!hookArray.some((h) => h.includes(this.bridgePath))) {
        hookArray.push(hookCommand)
      }
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  }

  uninstallClaudeHooks(settingsPath: string): void {
    if (!fs.existsSync(settingsPath)) return

    let settings: Record<string, unknown>
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    } catch (error) {
      logger.warn(
        'claudeHooks.uninstall.invalidJson',
        'Claude hooks settings file contains invalid JSON during uninstall',
        { settingsPath },
        error
      )
      return
    }
    if (!settings.hooks) return

    const hooks = settings.hooks as Record<string, unknown>

    for (const hookType of Object.keys(hooks)) {
      if (Array.isArray(hooks[hookType])) {
        hooks[hookType] = (hooks[hookType] as string[]).filter((h) => !h.includes(this.bridgePath))
      }
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  }
}
