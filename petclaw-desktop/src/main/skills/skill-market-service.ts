import fs from 'fs'
import path from 'path'
import { parse as parseYaml } from 'yaml'
import type {
  MarketplaceListResult,
  MarketSkill,
  SkillExample,
  SkillMarketplaceCache,
  SkillMarketResponse,
  SkillMarketSource,
  SkillMarketSourceTestResult
} from './skill-types'

interface SkillMarketServiceOptions {
  cacheDir: string
  metadataRoot: string
  sources: SkillMarketSource[] | (() => SkillMarketSource[])
  saveSources?: (sources: unknown) => SkillMarketSource[]
  fetchJson?: (endpoint: string) => Promise<unknown>
  now?: () => number
}

interface MemoryCacheEntry {
  result: MarketplaceListResult
  fetchedAt: number
}

interface FetchSourcesResult extends MarketplaceListResult {
  successfulSources: number
}

const CACHE_FILE_NAME = 'skills.json'
const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 15_000
const SAFE_SKILL_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/
const OFFICIAL_SOURCE_IDS = new Set(['petclaw-official', 'official'])

export class SkillMarketService {
  private memoryCache: MemoryCacheEntry | null = null
  private fetchJson: (endpoint: string) => Promise<unknown>
  private now: () => number

  constructor(private options: SkillMarketServiceOptions) {
    this.fetchJson = options.fetchJson ?? defaultFetchJson
    this.now = options.now ?? Date.now
  }

  listSources(): SkillMarketSource[] {
    return this.getSources()
  }

  saveSources(sources: unknown): SkillMarketSource[] {
    if (!this.options.saveSources) throw new Error('skills.marketSourceReadonly')
    const saved = this.options.saveSources(sources)
    this.memoryCache = null
    return this.getSourcesWithCustom(saved)
  }

