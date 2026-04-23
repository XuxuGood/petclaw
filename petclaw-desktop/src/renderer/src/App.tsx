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

  useEffect(() => {
    // v1 兼容层：旧 IPC channel 在 Task 15 清理前继续保留
    const unsub0 = window.api.onChatSent(() => {
      if (!paused) stateMachine.send(PetEvent.ChatSent)
    })
    const unsub1 = window.api.onAIResponding(() => {
      if (!paused) stateMachine.send(PetEvent.AIResponding)
    })
    const unsub2 = window.api.onChatDone(() => {
      if (!paused) {
        stateMachine.send(PetEvent.AIDone)
        setTimeout(() => stateMachine.send(PetEvent.Timeout), 3000)
      }
    })
    const unsub3 = window.api.onHookEvent((event) => {
      if (!paused) {
        if (event.type === 'session_end') {
          stateMachine.send(PetEvent.HookIdle)
        } else {
          stateMachine.send(PetEvent.HookActive)
        }
      }
    })
    // 原生菜单「停一下/继续」回调 — 窗口级事件，不在 v3 cowork 流程内
    const unsub4 = window.api.onPetTogglePause(() => {
      setPaused((prev) => {
        if (!prev) {
          setPetState(PetState.Idle)
        }
        return !prev
      })
    })
    return () => {
      unsub0()
      unsub1()
      unsub2()
      unsub3()
      unsub4()
    }
  }, [stateMachine, paused])

  // v3 统一事件入口：PetEventBridge 聚合后通过 pet:state-event 推送
  useEffect(() => {
    const unsub = window.api.pet.onStateEvent((data: unknown) => {
      const { event } = data as { event: string }
      // 校验 event 是合法的 PetEvent 枚举值，防止非法字符串进入状态机
      if (!paused && (Object.values(PetEvent) as string[]).includes(event)) {
        stateMachine.send(event as PetEvent)
        // AI_DONE 完成后自动 3s 回到 Idle
        if (event === PetEvent.AIDone) {
          setTimeout(() => stateMachine.send(PetEvent.Timeout), 3000)
        }
      }
    })
    return unsub
  }, [stateMachine, paused])

  // v3 bubble 订阅：暂存日志，气泡 UI 在后续任务实现
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
