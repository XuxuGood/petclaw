import { useState, useEffect, useMemo } from 'react'

import {
  Bot,
  Boxes,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  Inbox,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Settings,
  User,
  Zap
} from 'lucide-react'

import type { ViewType } from '../App'
import { useI18n } from '../i18n'
import { Tooltip } from './Tooltip'
import { WorkspaceHeader } from './workspace/WorkspaceHeader'

interface DirectoryInfo {
  agentId: string
  path: string
  name: string | null
}

type SessionOrigin = 'chat' | 'im' | 'scheduler' | 'hook'
type SessionStatus = 'idle' | 'running' | 'completed' | 'error'

interface Session {
  id: string
  agentId: string
  title: string
  directoryPath?: string
  origin: SessionOrigin
  status: SessionStatus
  updatedAt: number
}

interface ScheduledTask {
  id: string
  name: string
  enabled: boolean
  state?: {
    nextRunAtMs?: number | null
    lastStatus?: string | null
  }
}

interface ScheduledRun {
  id: string
  taskId: string
  taskName?: string
  sessionId: string | null
  status: 'success' | 'error' | 'skipped' | 'running'
  startedAt: string
}

type PlatformKey = 'wechat' | 'wecom' | 'dingtalk' | 'feishu'

interface ImInstance {
  id: string
  platform: PlatformKey
  name: string | null
  directoryPath: string | null
  enabled: boolean
  updatedAt: number
}

interface SidebarProps {
  activeView: ViewType
  onViewChange: (view: ViewType) => void
  currentDirectoryId: string
  onDirectoryChange: (agentId: string) => void
  activeSessionId: string | null
  onSessionSelect: (id: string) => void
  sidebarTab: 'tasks' | 'channels'
  onSidebarTabChange: (tab: 'tasks' | 'channels') => void
  onNewTask: () => void
  onSettingsOpen: () => void
  onClose: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isSessionOrigin(value: unknown): value is SessionOrigin {
  return value === 'chat' || value === 'im' || value === 'scheduler' || value === 'hook'
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return value === 'idle' || value === 'running' || value === 'completed' || value === 'error'
}

function isPlatformKey(value: unknown): value is PlatformKey {
  return value === 'wechat' || value === 'wecom' || value === 'dingtalk' || value === 'feishu'
}

function parseDirectory(value: unknown): DirectoryInfo | null {
  if (!isRecord(value)) return null
  const agentId = readString(value.agentId)
  const path = readString(value.path)
  if (!agentId || !path) return null
  return {
    agentId,
    path,
    name: readString(value.name)
  }
}

function parseSession(value: unknown): Session | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const agentId = readString(value.agentId)
  const title = readString(value.title)
  const updatedAt = readNumber(value.updatedAt)
  if (!id || !agentId || !title || updatedAt === null) return null
  return {
    id,
    agentId,
    title,
    directoryPath: readString(value.directoryPath) ?? undefined,
    origin: isSessionOrigin(value.origin) ? value.origin : 'chat',
    status: isSessionStatus(value.status) ? value.status : 'idle',
    updatedAt
  }
}

function parseScheduledTask(value: unknown): ScheduledTask | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const name = readString(value.name)
  if (!id || !name) return null
  const state = isRecord(value.state)
    ? {
        nextRunAtMs: readNumber(value.state.nextRunAtMs),
        lastStatus: readString(value.state.lastStatus)
      }
    : undefined
  return {
    id,
    name,
    enabled: value.enabled === true,
    state
  }
}

function parseScheduledRun(value: unknown): ScheduledRun | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const taskId = readString(value.taskId)
  const status = readString(value.status)
  const startedAt = readString(value.startedAt)
  if (
    !id ||
    !taskId ||
    !startedAt ||
    (status !== 'success' && status !== 'error' && status !== 'skipped' && status !== 'running')
  ) {
    return null
  }
  return {
    id,
    taskId,
    taskName: readString(value.taskName) ?? undefined,
    sessionId: readString(value.sessionId),
    status,
    startedAt
  }
}

function parseImInstance(value: unknown): ImInstance | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const platform = value.platform
  const updatedAt = readNumber(value.updatedAt)
  if (!id || !isPlatformKey(platform) || updatedAt === null) return null
  return {
    id,
    platform,
    name: readString(value.name),
    directoryPath: readString(value.directoryPath),
    enabled: value.enabled === true,
    updatedAt
  }
}

