import { useState, useCallback, useEffect } from 'react'
import { PetCanvas } from './pet/PetCanvas'
import { PetState, PetEvent, PetStateMachine } from './pet/state-machine'

export function App() {
  const [petState, setPetState] = useState<PetState>(PetState.Idle)
  const [paused, setPaused] = useState(false)
  const [stateMachine] = useState(
    () =>
      new PetStateMachine((_, to) => {
        setPetState(to)
      })
  )

  // 原生菜单「停一下/继续」回调
  useEffect(() => {
    const unsub = window.api.onPetTogglePause(() => {
      setPaused((prev) => {
        if (!prev) {
          setPetState(PetState.Idle)
        }
        return !prev
      })
    })
    return unsub
  }, [])

  // v3 统一事件入口：PetEventBridge 聚合后通过 pet:state-event 推送
  useEffect(() => {
    const unsub = window.api.pet.onStateEvent((data: unknown) => {
      const { event } = data as { event: string }
      if (!paused && (Object.values(PetEvent) as string[]).includes(event)) {
        stateMachine.send(event as PetEvent)
        if (event === PetEvent.AIDone) {
          setTimeout(() => stateMachine.send(PetEvent.Timeout), 3000)
        }
      }
    })
    return unsub
  }, [stateMachine, paused])

  // v3 气泡文本
  useEffect(() => {
    const unsub = window.api.pet.onBubble((data: unknown) => {
      const { text } = data as { text: string }
      console.warn('[pet:bubble]', text)
    })
    return unsub
  }, [])

  const handleDragMove = useCallback(
    (dx: number, dy: number) => {
      window.api.moveWindow(dx, dy)
      if (!paused) stateMachine.send(PetEvent.DragStart)
    },
    [stateMachine, paused]
  )

  const handleDragEnd = useCallback(() => {
    if (!paused) stateMachine.send(PetEvent.DragEnd)
  }, [stateMachine, paused])

  const handleClick = useCallback(() => {
    window.api.toggleChatWindow()
  }, [])

  const handleContextMenu = useCallback(() => {
    window.api.showPetContextMenu(paused)
  }, [paused])

  const handleSleepTimeout = useCallback(() => {
    if (!paused) stateMachine.send(PetEvent.SleepStart)
  }, [stateMachine, paused])

  return (
    <div className="w-full h-full bg-transparent relative">
      <PetCanvas
        state={petState}
        paused={paused}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onSleepTimeout={handleSleepTimeout}
      />
    </div>
  )
}
