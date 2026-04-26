import { useState, useEffect } from 'react'

import { useI18n } from '../../i18n'

export function ProfileSettings() {
  const { t } = useI18n()
  const [nickname, setNickname] = useState('')
  const [role, setRole] = useState('')
  const [saved, setSaved] = useState(false)

  // 职业角色选项（放组件内以便使用 t()）
  const ROLE_OPTIONS = [
    { value: t('profile.roles.engineer'), label: t('profile.roles.engineer') },
    { value: t('profile.roles.pm'), label: t('profile.roles.pm') },
    { value: t('profile.roles.designer'), label: t('profile.roles.designer') },
    { value: t('profile.roles.analyst'), label: t('profile.roles.analyst') },
    { value: t('profile.roles.ops'), label: t('profile.roles.ops') },
    { value: t('profile.roles.student'), label: t('profile.roles.student') },
    { value: t('profile.roles.other'), label: t('profile.roles.other') }
  ]

  // 加载用户资料
  useEffect(() => {
    Promise.all([window.api.getSetting('nickname'), window.api.getSetting('role')]).then(
      ([nick, r]) => {
        if (nick) setNickname(nick)
        if (r) setRole(r)
      }
    )
  }, [])

  const handleSave = () => {
    Promise.all([
      window.api.setSetting('nickname', nickname),
      window.api.setSetting('role', role)
    ]).then(() => {
      // 短暂显示保存成功提示
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <div>
      <h1 className="text-[20px] font-bold text-text-primary mb-1">{t('profile.title')}</h1>
      <p className="text-[13px] text-text-tertiary mb-6">{t('profile.subtitle')}</p>

      <div className="rounded-[14px] bg-bg-card border border-border overflow-hidden mb-4">
        {/* 昵称 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <label className="text-[14px] text-text-primary font-medium">
            {t('profile.nickname')}
          </label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={t('profile.nicknamePlaceholder')}
            className="w-[200px] px-3 py-1.5 rounded-[10px] bg-bg-input border-none text-[14px] text-text-primary outline-none placeholder:text-text-tertiary text-right"
          />
        </div>

        {/* 职业角色 */}
        <div className="flex items-center justify-between px-5 py-4">
          <label className="text-[14px] text-text-primary font-medium">{t('profile.role')}</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-[200px] px-3 py-1.5 rounded-[10px] bg-bg-input border-none text-[14px] text-text-primary outline-none appearance-none text-right"
          >
            <option value="">{t('profile.rolePlaceholder')}</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 保存按钮 */}
      <button
        onClick={handleSave}
        className="px-5 py-2 rounded-[10px] bg-accent text-white text-[14px] font-medium transition-all duration-[120ms] active:scale-[0.96] hover:opacity-90"
      >
        {saved ? t('profile.saved') : t('common.save')}
      </button>
    </div>
  )
}
