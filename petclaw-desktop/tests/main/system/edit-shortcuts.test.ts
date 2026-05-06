import { describe, expect, it, vi } from 'vitest'

import { registerEditShortcuts } from '../../../src/main/system/edit-shortcuts'

type ShortcutListener = Parameters<Parameters<typeof registerEditShortcuts>[0]['on']>[1]

function makeWebContents() {
  let listener: ShortcutListener | null = null
  const event = { preventDefault: vi.fn() }
  const webContents = {
    on: vi.fn((name: 'before-input-event', next: ShortcutListener) => {
      if (name === 'before-input-event') listener = next
    }),
    undo: vi.fn(),
    redo: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn()
  }

  registerEditShortcuts(webContents)

  return {
    event,
    webContents,
    trigger: (input: { type?: string; key: string; control?: boolean; meta?: boolean }) => {
      listener?.(event, { type: input.type ?? 'keyDown', ...input })
    }
  }
}

describe('edit shortcuts', () => {
  it('maps Command+C and Ctrl+C to webContents.copy', () => {
    const { trigger, webContents, event } = makeWebContents()

    trigger({ key: 'c', meta: true })
    trigger({ key: 'c', control: true })

    expect(webContents.copy).toHaveBeenCalledTimes(2)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
  })

  it('maps common edit shortcuts to webContents edit commands', () => {
    const { trigger, webContents } = makeWebContents()

    trigger({ key: 'a', control: true })
    trigger({ key: 'x', control: true })
    trigger({ key: 'v', control: true })
    trigger({ key: 'z', control: true })
    trigger({ key: 'y', control: true })

    expect(webContents.selectAll).toHaveBeenCalledTimes(1)
    expect(webContents.cut).toHaveBeenCalledTimes(1)
    expect(webContents.paste).toHaveBeenCalledTimes(1)
    expect(webContents.undo).toHaveBeenCalledTimes(1)
    expect(webContents.redo).toHaveBeenCalledTimes(1)
  })

  it('ignores non-edit key events', () => {
    const { trigger, webContents, event } = makeWebContents()

    trigger({ key: 'c' })
    trigger({ type: 'keyUp', key: 'c', control: true })

    expect(webContents.copy).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