  async testSource(source: unknown): Promise<SkillMarketSourceTestResult> {
    if (!isSkillMarketSourceConfig(source)) {
      return { ok: false, error: 'skills.marketSourceInvalidPayload' }
    }
    try {
      const response = parseMarketResponse(await this.fetchJson(source.endpoint), source)
      return {
        ok: true,
        skillCount: response.marketSkills.length,
        updatedAt: response.updatedAt
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async listMarketplace(options: { refresh: boolean }): Promise<MarketplaceListResult> {
    if (
      !options.refresh &&
      this.memoryCache &&
      this.now() - this.memoryCache.fetchedAt < MEMORY_CACHE_TTL_MS
    ) {
      return this.memoryCache.result
    }

    const fetched = await this.fetchSources()
    const result = toMarketplaceListResult(fetched)
    if (fetched.successfulSources > 0 || this.getSources().length === 0) {
      this.writeCache(result)
      this.memoryCache = { result, fetchedAt: this.now() }
      return result
    }

    const cached = this.readCache()
    if (cached) {
      const result: MarketplaceListResult = {
        ...cached,
        fromCache: true,
        sourceErrors: fetched.sourceErrors
      }
      this.memoryCache = { result, fetchedAt: this.now() }
      return result
    }

    return result
  }

  loadBundledExamples(slug: string): SkillExample[] {
    const normalizedSlug = normalizeSkillSlug(slug)
    if (!isSafeSkillSlug(normalizedSlug)) return []

    const filePath = path.join(
      this.options.metadataRoot,
      normalizedSlug,
      '.skill-metadata.yaml'
    )
    if (!fs.existsSync(filePath)) return []

    try {
      const parsed = parseYaml(fs.readFileSync(filePath, 'utf8')) as unknown
      if (!isRecord(parsed) || !Array.isArray(parsed.examples)) return []
      return parsed.examples.flatMap((item) => (isSkillExample(item) ? [item] : []))
    } catch {
      return []
    }
  }

  private async fetchSources(): Promise<FetchSourcesResult> {
    const sourceErrors: MarketplaceListResult['sourceErrors'] = []
    const sourceConflicts: MarketplaceListResult['sourceConflicts'] = []
    const bySlug = new Map<string, MarketSkill>()
    let successfulSources = 0

    for (const source of sortSourcesByPriority(this.getSources().filter((item) => item.enabled !== false))) {
      try {
        const response = parseMarketResponse(await this.fetchJson(source.endpoint), source)
        successfulSources += 1
        for (const skill of response.marketSkills) {
          if (skill.status === 'removed') continue

          const normalizedSlug = normalizeSkillSlug(skill.slug)
          const existing = bySlug.get(normalizedSlug)
          if (!existing) {
            bySlug.set(normalizedSlug, { ...skill, slug: normalizedSlug })
            continue
          }

          sourceConflicts.push({
            slug: normalizedSlug,
            keptSourceId: existing.source.id,
            droppedSourceId: skill.source.id
          })
        }
      } catch (error) {
        sourceErrors.push({
          sourceId: source.id,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return {
      skills: Array.from(bySlug.values()).sort((left, right) => left.slug.localeCompare(right.slug)),
      fromCache: false,
      sourceErrors,
      sourceConflicts,
      successfulSources
    }
  }

  private readCache(): MarketplaceListResult | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.cachePath(), 'utf8')) as unknown
      if (!isSkillMarketplaceCache(parsed)) return null
      return {
        skills: parsed.skills,
        fromCache: true,
        lastFetch: parsed.lastFetch,
        sourceErrors: parsed.sourceErrors,
        sourceConflicts: []
      }
    } catch {
      return null
    }
  }

  private writeCache(result: MarketplaceListResult): void {
    fs.mkdirSync(this.options.cacheDir, { recursive: true })
    const payload: SkillMarketplaceCache = {
      version: 1,
      lastFetch: this.now(),
      skills: result.skills,
      sourceErrors: result.sourceErrors
    }
    fs.writeFileSync(this.cachePath(), `${JSON.stringify(payload, null, 2)}\n`)
  }

  private cachePath(): string {
    return path.join(this.options.cacheDir, CACHE_FILE_NAME)
  }

  private getSources(): SkillMarketSource[] {
    return typeof this.options.sources === 'function' ? this.options.sources() : this.options.sources
  }

  private getSourcesWithCustom(customSources: SkillMarketSource[]): SkillMarketSource[] {
    const readonlySources = this.getSources().filter((source) => source.readonly)
    return [...readonlySources, ...customSources]
  }
}

function toMarketplaceListResult(result: FetchSourcesResult): MarketplaceListResult {
  return {
    skills: result.skills,
    fromCache: result.fromCache,
    lastFetch: result.lastFetch,
    sourceErrors: result.sourceErrors,
    sourceConflicts: result.sourceConflicts
  }
}

async function defaultFetchJson(endpoint: string): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(endpoint, { signal: controller.signal })
    if (!response.ok) throw new Error(`Endpoint returned HTTP ${response.status}`)
    return response.json()
  } finally {
    clearTimeout(timeout)
  }
}

function parseMarketResponse(raw: unknown, source: SkillMarketSource): SkillMarketResponse {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.marketSkills)) {
    throw new Error('Invalid skill market response')
  }

  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    marketSkills: raw.marketSkills.flatMap((item) => {
      if (!isMarketSkill(item)) return []
      return [
        {
          ...item,
          slug: normalizeSkillSlug(item.slug),
          source: { ...item.source, endpoint: source.endpoint }
        }
      ]
    }),
    denylist: Array.isArray(raw.denylist)
      ? raw.denylist.flatMap((item) => (isSkillDenylistEntry(item) ? [item] : []))
      : undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSkillMarketSourceConfig(value: unknown): value is SkillMarketSource {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.endpoint === 'string' &&
    (value.enabled === undefined || typeof value.enabled === 'boolean') &&
    (value.readonly === undefined || typeof value.readonly === 'boolean')
  )
}

