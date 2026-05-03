import { useState, useEffect } from 'react'
import {
  ListChecks,
  Package,
  Puzzle,
  ChevronDown,
  ChevronRight,
  Loader2,
  PanelRightClose
} from 'lucide-react'

import { useI18n } from '../i18n'
import { WorkspaceHeader } from './workspace/WorkspaceHeader'

interface TaskMonitorPanelProps {
  sessionId: string
  onClose: () => void
}

/**
 * 右侧任务监控面板（骨架版）。
 * 三个默认展开的区域：待办任务 / 产物 / 技能与 MCP。
 * 上下文用量不再作为面板区域，已改为输入框附近的内联圆环指示器；
 * 见 ContextUsageIndicator。完整数据对接待 Task 18 Cowork 实现后补充。
 */
export function TaskMonitorPanel({ sessionId, onClose }: TaskMonitorPanelProps) {
  const { t } = useI18n()
  // 三个区域统一默认展开，便于用户一眼看全会话状态；用户可按需折叠。
  const [todoOpen, setTodoOpen] = useState(true)
  const [artifactsOpen, setArtifactsOpen] = useState(true)
  const [skillsOpen, setSkillsOpen] = useState(true)

  // 占位：后续从 cowork session 数据中读取
  const loading = false
  void sessionId

  return (
    <aside className="flex h-full w-full min-w-0 flex-col overflow-y-auto bg-transparent xl:w-[var(--size-monitor-panel)] xl:max-w-[28vw] xl:min-w-[220px]">
      <WorkspaceHeader
        className="workspace-monitor-header"
        title={<span className="workspace-panel-title">{t('taskMonitor.title')}</span>}
        trailing={
          <button
            type="button"
            onClick={onClose}
            className="panel-toggle ui-focus"
            aria-label={t('common.close')}
          >
            <PanelRightClose size={15} strokeWidth={1.9} />
          </button>
        }
      />
      <div className="space-y-1 px-3 pb-3 pt-2">
        {/* 待办区域 */}
        <section className="task-monitor-section">
          <SectionHeader
            icon={ListChecks}
            label={t('taskMonitor.todoTasks')}
            open={todoOpen}
            onToggle={() => setTodoOpen((v) => !v)}
          />
          {todoOpen && (
            <div className="px-2 pb-1 pt-0.5">
              {loading ? <LoadingRow /> : <EmptyHint text={t('taskMonitor.noTodo')} />}
            </div>
          )}
        </section>

        {/* 产物区域 */}
        <section className="task-monitor-section">
          <SectionHeader
            icon={Package}
            label={t('taskMonitor.artifacts')}
            open={artifactsOpen}
            onToggle={() => setArtifactsOpen((v) => !v)}
          />
          {artifactsOpen && (
            <div className="px-2 pb-1 pt-0.5">
              {loading ? <LoadingRow /> : <EmptyHint text={t('taskMonitor.noArtifacts')} />}
            </div>
          )}
        </section>

        {/* 技能与 MCP 区域 */}
        <section className="task-monitor-section">
          <SectionHeader
            icon={Puzzle}
            label={t('taskMonitor.skillsAndMcp')}
            open={skillsOpen}
            onToggle={() => setSkillsOpen((v) => !v)}
          />
          {skillsOpen && (
            <div className="px-2 pb-1 pt-0.5">
              <ActiveSkillsSection />
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}

// --------------- 内部子组件 ---------------

interface SectionHeaderProps {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
  label: string
  open: boolean
  onToggle: () => void
}

function SectionHeader({ icon: Icon, label, open, onToggle }: SectionHeaderProps) {
  return (
    <button onClick={onToggle} className="task-monitor-section-header ui-focus">
      <Icon size={14} strokeWidth={1.9} className="shrink-0 text-text-tertiary" />
      <span className="task-monitor-section-title">{label}</span>
      {open ? (
        <ChevronDown size={13} strokeWidth={1.9} className="text-text-tertiary" />
      ) : (
        <ChevronRight size={13} strokeWidth={1.9} className="text-text-tertiary" />
      )}
    </button>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <p className="px-1 py-1 text-[12px] leading-relaxed text-text-tertiary">{text}</p>
}

function LoadingRow() {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-1.5 py-1 px-1 text-text-tertiary">
      <Loader2 size={12} strokeWidth={2} className="animate-spin" />
      <span className="text-[11.5px]">{t('common.loading')}</span>
    </div>
  )
}

/** 技能与 MCP 子区域：列出当前会话启用的技能（骨架版） */
function ActiveSkillsSection() {
  const { t } = useI18n()
  const [skills, setSkills] = useState<Array<{ id: string; name: string; enabled: boolean }>>([])

  useEffect(() => {
    window.api.skills.list().then((raw) => {
      if (!Array.isArray(raw)) return
      const list = raw as Array<{ id: string; name: string; enabled: boolean }>
      setSkills(list.filter((s) => s.enabled))
    })
  }, [])

  if (skills.length === 0) return <EmptyHint text={t('taskMonitor.noSkills')} />

  return (
    <div className="space-y-0.5">
      {skills.map((skill) => (
        <div
          key={skill.id}
          className="flex items-center gap-2 px-1 py-1 rounded-[8px] text-[12px] text-text-secondary"
        >
          <Puzzle size={12} strokeWidth={2} className="text-brand shrink-0" />
          <span className="truncate">{skill.name}</span>
        </div>
      ))}
    </div>
  )
}
