import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerWindowIpcHandlers } from '../../../src/main/ipc/window-ipc'
import type { SystemActions } from '../../../src/main/system/system-actions'

const registeredListeners = new Map<string, (...args: never[]) => void>()

const electronMock = vi.hoisted(() => {
  const popup = vi.fn()
  const fromWebContents = vi.fn()
  const buildFromTemplate = vi.fn((template: unknown) => ({ popup, template }))
  const quit = vi.fn()

  return {
    popup,
    fromWebContents,
    buildFromTemplate,
    quit
  }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: electronMock.fromWebContents
  },
  Menu: {
    buildFromTemplate: electronMock.buildFromTemplate
  },
  app: {
    quit: electronMock.quit
  }
}))

vi.mock('../../../src/main/i18n', () => ({
  t: (key: string) =>
    ({
      'system.openPetClaw': 'Open PetClaw',
      'system.togglePet': 'Show/Hide Pet',
      'system.pausePet': 'Pause Pet',
      'system.resumePet': 'Resume Pet',
      'system.settings': 'Settings...',
      'system.quit': 'Quit PetClaw'
    })[key] ?? key
}))

vi.mock('../../../src/main/ipc/ipc-registry', () => ({
  safeOn: vi.fn((channel: string, handler: (...args: never[]) => void) => {
    registeredListeners.set(channel, handler)
  })
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

function makePetWindow() {
  return {
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: {
      send: vi.fn()
    }
  }
}

function registerHandlers(actions = makeActions(), petWindow = makePetWindow()) {
  const legacyToggleMainWindow = vi.fn()
  const deps = {
    getPetWindow: () => petWindow,
    toggleMainWindow: legacyToggleMainWindow,
    actions
  }

  registerWindowIpcHandlers(deps)

  return { actions, legacyToggleMainWindow, petWindow }
}

function getListener(channel: string) {
  const listener = registeredListeners.get(channel)
  if (!listener) throw new Error(`Missing IPC listener: ${channel}`)
  return listener
}

function getLastMenuTemplate(): Array<Record<string, unknown>> {
  const calls = electronMock.buildFromTemplate.mock.calls
  const template = calls.at(-1)?.[0]
  if (!Array.isArray(template)) throw new Error('Missing menu template')
  return template as Array<Record<string, unknown>>
}

function labelsOf(template: ReadonlyArray<Record<string, unknown>>): string[] {
  return template.flatMap((item) => (typeof item.label === 'string' ? [item.label] : []))
}

function clickMenuItem(item: Record<string, unknown>): void {
  if (typeof item.click !== 'function') throw new Error('Missing menu item click handler')
  item.click()
}

describe('registerWindowIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredListeners.clear()
  })

  it('opens the main app through SystemActions for the legacy chat toggle event', () => {
    const { actions, legacyToggleMainWindow } = registerHandlers()

    getListener('chat:toggle')()

    expect(actions.openPetClaw).toHaveBeenCalledOnce()
    expect(legacyToggleMainWindow).not.toHaveBeenCalled()
  })

  it('builds the Pet Context Menu from system actions', () => {
    const { actions, petWindow } = registerHandlers()

    getListener('pet:context-menu')({} as never, false)
    const template = getLastMenuTemplate()

    expect(labelsOf(template)).toEqual([
      'Open PetClaw',
      'Show/Hide Pet',
      'Pause Pet',
      'Settings...',
      'Quit PetClaw'
    ])
    expect(template[0]).toMatchObject({ click: actions.openPetClaw })
    expect(template[1]).toMatchObject({ click: actions.togglePet })
    expect(template[3]).toMatchObject({ click: actions.showSettings })
    expect(template[5]).toMatchObject({ click: actions.quitPetClaw })
    expect(electronMock.popup).toHaveBeenCalledWith({ window: petWindow })
  })

  it('uses Resume Pet when the pet is already paused', () => {
    registerHandlers()

    getListener('pet:context-menu')({} as never, true)

    expect(labelsOf(getLastMenuTemplate())).toContain('Resume Pet')
  })

  it('does not expose task monitor or configuration surfaces in the Pet Context Menu', () => {
    registerHandlers()

    getListener('pet:context-menu')({} as never, false)

    expect(labelsOf(getLastMenuTemplate()).join(' ')).not.toMatch(
      /Task Monitor|Runtime Monitor|Monitor|Model|Skill|Directory|IM|Cron|任务监控|运行时监控|模型|技能|目录|定时/
    )
  })

  it('pause/resume only sends the pet pause event', () => {
    const { actions, petWindow } = registerHandlers()

    getListener('pet:context-menu')({} as never, false)
    clickMenuItem(getLastMenuTemplate()[2])

    expect(petWindow.webContents.send).toHaveBeenCalledWith('pet:toggle-pause')
    expect(actions.quitPetClaw).not.toHaveBeenCalled()
    expect(electronMock.quit).not.toHaveBeenCalled()
  })

  it('uses SystemActions for app quit compatibility event', () => {
    const { actions } = registerHandlers()

    getListener('app:quit')()

    expect(actions.quitPetClaw).toHaveBeenCalledOnce()
    expect(electronMock.quit).not.toHaveBeenCalled()
  })
})
