import { useState, useEffect } from 'react'

import { Search } from 'lucide-react'

import { useI18n } from '../../i18n'

interface SkillItem {
  id: string
  name: string
  description: string
  enabled: boolean
}

export function SkillsPage() {
  const { t } = useI18n()
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    window.api.skills.list().then((list: unknown) => {
      setSkills(list as SkillItem[])
    })
  }, [])

  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
  )

  const handleToggle = (id: string, enabled: boolean) => {
    window.api.skills.setEnabled(id, enabled)
    // 乐观更新：先在本地更新状态，不等待服务端确认
    setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)))
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="drag-region h-[52px] shrink-0" />
      <div className="flex-1 overflow-y-auto px-8 py-4">
        <h1 className="text-[20px] font-bold text-text-primary mb-1">{t('skills.title')}</h1>
        <p className="text-[13px] text-text-tertiary mb-6">{t('skills.subtitle')}</p>

        {/* 搜索框 */}
        <div className="relative mb-4">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('skills.searchPlaceholder')}
            className="w-full pl-9 pr-4 py-2.5 rounded-[10px] bg-bg-input border-none text-[14px] text-text-primary outline-none placeholder:text-text-tertiary"
          />
        </div>

        {/* 技能列表 */}
        <div className="rounded-[14px] bg-bg-card border border-border overflow-hidden">
          {filtered.length === 0 && (
            <div className="px-5 py-8 text-center text-[13px] text-text-tertiary">
              {search ? t('skills.noMatch') : t('skills.noSkills')}
            </div>
          )}
          {filtered.map((skill, i) => (
            <div
              key={skill.id}
              className={`flex items-center justify-between px-5 py-4 ${i < filtered.length - 1 ? 'border-b border-border' : ''}`}
            >
              <div>
                <span className="text-[14px] font-medium text-text-primary">{skill.name}</span>
                <p className="text-[13px] text-text-tertiary mt-0.5">{skill.description}</p>
              </div>
              {/* Toggle 开关 */}
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={(e) => handleToggle(skill.id, e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-bg-hover peer-focus:outline-none rounded-full peer peer-checked:bg-accent transition-colors duration-[120ms]" />
                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform duration-[120ms]" />
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
