import { useState, useEffect } from 'react'

import { useI18n } from '../../i18n'

interface SkillItem {
  id: string
  name: string
  description: string
  enabled: boolean
}

interface SkillsPageProps {
  /** 顶栏传入的搜索关键词 */
  search?: string
  refreshSignal?: number
}

export function SkillsPage({ search: externalSearch = '', refreshSignal = 0 }: SkillsPageProps) {
  const { t } = useI18n()
  const [skills, setSkills] = useState<SkillItem[]>([])

  useEffect(() => {
    window.api.skills.list().then((list: unknown) => {
      setSkills(list as SkillItem[])
    })
  }, [refreshSignal])

  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(externalSearch.toLowerCase()) ||
      s.description.toLowerCase().includes(externalSearch.toLowerCase())
  )

  const handleToggle = (id: string, enabled: boolean) => {
    window.api.skills.setEnabled(id, enabled)
    // 乐观更新：先在本地更新状态，不等待服务端确认
    setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)))
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="page-scroll">
        <div className="page-container-workbench workspace-page-container">
          <div className="page-hero">
            <h1 className="page-title">{t('skills.title')}</h1>
            <p className="page-subtitle">{t('skills.subtitle')}</p>
          </div>

          {/* 技能列表 */}
          <div className="ui-card overflow-hidden">
            {filtered.length === 0 && (
              <div className="px-5 py-8 text-center text-[13px] text-text-tertiary">
                {externalSearch ? t('skills.noMatch') : t('skills.noSkills')}
              </div>
            )}
            {filtered.map((skill, i) => (
              <div
                key={skill.id}
                className={`flex min-w-0 items-center justify-between gap-4 px-5 py-4 ${i < filtered.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <span className="text-[14px] font-medium text-text-primary">{skill.name}</span>
                  <p className="text-[13px] text-text-tertiary mt-0.5 leading-[1.55]">
                    {skill.description}
                  </p>
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
    </div>
  )
}
