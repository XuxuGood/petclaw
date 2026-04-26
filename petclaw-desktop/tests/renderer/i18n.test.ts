import { describe, it, expect, beforeEach } from 'vitest'
import { i18nService } from '../../src/renderer/src/i18n'

describe('renderer i18n service', () => {
  beforeEach(() => {
    i18nService.init('zh')
  })

  it('t() returns zh text by default', () => {
    expect(i18nService.t('common.confirm')).toBe('确认')
  })

  it('setLanguage switches to en', () => {
    i18nService.setLanguage('en')
    expect(i18nService.t('common.confirm')).toBe('Confirm')
  })

  it('t() supports interpolation', () => {
    expect(i18nService.t('error.dirNotFound', { path: '/test' })).toBe('工作目录不存在：/test')
  })

  it('t() returns key for missing keys', () => {
    expect(i18nService.t('nonexistent')).toBe('nonexistent')
  })

  it('getLanguage returns current locale', () => {
    expect(i18nService.getLanguage()).toBe('zh')
    i18nService.setLanguage('en')
    expect(i18nService.getLanguage()).toBe('en')
  })

  it('subscribe notifies on language change', () => {
    let called = false
    const unsubscribe = i18nService.subscribe(() => {
      called = true
    })
    i18nService.setLanguage('en')
    expect(called).toBe(true)
    unsubscribe()
  })

  it('unsubscribe stops notifications', () => {
    let count = 0
    const unsubscribe = i18nService.subscribe(() => {
      count++
    })
    i18nService.setLanguage('en')
    expect(count).toBe(1)
    unsubscribe()
    i18nService.setLanguage('zh')
    expect(count).toBe(1)
  })
})
