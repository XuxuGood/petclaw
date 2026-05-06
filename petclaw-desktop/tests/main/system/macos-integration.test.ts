import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'

import type { SystemActions } from '../../../src/main/system/system-actions'
import {
  buildApplicationMenuTemplate,
  buildDockMenuTemplate,
  initializeMacosIntegration,
  refreshMacosMenus
} from '../../../src/main/system/macos-integration'

const electronMock = vi.hoisted(() => {
  const buildFromTemplate = vi.fn((template: unknown) => ({ template }))
  const setApplicationMenu = vi.fn()
  const setDockMenu = vi.fn()
  const setDockIcon = vi.fn()
  const showDock = vi.fn(() => Promise.resolve())
  const setActivationPolicy = vi.fn()
  const setName = vi.fn()
  const getAppPath = vi.fn(() => '/tmp/petclaw-app')
  const dockIcon = { isEmpty: vi.fn(() => false) }
  const createFromPath = vi.fn(() => dockIcon)
  const on = vi.fn()
  const appMock = {
    name: 'Electron',
    isPackaged: false,
    getAppPath,
    setActivationPolicy,
    setName,
    dock: {
      setIcon: setDockIcon,
      setMenu: setDockMenu,
      show: showDock
    },
    on
  }

  return {
    buildFromTemplate,
    setApplicationMenu,
    setDockMenu,
    setDockIcon,
    showDock,
    setActivationPolicy,
    setName,
    getAppPath,
    dockIcon,
    createFromPath,
    appMock,
    on
  }
})

const loggingMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: electronMock.buildFromTemplate,
    setApplicationMenu: electronMock.setApplicationMenu
  },
  app: electronMock.appMock,
  nativeImage: {
    createFromPath: electronMock.createFromPath
  }
}))

vi.mock('../../../src/main/logging/facade', () => ({
  getLogger: () => loggingMock
}))

vi.mock('../../../src/main/i18n', () => ({
  t: (key: string) =>
    ({
      'system.about': 'About PetClaw',
      'system.open': 'Open',
      'system.openPetClaw': 'Open PetClaw',
      'system.togglePet': 'Show/Hide Pet',
      'system.settings': 'Settings...',
      'system.quit': 'Quit PetClaw',
      'system.services': 'Services',
      'system.hidePetClaw': 'Hide PetClaw',
      'system.hideOthers': 'Hide Others',
      'system.showAll': 'Show All',
      'system.edit': 'Edit',
      'system.undo': 'Undo',
      'system.redo': 'Redo',
      'system.cut': 'Cut',
      'system.copy': 'Copy',
      'system.paste': 'Paste',
      'system.pasteAndMatchStyle': 'Paste and Match Style',
      'system.delete': 'Delete',
      'system.selectAll': 'Select All',
      'system.window': 'Window',
      'system.minimize': 'Minimize',
      'system.closeWindow': 'Close Window',
      'system.bringAllToFront': 'Bring All to Front'
    })[key] ?? key
}))

function makeActions(): SystemActions {
  return {
    openPetClaw: vi.fn(),
    showSettings: vi.fn(),
    showPet: vi.fn(),
    hidePet: vi.fn(),
    togglePet: vi.fn(),
    quitPetClaw: vi.fn()
  }
}

function collectLabels(items: ReadonlyArray<Record<string, unknown>>): string[] {
  const labels: string[] = []

  for (const item of items) {
    if (typeof item.label === 'string') {
      labels.push(item.label)
    }

    if (Array.isArray(item.submenu)) {
      labels.push(...collectLabels(item.submenu as ReadonlyArray<Record<string, unknown>>))
    }
  }

  return labels
}

function collectRoles(items: ReadonlyArray<Record<string, unknown>>): string[] {
  const roles: string[] = []

  for (const item of items) {
    if (typeof item.role === 'string') {
      roles.push(item.role)
    }

    if (Array.isArray(item.submenu)) {
      roles.push(...collectRoles(item.submenu as ReadonlyArray<Record<string, unknown>>))
    }
  }

  return roles
}

