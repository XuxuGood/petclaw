export interface LocalizedText {
  zh: string
  en: string
}

export type SkillOrigin =
  | 'builtin'
  | 'market'
  | 'github'
  | 'clawhub'
  | 'zip'
  | 'local-folder'
  | 'expert-kit'

export type SkillRiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical'

export type SkillPackage =
  | { type: 'zip'; url: string; sha256?: string; size?: number }
  | { type: 'github-tree'; url: string; sha256?: string }
  | { type: 'github-repo'; url: string; sha256?: string }
  | { type: 'clawhub'; url: string }

export interface SkillExample {
  id: string
  title: LocalizedText
  description: LocalizedText
  prompt: LocalizedText
}

export interface MarketSkill {
  id: string
  slug: string
  name: LocalizedText
  description: LocalizedText
  version: string
  category?: string
  tags: string[]
  source: {
    id: string
    name: string
    author?: string
    homepage?: string
    endpoint?: string
  }
  package: SkillPackage
  skillMarkdown?: LocalizedText | string
  examples?: SkillExample[]
  status?: 'active' | 'deprecated' | 'removed'
  installed?: boolean
  enabled?: boolean
  updateAvailable?: boolean
  installedVersion?: string
  installId?: string
}

export interface SkillInstall {
  id: string
  slug: string
  origin: SkillOrigin
  enabled: boolean
  installedVersion?: string
  installedPath: string
  marketSourceId?: string
  removedFromBundle: boolean
  missing: boolean
  lastError?: string
  installedAt: number
  updatedAt: number
}

export interface SkillMarker {
  schemaVersion: 1
  id: string
  slug: string
  origin: SkillOrigin
  marketSourceId?: string
  marketSourceName?: string
  installedVersion?: string
  installedAt: number
  source?: {
    name: string
    homepage?: string
  }
  package?: SkillPackage
}

export interface SkillMarketSource {
  id: string
  name: string
  endpoint: string
  enabled?: boolean
  readonly?: boolean
}

export interface SkillDenylistEntry {
  id?: string
  slug: string
  reason: LocalizedText
  forceDisable: boolean
}

export interface SkillMarketResponse {
  version: 1
  updatedAt: number
  marketSkills: MarketSkill[]
  denylist?: SkillDenylistEntry[]
}

export interface SkillMarketSourceError {
  sourceId: string
  message: string
}

export interface SkillMarketSourceConflict {
  slug: string
  keptSourceId: string
  droppedSourceId: string
}

export interface SkillMarketSourceTestResult {
  ok: boolean
  skillCount?: number
  updatedAt?: number
  error?: string
}

export interface SkillMarketplaceCache {
  version: 1
  lastFetch: number
  skills: MarketSkill[]
  sourceErrors: SkillMarketSourceError[]
}

export interface MarketplaceListResult {
  skills: MarketSkill[]
  fromCache: boolean
  lastFetch?: number
  sourceErrors: SkillMarketSourceError[]
  sourceConflicts: SkillMarketSourceConflict[]
}
