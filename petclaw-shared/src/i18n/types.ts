export type Locale = 'zh' | 'en'

export const SUPPORTED_LOCALES: Locale[] = ['zh', 'en']

export const DEFAULT_LOCALE: Locale = 'zh'

// 从系统 locale 字符串推断 Locale（zh-CN/zh-TW → zh，其余 → en）
export function resolveLocale(systemLocale: string): Locale {
  if (systemLocale.startsWith('zh')) return 'zh'
  return 'en'
}

// 插值：将 {placeholder} 替换为 params 中的值
export function interpolate(template: string, params?: Record<string, string>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`)
}
