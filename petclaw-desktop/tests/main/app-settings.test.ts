import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  getAppSetting,
  readAppSettings,
  saveOnboardingSettings,
  setAppSetting
} from '../../src/main/app-settings'

describe('app-settings', () => {
  let tmpDir: string
  let settingsPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-settings-test-'))
    settingsPath = path.join(tmpDir, 'petclaw-settings.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads string settings from petclaw-settings.json', () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        gatewayUrl: 'ws://127.0.0.1:29890',
        onboardingComplete: true
      })
    )

    expect(getAppSetting('gatewayUrl', settingsPath)).toBe('ws://127.0.0.1:29890')
    expect(getAppSetting('onboardingComplete', settingsPath)).toBe('true')
  })

  it('updates a single app setting in petclaw-settings.json', () => {
    setAppSetting('gatewayUrl', 'ws://127.0.0.1:39999', settingsPath)

    const settings = readAppSettings(settingsPath)
    expect(settings.gatewayUrl).toBe('ws://127.0.0.1:39999')
  })

  it('persists onboarding results in petclaw-settings.json', () => {
    saveOnboardingSettings(
      {
        nickname: 'Mochi',
        roles: ['developer', 'founder'],
        selectedSkills: ['github', 'browser'],
        voiceShortcut: 'Meta + D',
        language: 'zh'
      },
      settingsPath
    )

    const settings = readAppSettings(settingsPath)
    expect(settings.onboardingComplete).toBe(true)
    expect(settings.sopComplete).toBe(true)
    expect(settings.language).toBe('zh')
    expect(settings.nickname).toBe('Mochi')
    expect(settings.roles).toEqual(['developer', 'founder'])
    expect(settings.selectedSkills).toEqual(['github', 'browser'])
    expect(settings.voiceShortcut).toEqual(['Meta', 'D'])
  })
})
