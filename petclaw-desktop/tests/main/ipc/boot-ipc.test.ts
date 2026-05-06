import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  safeHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    ipcMock.handlers.set(channel, handler)
  })
}))

vi.mock('../../../src/main/ipc/ipc-registry', () => ({
  safeHandle: ipcMock.safeHandle
}))

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.1.0')
  }
}))

const i18nMock = vi.hoisted(() => ({
  getLanguage: vi.fn(() => 'zh'),
  setLanguage: vi.fn()
}))

vi.mock('../../../src/main/i18n', () => i18nMock)

describe('registerBootIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcMock.handlers.clear()
  })

  it('refreshes native system menus after a valid language change', async () => {
    const refreshSystemMenus = vi.fn()
    const { registerBootIpcHandlers } = await import('../../../src/main/ipc/boot-ipc')

    registerBootIpcHandlers({
      db: {} as never,
      refreshSystemMenus
    })

    ipcMock.handlers.get('i18n:set-language')?.({} as never, 'en')

    expect(i18nMock.setLanguage).toHaveBeenCalledWith('en')
    expect(refreshSystemMenus).toHaveBeenCalledOnce()
  })

  it('does not refresh native menus for invalid locales', async () => {
    const refreshSystemMenus = vi.fn()
    const { registerBootIpcHandlers } = await import('../../../src/main/ipc/boot-ipc')

    registerBootIpcHandlers({
      db: {} as never,
      refreshSystemMenus
    })

    ipcMock.handlers.get('i18n:set-language')?.({} as never, 'fr')

    expect(i18nMock.setLanguage).not.toHaveBeenCalled()
    expect(refreshSystemMenus).not.toHaveBeenCalled()
  })
})
