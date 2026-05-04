import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SystemActions } from '../../../src/main/system/system-actions'
import {
  buildApplicationMenuTemplate,
  buildDockMenuTemplate,
  initializeMacosIntegration
} from '../../../src/main/system/macos-integration'

const electronMock = vi.hoisted(() => {
  const buildFromTemplate = vi.fn((template: unknown) => ({ template }))
  const setApplicationMenu = vi.fn()
  const setDockMenu = vi.fn()
  const on = vi.fn()

  return {
    buildFromTemplate,
    setApplicationMenu,
    setDockMenu,
    on
  }
})

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: electronMock.buildFromTemplate,
    setApplicationMenu: electronMock.setApplicationMenu
  },
  app: {
    dock: {
      setMenu: electronMock.setDockMenu
    },
    on: electronMock.on
  }
}))

vi.mock('../../../src/main/i18n', () => ({
  t: (key: string) =>
    ({
      'system.about': 'About PetClaw',
      'system.openPetClaw': 'Open PetClaw',
      'system.togglePet': 'Show/Hide Pet',
      'system.settings': 'Settings...',
      'system.quit': 'Quit PetClaw',
      'system.window': 'Window'
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

describe('macOS system integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds a focused Dock menu with only core system actions', () => {
    const actions = makeActions()

    const template = buildDockMenuTemplate(actions)
    const labels = collectLabels(template)

    expect(labels).toEqual(['Open PetClaw', 'Show/Hide Pet', 'Settings...', 'Quit PetClaw'])
    expect(template[0]).toMatchObject({ click: actions.openPetClaw })
    expect(template[1]).toMatchObject({ click: actions.togglePet })
    expect(template[2]).toMatchObject({ click: actions.showSettings })
    expect(template[4]).toMatchObject({ click: actions.quitPetClaw })
  })

  it('builds an Application Menu with macOS roles and core business entries', () => {
    const actions = makeActions()

    const template = buildApplicationMenuTemplate(actions)
    const labels = collectLabels(template)
    const appMenu = template[0].submenu as Array<Record<string, unknown>>
    const windowMenu = template[1].submenu as Array<Record<string, unknown>>

    expect(labels).toEqual(
      expect.arrayContaining([
        'PetClaw',
        'About PetClaw',
        'Open PetClaw',
        'Show/Hide Pet',
        'Settings...'
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
    expect(electronMock.setDockMenu).not.toHaveBeenCalled()
    expect(electronMock.on).not.toHaveBeenCalled()
  })

  it('installs Application Menu, Dock Menu, and activate handler on macOS', () => {
    const actions = makeActions()

    initializeMacosIntegration({
      actions,
      platform: 'darwin'
    })

    expect(electronMock.buildFromTemplate).toHaveBeenCalledTimes(2)
    expect(electronMock.setApplicationMenu).toHaveBeenCalledOnce()
    expect(electronMock.setDockMenu).toHaveBeenCalledOnce()
    expect(electronMock.on).toHaveBeenCalledWith('activate', actions.openPetClaw)
    expect(electronMock.on).not.toHaveBeenCalledWith('activate', actions.togglePet)
  })
})