function getBasename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function formatRelativeTime(timestamp: number): string {
  const diffSeconds = Math.round((timestamp - Date.now()) / 1000)
  const absSeconds = Math.abs(diffSeconds)
  const formatter = new Intl.RelativeTimeFormat(navigator.language, { numeric: 'auto' })
  if (absSeconds < 60) return formatter.format(diffSeconds, 'second')
  if (absSeconds < 3600) return formatter.format(Math.round(diffSeconds / 60), 'minute')
  if (absSeconds < 86400) return formatter.format(Math.round(diffSeconds / 3600), 'hour')
  return formatter.format(Math.round(diffSeconds / 86400), 'day')
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id]
}

export function Sidebar({
  activeView,
  onViewChange,
  activeSessionId,
  onSessionSelect,
  sidebarTab,
  onSidebarTabChange,
  onNewTask,
  onSettingsOpen,
  onClose
}: SidebarProps) {
  const { t } = useI18n()
  const [directories, setDirectories] = useState<DirectoryInfo[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([])
  const [scheduledRuns, setScheduledRuns] = useState<ScheduledRun[]>([])
  const [imInstances, setImInstances] = useState<ImInstance[]>([])
  const [collapsedScheduledTaskIds, setCollapsedScheduledTaskIds] = useState<string[]>([])
  const [collapsedChannelGroupIds, setCollapsedChannelGroupIds] = useState<string[]>([])
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.directories.list().then((raw: unknown) => {
      if (cancelled || !Array.isArray(raw)) return
      setDirectories(raw.map(parseDirectory).filter((item): item is DirectoryInfo => item !== null))
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(media.matches)
    const handler = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    loadSessions()
  }, [])

  useEffect(() => {
    loadScheduler()
    const unsubStatus = window.api.scheduler.onStatusUpdate(() => loadScheduler())
    const unsubRefresh = window.api.scheduler.onRefresh(() => loadScheduler())
    return () => {
      unsubStatus()
      unsubRefresh()
    }
  }, [])

  useEffect(() => {
    loadImInstances()
    const unsub = window.api.im.onStatusUpdate(() => loadImInstances())
    return unsub
  }, [])

  const directoryNameByAgentId = useMemo(() => {
    return new Map(
      directories.map((directory) => [
        directory.agentId,
        directory.name ?? getBasename(directory.path)
      ])
    )
  }, [directories])

  const taskSessions = useMemo(() => {
    // 任务列表只承载用户主动发起的 Cowork session；IM 与定时任务运行回到各自分组展示。
    return sessions
      .filter((session) => session.origin === 'chat')
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [sessions])

  const runsByTaskId = useMemo(() => {
    const map = new Map<string, ScheduledRun[]>()
    for (const run of scheduledRuns) {
      const list = map.get(run.taskId) ?? []
      list.push(run)
      map.set(run.taskId, list)
    }
    return map
  }, [scheduledRuns])

  const instancesByPlatform = useMemo(() => {
    const map = new Map<PlatformKey, ImInstance[]>()
    for (const instance of imInstances) {
      const list = map.get(instance.platform) ?? []
      list.push(instance)
      map.set(instance.platform, list)
    }
    return map
  }, [imInstances])

  function loadSessions(): void {
    window.api.cowork.listSessions().then((raw: unknown) => {
      if (!Array.isArray(raw)) return
      setSessions(raw.map(parseSession).filter((item): item is Session => item !== null))
    })
  }

  function loadScheduler(): void {
    void Promise.all([window.api.scheduler.list(), window.api.scheduler.listAllRuns(30)]).then(
      ([tasksRaw, runsRaw]) => {
        if (Array.isArray(tasksRaw)) {
          setScheduledTasks(
            tasksRaw.map(parseScheduledTask).filter((item): item is ScheduledTask => item !== null)
          )
        }
        if (Array.isArray(runsRaw)) {
          setScheduledRuns(
            runsRaw.map(parseScheduledRun).filter((item): item is ScheduledRun => item !== null)
          )
        }
      }
    )
  }

  function loadImInstances(): void {
    window.api.im.listInstances().then((raw: unknown) => {
      if (!isRecord(raw) || !Array.isArray(raw.instances)) return
      setImInstances(
        raw.instances.map(parseImInstance).filter((item): item is ImInstance => item !== null)
      )
    })
  }

  function getSessionSubtitle(session: Session): string {
    const time = formatRelativeTime(session.updatedAt)
    if (session.agentId === 'main') return time
    const knownName = directoryNameByAgentId.get(session.agentId)
    if (knownName) return `${knownName} · ${time}`
    return session.directoryPath ? `${getBasename(session.directoryPath)} · ${time}` : time
  }

  function getRunStatusLabel(status: ScheduledRun['status']): string {
    if (status === 'success') return t('cron.statusSuccess')
    if (status === 'error') return t('cron.statusFailed')
    if (status === 'running') return t('cron.statusRunning')
    return t('cron.statusSkipped')
  }

  function getPlatformLabel(platform: PlatformKey): string {
    return t(`im.${platform}` as const)
  }

  function getPlatformTitle(platform: PlatformKey, instances: ImInstance[]): string {
    const label = getPlatformLabel(platform)
    if (platform !== 'wechat') return label
    const accountLabel = instances[0]?.name?.trim()
    return accountLabel ? `${label} · ${accountLabel}` : label
  }

  function handleSessionOpen(sessionId: string): void {
    onViewChange('chat')
    onSessionSelect(sessionId)
  }

  const navItems = [
    {
      key: 'skills',
      label: t('sidebar.skills'),
      icon: Zap,
      active: activeView === 'skills',
      onClick: () => onViewChange('skills')
    },
    {
      key: 'expert-kits',
      label: t('chat.actionExpertKits'),
      icon: Boxes,
      active: activeView === 'expert-kits',
      onClick: () => onViewChange('expert-kits')
    },
    {
      key: 'cron',
      label: t('sidebar.cron'),
      icon: Clock,
      active: activeView === 'cron',
      onClick: () => onViewChange('cron')
    },
    {
      key: 'im-channels',
      label: t('sidebar.imChannels'),
      icon: MessageSquare,
      active: activeView === 'im-channels',
      onClick: () => onViewChange('im-channels')
    }
  ]

  const platformOrder: PlatformKey[] = ['feishu', 'dingtalk', 'wecom', 'wechat']

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-transparent select-none">
      <WorkspaceHeader
        className="workspace-sidebar-header"
        title={
          <div className="min-w-0 pl-0.5">
            <div className="min-w-0 truncate text-[14px] leading-none tracking-tight">
              <span className="font-bold text-text-primary">PetClaw</span>
              <span className="relative top-[-1px] ml-0.5 align-top text-[10px] font-semibold text-text-tertiary">
                AI
              </span>
            </div>
          </div>
        }
        trailing={
          <button
            type="button"
            onClick={onClose}
            title={t('sidebar.close')}
            aria-label={t('sidebar.close')}
            className="panel-toggle ui-focus"
          >
            <PanelLeftClose size={15} strokeWidth={1.9} />
          </button>
        }
      />

      <div className="px-3 pb-1 pt-2.5">
        <button onClick={onNewTask} className="no-drag ui-row-button ui-focus">
          <Plus size={15} strokeWidth={1.9} />
          <span>{t('sidebar.newTask')}</span>
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                onClick={item.onClick}
                title={item.label}
                className={`no-drag ui-row-button ui-focus ${
                  item.active ? 'ui-row-button-active' : ''
                }`}
              >
                <Icon size={15} strokeWidth={item.active ? 1.95 : 1.75} />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="px-3 pt-1 pb-1.5">
        <div className="ui-segment">
          <button
            onClick={() => onSidebarTabChange('tasks')}
            className={`no-drag ui-segment-button ui-focus ${
              sidebarTab === 'tasks' ? 'ui-segment-button-active' : ''
            }`}
          >
            {t('sidebar.tasks')}
          </button>
          <button
            onClick={() => onSidebarTabChange('channels')}
            className={`no-drag ui-segment-button ui-focus ${
              sidebarTab === 'channels' ? 'ui-segment-button-active' : ''
            }`}
          >
            {t('sidebar.channels')}
          </button>
        </div>
      </div>

      {/*
        任务与频道只改变侧栏内容，不强制切换主路由。外层轨道保持原有 transform 方案；
        reduced-motion 下改为透明度切换，避免对系统减少动态偏好的用户产生空间位移。
      */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div
          className="flex h-full w-[200%] will-change-transform"
          style={{
            transform: reducedMotion
              ? 'translate3d(0, 0, 0)'
              : `translate3d(${sidebarTab === 'tasks' ? '0%' : '-50%'}, 0, 0)`,
            transition: reducedMotion ? 'none' : 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)'
          }}
        >
          <div
            className="w-1/2 shrink-0 min-h-0 overflow-y-auto px-3 pb-3"
            style={{
              opacity: reducedMotion && sidebarTab !== 'tasks' ? 0 : 1,
              transition: reducedMotion ? 'opacity var(--motion-base) ease' : undefined,
              pointerEvents: reducedMotion && sidebarTab !== 'tasks' ? 'none' : undefined
            }}
          >
            <div className="space-y-3 py-1">
              {scheduledTasks.length > 0 && (
                <section>
                  <div className="flex items-center justify-between px-2 pb-1">
                    <span className="text-[11px] font-medium text-text-tertiary">
                      {t('sidebar.scheduledTasks')}
                    </span>
                    <span className="text-[10px] text-text-tertiary tabular-nums">
                      {scheduledTasks.length}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {scheduledTasks.map((task) => {
                      const collapsed = collapsedScheduledTaskIds.includes(task.id)
                      const runs = runsByTaskId.get(task.id) ?? []
                      return (
                        <div key={task.id}>
                          <button
                            onClick={() =>
                              setCollapsedScheduledTaskIds((value) => toggleId(value, task.id))
                            }
                            className="no-drag ui-row-button ui-focus"
                            aria-expanded={!collapsed}
                          >
                            {collapsed ? (
                              <ChevronRight size={13} strokeWidth={1.8} />
                            ) : (
                              <ChevronDown size={13} strokeWidth={1.8} />
                            )}
                            <CalendarClock
                              size={13}
                              strokeWidth={1.75}
                              className="shrink-0 text-text-tertiary"
                            />
                            <Tooltip
                              content={task.name}
                              side="right"
                              contentClassName="ui-tooltip-selectable"
                            >
                              <span className="min-w-0 flex-1 truncate text-left">{task.name}</span>
                            </Tooltip>
                            {task.state?.lastStatus === 'running' && (
                              <span className="rounded-full bg-bg-active px-1.5 py-0.5 text-[10px] text-text-secondary">
                                {t('cron.statusRunning')}
                              </span>
                            )}
                          </button>
                          {!collapsed && (
                            <div className="ml-7 mt-0.5 space-y-0.5">
                              {runs.length === 0 ? (
                                <div className="px-3 py-2 text-[11px] text-text-tertiary">
                                  {t('sidebar.noScheduledRuns')}
                                </div>
                              ) : (
                                runs.slice(0, 3).map((run) => (
                                  <button
                                    key={run.id}
                                    onClick={() => {
                                      if (run.sessionId) handleSessionOpen(run.sessionId)
                                    }}
                                    disabled={!run.sessionId}
                                    className="no-drag ui-row-button ui-focus text-left disabled:cursor-default disabled:opacity-60"
                                  >
                                    <Tooltip
                                      content={run.taskName ?? task.name}
                                      side="right"
                                      contentClassName="ui-tooltip-selectable"
                                    >
                                      <span className="min-w-0 flex-1 truncate">
                                        {run.taskName ?? task.name}
                                      </span>
                                    </Tooltip>
                                    <span className="shrink-0 text-[10px] text-text-tertiary">
                                      {getRunStatusLabel(run.status)}
                                    </span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              <section>
                <div className="flex items-center justify-between px-2 pb-1">
                  <span className="text-[11px] font-medium text-text-tertiary">
                    {t('sidebar.taskList')}
                  </span>
                  <span className="text-[10px] text-text-tertiary tabular-nums">
                    {taskSessions.length}
                  </span>
                </div>
                {taskSessions.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[12px] text-text-tertiary">
                    {t('sidebar.noTasks')}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {taskSessions.map((session) => (
                      <button
                        key={session.id}
                        onClick={() => handleSessionOpen(session.id)}
                        className={`no-drag ui-row-button text-left ui-focus ${
                          activeSessionId === session.id ? 'ui-row-button-active' : ''
                        }`}
                      >
                        <MessageSquare
                          size={13}
                          strokeWidth={1.7}
                          className="shrink-0 text-text-tertiary"
                        />
                        <span className="min-w-0 flex-1">
                          <Tooltip
                            content={session.title || t('sidebar.defaultTitle')}
                            side="right"
                            contentClassName="ui-tooltip-selectable"
                          >
                            <span className="block truncate">
                              {session.title || t('sidebar.defaultTitle')}
                            </span>
                          </Tooltip>
                          <span className="mt-0.5 block truncate text-[11px] font-normal text-text-tertiary">
                            {getSessionSubtitle(session)}
                          </span>
                        </span>
                        {session.status === 'running' && (
                          <span className="rounded-full bg-bg-active px-1.5 py-0.5 text-[10px] text-text-secondary">
                            {t('cron.statusRunning')}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>

          <div
            className="w-1/2 shrink-0 min-h-0 overflow-y-auto px-3 pb-3"
            style={{
              opacity: reducedMotion && sidebarTab !== 'channels' ? 0 : 1,
              transition: reducedMotion ? 'opacity var(--motion-base) ease' : undefined,
              pointerEvents: reducedMotion && sidebarTab !== 'channels' ? 'none' : undefined,
              marginLeft: reducedMotion ? '-50%' : undefined
            }}
          >
            <div className="space-y-3 py-1">
              {imInstances.length === 0 ? (
                <div className="px-3 py-6 text-center text-[12px] text-text-tertiary">
                  {t('sidebar.noChannels')}
                </div>
              ) : (
                platformOrder.map((platform) => {
                  const instances = instancesByPlatform.get(platform) ?? []
                  if (instances.length === 0) return null
                  const groupId = `platform:${platform}`
                  const collapsed = collapsedChannelGroupIds.includes(groupId)
                  return (
                    <section key={platform}>
                      <button
                        onClick={() =>
                          setCollapsedChannelGroupIds((value) => toggleId(value, groupId))
                        }
                        className="no-drag ui-row-button ui-focus"
                        aria-expanded={!collapsed}
                      >
                        {collapsed ? (
                          <ChevronRight size={13} strokeWidth={1.8} />
                        ) : (
                          <ChevronDown size={13} strokeWidth={1.8} />
                        )}
                        <Bot size={13} strokeWidth={1.75} className="text-text-tertiary" />
                        <span className="min-w-0 flex-1 truncate text-left">
                          {getPlatformTitle(platform, instances)}
                        </span>
                        {platform !== 'wechat' && (
                          <span className="text-[10px] text-text-tertiary tabular-nums">
                            {instances.length}
                          </span>
                        )}
                      </button>
                      {!collapsed && (
                        <div className="ml-7 mt-0.5 space-y-0.5">
                          {platform === 'wechat' ? (
                            <div className="px-3 py-2 text-[11px] leading-[1.45] text-text-tertiary">
                              {t('sidebar.channelConversationPending')}
                            </div>
                          ) : (
                            <>
                              {instances.map((instance) => (
                                <button
                                  key={instance.id}
                                  onClick={() => onViewChange('im-channels')}
                                  className="no-drag ui-row-button ui-focus text-left"
                                >
                                  <Inbox
                                    size={13}
                                    strokeWidth={1.7}
                                    className="shrink-0 text-text-tertiary"
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate">
                                      {instance.name ?? getPlatformLabel(instance.platform)}
                                    </span>
                                    <span className="mt-0.5 block truncate text-[11px] font-normal text-text-tertiary">
                                      {instance.directoryPath
                                        ? getBasename(instance.directoryPath)
                                        : t('sidebar.mainWorkspace')}{' '}
                                      ·{' '}
                                      {instance.enabled
                                        ? t('sidebar.channelEnabled')
                                        : t('sidebar.channelDisabled')}
                                    </span>
                                  </span>
                                </button>
                              ))}
                              <div className="px-3 py-2 text-[11px] leading-[1.45] text-text-tertiary">
                                {t('sidebar.channelConversationPending')}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </section>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-4 h-px bg-black/[0.035]" />
      <div className="px-3 py-2 flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.045] text-text-primary">
            <User size={15} className="text-text-secondary" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-medium text-text-primary">
              {t('sidebar.defaultUserName')}
            </div>
            <div className="truncate text-[11px] text-text-tertiary">{t('sidebar.freePlan')}</div>
          </div>
        </div>
        <button
          onClick={onSettingsOpen}
          aria-label={t('sidebar.settings')}
          title={t('sidebar.settings')}
          className={`no-drag ui-icon-button ui-focus ${
            activeView === 'settings' ? 'ui-icon-button-active' : ''
          }`}
        >
          <Settings size={15} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
