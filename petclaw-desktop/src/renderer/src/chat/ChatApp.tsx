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

export function ChatApp(): JSX.Element {
  const [activeView, setActiveView] = useState<ViewType>('chat')
  const [phase, setPhase] = useState<AppPhase>('bootcheck')

  useEffect(() => {
    const unsub = window.api.onPanelOpen((panel) => {
      if (panel === 'chat' || panel === 'monitor' || panel === 'settings') {
        setActiveView(panel as ViewType)
      }
    })
    return unsub
  }, [])

  // Listen for boot completion
  useEffect(() => {
    const unsub = window.api.onBootComplete((success) => {
      if (success) {
        window.api.getSetting('onboardingCompleted').then((val) => {
          setPhase(val === 'true' ? 'main' : 'onboarding')
        })
      }
      // If not success, stay on bootcheck (error displayed)
    })
    return unsub
  }, [])

  // BootCheck phase
  if (phase === 'bootcheck') {
    return <BootCheckPanel />
  }

  // Onboarding phase
  if (phase === 'onboarding') {
    return <OnboardingPanel onComplete={() => setPhase('main')} />
  }

  // Main phase
  return (
    <div className="w-full h-full flex bg-bg-root overflow-hidden">
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
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
