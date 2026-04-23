import { useState, useEffect } from 'react'
import { ListChecks, Package, Puzzle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

interface TaskMonitorPanelProps {
  sessionId: string
}

/**
 * 右侧任务监控面板（骨架版）。
 * 三个可折叠区域：待办任务 / 产物 / 技能与 MCP。
 * 完整数据对接待 Task 18 Cowork 实现后补充。
 */
export function TaskMonitorPanel({ sessionId }: TaskMonitorPanelProps) {
  const [todoOpen, setTodoOpen] = useState(true)
  const [artifactsOpen, setArtifactsOpen] = useState(true)
  const [skillsOpen, setSkillsOpen] = useState(false)

  // 占位：后续从 cowork session 数据中读取
  const loading = false
  void sessionId

  return (
    <div className="w-[240px] shrink-0 flex flex-col border-l border-border overflow-y-auto">
      <div className="px-3 py-3 space-y-1.5">
        {/* 待办区域 */}
        <SectionHeader
          icon={ListChecks}
          label="待办任务"
          open={todoOpen}
          onToggle={() => setTodoOpen((v) => !v)}
        />
        {todoOpen && (
          <div className="px-1 pb-2">
            {loading ? <LoadingRow /> : <EmptyHint text="暂无待办任务" />}
          </div>
        )}

        {/* 产物区域 */}
        <SectionHeader
          icon={Package}
          label="产物"
          open={artifactsOpen}
          onToggle={() => setArtifactsOpen((v) => !v)}
        />
        {artifactsOpen && (
          <div className="px-1 pb-2">
            {loading ? <LoadingRow /> : <EmptyHint text="暂无产物" />}
          </div>
        )}

        {/* 技能与 MCP 区域 */}
        <SectionHeader
          icon={Puzzle}
          label="技能与 MCP"
          open={skillsOpen}
          onToggle={() => setSkillsOpen((v) => !v)}
        />
        {skillsOpen && (
          <div className="px-1 pb-2">
            <ActiveSkillsSection />
          </div>
        )}
      </div>
    </div>
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
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-1 py-1 rounded-[10px] text-text-tertiary hover:text-text-secondary hover:bg-bg-input transition-all duration-[120ms] ease active:scale-[0.96]"
    >
      <Icon size={13} strokeWidth={2} className="shrink-0" />
      <span className="flex-1 text-left text-[12px] font-semibold uppercase tracking-wider">
        {label}
      </span>
      {open ? (
        <ChevronDown size={12} strokeWidth={2} />
      ) : (
        <ChevronRight size={12} strokeWidth={2} />
      )}
    </button>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-[11.5px] text-text-tertiary py-1 px-1">{text}</p>
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-1.5 py-1 px-1 text-text-tertiary">
      <Loader2 size={12} strokeWidth={2} className="animate-spin" />
      <span className="text-[11.5px]">加载中…</span>
    </div>
  )
}

/** 技能与 MCP 子区域：列出当前会话启用的技能（骨架版） */
function ActiveSkillsSection() {
  const [skills, setSkills] = useState<Array<{ id: string; name: string; enabled: boolean }>>([])

  useEffect(() => {
    window.api.skills.list().then((raw) => {
      if (!Array.isArray(raw)) return
      const list = raw as Array<{ id: string; name: string; enabled: boolean }>
      setSkills(list.filter((s) => s.enabled))
    })
  }, [])

  if (skills.length === 0) return <EmptyHint text="暂无启用的技能" />

  return (
    <div className="space-y-0.5">
      {skills.map((skill) => (
        <div
          key={skill.id}
          className="flex items-center gap-2 px-1 py-1 rounded-[10px] text-[12px] text-text-secondary"
        >
          <Puzzle size={12} strokeWidth={2} className="text-accent shrink-0" />
          <span className="truncate">{skill.name}</span>
        </div>
      ))}
    </div>
  )
}
