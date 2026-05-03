import { app, shell, systemPreferences } from 'electron'
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

  safeHandle('onboarding:get-permissions', async () => {
    return getSystemPermissionStatus()
  })

  safeHandle(
    'onboarding:request-permission',
    async (_event, type: 'accessibility' | 'microphone') => {
      if (type === 'accessibility') {
        if (process.platform === 'darwin') {
          systemPreferences.isTrustedAccessibilityClient(true)
          await shell.openExternal(
            'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
          )
        }
        return getSystemPermissionStatus()
      }

      if (process.platform === 'darwin') {
        await systemPreferences.askForMediaAccess('microphone')
      }
      return getSystemPermissionStatus()
    }
  )

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

function getSystemPermissionStatus(): { accessibility: boolean; microphone: boolean } {
  if (process.platform !== 'darwin') {
    // Windows/Linux 没有与 macOS TCC 等价的系统级引导入口；应用内视为无需预授权，
    // 真正的设备/系统能力失败仍由具体功能入口处理。
    return { accessibility: true, microphone: true }
  }

  const microphoneStatus = systemPreferences.getMediaAccessStatus('microphone')
  return {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    microphone: microphoneStatus === 'granted'
  }
}
