import fs from 'fs'
import path from 'path'

export interface PetclawSettings {
  language?: string
  brainApiUrl?: string
  brainModel?: string
  brainApiKey?: string
  runtimeMode?: string
  region?: string
  gatewayPort?: number
  gatewayUrl?: string
  gatewayToken?: string
  deviceId?: string
  userEmail?: string
  userToken?: string
  inviteCode?: string
  theme?: string
  voiceShortcut?: string[]
  voiceInputDevice?: string
  sopComplete?: boolean
  onboardingComplete?: boolean
  lastLaunchedVersion?: string
  userCredits?: number
  modelTier?: string
  membershipTier?: string
  autoLaunchExplicitlySet?: boolean
  nickname?: string
  roles?: string[]
  selectedSkills?: string[]
}

export interface OnboardingSettingsInput {
  nickname: string
  roles: string[]
  selectedSkills: string[]
  voiceShortcut: string
  language: string
}

function ensureParentDir(settingsPath: string): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
}

export function readAppSettings(settingsPath: string): PetclawSettings {
  if (!fs.existsSync(settingsPath)) return {}

  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as PetclawSettings
  } catch {
    return {}
  }
}

export function writeAppSettings(settingsPath: string, settings: PetclawSettings): void {
  ensureParentDir(settingsPath)
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}

export function getAppSetting(key: string, settingsPath: string): string | null {
  const settings = readAppSettings(settingsPath)
  const value = settings[key as keyof PetclawSettings]

  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

export function setAppSetting(key: string, value: string, settingsPath: string): void {
  const settings = readAppSettings(settingsPath)
  ;(settings as Record<string, unknown>)[key] = parseSettingValue(key, value)
  writeAppSettings(settingsPath, settings)
}

export function saveOnboardingSettings(
  input: OnboardingSettingsInput,
  settingsPath: string
): PetclawSettings {
  const settings = readAppSettings(settingsPath)
  const nextSettings: PetclawSettings = {
    ...settings,
    onboardingComplete: true,
    sopComplete: true,
    language: input.language,
    nickname: input.nickname,
    roles: input.roles,
    selectedSkills: input.selectedSkills,
    voiceShortcut: input.voiceShortcut.split(' + ').map((k) => k.trim())
  }

  writeAppSettings(settingsPath, nextSettings)
  return nextSettings
}

function parseSettingValue(key: string, value: string): unknown {
  if (key === 'onboardingComplete' || key === 'sopComplete') {
    return value === 'true'
  }

  if (key === 'gatewayPort') {
    const port = Number(value)
    return Number.isFinite(port) ? port : value
  }

  return value
}
