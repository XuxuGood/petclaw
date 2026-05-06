import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EngineSettings } from '../../../src/renderer/src/views/settings/EngineSettings'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function makeApi() {
  return {
    engine: {
      onStatus: vi.fn(() => vi.fn())
    },
    logging: {
      openLogFolder: vi.fn().mockResolvedValue(undefined),
      exportDiagnostics: vi.fn().mockResolvedValue({
        filePath: '/tmp/petclaw-diagnostics.zip',
        sizeBytes: 100,
        redactionCount: 0,
        exportWarnings: []
      }),
      snapshot: vi.fn().mockResolvedValue({}),
      report: vi.fn().mockResolvedValue(undefined)
    }
  }
}

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(label)
  )
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return button
}

describe('diagnostics actions', () => {
  let container: HTMLDivElement
  let root: Root
  let api: ReturnType<typeof makeApi>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    api = makeApi()
    Object.defineProperty(window, 'api', {
      value: api,
      configurable: true
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('EngineSettings exports diagnostics through preload api', async () => {
    await act(async () => {
      root.render(<EngineSettings />)
    })

    await act(async () => {
      getButton(container, '导出诊断包').click()
    })

    expect(api.logging.exportDiagnostics).toHaveBeenCalledWith({ timeRangeDays: 3 })
    expect(container.textContent).toContain('诊断包已导出')
  })

  it('EngineSettings reports diagnostics export failures', async () => {
    api.logging.exportDiagnostics.mockRejectedValueOnce(new Error('disk full'))

    await act(async () => {
      root.render(<EngineSettings />)
    })

    await act(async () => {
      getButton(container, '导出诊断包').click()
    })

    expect(api.logging.report).toHaveBeenCalledWith({
      level: 'error',
      module: 'EngineSettings',
      event: 'renderer.logging.exportDiagnostics.failed',
      message: 'disk full'
    })
    expect(container.textContent).toContain('诊断包导出失败：disk full')
  })
})
