// 目录技能多选子组件，带搜索过滤
// 通过 IPC skills:list 获取所有技能，支持名称/描述关键词过滤和多选
import { useState, useEffect } from 'react'

import { Check } from 'lucide-react'

interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
}

interface DirectorySkillSelectorProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function DirectorySkillSelector({ selectedIds, onChange }: DirectorySkillSelectorProps) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [search, setSearch] = useState('')

  // 挂载时从主进程加载技能列表
  useEffect(() => {
    window.api.skills.list().then((list: unknown) => {
      setSkills(list as Skill[])
    })
  }, [])

  // 同时匹配名称和描述，大小写不敏感
  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
  )

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((sid) => sid !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索技能..."
        className="w-full px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
      <div className="max-h-[300px] overflow-y-auto space-y-1">
        {filtered.map((skill) => {
          const isSelected = selectedIds.includes(skill.id)
          return (
            <button
              key={skill.id}
              onClick={() => toggle(skill.id)}
              className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-[13px] transition-colors duration-[120ms] ${
                isSelected ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-bg-hover'
              }`}
            >
              {/* 自定义 checkbox，选中时填充 accent 色 */}
              <div
                className={`w-4 h-4 rounded-[4px] border flex items-center justify-center shrink-0 ${
                  isSelected ? 'bg-accent border-accent' : 'border-border'
                }`}
              >
                {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-text-primary">{skill.name}</div>
                {skill.description && (
                  <div className="text-[12px] text-text-tertiary truncate">{skill.description}</div>
                )}
              </div>
            </button>
          )
        })}
      </div>
      <div className="text-[12px] text-text-tertiary">已选 {selectedIds.length} 个技能</div>
    </div>
  )
}
