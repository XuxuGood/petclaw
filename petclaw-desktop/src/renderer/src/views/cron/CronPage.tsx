// src/renderer/src/chat/components/CronPage.tsx
import { useState, useEffect, useCallback } from 'react'
import { Clock, Plus, MoreHorizontal, Play, Trash2, Edit3, Info, Sparkles } from 'lucide-react'

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

// cron 表达式转人类可读描述
function cronToDescription(expr: string): string {
  const parts = expr.split(/\s+/)
  if (parts.length < 5) return expr
  const [minute, hour, , , dow] = parts
  const timeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`

  if (dow === '*') return `每天 ${timeStr}`
  if (dow === '1-5') return `工作日 ${timeStr}`
  if (dow === '0,6' || dow === '6,0') return `周末 ${timeStr}`

  const dayNames = ['日', '一', '二', '三', '四', '五', '六']
  const days = dow.split(',').map((d) => dayNames[parseInt(d)] ?? d)
  if (days.length === 1) return `每周${days[0]} ${timeStr}`
  return `每周${days.join('、')} ${timeStr}`
}

export function CronPage() {
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

  const handleCreate = () => {
    setEditingTaskId(null)
    setEditingData(undefined)
    setEditDialogOpen(true)
  }

  const TABS: Array<{ id: CronTab; label: string }> = [
    { id: 'tasks', label: '我的定时任务' },
    { id: 'runs', label: '执行记录' }
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 拖拽区 + 按钮 */}
      <div className="drag-region h-[52px] shrink-0 flex items-center justify-end pr-5 gap-2">
        <button className="no-drag flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary transition-colors active:scale-[0.96] duration-[120ms]">
          <Sparkles size={13} />
          通过 QoderWork 创建
        </button>
        <button
          onClick={handleCreate}
          className="no-drag flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-[8px] bg-text-primary text-white hover:opacity-90 transition-all active:scale-[0.96] duration-[120ms]"
        >
          <Plus size={13} />
          新建定时任务
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[800px] mx-auto px-6 py-2">
          {/* 标题 */}
          <h1 className="text-[24px] font-bold text-text-primary mb-1">定时任务</h1>
          <p className="text-[14px] text-text-tertiary mb-5">
            设置自动化任务，让 QoderWork 按计划帮你完成重复性工作
          </p>

          {/* 信息条 */}
          <div className="flex items-center gap-3 px-4 py-3 mb-5 bg-blue-50 border border-blue-100 rounded-[10px]">
            <Info size={16} className="text-blue-500 shrink-0" />
            <p className="text-[13px] text-blue-700 flex-1">定时任务仅在电脑保持唤醒时运行</p>
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
              ) : tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <Clock size={48} className="text-text-tertiary mb-4" strokeWidth={1.25} />
                  <h3 className="text-[15px] font-medium text-text-primary mb-1">还没有定时任务</h3>
                  <p className="text-[13px] text-text-tertiary mb-4">
                    创建你的第一个定时任务，让 QoderWork 自动帮你完成
                  </p>
                  <button
                    onClick={handleCreate}
                    className="flex items-center gap-1.5 px-4 py-2 text-[13px] rounded-[10px] bg-accent text-white hover:bg-accent-hover transition-colors active:scale-[0.96] duration-[120ms]"
                  >
                    <Plus size={14} />
                    新建定时任务
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="relative rounded-[14px] border border-border p-4 hover:border-text-tertiary/30 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        {/* 圆形 checkbox */}
                        <button
                          onClick={() => handleToggle(task.id, !task.enabled)}
                          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                            task.enabled ? 'border-accent bg-accent' : 'border-gray-300'
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
                          <h3 className="text-[14px] font-semibold text-text-primary mb-1">
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
                            <div className="absolute right-0 top-8 w-[140px] bg-bg-root border border-border rounded-[10px] shadow-lg py-1 z-10">
                              <button
                                onClick={() => handleEdit(task)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-text-secondary hover:bg-bg-hover transition-colors"
                              >
                                <Edit3 size={13} />
                                编辑
                              </button>
                              <button
                                onClick={() => handleRunManually(task.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-text-secondary hover:bg-bg-hover transition-colors"
                              >
                                <Play size={13} />
                                手动执行
                              </button>
                              <button
                                onClick={() => {
                                  handleDelete(task.id)
                                  setMenuOpenId(null)
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-red-500 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 size={13} />
                                删除
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 底部时间描述 */}
                      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border">
                        <Clock size={13} className="text-text-tertiary" />
                        <span className="text-[12px] text-text-tertiary">
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
              <div className="flex items-center gap-3 mb-4">
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
                      {range === 'day' ? '按天' : range === 'week' ? '按周' : '按月'}
                    </button>
                  ))}
                </div>
              </div>

              {runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <Clock size={48} className="text-text-tertiary mb-4" strokeWidth={1.25} />
                  <h3 className="text-[15px] font-medium text-text-primary mb-1">暂无执行记录</h3>
                  <p className="text-[13px] text-text-tertiary">
                    当定时任务开始执行后，记录将显示在这里
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {runs.map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center gap-3 px-4 py-3 rounded-[10px] hover:bg-bg-hover transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] text-text-primary">
                          {run.taskName ?? run.taskId}
                        </span>
                      </div>
                      <span className="text-[12px] text-text-tertiary">
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
                            ? 'bg-green-50 text-green-600'
                            : run.status === 'error'
                              ? 'bg-red-50 text-red-500'
                              : run.status === 'running'
                                ? 'bg-blue-50 text-blue-500'
                                : 'bg-gray-100 text-text-tertiary'
                        }`}
                      >
                        {run.status === 'success'
                          ? '成功'
                          : run.status === 'error'
                            ? '失败'
                            : run.status === 'running'
                              ? '运行中'
                              : '跳过'}
                      </span>
                      {run.durationMs !== null && (
                        <span className="text-[12px] text-text-tertiary w-[60px] text-right">
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
