import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SystemActions } from '../../../src/main/system/system-actions'
import {
  buildTrayMenuTemplate,
  createTray,
  shouldCreateFallbackTray,
  updateTrayMenu
} from '../../../src/main/system/tray'

const electronMock = vi.hoisted(() => {
  const trayInstance = {
    setTitle: vi.fn(),
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn()
  }
  const Tray = vi.fn(() => trayInstance)
  const buildFromTemplate = vi.fn((template: unknown) => ({ template }))
  const createEmpty = vi.fn(() => ({ empty: true }))

  return {
    trayInstance,
    Tray,
    buildFromTemplate,
    createEmpty
  }
})

vi.mock('electron', () => ({
  Tray: electronMock.Tray,
  Menu: {
    buildFromTemplate: electronMock.buildFromTemplate
  },
  nativeImage: {
    createEmpty: electronMock.createEmpty
  }
}))

vi.mock('../../../src/main/i18n', () => ({
  t: (key: string) =>
    ({
      'system.openPetClaw': 'Open PetClaw',
      'system.togglePet': 'Show/Hide Pet',
      'system.quit': 'Quit PetClaw'
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
  }

  return labels
}

describe('fallback tray', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is not created by default on macOS', () => {
    expect(shouldCreateFallbackTray('darwin')).toBe(false)
    expect(shouldCreateFallbackTray('win32')).toBe(true)
    expect(shouldCreateFallbackTray('linux')).toBe(true)
  })

  it('keeps only core actions in the fallback tray menu', () => {
    const actions = makeActions()
    const template = buildTrayMenuTemplate(actions)

    expect(collectLabels(template)).toEqual(['Open PetClaw', 'Show/Hide Pet', 'Quit PetClaw'])
    expect(template[0]).toMatchObject({ click: actions.openPetClaw })
    expect(template[1]).toMatchObject({ click: actions.togglePet })
    expect(template[3]).toMatchObject({ click: actions.quitPetClaw })
  })

  it('does not expose task monitor or detailed configuration surfaces', () => {
    const labels = collectLabels(buildTrayMenuTemplate(makeActions()))

    expect(labels.join(' ')).not.toMatch(
      /Task Monitor|Runtime Monitor|Monitor|Model|Skill|Directory|IM|Cron|任务监控|运行时监控|模型|技能|目录|定时/
    )
  })

  it('creates a tray without using an emoji title as the brand entry', () => {
    const actions = makeActions()

    createTray(actions)

    expect(electronMock.createEmpty).toHaveBeenCalledOnce()
    expect(electronMock.Tray).toHaveBeenCalledOnce()
    expect(electronMock.trayInstance.setTitle).not.toHaveBeenCalled()
    expect(electronMock.trayInstance.setToolTip).toHaveBeenCalledWith('PetClaw')
    expect(electronMock.trayInstance.setContextMenu).toHaveBeenCalledOnce()
    expect(electronMock.trayInstance.on).toHaveBeenCalledWith('click', actions.openPetClaw)
  })

  it('rebuilds the fallback tray menu when language changes', () => {
    const actions = makeActions()

    updateTrayMenu(electronMock.trayInstance as never, actions)

    expect(electronMock.buildFromTemplate).toHaveBeenCalledOnce()
    expect(electronMock.trayInstance.setContextMenu).toHaveBeenCalledOnce()
  })
})
