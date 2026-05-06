import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../../src/renderer/src/App'

type PanelOpenHandler = (panel: string) => void

const permissionState = {
  pendingPermissions: [],
  dequeue: vi.fn()
}

vi.mock('../../src/renderer/src/hooks/use-permission-listener', () => ({
  usePermissionListener: vi.fn()
}))

vi.mock('../../src/renderer/src/stores/permission-store', () => ({
  usePermissionStore: (selector: (state: typeof permissionState) => unknown) =>
    selector(permissionState)
}))

vi.mock('../../src/renderer/src/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../../src/renderer/src/components/Sidebar', () => ({
  Sidebar: ({ onSettingsOpen }: { onSettingsOpen: () => void }) =>
    React.createElement(
      'button',
      { type: 'button', onClick: onSettingsOpen, 'data-testid': 'sidebar-settings' },
      'settings'
    )
}))

vi.mock('../../src/renderer/src/components/TaskMonitorPanel', () => ({
  TaskMonitorPanel: () => React.createElement('aside', { 'data-testid': 'task-monitor' })
}))

vi.mock('../../src/renderer/src/components/workspace/WorkspaceFrame', () => ({
  WorkspaceFrame: ({
    leftPane,
    children
  }: {
    leftPane: React.ReactNode
    children: React.ReactNode
  }) => React.createElement('section', { 'data-testid': 'workspace' }, leftPane, children)
}))

vi.mock('../../src/renderer/src/views/chat/ChatView', () => ({
  ChatView: () => React.createElement('div', { 'data-testid': 'chat-view' }, 'chat')
}))

vi.mock('../../src/renderer/src/views/chat/ChatTitleSlot', () => ({
  ChatTitleSlot: () => React.createElement('div', { 'data-testid': 'chat-title' })
}))

vi.mock('../../src/renderer/src/views/skills/SkillsPage', () => ({
  SkillsPage: () => React.createElement('div', { 'data-testid': 'skills-page' })
}))

vi.mock('../../src/renderer/src/views/cron/CronPage', () => ({
  CronPage: () => React.createElement('div', { 'data-testid': 'cron-page' })
}))

vi.mock('../../src/renderer/src/views/im/ImChannelsPage', () => ({
  ImChannelsPage: () => React.createElement('div', { 'data-testid': 'im-page' })
}))

vi.mock('../../src/renderer/src/views/settings/SettingsPage', () => ({
  SettingsPage: () => React.createElement('div', { 'data-testid': 'settings-page' }, 'settings')
}))

vi.mock('../../src/renderer/src/views/boot/BootCheckPanel', () => ({
  BootCheckPanel: () => React.createElement('div', { 'data-testid': 'bootcheck' })
}))

vi.mock('../../src/renderer/src/views/chat/CoworkPermissionModal', () => ({
  CoworkPermissionModal: () => React.createElement('div', { 'data-testid': 'permission-modal' })
}))

vi.mock('../../src/renderer/src/views/chat/CoworkQuestionWizard', () => ({
  CoworkQuestionWizard: () => React.createElement('div', { 'data-testid': 'question-wizard' })
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function makeApi(initialLastActiveTab: string) {
  let panelOpenHandler: PanelOpenHandler | null = null

  const api = {
    cowork: {
      respondPermission: vi.fn()
    },
    getSetting: vi.fn(async (key: string) => {
      if (key === 'lastActiveTab') return initialLastActiveTab
      return null
    }),
    setSetting: vi.fn(async () => {}),
    onBootComplete: vi.fn(() => vi.fn()),
    getBootStatus: vi.fn(async () => true),
    petReady: vi.fn(async () => {}),
    retryBoot: vi.fn(async () => {}),
    onPanelOpen: vi.fn((callback: PanelOpenHandler) => {
      panelOpenHandler = callback
      return vi.fn()
    })
  }

  return {
    api,
    emitPanelOpen: (panel: string) => {
      if (!panelOpenHandler) throw new Error('Panel open handler was not registered')
      panelOpenHandler(panel)
    }
  }
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('App route persistence', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('does not restore the transient settings view from lastActiveTab', async () => {
    const { api } = makeApi('settings')
    Object.defineProperty(window, 'api', {
      value: api,
      configurable: true
    })

    await act(async () => {
      root.render(<App />)
    })
    await flushEffects()

    expect(container.querySelector('[data-testid="chat-view"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="settings-page"]')).toBeNull()
  })

  it('does not persist settings when opened by a system panel command', async () => {
    const { api, emitPanelOpen } = makeApi('chat')
    Object.defineProperty(window, 'api', {
      value: api,
      configurable: true
    })

    await act(async () => {
      root.render(<App />)
    })
    await flushEffects()

    act(() => {
      emitPanelOpen('settings')
    })

    expect(container.querySelector('[data-testid="settings-page"]')).not.toBeNull()
    expect(api.setSetting).not.toHaveBeenCalledWith('lastActiveTab', 'settings')
  })
})
