// src/renderer/src/chat/components/CronEditDialog.tsx
import { useState, useEffect } from 'react'
import { X, Clock, FolderOpen, Calendar, Paperclip, ChevronDown } from 'lucide-react'

import { useI18n } from '../../i18n'

type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'custom'

// cron 表达式中星期几的数值（与 WEEKDAY_LABELS 顺序对应）
const WEEKDAY_CRON_VALUES = [1, 2, 3, 4, 5, 6, 0]

interface CronEditDialogProps {
  isOpen: boolean
  taskId: string | null
  initialData?: {
    name: string
    schedule: { kind: string; expr?: string }
    payload: { message: string }
  }
  onClose: () => void
  onSaved: () => void
}

export function CronEditDialog({
  isOpen,
  taskId,
  initialData,
  onClose,
  onSaved
}: CronEditDialogProps) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [frequency, setFrequency] = useState<ScheduleFrequency>('daily')
  const [time, setTime] = useState('09:00')
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([1])
  const [prompt, setPrompt] = useState('')
  const [cwd, setCwd] = useState('')
  const [customCron, setCustomCron] = useState('')
  const [saving, setSaving] = useState(false)

  // 从 i18n 获取星期几标签，保证语言切换时响应式更新
  const weekdayLabels = t('cronEdit.weekdayLabels').split(',')

  useEffect(() => {
    if (!isOpen) return
    if (initialData) {
      setName(initialData.name)
      setPrompt(initialData.payload.message)
      if (initialData.schedule.kind === 'cron' && initialData.schedule.expr) {
        parseCronExpr(initialData.schedule.expr)
      }
    } else {
      setName('')
      setFrequency('daily')
      setTime('09:00')
      setSelectedWeekdays([1])
      setPrompt('')
      setCwd('')
      setCustomCron('')
    }
  }, [isOpen, initialData])

  const parseCronExpr = (expr: string) => {
    const parts = expr.split(/\s+/)
    if (parts.length < 5) return
    const [minute, hour, , , dow] = parts
    setTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`)
    if (dow === '*') {
      setFrequency('daily')
    } else if (dow === '1-5') {
      setFrequency('weekly')
      setSelectedWeekdays([1, 2, 3, 4, 5])
    } else {
      setFrequency('weekly')
      setSelectedWeekdays(dow.split(',').map(Number))
    }
  }

  const buildCronExpr = (): string => {
    if (frequency === 'custom') return customCron
    const [h, m] = time.split(':')
    if (frequency === 'daily') return `${parseInt(m)} ${parseInt(h)} * * *`
    if (frequency === 'weekly') {
      const days = selectedWeekdays.sort().join(',')
      return `${parseInt(m)} ${parseInt(h)} * * ${days}`
    }
    if (frequency === 'monthly') return `${parseInt(m)} ${parseInt(h)} 1 * *`
    return `${parseInt(m)} ${parseInt(h)} * * *`
  }

  const toggleWeekday = (dayValue: number) => {
    setSelectedWeekdays((prev) =>
      prev.includes(dayValue) ? prev.filter((d) => d !== dayValue) : [...prev, dayValue]
    )
  }

  const handleSave = async () => {
    if (!name.trim() || !prompt.trim()) return
    setSaving(true)
    try {
      const input = {
        name: name.trim(),
        enabled: true,
        schedule: { kind: 'cron' as const, expr: buildCronExpr() },
        sessionTarget: 'main' as const,
        wakeMode: 'always' as const,
        payload: { kind: 'agentTurn' as const, message: prompt.trim() }
      }
      if (taskId) {
        await window.api.scheduler.update(taskId, input)
      } else {
        await window.api.scheduler.create(input)
      }
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleSelectCwd = async () => {
    const dir = window.prompt(t('cwdSelector.promptPath'))
    if (dir) setCwd(dir)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
      <div className="bg-bg-root rounded-[14px] shadow-lg w-[540px] max-h-[85vh] flex flex-col overflow-hidden">
        {/* 标题 */}
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <h2 className="text-[17px] font-semibold text-text-primary">
              {taskId ? t('cronEdit.editTitle') : t('cronEdit.createTitle')}
            </h2>
            <p className="text-[13px] text-text-tertiary mt-1">{t('cronEdit.subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-[8px] hover:bg-bg-hover transition-colors shrink-0"
          >
            <X size={18} className="text-text-tertiary" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {/* 任务名称 */}
          <div className="mb-5">
            <label className="block text-[14px] font-medium text-text-primary mb-2">
              {t('cronEdit.taskName')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('cronEdit.taskNamePlaceholder')}
              className="w-full px-4 py-3 text-[14px] rounded-[10px] bg-bg-root border border-border text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
          </div>

          {/* 计划时间 */}
          <div className="mb-5">
            <label className="block text-[14px] font-medium text-text-primary mb-2">
              {t('cronEdit.schedule')}
            </label>
            <div className="flex items-center gap-3">
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)}
                className="px-4 py-3 text-[14px] rounded-[10px] bg-bg-root border border-border text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40 min-w-[120px]"
              >
                <option value="daily">{t('cronEdit.daily')}</option>
                <option value="weekly">{t('cronEdit.weekly')}</option>
                <option value="monthly">{t('cronEdit.monthly')}</option>
                <option value="custom">{t('cronEdit.customCron')}</option>
              </select>

              {frequency !== 'custom' ? (
                <div className="relative">
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="px-4 py-3 pr-10 text-[14px] rounded-[10px] bg-bg-root border border-border text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                  <Clock
                    size={16}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
                  />
                </div>
              ) : (
                <input
                  type="text"
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  placeholder="0 9 * * 1-5"
                  className="flex-1 px-4 py-3 text-[14px] font-mono rounded-[10px] bg-bg-root border border-border text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              )}
            </div>

            {/* 星期选择器（仅每周模式） */}
            {frequency === 'weekly' && (
              <div className="flex items-center gap-2 mt-3">
                {weekdayLabels.map((label, idx) => {
                  const cronValue = WEEKDAY_CRON_VALUES[idx]
                  const isActive = selectedWeekdays.includes(cronValue)
                  return (
                    <button
                      key={cronValue}
                      onClick={() => toggleWeekday(cronValue)}
                      className={`w-9 h-9 rounded-full text-[13px] font-medium transition-all duration-[120ms] active:scale-[0.96] ${
                        isActive
                          ? 'bg-text-primary text-white'
                          : 'bg-bg-hover text-text-secondary hover:bg-bg-active'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Prompt */}
          <div className="mb-4">
            <div className="border border-border rounded-[10px] overflow-hidden">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                placeholder={t('cronEdit.promptPlaceholder')}
                className="w-full px-4 py-3 text-[14px] text-text-primary bg-bg-root resize-none focus:outline-none placeholder:text-text-tertiary"
              />
              {/* 工具栏 */}
              <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-bg-root">
                <button
                  onClick={handleSelectCwd}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-[8px] transition-colors"
                >
                  <FolderOpen size={14} />
                  {cwd ? cwd.split('/').pop() : t('cronEdit.selectDir')}
                </button>
                <button className="p-1.5 text-text-tertiary hover:text-text-secondary rounded-[6px] hover:bg-bg-hover transition-colors">
                  <Calendar size={16} />
                </button>
                <button className="p-1.5 text-text-tertiary hover:text-text-secondary rounded-[6px] hover:bg-bg-hover transition-colors">
                  <Paperclip size={16} />
                </button>
                <div className="flex-1" />
                <button className="flex items-center gap-1 px-2 py-1 text-[12px] text-text-tertiary hover:text-text-secondary rounded-[6px] hover:bg-bg-hover transition-colors">
                  <span>{t('cronEdit.standard')}</span>
                  <ChevronDown size={12} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-[14px] text-text-secondary hover:text-text-primary transition-colors active:scale-[0.96] duration-[120ms]"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !prompt.trim() || saving}
            className="px-5 py-2.5 text-[14px] rounded-[10px] bg-text-primary text-white hover:opacity-90 transition-all active:scale-[0.96] duration-[120ms] disabled:opacity-40"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
