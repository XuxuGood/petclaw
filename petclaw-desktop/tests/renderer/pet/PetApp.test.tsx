import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { PetApp } from '../../../src/renderer/src/pet/PetApp'
import { PetState } from '../../../src/renderer/src/pet/state-machine'

const petCanvasMock = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null
}))

vi.mock('../../../src/renderer/src/pet/PetCanvas', () => ({
  PetCanvas: vi.fn((props: Record<string, unknown>) => {
    petCanvasMock.props = props
    return React.createElement('button', { type: 'button' }, 'pet')
  })
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function makeApi() {
  return {
    moveWindow: vi.fn(),
    toggleMainWindow: vi.fn(),
    showPetContextMenu: vi.fn(),
    onPetTogglePause: vi.fn(() => vi.fn()),
    pet: {
      onStateEvent: vi.fn(() => vi.fn()),
      onBubble: vi.fn(() => vi.fn())
    }
  }
}

function latestPetCanvasProps() {
  if (!petCanvasMock.props) throw new Error('PetCanvas was not rendered')
  return petCanvasMock.props as {
    state: PetState
    onClick: () => void
    onSleepTimeout: () => void
  }
}

describe('PetApp click behavior', () => {
  let container: HTMLDivElement
  let root: Root
  let api: ReturnType<typeof makeApi>

  beforeEach(() => {
    petCanvasMock.props = null
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

  it('toggles the main app when the pet is clicked', () => {
    act(() => {
      root.render(<PetApp />)
    })

    act(() => {
      latestPetCanvasProps().onClick()
    })

    expect(api.toggleMainWindow).toHaveBeenCalledOnce()
  })

  it('wakes a sleeping pet and toggles the main app on the same click', () => {
    act(() => {
      root.render(<PetApp />)
    })

    act(() => {
      latestPetCanvasProps().onSleepTimeout()
    })
    expect(latestPetCanvasProps().state).toBe(PetState.Sleep)

    act(() => {
      latestPetCanvasProps().onClick()
    })

    expect(api.toggleMainWindow).toHaveBeenCalledOnce()
    expect(latestPetCanvasProps().state).toBe(PetState.Idle)
  })
})
