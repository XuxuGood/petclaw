import { useEffect, useRef, useState, useCallback } from 'react'
import { PetState } from './state-machine'

import beginVideo from '../assets/cat/begin.webm'
import staticVideo from '../assets/cat/static.webm'
import listeningVideo from '../assets/cat/listening.webm'
import sleepStartVideo from '../assets/cat/sleep-start.webm'
import sleepLoopVideo from '../assets/cat/sleep-loop.webm'
import sleepLeaveVideo from '../assets/cat/sleep-leave.webm'
import taskStartVideo from '../assets/cat/task-start.webm'
import taskLoopVideo from '../assets/cat/task-loop.webm'
import taskLeaveVideo from '../assets/cat/task-leave.webm'

interface PetCanvasProps {
  state: PetState
  onDragMove?: (dx: number, dy: number) => void
  onDragEnd?: () => void
  onClick?: () => void
  onContextMenu?: () => void
}

const DRAG_THRESHOLD = 5
const SLEEP_DELAY = 120_000 // 2 minutes idle before sleeping

type VideoStep = { src: string; loop: boolean }

/**
 * Double-buffered video player to avoid flicker on source switch.
 * Two <video> elements swap: the back one loads while the front one keeps showing.
 */
class VideoPlayer {
  private videos: [HTMLVideoElement, HTMLVideoElement]
  private activeIdx = 0
  private queue: VideoStep[] = []
  private endedHandler: (() => void) | null = null

  constructor(v0: HTMLVideoElement, v1: HTMLVideoElement) {
    this.videos = [v0, v1]
    v0.style.visibility = 'visible'
    v1.style.visibility = 'hidden'
  }

  get active(): HTMLVideoElement {
    return this.videos[this.activeIdx]
  }

  get back(): HTMLVideoElement {
    return this.videos[1 - this.activeIdx]
  }

  playSequence(steps: VideoStep[]): void {
    // Clean up previous
    this.clearEnded()
    this.queue = []

    if (steps.length === 0) return
    const [first, ...rest] = steps
    this.queue = rest
    this.loadAndPlay(first)
  }

  private loadAndPlay(step: VideoStep): void {
    this.clearEnded()
    const back = this.back

    back.loop = step.loop
    back.src = step.src
    back.load()

    const onCanPlay = (): void => {
      back.removeEventListener('canplay', onCanPlay)
      // Swap: show back, hide old active
      this.activeIdx = 1 - this.activeIdx
      this.active.style.visibility = 'visible'
      this.back.style.visibility = 'hidden'
      this.back.pause()

      this.active.play().catch(() => {})

      // If not looping and there's more in queue, chain
      if (!step.loop && this.queue.length > 0) {
        const next = this.queue.shift()!
        this.endedHandler = () => {
          this.active.removeEventListener('ended', this.endedHandler!)
          this.endedHandler = null
          this.loadAndPlay(next)
        }
        this.active.addEventListener('ended', this.endedHandler)
      }
    }
    back.addEventListener('canplay', onCanPlay)
  }

  private clearEnded(): void {
    if (this.endedHandler) {
      this.active.removeEventListener('ended', this.endedHandler)
      this.endedHandler = null
    }
  }
}

