import os from 'os'
import path from 'path'

import {
  DEFAULT_EVENT_MAX_CHARS,
  type LogEventInput,
  type SanitizedError,
  type SanitizedLogEvent
} from './types'

const REDACTED = '[redacted]'
const CIRCULAR = '[circular]'

const SENSITIVE_KEY_PATTERN =
  /(api[-_]?key|token|secret|password|authorization|cookie|session|refresh[-_]?token|access[-_]?token|gateway[-_]?token)/i

const SENSITIVE_VALUE_PATTERNS = [
  /(?<![?&])\b(?:api[-_]?key|token|secret|password|authorization|cookie|session|refresh[-_]?token|access[-_]?token|gateway[-_]?token)=\S+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/g,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
]

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi

export interface SanitizeOptions {
  maxChars?: number
  userDataPath?: string
  workspacePath?: string
  tempPath?: string
  homePath?: string
}

export interface SanitizedValue {
  value: unknown
  redactionCount: number
  truncated: boolean
}

function replaceAllPathSeparators(value: string): string {
  return value.split(path.sep).join('/')
}

function normalizePathText(value: string, options: SanitizeOptions): string {
  const replacements: Array<[string | undefined, string]> = [
    [options.userDataPath, '{userData}'],
    [options.workspacePath, '{workspace}'],
    [options.tempPath ?? os.tmpdir(), '{temp}'],
    [options.homePath ?? os.homedir(), '{home}']
  ]

  let next = value
  for (const [sourcePath, label] of replacements) {
    if (!sourcePath) continue
    next = next.split(sourcePath).join(label)
    next = next.split(replaceAllPathSeparators(sourcePath)).join(label)
  }
  return next
}

function redactString(value: string): { value: string; redactionCount: number } {
  let redactionCount = 0
  const urlRedacted = redactUrlQuery(value)
  redactionCount += urlRedacted.redactionCount
  let next = urlRedacted.value
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    next = next.replace(pattern, () => {
      redactionCount += 1
      return REDACTED
    })
  }
  return { value: next, redactionCount }
}

function redactUrlQuery(value: string): { value: string; redactionCount: number } {
  let redactionCount = 0
  const next = value.replace(URL_PATTERN, (rawUrl) => {
    try {
      const parsed = new URL(rawUrl)
      const sensitiveKeys = Array.from(new Set(parsed.searchParams.keys())).filter((key) =>
        SENSITIVE_KEY_PATTERN.test(key)
      )
      for (const key of sensitiveKeys) {
        const existingValues = parsed.searchParams.getAll(key)
        if (existingValues.length === 0) continue
        redactionCount += existingValues.filter((item) => item !== REDACTED).length
        parsed.searchParams.delete(key)
        for (let index = 0; index < existingValues.length; index += 1) {
          parsed.searchParams.append(key, REDACTED)
        }
      }
      return parsed.toString()
    } catch {
      return rawUrl
    }
  })
  return { value: next, redactionCount }
}

function truncateString(value: string, maxChars: number): { value: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { value, truncated: false }
  }
  return {
    value: `${value.slice(0, maxChars)}[truncated:${value.length - maxChars}]`,
    truncated: true
  }
}

function sanitizeInternal(
  value: unknown,
  options: Required<Pick<SanitizeOptions, 'maxChars'>> & SanitizeOptions,
  seen: WeakSet<object>,
  keyName?: string
): SanitizedValue {
  if (typeof value === 'string') {
    if (keyName && SENSITIVE_KEY_PATTERN.test(keyName)) {
      return { value: REDACTED, redactionCount: 1, truncated: false }
    }
    const normalized = normalizePathText(value, options)
    const redacted = redactString(normalized)
    const truncated = truncateString(redacted.value, options.maxChars)
    return {
      value: truncated.value,
      redactionCount: redacted.redactionCount,
      truncated: truncated.truncated
    }
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return { value, redactionCount: 0, truncated: false }
  }

  if (typeof value === 'bigint') {
    return { value: value.toString(), redactionCount: 0, truncated: false }
  }

  if (Array.isArray(value)) {
    let redactionCount = 0
    let truncated = false
    const next = value.slice(0, 50).map((item) => {
      const result = sanitizeInternal(item, options, seen)
      redactionCount += result.redactionCount
      truncated ||= result.truncated
      return result.value
    })
    if (value.length > 50) {
      next.push(`[truncatedItems:${value.length - 50}]`)
      truncated = true
    }
    return { value: next, redactionCount, truncated }
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return { value: CIRCULAR, redactionCount: 0, truncated: false }
    }
    seen.add(value)
    let redactionCount = 0
    let truncated = false
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 50)
    const next: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of entries) {
      const result = sanitizeInternal(entryValue, options, seen, entryKey)
      next[entryKey] = result.value
      redactionCount += result.redactionCount
      truncated ||= result.truncated
    }
    const originalCount = Object.keys(value as Record<string, unknown>).length
    if (originalCount > 50) {
      next.__truncatedKeys = originalCount - 50
      truncated = true
    }
    return { value: next, redactionCount, truncated }
  }

  return { value: String(value), redactionCount: 0, truncated: false }
}

export function sanitizeUnknownForLog(
  value: unknown,
  options: SanitizeOptions = {}
): SanitizedValue {
  return sanitizeInternal(
    value,
    {
      ...options,
      maxChars: options.maxChars ?? DEFAULT_EVENT_MAX_CHARS
    },
    new WeakSet<object>()
  )
}

function sanitizeError(error: unknown, options: SanitizeOptions): SanitizedError | undefined {
  if (!(error instanceof Error)) return undefined
  const stack = error.stack ? String(sanitizeUnknownForLog(error.stack, options).value) : undefined
  return {
    name: error.name,
    message: String(sanitizeUnknownForLog(error.message, options).value),
    ...(stack ? { stack } : {})
  }
}

export function sanitizeLogEvent(
  input: LogEventInput,
  options: SanitizeOptions & { appVersion: string }
): SanitizedLogEvent {
  const fields = sanitizeUnknownForLog(input.fields ?? {}, options)
  const message = input.message
    ? String(sanitizeUnknownForLog(input.message, options).value)
    : input.event
  const error = sanitizeError(input.error, options)

  return {
    timestamp: new Date().toISOString(),
    level: input.level,
    source: input.source,
    module: input.module,
    event: input.event,
    message,
    platform: process.platform,
    arch: process.arch,
    appVersion: options.appVersion,
    fields: fields.value as Record<string, unknown>,
    ...(error ? { error } : {}),
    redactionCount: fields.redactionCount,
    truncated: fields.truncated
  }
}