function isLocalizedText(value: unknown): value is { zh: string; en: string } {
  return isRecord(value) && typeof value.zh === 'string' && typeof value.en === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function normalizeSkillSlug(slug: string): string {
  return slug.trim().toLowerCase()
}

function isSafeSkillSlug(slug: string): boolean {
  return SAFE_SKILL_SLUG_RE.test(slug)
}

function isOfficialSource(source: SkillMarketSource): boolean {
  return OFFICIAL_SOURCE_IDS.has(source.id)
}

function sortSourcesByPriority(sources: SkillMarketSource[]): SkillMarketSource[] {
  return sources
    .map((source, index) => ({ source, index }))
    .sort((left, right) => {
      const officialRank =
        Number(isOfficialSource(right.source)) - Number(isOfficialSource(left.source))
      if (officialRank !== 0) return officialRank
      return left.index - right.index
    })
    .map((entry) => entry.source)
}

function isSkillExample(value: unknown): value is SkillExample {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isLocalizedText(value.title) &&
    isLocalizedText(value.description) &&
    isLocalizedText(value.prompt)
  )
}

function isSkillDenylistEntry(value: unknown): value is NonNullable<SkillMarketResponse['denylist']>[number] {
  return (
    isRecord(value) &&
    typeof value.slug === 'string' &&
    isSafeSkillSlug(normalizeSkillSlug(value.slug)) &&
    isLocalizedText(value.reason) &&
    typeof value.forceDisable === 'boolean' &&
    (value.id === undefined || typeof value.id === 'string')
  )
}

function isSkillPackage(value: unknown): value is MarketSkill['package'] {
  if (!isRecord(value) || typeof value.type !== 'string') return false

  if (value.type === 'zip') {
    return (
      typeof value.url === 'string' &&
      (value.sha256 === undefined || typeof value.sha256 === 'string') &&
      (value.size === undefined || typeof value.size === 'number')
    )
  }

  if (value.type === 'github-tree' || value.type === 'github-repo') {
    return (
      typeof value.url === 'string' &&
      (value.sha256 === undefined || typeof value.sha256 === 'string')
    )
  }

  return value.type === 'clawhub' && typeof value.url === 'string'
}

function isMarketSkill(value: unknown): value is MarketSkill {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.slug === 'string' &&
    isSafeSkillSlug(normalizeSkillSlug(value.slug)) &&
    isLocalizedText(value.name) &&
    isLocalizedText(value.description) &&
    typeof value.version === 'string' &&
    (value.category === undefined || typeof value.category === 'string') &&
    isStringArray(value.tags) &&
    isRecord(value.source) &&
    typeof value.source.id === 'string' &&
    typeof value.source.name === 'string' &&
    (value.source.author === undefined || typeof value.source.author === 'string') &&
    (value.source.homepage === undefined || typeof value.source.homepage === 'string') &&
    (value.source.endpoint === undefined || typeof value.source.endpoint === 'string') &&
    isSkillPackage(value.package) &&
    (value.skillMarkdown === undefined ||
      typeof value.skillMarkdown === 'string' ||
      isLocalizedText(value.skillMarkdown)) &&
    (value.examples === undefined ||
      (Array.isArray(value.examples) && value.examples.every(isSkillExample))) &&
    (value.status === undefined ||
      value.status === 'active' ||
      value.status === 'deprecated' ||
      value.status === 'removed')
  )
}

function isSkillMarketSourceError(value: unknown): value is MarketplaceListResult['sourceErrors'][number] {
  return (
    isRecord(value) && typeof value.sourceId === 'string' && typeof value.message === 'string'
  )
}

function isSkillMarketplaceCache(value: unknown): value is SkillMarketplaceCache {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.lastFetch === 'number' &&
    Array.isArray(value.skills) &&
    value.skills.every(isMarketSkill) &&
    Array.isArray(value.sourceErrors) &&
    value.sourceErrors.every(isSkillMarketSourceError)
  )
}
