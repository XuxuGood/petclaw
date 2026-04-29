import { app } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'

import type Database from 'better-sqlite3'

import { safeHandle } from './ipc-registry'
import { ConfigInstaller } from '../hooks/installer'
import { checkEnvironment, checkGatewayConnectivity, installHooks } from '../onboarding'
import { kvGet, kvSet } from '../data/db'
import { getLanguage, setLanguage } from '../i18n'
import type { Locale } from '@petclaw/shared/i18n'

export interface BootIpcDeps {
  db: Database.Database
}

export function registerBootIpcHandlers(deps: BootIpcDeps): void {
  const { db } = deps

  safeHandle('app:version', async () => app.getVersion())

  safeHandle('onboarding:check-env', async () => {
    return checkEnvironment()
  })

  safeHandle('onboarding:check-gateway', async (_event, url: string) => {
    return checkGatewayConnectivity(url)
  })

  safeHandle('onboarding:install-hooks', async () => {
    const settingsPath = join(app.getPath('home'), '.claude', 'settings.json')
    const bridgePath = join(app.getAppPath(), 'resources', 'petclaw-bridge')
    const installer = new ConfigInstaller(bridgePath)
    return installHooks(installer, settingsPath)
  })

  // 保存 Onboarding 结果
  safeHandle(
    'onboarding:save-config',
    async (
      _event,
      data: {
        nickname: string
        roles: string[]
        selectedSkills: string[]
        voiceShortcut: string
        language: string
      }
    ) => {
      // 持久化到 kv 表
      kvSet(db, 'onboardingComplete', JSON.stringify(true))
      kvSet(db, 'nickname', JSON.stringify(data.nickname))
      kvSet(db, 'roles', JSON.stringify(data.roles))
      kvSet(db, 'selectedSkills', JSON.stringify(data.selectedSkills))
      kvSet(db, 'language', JSON.stringify(data.language))
      kvSet(
        db,
        'voiceShortcut',
        JSON.stringify(data.voiceShortcut.split(' + ').map((k) => k.trim()))
      )

      // 同步 workspace/USER.md
      const petclawHome = join(app.getPath('home'), '.petclaw')
      const workspacePath = join(petclawHome, 'workspace')
      const fingerprint = `${data.nickname}|${data.roles.join(',')}`
      const currentFingerprint = kvGet(db, 'userMdSyncedFrom')

      if (currentFingerprint !== JSON.stringify(fingerprint)) {
        const userMd = `## USER.md - About Your Human\n\n- **Name:** ${data.nickname}\n- **What to call them:** ${data.nickname}\n- **Occupation:** ${data.roles.join(', ')}\n- **Notes:**\n`
        writeFileSync(join(workspacePath, 'USER.md'), userMd)
        kvSet(db, 'userMdSyncedFrom', JSON.stringify(fingerprint))
      }

      return { success: true }
    }
  )

  // i18n 语言查询与切换
  safeHandle('i18n:get-language', () => getLanguage())

  safeHandle('i18n:set-language', (_event, locale: string) => {
    if (locale === 'zh' || locale === 'en') {
      setLanguage(locale as Locale)
    }
  })
}
