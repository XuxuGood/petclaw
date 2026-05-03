import { useState, useEffect, useCallback } from 'react'
import {
  Plus,
  MessageSquareWarning,
  PanelRightOpen,
  Search,
  RefreshCw,
  Boxes,
  Sparkles
} from 'lucide-react'

import { Sidebar } from './components/Sidebar'
import { TaskMonitorPanel } from './components/TaskMonitorPanel'
import { WorkspaceFrame } from './components/workspace/WorkspaceFrame'
import { ChatView } from './views/chat/ChatView'
import { ChatTitleSlot } from './views/chat/ChatTitleSlot'
import { SkillsPage } from './views/skills/SkillsPage'
import { CronPage } from './views/cron/CronPage'
import { ImChannelsPage } from './views/im/ImChannelsPage'
import { SettingsPage } from './views/settings/SettingsPage'

import { OnboardingPanel } from './views/onboarding/OnboardingPanel'
import { BootCheckPanel } from './views/onboarding/BootCheckPanel'
import { usePermissionListener } from './hooks/use-permission-listener'
import { usePermissionStore } from './stores/permission-store'
import { useI18n } from './i18n'
import { CoworkPermissionModal } from './views/chat/CoworkPermissionModal'
import { CoworkQuestionWizard } from './views/chat/CoworkQuestionWizard'

// 路由类型
export type ViewType = 'chat' | 'skills' | 'expert-kits' | 'cron' | 'im-channels' | 'settings'

type AppPhase = 'bootcheck' | 'onboarding' | 'main'

