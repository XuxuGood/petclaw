import { describe, it, expect } from 'vitest'
import { zh } from '../../src/i18n/locales/zh'
import { en } from '../../src/i18n/locales/en'

describe('i18n locale completeness', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()

  it('zh and en have the same keys', () => {
    expect(zhKeys).toEqual(enKeys)
  })

  it('no empty values in zh', () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value.trim(), `zh key "${key}" is empty`).not.toBe('')
    }
  })

  it('no empty values in en', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `en key "${key}" is empty`).not.toBe('')
    }
  })

  it('interpolation placeholders match between locales', () => {
    const placeholderRegex = /\{(\w+)\}/g
    for (const key of zhKeys) {
      const zhPlaceholders = [...zh[key].matchAll(placeholderRegex)].map((m) => m[1]).sort()
      const enPlaceholders = [...en[key].matchAll(placeholderRegex)].map((m) => m[1]).sort()
      expect(enPlaceholders, `Placeholder mismatch for key "${key}"`).toEqual(zhPlaceholders)
    }
  })
})
