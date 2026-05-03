// src/renderer/src/chat/components/CronPage.tsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { Clock, Plus, MoreHorizontal, Play, Trash2, Edit3, Info } from 'lucide-react'

import { useI18n } from '../../i18n'
import { CronEditDialog } from './CronEditDialog'

type CronTab = 'tasks' | 'runs'
type TimeRange = 'day' | 'week' | 'month'

interface ScheduledTask {
  id: string
  name: string
  description: string
  enabled: boolean
  schedule: { kind: string; expr?: string }
  payload: { kind: string; message: string }
  state: {
    nextRunAtMs: number | null
    lastRunAtMs: number | null
    lastStatus: string | null
  }
}

interface TaskRun {
  id: string
  taskId: string
  taskName?: string
  status: 'success' | 'error' | 'skipped' | 'running'
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  error: string | null
}

interface CronPageProps {
  createSignal?: number
  refreshSignal?: number
  /** 顶栏传入的搜索关键词，用于本地过滤任务与执行记录。 */
  search?: string
}

export function CronPage({ createSignal = 0, refreshSignal = 0, search = '' }: CronPageProps) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<CronTab>('tasks')
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [runs, setRuns] = useState<TaskRun[]>([])
  const [loading, setLoading] = useState(true)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingData, setEditingData] = useState<
    | { name: string; schedule: { kind: string; expr?: string }; payload: { message: string } }
    | undefined
  >()
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [timeRange, setTimeRange] = useState<TimeRange>('day')
  const createSignalRef = useRef(createSignal)

  // cron 表达式转人类可读描述，依赖 i18n 的 dayNames 和格式模板
  const cronToDescription = useCallback(
    (expr: string): string => {
      const parts = expr.split(/\s+/)
      if (parts.length < 5) return expr
      const [minute, hour, , , dow] = parts
      const timeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`

      if (dow === '*') return t('cron.daily', { time: timeStr })
      if (dow === '1-5') return t('cron.weekdays', { time: timeStr })
      if (dow === '0,6' || dow === '6,0') return t('cron.weekends', { time: timeStr })

      const dayNames = t('cron.dayNames').split(',')
      const days = dow.split(',').map((d) => dayNames[parseInt(d)] ?? d)
      if (days.length === 1) return t('cron.weeklyOne', { day: days[0], time: timeStr })
      return t('cron.weeklyMulti', { days: days.join('、'), time: timeStr })
    },
    [t]
  )

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.scheduler.list()
      setTasks(list as ScheduledTask[])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRuns = useCallback(async () => {
    const list = await window.api.scheduler.listAllRuns(50)
    setRuns(list as TaskRun[])
  }, [])

  useEffect(() => {
    loadTasks()
    loadRuns()
    const unsub1 = window.api.scheduler.onStatusUpdate(() => loadTasks())
    const unsub2 = window.api.scheduler.onRefresh(() => {
      loadTasks()
      loadRuns()
    })
    return () => {
      unsub1()
      unsub2()
    }
  }, [loadTasks, loadRuns])

  const handleToggle = async (id: string, enabled: boolean) => {
    await window.api.scheduler.toggle(id, enabled)
    loadTasks()
  }

  const handleDelete = async (id: string) => {
    await window.api.scheduler.delete(id)
    loadTasks()
  }

  const handleRunManually = async (id: string) => {
    await window.api.scheduler.runManually(id)
    setMenuOpenId(null)
  }

  const handleEdit = (task: ScheduledTask) => {
    setEditingTaskId(task.id)
    setEditingData({
      name: task.name,
      schedule: task.schedule,
      payload: task.payload as { message: string }
    })
    setEditDialogOpen(true)
    setMenuOpenId(null)
  }

  const handleCreate = useCallback(() => {
    setEditingTaskId(null)
    setEditingData(undefined)
    setEditDialogOpen(true)
  }, [])

  useEffect(() => {
    if (createSignal === createSignalRef.current) return
    createSignalRef.current = createSignal
    handleCreate()
  }, [createSignal, handleCreate])

  useEffect(() => {
    if (refreshSignal === 0) return
    loadTasks()
    loadRuns()
  }, [refreshSignal, loadTasks, loadRuns])

  // Tab 数据在渲染内部定义，保证 i18n 响应式更新
  const TABS: Array<{ id: CronTab; label: string }> = [
    { id: 'tasks', label: t('cron.myTasks') },
    { id: 'runs', label: t('cron.runHistory') }
  ]
  const normalizedSearch = search.trim().toLowerCase()
  const filteredTasks = normalizedSearch
    ? tasks.filter((task) => {
        const scheduleLabel =
          task.schedule.kind === 'cron' && task.schedule.expr
            ? cronToDescription(task.schedule.expr)
            : task.schedule.kind
        return [task.name, task.payload.message, scheduleLabel].some((value) =>
          value.toLowerCase().includes(normalizedSearch)
        )
      })
    : tasks
  const filteredRuns = normalizedSearch
    ? runs.filter((run) =>
        [run.taskName, run.taskId, run.status, run.error]
          .filter((value): value is string => typeof value === 'string')
          .some((value) => value.toLowerCase().includes(normalizedSearch))
      )
    : runs

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="page-scroll">
        <div className="page-container-workbench workspace-page-container">
          <div className="page-hero">
            <h1 className="page-title">{t('cron.title')}</h1>
            <p className="page-subtitle">{t('cron.subtitle')}</p>
          </div>

          {/* 信息条 */}
          <div className="flex items-start gap-3 px-4 py-3 mb-5 bg-caution-bg border border-caution-border rounded-[8px]">
            <Info size={16} className="text-caution-icon shrink-0" />
            <p className="text-[13px] text-warning flex-1 leading-[1.55]">
              {t('cron.sleepWarning')}
            </p>
          </div>

          {/* Tab */}
          <div className="flex gap-4 mb-5 border-b border-border">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`pb-2.5 text-[14px] transition-colors duration-[120ms] border-b-2 ${
                  activeTab === id
                    ? 'text-text-primary font-semibold border-text-primary'
                    : 'text-text-tertiary hover:text-text-secondary border-transparent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 我的定时任务 */}
          {activeTab === 'tasks' && (
            <>
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <Clock size={48} className="text-text-tertiary mb-4" strokeWidth={1.25} />
                  <h3 className="text-[15px] font-medium text-text-primary mb-1">
                    {t('cron.noTasks')}
                  </h3>
                  <p className="text-[13px] text-text-tertiary mb-4">{t('cron.noTasksHint')}</p>
                  <button
                    onClick={handleCreate}
                    className="flex items-center gap-1.5 rounded-[8px] bg-accent px-4 py-2 text-[13px] text-white transition-colors duration-[120ms] hover:bg-accent-hover"
                  >
                    <Plus size={14} />
                    {t('cron.newTask')}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {filteredTasks.map((task) => (
                    <div
                      key={task.id}
                      className="relative min-w-0 rounded-[12px] border border-border p-4 hover:border-text-tertiary/30 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        {/* 圆形 checkbox */}
                        <button
                          onClick={() => handleToggle(task.id, !task.enabled)}
                          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                            task.enabled ? 'border-accent bg-accent' : 'border-border'
                          }`}
                        >
                          {task.enabled && (
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                              <path
                                d="M1 4L3.5 6.5L9 1"
                                stroke="white"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          <h3 className="text-[14px] font-semibold text-text-primary mb-1 truncate">
                            {task.name}
                          </h3>
                          <p className="text-[12px] text-text-tertiary leading-[1.5] line-clamp-3">
                            {task.payload.message}
                          </p>
                        </div>

                        {/* 更多菜单 */}
                        <div className="relative">
                          <button
                            onClick={() => setMenuOpenId(menuOpenId === task.id ? null : task.id)}
                            className="p-1 text-text-tertiary hover:text-text-secondary rounded-[6px] hover:bg-bg-hover transition-colors"
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          {menuOpenId === task.id && (
                            <div className="absolute right-0 top-8 w-[140px] bg-bg-root border border-border rounded-[8px] shadow-lg py-1 z-10">
                              <button
                                onClick={() => handleEdit(task)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-text-secondary hover:bg-bg-hover transition-colors"
                              >
                                <Edit3 size={13} />
                                {t('common.edit')}
                              </button>
                              <button
                                onClick={() => handleRunManually(task.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-text-secondary hover:bg-bg-hover transition-colors"
                              >
                                <Play size={13} />
                                {t('cron.execute')}
                              </button>
                              <button
                                onClick={() => {
                                  handleDelete(task.id)
                                  setMenuOpenId(null)
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-error hover:bg-danger-bg transition-colors"
                              >
                                <Trash2 size={13} />
                                {t('common.delete')}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 底部时间描述 */}
                      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border min-w-0">
                        <Clock size={13} className="text-text-tertiary" />
                        <span className="text-[12px] text-text-tertiary truncate">
                          {task.schedule.kind === 'cron' && task.schedule.expr
                            ? cronToDescription(task.schedule.expr as string)
                            : task.schedule.kind}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* 执行记录 */}
          {activeTab === 'runs' && (
            <div>
              {/* 筛选器 */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="flex bg-bg-hover rounded-[8px] p-0.5">
                  {(['day', 'week', 'month'] as TimeRange[]).map((range) => (
                    <button
                      key={range}
                      onClick={() => setTimeRange(range)}
                      className={`px-3 py-1.5 text-[12px] rounded-[6px] transition-all duration-[120ms] ${
                        timeRange === range
                          ? 'bg-bg-root text-text-primary font-medium shadow-sm'
                          : 'text-text-tertiary hover:text-text-secondary'
                      }`}
                    >
                      {range === 'day'
                        ? t('cron.byDay')
                        : range === 'week'
                          ? t('cron.byWeek')
                          : t('cron.byMonth')}
                    </button>
                  ))}
                </div>
              </div>

              {filteredRuns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <Clock size={48} className="text-text-tertiary mb-4" strokeWidth={1.25} />
                  <h3 className="text-[15px] font-medium text-text-primary mb-1">
                    {t('cron.noHistory')}
                  </h3>
                  <p className="text-[13px] text-text-tertiary">{t('cron.noHistoryHint')}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredRuns.map((run) => (
                    <div
                      key={run.id}
                      className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3 rounded-[8px] hover:bg-bg-hover transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] text-text-primary">
                          {run.taskName ?? run.taskId}
                        </span>
                      </div>
                      <span className="text-[12px] text-text-tertiary shrink-0">
                        {new Date(run.startedAt).toLocaleString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </span>
                      <span
                        className={`px-2 py-0.5 text-[11px] rounded-full font-medium ${
                          run.status === 'success'
                            ? 'bg-safe-bg text-success'
                            : run.status === 'error'
                              ? 'bg-danger-bg text-error'
                              : run.status === 'running'
                                ? 'bg-bg-active text-text-secondary'
                                : 'bg-bg-hover text-text-tertiary'
                        }`}
                      >
                        {run.status === 'success'
                          ? t('cron.statusSuccess')
                          : run.status === 'error'
                            ? t('cron.statusFailed')
                            : run.status === 'running'
                              ? t('cron.statusRunning')
                              : t('cron.statusSkipped')}
                      </span>
                      {run.durationMs !== null && (
                        <span className="text-[12px] text-text-tertiary w-[60px] text-right shrink-0">
                          {run.durationMs < 1000
                            ? `${run.durationMs}ms`
                            : `${(run.durationMs / 1000).toFixed(1)}s`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 编辑弹窗 */}
      <CronEditDialog
        isOpen={editDialogOpen}
        taskId={editingTaskId}
        initialData={editingData}
        onClose={() => setEditDialogOpen(false)}
        onSaved={() => {
          loadTasks()
          loadRuns()
        }}
      />
    </div>
  )
}
