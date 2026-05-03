import { describe, it, expect } from 'vitest'

import { resolveMainWindowBounds, resolvePetWindowBounds } from '../../src/main/window-layout'

describe('windows layout helpers', () => {
  it('restores saved main window bounds when they are valid', () => {
    const bounds = resolveMainWindowBounds({
      screen: { width: 1440, height: 900 },
      savedBounds: { x: 100, y: 80, width: 900, height: 700 }
    })

    expect(bounds).toMatchObject({ x: 100, y: 80, width: 900, height: 700 })
  })

  it('keeps saved main window size but drops position when saved bounds are off screen', () => {
    const bounds = resolveMainWindowBounds({
      screen: { width: 1440, height: 900 },
      savedBounds: { x: 3000, y: 80, width: 900, height: 700 }
    })

    expect(bounds.x).toBeUndefined()
    expect(bounds.y).toBeUndefined()
    expect(bounds.width).toBe(900)
    expect(bounds.height).toBe(700)
  })

  it('clamps old tiny saved main window bounds to compact minimum size', () => {
    const bounds = resolveMainWindowBounds({
      screen: { width: 1440, height: 900 },
      savedBounds: { x: 100, y: 80, width: 640, height: 500 }
    })

    expect(bounds).toMatchObject({ x: 100, y: 80, width: 760, height: 500 })
  })

  it('clamps extremely small saved main window bounds to mobile-like minimum size', () => {
    const bounds = resolveMainWindowBounds({
      screen: { width: 1440, height: 900 },
      savedBounds: { x: 100, y: 80, width: 420, height: 360 }
    })

    expect(bounds).toMatchObject({ x: 100, y: 80, width: 760, height: 460 })
  })

  it('anchors pet window to the chat window when no saved pet position exists', () => {
    const bounds = resolvePetWindowBounds({
      screen: { width: 1440, height: 900 },
      chatBounds: { x: 200, y: 100, width: 900, height: 700 }
    })

    expect(bounds).toEqual({ x: 950, y: 600 })
  })

  it('prefers valid saved pet position over chat anchor', () => {
    const bounds = resolvePetWindowBounds({
      screen: { width: 1440, height: 900 },
      savedPetPosition: { x: 40, y: 50 },
      chatBounds: { x: 200, y: 100, width: 900, height: 700 }
    })

    expect(bounds).toEqual({ x: 40, y: 50 })
  })
})