export function PetCanvas({
  state,
  onDragMove,
  onDragEnd,
  onClick,
  onContextMenu
}: PetCanvasProps): JSX.Element {
  const video0Ref = useRef<HTMLVideoElement>(null)
  const video1Ref = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<VideoPlayer | null>(null)
  const prevStateRef = useRef<PetState>(PetState.Idle)
  const isSleepingRef = useRef(false)
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const isMouseDown = useRef(false)
  const hasDragged = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const mouseDownPos = useRef({ x: 0, y: 0 })

  // Init player + play begin → static
  useEffect(() => {
    if (!video0Ref.current || !video1Ref.current) return
    const player = new VideoPlayer(video0Ref.current, video1Ref.current)
    playerRef.current = player

    player.playSequence([
      { src: beginVideo, loop: false },
      { src: staticVideo, loop: true }
    ])

    // Start sleep timer
    sleepTimerRef.current = setTimeout(() => {
      if (playerRef.current && prevStateRef.current === PetState.Idle) {
        isSleepingRef.current = true
        playerRef.current.playSequence([
          { src: sleepStartVideo, loop: false },
          { src: sleepLoopVideo, loop: true }
        ])
      }
    }, SLEEP_DELAY)

    return () => {
      if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current)
    }
  }, [])

  // Reset sleep timer whenever state changes away from Idle
  const resetSleepTimer = useCallback(() => {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current)
    isSleepingRef.current = false
    sleepTimerRef.current = setTimeout(() => {
      if (playerRef.current && prevStateRef.current === PetState.Idle) {
        isSleepingRef.current = true
        playerRef.current.playSequence([
          { src: sleepStartVideo, loop: false },
          { src: sleepLoopVideo, loop: true }
        ])
      }
    }, SLEEP_DELAY)
  }, [])

  // State change handler
  useEffect(() => {
    const player = playerRef.current
    if (!player) return

    const prev = prevStateRef.current
    if (prev === state) return
    prevStateRef.current = state

    // Any activity resets sleep timer
    resetSleepTimer()

    if (state === PetState.Working) {
      player.playSequence([
        { src: taskStartVideo, loop: false },
        { src: taskLoopVideo, loop: true }
      ])
      return
    }

    if (state === PetState.Idle) {
      // Return to standing (not sleeping)
      if (isSleepingRef.current) {
        // Was sleeping → wake up
        isSleepingRef.current = false
        player.playSequence([
          { src: sleepLeaveVideo, loop: false },
          { src: staticVideo, loop: true }
        ])
      } else {
        player.playSequence([{ src: staticVideo, loop: true }])
      }
      return
    }

    if (state === PetState.Thinking) {
      if (isSleepingRef.current) {
        // Wake up first, then listen
        isSleepingRef.current = false
        player.playSequence([
          { src: sleepLeaveVideo, loop: false },
          { src: listeningVideo, loop: true }
        ])
      } else {
        player.playSequence([{ src: listeningVideo, loop: true }])
      }
      return
    }

    if (state === PetState.Happy) {
      player.playSequence([
        { src: taskLeaveVideo, loop: false },
        { src: staticVideo, loop: true }
      ])
      return
    }

    if (state === PetState.Dragging) {
      if (isSleepingRef.current) {
        isSleepingRef.current = false
        player.playSequence([
          { src: sleepLeaveVideo, loop: false },
          { src: staticVideo, loop: true }
        ])
      } else {
        player.playSequence([{ src: staticVideo, loop: true }])
      }
      return
    }
  }, [state, resetSleepTimer])

  // Speech bubble
  const [bubbleText, setBubbleText] = useState('')
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    let fullText = ''
    const unsub1 = window.api.onChatChunk((chunk) => {
      fullText += chunk
      const display = fullText.length > 30 ? fullText.slice(-30) + '...' : fullText
      setBubbleText(display)
      setBubbleVisible(true)
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
      bubbleTimerRef.current = setTimeout(() => setBubbleVisible(false), 3000)
    })
    const unsub2 = window.api.onChatDone(() => {
      fullText = ''
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
      bubbleTimerRef.current = setTimeout(() => setBubbleVisible(false), 3000)
    })
    const unsub3 = window.api.onChatError(() => {
      fullText = ''
      setBubbleVisible(false)
    })
    return () => {
      unsub1()
      unsub2()
      unsub3()
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isMouseDown.current = true
    hasDragged.current = false
    dragStart.current = { x: e.screenX, y: e.screenY }
    mouseDownPos.current = { x: e.screenX, y: e.screenY }
  }, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isMouseDown.current) return
      const dx = e.screenX - dragStart.current.x
      const dy = e.screenY - dragStart.current.y

      if (!hasDragged.current) {
        const totalDx = e.screenX - mouseDownPos.current.x
        const totalDy = e.screenY - mouseDownPos.current.y
        if (Math.abs(totalDx) < DRAG_THRESHOLD && Math.abs(totalDy) < DRAG_THRESHOLD) return
        hasDragged.current = true
      }

      dragStart.current = { x: e.screenX, y: e.screenY }
      onDragMove?.(dx, dy)
    },
    [onDragMove]
  )

  const handleMouseUp = useCallback(() => {
    if (isMouseDown.current && hasDragged.current) {
      onDragEnd?.()
    }
    isMouseDown.current = false
  }, [onDragEnd])

  const handleClick = useCallback(() => {
    if (!hasDragged.current) {
      onClick?.()
    }
  }, [onClick])

  return (
    <div
      className="w-full h-full relative cursor-grab active:cursor-grabbing select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu?.()
      }}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <video
        ref={video0Ref}
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        style={{ background: 'transparent' }}
      />
      <video
        ref={video1Ref}
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        style={{ background: 'transparent' }}
      />

      {bubbleVisible && bubbleText && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-1 z-10 max-w-50 px-3 py-1.5 rounded-xl bg-white/95 text-[11px] text-[#4A4A4A] shadow-md animate-bubble-in pointer-events-none"
          style={{ fontFamily: '-apple-system, PingFang SC, sans-serif' }}
        >
          {bubbleText}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-white/95 rotate-45" />
        </div>
      )}
    </div>
  )
}
