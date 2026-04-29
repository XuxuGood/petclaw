import { useState, useEffect, useCallback } from 'react'

import { Sidebar } from './components/Sidebar'
import { ChatView } from './views/chat/ChatView'
import { SkillsPage } from './views/skills/SkillsPage'
import { CronPage } from './views/cron/CronPage'
import { ImChannelsPage } from './views/im/ImChannelsPage'
import { SettingsPage } from './views/settings/SettingsPage'
import { StatusBar } from './components/StatusBar'

import { OnboardingPanel } from './views/onboarding/OnboardingPanel'
import { BootCheckPanel } from './views/onboarding/BootCheckPanel'
import { usePermissionListener } from './hooks/use-permission-listener'
import { usePermissionStore } from './stores/permission-store'
import { CoworkPermissionModal } from './views/chat/CoworkPermissionModal'
import { CoworkQuestionWizard } from './views/chat/CoworkQuestionWizard'

// 路由类型
export type ViewType = 'chat' | 'skills' | 'cron' | 'im-channels' | 'settings'

type AppPhase = 'bootcheck' | 'onboarding' | 'main'

export function App() {
  // 全局权限请求监听：订阅 IPC 事件维护队列
  usePermissionListener()
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

  // 任务监控面板开关
  const [taskMonitorOpen, setTaskMonitorOpen] = useState(false)

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

  // 启动时恢复上次激活的 Tab
  useEffect(() => {
    window.api.getSetting('lastActiveTab').then((val) => {
      if (
        val === 'chat' ||
        val === 'skills' ||
        val === 'cron' ||
        val === 'im-channels' ||
        val === 'settings'
      ) {
        setActiveView(val as ViewType)
      }
    })
  }, [])

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

  // 监听主进程推送的面板切换指令（如托盘菜单点击）
  useEffect(() => {
    const unsub = window.api.onPanelOpen((panel) => {
      if (
        panel === 'chat' ||
        panel === 'skills' ||
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

  // 三栏布局：Sidebar (220px) + Main (flex-1) + StatusBar（底部）
  return (
    <>
      {renderPermissionModal()}
      <div className="w-full h-full flex bg-bg-root overflow-hidden">
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
        />
        <div className="flex-1 flex flex-col min-w-0">
          <main className="flex-1 flex min-h-0">
            <div className="flex-1 flex flex-col min-w-0">
              {activeView === 'chat' && (
                <ChatView
                  activeSessionId={activeSessionId}
                  onSessionCreated={setActiveSessionId}
                  currentDirectoryId={currentDirectoryId}
                  taskMonitorOpen={taskMonitorOpen}
                  onToggleMonitor={() => setTaskMonitorOpen((p) => !p)}
                />
              )}
              {activeView === 'skills' && <SkillsPage />}
              {activeView === 'cron' && <CronPage />}
              {activeView === 'im-channels' && <ImChannelsPage />}
            </div>
          </main>
          <StatusBar />
        </div>
      </div>
    </>
  )
}
