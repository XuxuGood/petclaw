import { useEffect, useReducer } from 'react'
import { zh, en, interpolate } from '@petclaw/shared/i18n'
import type { Locale } from '@petclaw/shared/i18n'

const locales: Record<Locale, Record<string, string>> = { zh, en }

class I18nService {
  private locale: Locale = 'zh'
  private listeners = new Set<() => void>()

  init(locale: Locale): void {
    this.locale = locale
  }

  t(key: string, params?: Record<string, string>): string {
    const template = locales[this.locale]?.[key]
    if (!template) return key
    return interpolate(template, params)
  }

  // 切换语言并通知主进程同步，再触发所有订阅者重渲染
  setLanguage(locale: Locale): void {
    if (this.locale === locale) return
    this.locale = locale
    window.api?.setLanguage?.(locale)
    for (const listener of this.listeners) {
      listener()
    }
  }

  getLanguage(): Locale {
    return this.locale
  }

  // 返回取消订阅函数，供 useEffect cleanup 使用
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const i18nService = new I18nService()

export function useI18n() {
  // useReducer 作为强制重渲染触发器，无需实际状态
  const [, forceUpdate] = useReducer((c: number) => c + 1, 0)

  useEffect(() => {
    return i18nService.subscribe(forceUpdate)
  }, [])

  return {
    t: i18nService.t.bind(i18nService),
    language: i18nService.getLanguage()
  }
}
