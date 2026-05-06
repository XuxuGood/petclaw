import { beforeEach, describe, expect, test, vi } from 'vitest'

const ipcMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  safeHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    ipcMock.handlers.set(channel, handler)
  }),
  reportRendererLog: vi.fn(),
  snapshot: vi.fn(() => ({
    writable: true,
    sources: [
      {
        source: 'main',
        dir: '/tmp/petclaw/logs/main',
        currentFile: '/tmp/petclaw/logs/main/main-2026-05-05.log',
        exists: true
      }
    ],
    errors: []
  })),
  exportDiagnosticsBundle: vi.fn(),
  openPath: vi.fn(() => Promise.resolve(''))
}))

vi.mock('../../../src/main/ipc/ipc-registry', () => ({
  safeHandle: ipcMock.safeHandle
}))

vi.mock('../../../src/main/logging/facade', () => ({
  getLoggingPlatform: () => ({
    reportRendererLog: ipcMock.reportRendererLog,
    snapshot: ipcMock.snapshot
  })
}))

vi.mock('../../../src/main/logging/diagnostics-bundle', () => ({
  exportDiagnosticsBundle: ipcMock.exportDiagnosticsBundle
}))

vi.mock('electron', () => ({
  shell: {
    openPath: ipcMock.openPath
  }
}))

describe('validateRendererLogReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcMock.handlers.clear()
  })

  test('accepts warn and error reports', async () => {
    const { validateRendererLogReport } = await import('../../../src/main/logging/logging-ipc')

    expect(
      validateRendererLogReport({
        level: 'error',
        module: 'BootCheckPanel',
        event: 'renderer.render.failed',
        message: 'failed',
        fields: { retry: true }
      })
    ).toEqual({
      level: 'error',
      module: 'BootCheckPanel',
      event: 'renderer.render.failed',
      message: 'failed',
      fields: { retry: true }
    })
  })

  test('rejects info reports from renderer', async () => {
    const { validateRendererLogReport } = await import('../../../src/main/logging/logging-ipc')

    expect(() =>
      validateRendererLogReport({
        level: 'info',
        module: 'BootCheckPanel',
        event: 'renderer.click'
      })
    ).toThrow('Invalid renderer log level')
  })

  test('rejects oversized event names', async () => {
    const { validateRendererLogReport } = await import('../../../src/main/logging/logging-ipc')

    expect(() =>
      validateRendererLogReport({
        level: 'error',
        module: 'BootCheckPanel',
        event: 'x'.repeat(200)
      })
    ).toThrow('Invalid renderer log event')
  })
})

describe('registerLoggingIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcMock.handlers.clear()
  })

  test('registers logging IPC handlers through the registry', async () => {
    const { registerLoggingIpcHandlers } = await import('../../../src/main/logging/logging-ipc')

    registerLoggingIpcHandlers()

    expect([...ipcMock.handlers.keys()].sort()).toEqual([
      'logging:export-diagnostics',
      'logging:open-log-folder',
      'logging:report',
      'logging:snapshot'
    ])
  })

  test('writes renderer reports through the logging platform', async () => {
    const { registerLoggingIpcHandlers } = await import('../../../src/main/logging/logging-ipc')
    registerLoggingIpcHandlers()

    ipcMock.handlers.get('logging:report')?.({} as never, {
      level: 'warn',
      module: 'Settings',
      event: 'renderer.logging.failed'
    })

    expect(ipcMock.reportRendererLog).toHaveBeenCalledWith({
      level: 'warn',
      module: 'Settings',
      event: 'renderer.logging.failed'
    })
  })

  test('opens only the main log folder resolved by the logging platform', async () => {
    const { registerLoggingIpcHandlers } = await import('../../../src/main/logging/logging-ipc')
    registerLoggingIpcHandlers()

    await ipcMock.handlers.get('logging:open-log-folder')?.({} as never)

    expect(ipcMock.openPath).toHaveBeenCalledWith('/tmp/petclaw/logs/main')
  })
})
