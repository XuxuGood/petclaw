import { useState, useCallback, useEffect, useRef } from 'react'
import { PetCanvas } from './PetCanvas'
import { PetState, PetEvent, PetStateMachine } from './state-machine'

export function PetApp() {
  const [petState, setPetState] = useState<PetState>(PetState.Idle)
  const [paused, setPaused] = useState(false)
  const [bubbleText, setBubbleText] = useState('')
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
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

  // 统一事件入口：PetEventBridge 聚合后通过 pet:state-event 推送
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

  // 显示气泡：设置文本后 4 秒自动清除。
  // 多次触发时重置计时器，保证最新气泡完整显示。
  const showBubble = useCallback((text: string) => {
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
    setBubbleText(text)
    bubbleTimerRef.current = setTimeout(() => {
      setBubbleText('')
      bubbleTimerRef.current = undefined
    }, 4000)
  }, [])

  // 气泡文本：PetEventBridge 聚合后通过 pet:bubble 推送
  // 暂停时气泡直接丢弃，不缓存（暂停语义 = 宠物停止一切活动）
  useEffect(() => {
    const unsub = window.api.pet.onBubble((data: unknown) => {
      const { text } = data as { text: string }
      if (text && !paused) showBubble(text)
    })
    return unsub
  }, [showBubble, paused])

  // 拖拽是纯视图操作，不影响状态机
  const handleDragMove = useCallback((dx: number, dy: number) => {
    window.api.moveWindow(dx, dy)
  }, [])

  const handleDragEnd = useCallback(() => {}, [])

  // 点击：Sleep 状态下优先唤醒宠物，非 Sleep 状态切换主窗口
  const handleClick = useCallback(() => {
    if (petState === PetState.Sleep) {
      stateMachine.send(PetEvent.WakeUp)
    } else {
      window.api.toggleMainWindow()
    }
  }, [petState, stateMachine])

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
        bubbleText={bubbleText}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onSleepTimeout={handleSleepTimeout}
      />
    </div>
  )
}
