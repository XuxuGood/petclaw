import { useState, useCallback, useRef } from 'react'
import { PetCanvas } from './pet/PetCanvas'
import { PetState } from './pet/state-machine'

export function App(): JSX.Element {
  const [petState, setPetState] = useState<PetState>(PetState.Idle)
  const panelOpen = useRef(false)

  const handleDragMove = useCallback((dx: number, dy: number) => {
    // Move the Electron window
    window.api?.moveWindow?.(dx, dy)
    setPetState(PetState.Dragging)
  }, [])

  const handleDragEnd = useCallback(() => {
    setPetState(PetState.Idle)
  }, [])

  const handleClick = useCallback(() => {
    panelOpen.current = !panelOpen.current
  }, [])

  return (
    <div className="w-full h-full bg-transparent">
      <PetCanvas
        state={petState}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
      />
    </div>
  )
}
