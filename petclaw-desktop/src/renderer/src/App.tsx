import { useState, useCallback, useEffect } from 'react'
import { PetCanvas } from './pet/PetCanvas'
import { PetState, PetEvent, PetStateMachine } from './pet/state-machine'
import { ChatPanel } from './panels/ChatPanel'

export function App(): JSX.Element {
  const [petState, setPetState] = useState<PetState>(PetState.Idle)
  const [panelOpen, setPanelOpen] = useState(false)
  const [stateMachine] = useState(
    () =>
      new PetStateMachine((_, to) => {
        setPetState(to)
      })
  )

  // Listen for AI events to drive pet state
  useEffect(() => {
    const unsub1 = window.api.onAIResponding(() => {
      stateMachine.send(PetEvent.ChatSent)
      stateMachine.send(PetEvent.AIResponding)
    })
    const unsub2 = window.api.onChatDone(() => {
      stateMachine.send(PetEvent.AIDone)
      // Return to idle after 3s
      setTimeout(() => stateMachine.send(PetEvent.Timeout), 3000)
    })
    return () => {
      unsub1()
      unsub2()
    }
  }, [stateMachine])

  const handleDragMove = useCallback(
    (dx: number, dy: number) => {
      window.api.moveWindow(dx, dy)
      stateMachine.send(PetEvent.DragStart)
    },
    [stateMachine]
  )

  const handleDragEnd = useCallback(() => {
    stateMachine.send(PetEvent.DragEnd)
  }, [stateMachine])

  const handleClick = useCallback(() => {
    setPanelOpen((prev) => !prev)
  }, [])

  return (
    <div className="w-full h-full bg-transparent relative">
      <PetCanvas
        state={petState}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
      />
      {panelOpen && <ChatPanel onClose={() => setPanelOpen(false)} />}
    </div>
  )
}
