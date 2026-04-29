// 目录配置对话框：编辑目录别名、模型覆盖、技能白名单
// 只有编辑模式（目录自动注册，不能手动创建）
import { useState, useEffect, useCallback } from 'react'

import { X } from 'lucide-react'

import { useI18n } from '../i18n'
import { DirectorySkillSelector } from './DirectorySkillSelector'

type ConfigTab = 'basic' | 'skills'

interface DirectoryConfigDialogProps {
  isOpen: boolean
  directoryAgentId: string | null // null = 未打开
  onClose: () => void
  onSaved: () => void
}

export function DirectoryConfigDialog({
  isOpen,
  directoryAgentId,
  onClose,
  onSaved
}: DirectoryConfigDialogProps) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<ConfigTab>('basic')
  const [saving, setSaving] = useState(false)

  // 表单状态
  const [name, setName] = useState('')
  const [directoryPath, setDirectoryPath] = useState('')
  const [modelOverride, setModelOverride] = useState('')
  const [skillIds, setSkillIds] = useState<string[]>([])

  // 对话框打开时加载目录数据
  useEffect(() => {
    if (!isOpen || !directoryAgentId) return
    setActiveTab('basic')

    window.api.directories.get(directoryAgentId).then((dir: unknown) => {
      const d = dir as {
        path: string
        name: string | null
        modelOverride: string
        skillIds: string[]
      } | null
      if (d) {
        setName(d.name ?? '')
        setDirectoryPath(d.path)
        setModelOverride(d.modelOverride)
        setSkillIds(d.skillIds)
      }
    })
  }, [isOpen, directoryAgentId])

  const handleSave = useCallback(async () => {
    if (!directoryAgentId) return
    setSaving(true)
    try {
      await window.api.directories.updateName(directoryAgentId, name.trim())
      await window.api.directories.updateModel(directoryAgentId, modelOverride.trim())
      await window.api.directories.updateSkills(directoryAgentId, skillIds)
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }, [directoryAgentId, name, modelOverride, skillIds, onSaved, onClose])

  if (!isOpen || !directoryAgentId) return null

  const TABS: Array<{ id: ConfigTab; label: string }> = [
    { id: 'basic', label: t('dirConfig.basicInfo') },
    { id: 'skills', label: t('dirConfig.skills') }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
      <div className="bg-bg-root rounded-[14px] shadow-lg w-[560px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* 标题栏：目录名称 + 路径 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold text-text-primary truncate">
              {name || directoryPath.split('/').pop() || '目录配置'}
            </h2>
            <p className="text-[12px] text-text-tertiary truncate mt-0.5">{directoryPath}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-[8px] hover:bg-bg-hover transition-colors ml-2"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        {/* Tab 栏：纯文字，激活项底部蓝线 */}
        <div className="flex gap-4 px-5 pt-3 border-b border-border">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`pb-2.5 text-[13px] transition-colors duration-[120ms] border-b-2 ${
                activeTab === id
                  ? 'text-text-primary font-medium border-accent'
                  : 'text-text-tertiary hover:text-text-secondary border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 内容区域，可滚动 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <Field label={t('dirConfig.alias')}>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={directoryPath.split('/').pop() || ''}
                  className="w-full px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
                <p className="text-[11px] text-text-tertiary mt-1">{t('dirConfig.aliasHint')}</p>
              </Field>
              <Field label={t('dirConfig.modelOverride')}>
                <input
                  type="text"
                  value={modelOverride}
                  onChange={(e) => setModelOverride(e.target.value)}
                  placeholder={t('dirConfig.modelOverridePlaceholder')}
                  className="w-full px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
                <p className="text-[11px] text-text-tertiary mt-1">
                  {t('dirConfig.modelOverrideHint')}
                </p>
              </Field>
            </div>
          )}

          {activeTab === 'skills' && (
            <DirectorySkillSelector selectedIds={skillIds} onChange={setSkillIds} />
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] rounded-[10px] text-text-secondary hover:bg-bg-hover transition-colors active:scale-[0.96] duration-[120ms] mr-2"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-[13px] rounded-[10px] bg-accent text-white hover:bg-accent-hover transition-colors active:scale-[0.96] duration-[120ms] disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Field 子组件：统一标签 + 内容布局 ──
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] text-text-tertiary mb-1.5">{label}</label>
      {children}
    </div>
  )
}