export function App() {
  // 全局权限请求监听：订阅 IPC 事件维护队列
  usePermissionListener()
  const { t } = useI18n()
  const firstPending = usePermissionStore((s) => s.pendingPermissions[0] ?? null)
  const dequeue = usePermissionStore((s) => s.dequeue)

  const [phase, setPhase] = useState<AppPhase>('bootcheck')

  // 核心路由状态
  const [activeView, setActiveView] = useState<ViewType>('chat')
  // 返回 settings 时的上一个页面，用于「返回」按钮
  const [previousView, setPreviousView] = useState<ViewType>('chat')

  // 目录与会话
  const [currentDirectoryId, setCurrentDirectoryId] = useState('main')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // 侧栏 Tab
  const [sidebarTab, setSidebarTab] = useState<'tasks' | 'channels'>('tasks')

  // Settings 子菜单
  const [settingsTab, setSettingsTab] = useState('preferences')
  const [cronCreateSignal, setCronCreateSignal] = useState(0)

  // 任务监控面板开关
  const [taskMonitorOpen, setTaskMonitorOpen] = useState(true)
  // 主侧栏开关：小窗用户需要把完整宽度留给当前任务。
  const [mainSidebarOpen, setMainSidebarOpen] = useState(true)

  // 权限弹窗响应：发送结果到主进程并出队
  const handlePermissionRespond = useCallback(
    (result: {
      behavior: 'allow' | 'deny'
      updatedInput?: Record<string, unknown>
      message?: string
    }) => {
      if (!firstPending) return
      window.api.cowork.respondPermission(firstPending.requestId, result)
      dequeue(firstPending.requestId)
    },
    [firstPending, dequeue]
  )

  // 根据 toolName 和 questions 数量选择弹窗组件
  const renderPermissionModal = useCallback(() => {
    if (!firstPending) return null
    const isAskUser = firstPending.toolName === 'AskUserQuestion'
    const questions = (firstPending.toolInput as Record<string, unknown>).questions
    const isMultiQuestion = isAskUser && Array.isArray(questions) && questions.length > 1

    if (isMultiQuestion) {
      return <CoworkQuestionWizard permission={firstPending} onRespond={handlePermissionRespond} />
    }
    return <CoworkPermissionModal permission={firstPending} onRespond={handlePermissionRespond} />
  }, [firstPending, handlePermissionRespond])

  // 切换视图：进入 settings 时记录来源页，便于返回
  const handleViewChange = useCallback(
    (view: ViewType) => {
      if (view === 'settings') {
        setPreviousView(activeView === 'settings' ? 'chat' : activeView)
      }
      setActiveView(view)
      window.api.setSetting('lastActiveTab', view)
    },
    [activeView]
  )

  const handleBackFromSettings = useCallback(() => {
    setActiveView(previousView)
  }, [previousView])

  // 切换目录：重置会话、切回 chat 视图
  const handleDirectoryChange = useCallback((agentId: string) => {
    setCurrentDirectoryId(agentId)
    setSidebarTab('tasks')
    setActiveView('chat')
    setActiveSessionId(null)
  }, [])

  // 新建任务：清空会话 ID，回到 chat
  const handleNewTask = useCallback(() => {
    setActiveView('chat')
    setActiveSessionId(null)
  }, [])

  // Skills 搜索关键词（提升到 App 层以便在顶栏搜索框和 SkillsPage 之间共享）
  const [skillsSearch, setSkillsSearch] = useState('')
  // 工作台二级页面共享顶栏搜索语言；Cron 先做本地过滤，专家套件保留一致入口等待数据接入。
  const [cronSearch, setCronSearch] = useState('')
  const [expertKitsSearch, setExpertKitsSearch] = useState('')

  /**
   * 根据当前 activeView 计算 AppTopBar 的 centerSlot 和 rightSlot。
   * 各 view 的顶栏内容集中在这里管理，保证统一。
   */
  const getTopBarSlots = useCallback(
    (options?: { sidebarCollapsed?: boolean }) => {
      let centerSlot = null
      let rightSlot = null

      switch (activeView) {
        case 'chat': {
          centerSlot = (
            <ChatTitleSlot
              sessionId={activeSessionId}
              sidebarCollapsed={options?.sidebarCollapsed ?? !mainSidebarOpen}
            />
          )
          rightSlot = (
            <>
              <button
                className="topbar-btn topbar-btn-ghost ui-focus"
                aria-label={t('about.feedback')}
              >
                <MessageSquareWarning size={14} strokeWidth={2} />
                <span className="hidden sm:inline">{t('about.feedback')}</span>
              </button>
              {activeSessionId && !taskMonitorOpen && (
                <button
                  type="button"
                  onClick={() => setTaskMonitorOpen(true)}
                  className="panel-toggle ui-focus"
                  aria-label={t('chat.toggleMonitor')}
                >
                  <PanelRightOpen size={15} strokeWidth={1.9} />
                </button>
              )}
            </>
          )
          break
        }
        case 'cron': {
          rightSlot = (
            <div className="topbar-workbench-tools">
              <button
                type="button"
                onClick={() => {}}
                className="topbar-btn topbar-btn-ghost topbar-btn-icon ui-focus"
                aria-label={t('common.refresh')}
              >
                <RefreshCw size={15} strokeWidth={1.9} />
              </button>
              <div className="topbar-search-field">
                <Search size={16} className="topbar-search-icon" />
                <input
                  type="text"
                  value={cronSearch}
                  onChange={(e) => setCronSearch(e.target.value)}
                  placeholder={t('cron.searchPlaceholder')}
                  className="topbar-search-input"
                />
              </div>
              <div className="topbar-actions">
                <button
                  type="button"
                  onClick={handleNewTask}
                  className="topbar-btn topbar-btn-pill ui-focus"
                >
                  <Sparkles size={13} strokeWidth={1.9} />
                  <span>{t('cron.createdVia')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCronCreateSignal((v) => v + 1)}
                  className="topbar-btn topbar-btn-primary ui-focus"
                >
                  <Plus size={14} strokeWidth={2.1} />
                  <span>{t('cron.newTask')}</span>
                </button>
              </div>
            </div>
          )
          break
        }
        case 'skills': {
          rightSlot = (
            <div className="topbar-workbench-tools">
              <button
                type="button"
                onClick={() => {}}
                className="topbar-btn topbar-btn-ghost topbar-btn-icon ui-focus"
                aria-label={t('common.refresh')}
              >
                <RefreshCw size={15} strokeWidth={1.9} />
              </button>
              <div className="topbar-search-field">
                <Search size={16} className="topbar-search-icon" />
                <input
                  type="text"
                  value={skillsSearch}
                  onChange={(e) => setSkillsSearch(e.target.value)}
                  placeholder={t('skills.searchPlaceholder')}
                  className="topbar-search-input"
                />
              </div>
              <div className="topbar-actions">
                <button
                  type="button"
                  onClick={handleNewTask}
                  className="topbar-btn topbar-btn-pill ui-focus"
                >
                  <Sparkles size={13} strokeWidth={1.9} />
                  <span>{t('cron.createdVia')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {}}
                  className="topbar-btn topbar-btn-primary ui-focus"
                >
                  <Plus size={14} strokeWidth={2.1} />
                  <span>{t('skills.installSkill')}</span>
                </button>
              </div>
            </div>
          )
          break
        }
        case 'expert-kits': {
          rightSlot = (
            <div className="topbar-workbench-tools">
              <button
                type="button"
                onClick={() => {}}
                className="topbar-btn topbar-btn-ghost topbar-btn-icon ui-focus"
                aria-label={t('common.refresh')}
              >
                <RefreshCw size={15} strokeWidth={1.9} />
              </button>
              <div className="topbar-search-field">
                <Search size={16} className="topbar-search-icon" />
                <input
                  type="text"
                  value={expertKitsSearch}
                  onChange={(e) => setExpertKitsSearch(e.target.value)}
                  placeholder={t('expertKits.searchPlaceholder')}
                  className="topbar-search-input"
                />
              </div>
              <div className="topbar-actions">
                <button
                  type="button"
                  onClick={handleNewTask}
                  className="topbar-btn topbar-btn-pill ui-focus"
                >
                  <Sparkles size={13} strokeWidth={1.9} />
                  <span>{t('cron.createdVia')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {}}
                  className="topbar-btn topbar-btn-primary ui-focus"
                >
                  <Plus size={14} strokeWidth={2.1} />
                  <span>{t('expertKits.installKit')}</span>
                </button>
              </div>
            </div>
          )
          break
        }
        case 'im-channels': {
          rightSlot = (
            <button
              className="topbar-btn topbar-btn-ghost ui-focus"
              aria-label={t('about.feedback')}
            >
              <MessageSquareWarning size={14} strokeWidth={2} />
              <span className="hidden sm:inline">{t('about.feedback')}</span>
            </button>
          )
          break
        }
      }

      return { centerSlot, rightSlot }
    },
    [
      activeView,
      activeSessionId,
      mainSidebarOpen,
      taskMonitorOpen,
      skillsSearch,
      cronSearch,
      expertKitsSearch,
      t,
      handleNewTask
    ]
  )

  // 启动时恢复上次激活的 Tab
  useEffect(() => {
    window.api.getSetting('lastActiveTab').then((val) => {
      if (
        val === 'chat' ||
        val === 'skills' ||
        val === 'expert-kits' ||
        val === 'cron' ||
        val === 'im-channels' ||
        val === 'settings'
      ) {
        setActiveView(val as ViewType)
      }
    })
  }, [])

  // 监听子组件触发的应用内跳转事件：用于从弹窗/卡片等深层组件穿透到 App 路由
  // event.detail.view 为目标 ViewType，消费者通过协议不假设 props 向下传递，避免层层 prop drilling
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: ViewType }>).detail
      if (!detail?.view) return
      handleViewChange(detail.view)
    }
    window.addEventListener('app:navigate', handler)
    return () => window.removeEventListener('app:navigate', handler)
  }, [handleViewChange])

  // 监听 boot 完成事件（push + 轮询兜底）
  useEffect(() => {
    function handleBootSuccess(): void {
      window.api.getSetting('onboardingComplete').then((val) => {
        setPhase(val === 'true' ? 'main' : 'onboarding')
      })
    }

    const unsub = window.api.onBootComplete((success) => {
      if (success) handleBootSuccess()
    })

    window.api
      .getBootStatus()
      .then((success) => {
        if (success) handleBootSuccess()
      })
      .catch(() => {})

    return unsub
  }, [])

  // 进入 main 阶段后通知主进程（触发宠物窗口创建）
  useEffect(() => {
    if (phase === 'main') window.api.petReady()
  }, [phase])

  // 历史会话/新会话进入聊天态时默认展开任务监控；用户仍可在当前会话内手动关闭。
  useEffect(() => {
    if (activeView === 'chat' && activeSessionId) setTaskMonitorOpen(true)
  }, [activeSessionId, activeView])

  // 监听主进程推送的面板切换指令（如托盘菜单点击）
  useEffect(() => {
    const unsub = window.api.onPanelOpen((panel) => {
      if (
        panel === 'chat' ||
        panel === 'skills' ||
        panel === 'expert-kits' ||
        panel === 'cron' ||
        panel === 'im-channels' ||
        panel === 'settings'
      ) {
        handleViewChange(panel as ViewType)
      }
    })
    return unsub
  }, [handleViewChange])

  if (phase === 'bootcheck') {
    return (
      <>
        {renderPermissionModal()}
        <BootCheckPanel onRetry={() => window.api.retryBoot()} />
      </>
    )
  }

  if (phase === 'onboarding') {
    return (
      <>
        {renderPermissionModal()}
        <OnboardingPanel onComplete={() => setPhase('main')} />
      </>
    )
  }

  // Settings 全页面模式：隐藏主侧栏，独占渲染
  if (activeView === 'settings') {
    return (
      <>
        {renderPermissionModal()}
        <SettingsPage
          activeTab={settingsTab}
          onTabChange={setSettingsTab}
          onBack={handleBackFromSettings}
        />
      </>
    )
  }

  // 工作台布局：左右推拉面板都属于同一块玻璃底板，中间仅承载当前主工作面。
  return (
    <>
      {renderPermissionModal()}
      <WorkspaceFrame
        leftOpen={mainSidebarOpen}
        showRightPane={activeView === 'chat' && Boolean(activeSessionId)}
        rightOpen={taskMonitorOpen}
        leftPane={
          <Sidebar
            activeView={activeView}
            onViewChange={handleViewChange}
            currentDirectoryId={currentDirectoryId}
            onDirectoryChange={handleDirectoryChange}
            activeSessionId={activeSessionId}
            onSessionSelect={setActiveSessionId}
            sidebarTab={sidebarTab}
            onSidebarTabChange={setSidebarTab}
            onNewTask={handleNewTask}
            onSettingsOpen={() => handleViewChange('settings')}
            onClose={() => setMainSidebarOpen(false)}
          />
        }
        rightPane={
          activeSessionId ? (
            <TaskMonitorPanel
              sessionId={activeSessionId}
              onClose={() => setTaskMonitorOpen(false)}
            />
          ) : null
        }
        renderTopBarSlots={(topBar) =>
          getTopBarSlots({
            sidebarCollapsed: !topBar.leftOpen
          })
        }
        onOpenLeft={() => {
          setTaskMonitorOpen(false)
          setMainSidebarOpen(true)
        }}
        onCloseLeft={() => setMainSidebarOpen(false)}
        onCloseRight={() => setTaskMonitorOpen(false)}
        onNewTask={handleNewTask}
        openLeftLabel={t('sidebar.open')}
        closeOverlayLabel={t('common.close')}
        newTaskLabel={t('sidebar.newTask')}
      >
        <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col">
            {activeView === 'chat' && (
              <ChatView
                activeSessionId={activeSessionId}
                onSessionCreated={setActiveSessionId}
                currentDirectoryId={currentDirectoryId}
              />
            )}
            {activeView === 'skills' && <SkillsPage search={skillsSearch} />}
            {activeView === 'expert-kits' && (
              <div className="page-scroll">
                <div className="page-container-workbench workspace-page-container">
                  <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[12px] bg-bg-active text-text-secondary">
                      <Boxes size={22} strokeWidth={1.8} />
                    </div>
                    <h1 className="text-[18px] font-semibold text-text-primary">
                      {t('chat.expertKitsEmptyTitle')}
                    </h1>
                    <p className="mt-2 max-w-[360px] text-[13px] leading-[1.65] text-text-tertiary">
                      {t('chat.expertKitsEmptyDesc')}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {activeView === 'cron' && (
              <CronPage createSignal={cronCreateSignal} search={cronSearch} />
            )}
            {activeView === 'im-channels' && <ImChannelsPage />}
          </div>
        </main>
      </WorkspaceFrame>
    </>
  )
}
