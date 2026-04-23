import { useState, useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { MonitorView } from './components/MonitorView'
import { SettingsView } from './components/SettingsView'
import { StatusBar } from './components/StatusBar'
import { OnboardingPanel } from '../panels/OnboardingPanel'
import { BootCheckPanel } from '../panels/BootCheckPanel'

export type ViewType = 'chat' | 'monitor' | 'settings'

type AppPhase = 'bootcheck' | 'onboarding' | 'main'

export function ChatApp() {
  const [activeView, setActiveView] = useState<ViewType>('chat')
  const [phase, setPhase] = useState<AppPhase>('bootcheck')

  // Restore last active tab on mount
  useEffect(() => {
    window.api.getSetting('lastActiveTab').then((val) => {
      if (val === 'chat' || val === 'monitor' || val === 'settings') {
        setActiveView(val as ViewType)
      }
    })
  }, [])

  // Save active tab when it changes
  const handleViewChange = (view: ViewType): void => {
    setActiveView(view)
    window.api.setSetting('lastActiveTab', view)
  }

  useEffect(() => {
    const unsub = window.api.onPanelOpen((panel) => {
      if (panel === 'chat' || panel === 'monitor' || panel === 'settings') {
        handleViewChange(panel as ViewType)
      }
    })
    return unsub
  }, [])

  // Listen for boot completion (event-based + polling fallback)
  useEffect(() => {
    function handleBootSuccess(): void {
      window.api.getSetting('onboardingComplete').then((val) => {
        setPhase(val === 'true' ? 'main' : 'onboarding')
      })
    }

    // Event listener for push notification
    const unsub = window.api.onBootComplete((success) => {
      if (success) handleBootSuccess()
    })

    // Fallback: query in case event was sent before listener was set up
    window.api
      .getBootStatus()
      .then((success) => {
        if (success) handleBootSuccess()
      })
      .catch(() => {
        /* handler not yet registered */
      })

    return unsub
  }, [])

  // Notify main process when entering main phase (pet window can be created)
  useEffect(() => {
    if (phase === 'main') {
      window.api.petReady()
    }
  }, [phase])

  // BootCheck phase
  if (phase === 'bootcheck') {
    return <BootCheckPanel onRetry={() => window.api.retryBoot()} />
  }

  // Onboarding phase
  if (phase === 'onboarding') {
    return <OnboardingPanel onComplete={() => setPhase('main')} />
  }

  // Main phase
  return (
    <div className="w-full h-full flex bg-bg-root overflow-hidden">
      <Sidebar activeView={activeView} onViewChange={handleViewChange} />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 flex flex-col min-h-0">
          {activeView === 'chat' && <ChatView />}
          {activeView === 'monitor' && <MonitorView />}
          {activeView === 'settings' && <SettingsView />}
        </main>
        <StatusBar />
      </div>
    </div>
  )
}
