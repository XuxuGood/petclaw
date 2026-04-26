import { useState, useEffect } from 'react'

import { useI18n, i18nService } from '../../i18n'

export function PreferenceSettings() {
  const { t } = useI18n()
  const [language, setLanguage] = useState('zh')
  const [theme, setTheme] = useState('system')
  const [fontSize, setFontSize] = useState('medium')

  // 语言选项（放组件内以便使用 t()）
  const LANGUAGE_OPTIONS = [
    { value: 'zh', label: t('preferences.languageZh') },
    { value: 'en', label: t('preferences.languageEn') }
  ]

  // 主题选项
  const THEME_OPTIONS = [
    { value: 'system', label: t('preferences.themeSystem') },
    { value: 'light', label: t('preferences.themeLight') },
    { value: 'dark', label: t('preferences.themeDark') }
  ]

  // 字号选项
  const FONT_SIZE_OPTIONS = [
    { value: 'small', label: t('preferences.fontSmall') },
    { value: 'medium', label: t('preferences.fontMedium') },
    { value: 'large', label: t('preferences.fontLarge') }
  ]

  // 从持久化存储加载偏好
  useEffect(() => {
    Promise.all([
      window.api.getSetting('language'),
      window.api.getSetting('theme'),
      window.api.getSetting('fontSize')
    ]).then(([lang, th, fs]) => {
      if (lang) setLanguage(lang)
      if (th) setTheme(th)
      if (fs) setFontSize(fs)
    })
  }, [])

  const handleChange = (key: string, value: string) => {
    window.api.setSetting(key, value)
    if (key === 'language') {
      setLanguage(value)
      // 切换语言时同步更新渲染进程 i18n 服务，触发所有订阅者重渲染
      i18nService.setLanguage(value as 'zh' | 'en')
    }
    if (key === 'theme') setTheme(value)
    if (key === 'fontSize') setFontSize(value)
  }

  return (
    <div>
      <h1 className="text-[20px] font-bold text-text-primary mb-1">{t('preferences.title')}</h1>
      <p className="text-[13px] text-text-tertiary mb-6">{t('preferences.subtitle')}</p>

      {/* 语言 */}
      <div className="rounded-[14px] bg-bg-card border border-border overflow-hidden mb-4">
        <div className="px-5 py-3 border-b border-border">
          <span className="text-[12px] text-text-tertiary font-medium uppercase tracking-wider">
            {t('preferences.language')}
          </span>
        </div>
        {LANGUAGE_OPTIONS.map((opt, i) => (
          <label
            key={opt.value}
            className={`flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-bg-hover transition-colors duration-[120ms] ${i < LANGUAGE_OPTIONS.length - 1 ? 'border-b border-border' : ''}`}
          >
            <span className="text-[14px] text-text-primary">{opt.label}</span>
            <input
              type="radio"
              name="language"
              value={opt.value}
              checked={language === opt.value}
              onChange={() => handleChange('language', opt.value)}
              className="accent-accent w-4 h-4"
            />
          </label>
        ))}
      </div>

      {/* 主题 */}
      <div className="rounded-[14px] bg-bg-card border border-border overflow-hidden mb-4">
        <div className="px-5 py-3 border-b border-border">
          <span className="text-[12px] text-text-tertiary font-medium uppercase tracking-wider">
            {t('preferences.theme')}
          </span>
        </div>
        {THEME_OPTIONS.map((opt, i) => (
          <label
            key={opt.value}
            className={`flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-bg-hover transition-colors duration-[120ms] ${i < THEME_OPTIONS.length - 1 ? 'border-b border-border' : ''}`}
          >
            <span className="text-[14px] text-text-primary">{opt.label}</span>
            <input
              type="radio"
              name="theme"
              value={opt.value}
              checked={theme === opt.value}
              onChange={() => handleChange('theme', opt.value)}
              className="accent-accent w-4 h-4"
            />
          </label>
        ))}
      </div>

      {/* 字号 */}
      <div className="rounded-[14px] bg-bg-card border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <span className="text-[12px] text-text-tertiary font-medium uppercase tracking-wider">
            {t('preferences.fontSize')}
          </span>
        </div>
        {FONT_SIZE_OPTIONS.map((opt, i) => (
          <label
            key={opt.value}
            className={`flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-bg-hover transition-colors duration-[120ms] ${i < FONT_SIZE_OPTIONS.length - 1 ? 'border-b border-border' : ''}`}
          >
            <span className="text-[14px] text-text-primary">{opt.label}</span>
            <input
              type="radio"
              name="fontSize"
              value={opt.value}
              checked={fontSize === opt.value}
              onChange={() => handleChange('fontSize', opt.value)}
              className="accent-accent w-4 h-4"
            />
          </label>
        ))}
      </div>
    </div>
  )
}