function collectRoleItems(
  items: ReadonlyArray<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const roleItems: Array<Record<string, unknown>> = []

  for (const item of items) {
    if (typeof item.role === 'string') {
      roleItems.push(item)
    }

    if (Array.isArray(item.submenu)) {
      roleItems.push(...collectRoleItems(item.submenu as ReadonlyArray<Record<string, unknown>>))
    }
  }

  return roleItems
}

describe('macOS system integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMock.appMock.name = 'Electron'
    electronMock.appMock.isPackaged = false
  })

  it('builds a focused Dock menu with only core system actions', () => {
    const actions = makeActions()

    const template = buildDockMenuTemplate(actions)
    const labels = collectLabels(template)

    expect(labels).toEqual(['Open', 'Show/Hide Pet', 'Settings...'])
    expect(template[0]).toMatchObject({ click: actions.openPetClaw })
    expect(template[1]).toMatchObject({ click: actions.togglePet })
    expect(template[2]).toMatchObject({ click: actions.showSettings })
    expect(labels.every((label) => !label.includes('PetClaw'))).toBe(true)
  })

  it('builds an Application Menu with macOS roles and core business entries', () => {
    const actions = makeActions()

    const template = buildApplicationMenuTemplate(actions)
    const labels = collectLabels(template)
    const appMenu = template[0].submenu as Array<Record<string, unknown>>
    const windowMenu = template.find((item) => item.label === 'Window')?.submenu as Array<
      Record<string, unknown>
    >

    expect(labels).toEqual(
      expect.arrayContaining([
        'PetClaw',
        'About PetClaw',
        'Open PetClaw',
        'Show/Hide Pet',
        'Settings...',
        'Services',
        'Hide PetClaw',
        'Hide Others',
        'Show All'
      ])
    )
    expect(appMenu).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'about' })]))
    expect(appMenu).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'services' })]))
    expect(windowMenu).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'minimize' })])
    )
    expect(windowMenu).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'front' })]))
    expect(labels).toContain('Window')
  })

  it('sets explicit i18n labels for every visible Application Menu role item', () => {
    const actions = makeActions()

    const template = buildApplicationMenuTemplate(actions)
    const roleItems = collectRoleItems(template)

    expect(roleItems).not.toHaveLength(0)
    expect(roleItems.every((item) => typeof item.label === 'string')).toBe(true)
    expect(collectLabels(template)).not.toEqual(
      expect.arrayContaining([
        'system.services',
        'system.hidePetClaw',
        'system.hideOthers',
        'system.showAll',
        'system.undo',
        'system.copy',
        'system.closeWindow'
      ])
    )
  })

  it('keeps standard text editing shortcuts available in the Application Menu', () => {
    const actions = makeActions()

    const template = buildApplicationMenuTemplate(actions)
    const roles = collectRoles(template)

    expect(roles).toEqual(
      expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
    )
  })

  it('does not expose task monitor or configuration surfaces in system menus', () => {
    const actions = makeActions()
    const labels = [
      ...collectLabels(buildDockMenuTemplate(actions)),
      ...collectLabels(buildApplicationMenuTemplate(actions))
    ]

    expect(labels.join(' ')).not.toMatch(
      /Task Monitor|Runtime Monitor|Monitor|Model|Skill|Directory|IM|Cron|任务监控|运行时监控|模型|技能|目录|定时/
    )
  })

  it('does nothing outside macOS', () => {
    initializeMacosIntegration({
      actions: makeActions(),
      platform: 'win32'
    })

    expect(electronMock.buildFromTemplate).not.toHaveBeenCalled()
    expect(electronMock.setApplicationMenu).not.toHaveBeenCalled()
    expect(electronMock.setActivationPolicy).not.toHaveBeenCalled()
    expect(electronMock.setName).not.toHaveBeenCalled()
    expect(electronMock.createFromPath).not.toHaveBeenCalled()
    expect(electronMock.setDockIcon).not.toHaveBeenCalled()
    expect(electronMock.setDockMenu).not.toHaveBeenCalled()
    expect(electronMock.showDock).not.toHaveBeenCalled()
    expect(electronMock.on).not.toHaveBeenCalled()
  })

  it('installs Application Menu, Dock identity, dev Dock icon, Dock Menu, and activate handler on macOS dev runner', () => {
    const actions = makeActions()

    initializeMacosIntegration({
      actions,
      platform: 'darwin'
    })

    expect(electronMock.appMock.name).toBe('PetClaw')
    expect(electronMock.setName).toHaveBeenCalledWith('PetClaw')
    expect(electronMock.setActivationPolicy).toHaveBeenCalledWith('regular')
    expect(electronMock.createFromPath).toHaveBeenCalledWith(
      path.join('/tmp/petclaw-app', 'resources', 'icon.png')
    )
    expect(electronMock.setDockIcon).toHaveBeenCalledWith(electronMock.dockIcon)
    expect(electronMock.showDock).toHaveBeenCalledOnce()
    expect(electronMock.buildFromTemplate).toHaveBeenCalledTimes(2)
    expect(electronMock.setApplicationMenu).toHaveBeenCalledOnce()
    expect(electronMock.setDockMenu).toHaveBeenCalledOnce()
    expect(electronMock.on).toHaveBeenCalledWith('activate', actions.openPetClaw)
    expect(electronMock.on).not.toHaveBeenCalledWith('activate', actions.togglePet)
  })

  it('uses the packaged app bundle icon instead of overriding the Dock icon at runtime', () => {
    const actions = makeActions()
    electronMock.appMock.isPackaged = true

    initializeMacosIntegration({
      actions,
      platform: 'darwin'
    })

    expect(electronMock.appMock.name).toBe('PetClaw')
    expect(electronMock.setName).toHaveBeenCalledWith('PetClaw')
    expect(electronMock.setActivationPolicy).toHaveBeenCalledWith('regular')
    expect(electronMock.createFromPath).not.toHaveBeenCalled()
    expect(electronMock.setDockIcon).not.toHaveBeenCalled()
    expect(electronMock.showDock).toHaveBeenCalledOnce()
    expect(electronMock.setApplicationMenu).toHaveBeenCalledOnce()
    expect(electronMock.setDockMenu).toHaveBeenCalledOnce()
    expect(electronMock.on).toHaveBeenCalledWith('activate', actions.openPetClaw)
  })

  it('keeps the Dock visible without replacing the icon when the asset is missing', () => {
    const actions = makeActions()
    electronMock.dockIcon.isEmpty.mockReturnValueOnce(true)

    initializeMacosIntegration({
      actions,
      platform: 'darwin'
    })

    expect(electronMock.createFromPath).toHaveBeenCalledOnce()
    expect(electronMock.setDockIcon).not.toHaveBeenCalled()
    expect(electronMock.showDock).toHaveBeenCalledOnce()
    expect(electronMock.setApplicationMenu).toHaveBeenCalledOnce()
    expect(electronMock.setDockMenu).toHaveBeenCalledOnce()
  })

  it('logs a warning when Dock show fails', async () => {
    const actions = makeActions()
    electronMock.showDock.mockRejectedValueOnce(new Error('dock unavailable'))

    initializeMacosIntegration({
      actions,
      platform: 'darwin'
    })
    await Promise.resolve()

    expect(loggingMock.warn).toHaveBeenCalledWith(
      'dock.show.failed',
      'Failed to show Dock icon',
      expect.any(Error)
    )
  })

  it('refreshes native menus without re-registering activate handlers or changing the Dock icon', () => {
    const actions = makeActions()

    refreshMacosMenus({
      actions,
      platform: 'darwin'
    })

    expect(electronMock.buildFromTemplate).toHaveBeenCalledTimes(2)
    expect(electronMock.setApplicationMenu).toHaveBeenCalledOnce()
    expect(electronMock.setDockMenu).toHaveBeenCalledOnce()
    expect(electronMock.createFromPath).not.toHaveBeenCalled()
    expect(electronMock.setDockIcon).not.toHaveBeenCalled()
    expect(electronMock.on).not.toHaveBeenCalled()
  })
})
