import { describe, expect, it, vi } from 'vitest'

import { activateMainWindow } from '../../../src/main/system/window-activation'

function makeWindow() {
  return {
    show: vi.fn(),
    focus: vi.fn(),
    moveTop: vi.fn(),
    isMinimized: vi.fn(() => false),
    restore: vi.fn()
  }
}

describe('activateMainWindow', () => {
  it('restores regular macOS app identity, shows Dock, then focuses the main window', () => {
    const app = {
      show: vi.fn(),
      focus: vi.fn(),
      setActivationPolicy: vi.fn(),
      dock: {
        show: vi.fn(() => Promise.resolve())
      }
    }
    const window = makeWindow()

    activateMainWindow({
      app: app as never,
      window: window as never,
      platform: 'darwin'
    })

    expect(app.setActivationPolicy).toHaveBeenCalledWith('regular')
    expect(app.dock.show).toHaveBeenCalledOnce()
    expect(app.show).toHaveBeenCalledOnce()
    expect(app.focus).toHaveBeenCalledWith({ steal: true })
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.moveTop).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(app.setActivationPolicy.mock.invocationCallOrder[0]).toBeLessThan(
      app.show.mock.invocationCallOrder[0]
    )
    expect(app.show.mock.invocationCallOrder[0]).toBeLessThan(
      window.show.mock.invocationCallOrder[0]
    )
    expect(window.show.mock.invocationCallOrder[0]).toBeLessThan(
      window.moveTop.mock.invocationCallOrder[0]
    )
    expect(window.moveTop.mock.invocationCallOrder[0]).toBeLessThan(
      app.focus.mock.invocationCallOrder[0]
    )
    expect(app.focus.mock.invocationCallOrder[0]).toBeLessThan(
      window.focus.mock.invocationCallOrder[0]
    )
  })

  it('does not steal application focus on non-macOS platforms', () => {
    const app = {
      show: vi.fn(),
      focus: vi.fn()
    }
    const window = makeWindow()

    activateMainWindow({
      app: app as never,
      window: window as never,
      platform: 'win32'
    })

    expect(app.show).not.toHaveBeenCalled()
    expect(app.focus).not.toHaveBeenCalled()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.moveTop).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('restores a minimized window before showing it', () => {
    const app = {
      show: vi.fn(),
      focus: vi.fn()
    }
    const window = makeWindow()
    window.isMinimized.mockReturnValue(true)

    activateMainWindow({
      app: app as never,
      window: window as never,
      platform: 'darwin'
    })

    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.restore.mock.invocationCallOrder[0]).toBeLessThan(
      window.show.mock.invocationCallOrder[0]
    )
  })
})
