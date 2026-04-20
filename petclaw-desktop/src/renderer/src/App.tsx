import { useState, useCallback, useEffect } from 'react'
import { PetCanvas } from './pet/PetCanvas'
import { PetState, PetEvent, PetStateMachine } from './pet/state-machine'

export function App(): JSX.Element {
  const [petState, setPetState] = useState<PetState>(PetState.Idle)
  const [stateMachine] = useState(
    () =>
      new PetStateMachine((_, to) => {
        setPetState(to)
      })
  )

  useEffect(() => {
    const unsub1 = window.api.onAIResponding(() => {
      stateMachine.send(PetEvent.ChatSent)
      stateMachine.send(PetEvent.AIResponding)
    })
    const unsub2 = window.api.onChatDone(() => {
      stateMachine.send(PetEvent.AIDone)
      setTimeout(() => stateMachine.send(PetEvent.Timeout), 3000)
    })
    const unsub3 = window.api.onHookEvent((event) => {
      if (event.type === 'session_end') {
        stateMachine.send(PetEvent.HookIdle)
      } else {
        stateMachine.send(PetEvent.HookActive)
      }
    })
    return () => {
      unsub1()
      unsub2()
      unsub3()
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
    window.api.toggleChatWindow()
  }, [])

  const handleContextMenu = useCallback(() => {
    window.api.toggleChatWindow()
  }, [])

  return (
    <div className="w-full h-full bg-transparent">
      <PetCanvas
        state={petState}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />
    </div>
  )
}
