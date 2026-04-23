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
  autoLaunch?: boolean
  nickname?: string
  roles?: string[]
  selectedSkills?: string[]
  windowBounds?: { x: number; y: number; width: number; height: number }
  petPosition?: { x: number; y: number }
  lastActiveTab?: string
  soundEnabled?: boolean
  notificationsEnabled?: boolean
  managedWorkspaceMd?: {
    userMdSyncedFrom?: string // "nickname|role1,role2" — USER.md 生成时的源数据指纹
    soulMdSyncedFrom?: string // "zh" — SOUL.md 生成时的 language
  }
}

/** Default settings for new installation. Dynamic fields (deviceId, gatewayToken) are set at runtime. */
export const DEFAULT_GATEWAY_PORT = 29890
export const DEFAULT_GATEWAY_URL = `ws://127.0.0.1:${DEFAULT_GATEWAY_PORT}`

export function createDefaultSettings(overrides?: {
  gatewayPort?: number
  gatewayToken?: string
  deviceId?: string
}): PetclawSettings {
  const port = overrides?.gatewayPort ?? DEFAULT_GATEWAY_PORT
  return {
    language: 'zh',
    brainApiUrl: 'https://petclaw.ai/api/v1',
    brainModel: 'petclaw-fast',
    brainApiKey: '',
    runtimeMode: 'chat',
    region: 'china',
    gatewayPort: port,
    gatewayUrl: `ws://127.0.0.1:${port}`,
    gatewayToken: overrides?.gatewayToken ?? '',
    deviceId: overrides?.deviceId ?? '',
    userEmail: '',
    userToken: '',
    inviteCode: '',
    theme: 'light',
    voiceShortcut: ['Meta', 'd'],
    voiceInputDevice: 'default',
    sopComplete: false,
    onboardingComplete: false,
    userCredits: 0,
    modelTier: 'free',
    membershipTier: 'free',
    autoLaunchExplicitlySet: false,
    autoLaunch: false,
    soundEnabled: true,
    notificationsEnabled: true
  }
}

/** Merge defaults into existing settings, preserving existing values */
export function mergeDefaults(
  existing: PetclawSettings,
  defaults: PetclawSettings
): PetclawSettings {
  const merged = { ...existing }
  for (const [key, value] of Object.entries(defaults)) {
    if ((merged as Record<string, unknown>)[key] === undefined) {
      ;(merged as Record<string, unknown>)[key] = value
    }
  }
  return merged
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
  const booleanKeys = [
    'onboardingComplete',
    'sopComplete',
    'autoLaunchExplicitlySet',
    'autoLaunch',
    'soundEnabled',
    'notificationsEnabled'
  ]
  if (booleanKeys.includes(key)) {
    return value === 'true'
  }

  if (key === 'gatewayPort') {
    const port = Number(value)
    return Number.isFinite(port) ? port : value
  }

  return value
}
