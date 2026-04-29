import { useEffect, useRef, useCallback } from 'react'
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
  paused?: boolean
  /** 气泡文本，非空时显示气泡，清空后隐藏 */
  bubbleText?: string
  onDragMove?: (dx: number, dy: number) => void
  onDragEnd?: () => void
  onClick?: () => void
  onContextMenu?: () => void
  onSleepTimeout?: () => void
}

const DRAG_THRESHOLD = 5
const SLEEP_DELAY = 120_000 // 2 minutes idle before sleeping

type VideoStep = { src: string; loop: boolean }

/**
 * Double-buffered video player to avoid flicker on source switch.
 * Two <video> elements swap: the back one loads while the front one keeps showing.
 * 每轮 playSequence 使用 AbortController 管理所有监听器生命周期，
 * abort 时自动清除 canplay/ended 监听器，避免快速切换时旧 handler 执行导致动画混乱。
 */
class VideoPlayer {
  private videos: [HTMLVideoElement, HTMLVideoElement]
  private activeIdx = 0
  private queue: VideoStep[] = []
  private abortController: AbortController | null = null

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
    // abort 上一轮所有监听器，确保 canplay/ended 不会在新序列中执行
    this.abortController?.abort()
    this.abortController = new AbortController()
    this.queue = []

    if (steps.length === 0) return
    const [first, ...rest] = steps
    this.queue = rest
    this.loadAndPlay(first)
  }

  private loadAndPlay(step: VideoStep): void {
    const signal = this.abortController!.signal
    const back = this.back

    back.loop = step.loop
    back.src = step.src
    back.load()

    back.addEventListener(
      'canplay',
      () => {
        this.activeIdx = 1 - this.activeIdx
        this.active.style.visibility = 'visible'
        this.back.style.visibility = 'hidden'
        this.back.pause()

        this.active.play().catch(() => {})

        if (!step.loop && this.queue.length > 0) {
          const next = this.queue.shift()!
          this.active.addEventListener(
            'ended',
            () => {
              this.loadAndPlay(next)
            },
            { once: true, signal }
          )
        }
      },
      { once: true, signal }
    )
  }

  pause(): void {
    this.active.pause()
  }

  resume(): void {
    this.active.play().catch(() => {})
  }
}

export function PetCanvas({
  state,
  paused,
  bubbleText: externalBubbleText,
  onDragMove,
  onDragEnd,
  onClick,
  onContextMenu,
  onSleepTimeout
}: PetCanvasProps) {
  const video0Ref = useRef<HTMLVideoElement>(null)
  const video1Ref = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<VideoPlayer | null>(null)
  const prevStateRef = useRef<PetState>(PetState.Idle)
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
  }, [])

  // 睡眠计时器：Idle 状态下 2 分钟无互动触发
  useEffect(() => {
    if (state !== PetState.Idle || paused) return
    const timer = setTimeout(() => onSleepTimeout?.(), SLEEP_DELAY)
    return () => clearTimeout(timer)
  }, [state, paused, onSleepTimeout])

  // Pause/resume video playback
  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    if (paused) {
      player.playSequence([{ src: staticVideo, loop: true }])
      // Wait for static to load, then pause on first frame
      const timer = setTimeout(() => player.pause(), 100)
      return () => clearTimeout(timer)
    } else {
      player.resume()
    }
  }, [paused])

  // State change handler
  useEffect(() => {
    const player = playerRef.current
    if (!player) return

    const prev = prevStateRef.current
    if (prev === state) return
    prevStateRef.current = state

    // 从 Sleep 唤醒时，先播 sleep-leave 过渡
    const wakePrefix: VideoStep[] =
      prev === PetState.Sleep ? [{ src: sleepLeaveVideo, loop: false }] : []

    if (state === PetState.Sleep) {
      player.playSequence([
        { src: sleepStartVideo, loop: false },
        { src: sleepLoopVideo, loop: true }
      ])
      return
    }

    if (state === PetState.Working) {
      player.playSequence([
        ...wakePrefix,
        { src: taskStartVideo, loop: false },
        { src: taskLoopVideo, loop: true }
      ])
      return
    }

    if (state === PetState.Thinking) {
      player.playSequence([...wakePrefix, { src: listeningVideo, loop: true }])
      return
    }

    if (state === PetState.Happy) {
      player.playSequence([
        { src: taskLeaveVideo, loop: false },
        { src: staticVideo, loop: true }
      ])
      return
    }

    if (state === PetState.Idle) {
      player.playSequence([...wakePrefix, { src: staticVideo, loop: true }])
      return
    }
  }, [state])

  // 气泡显示由 PetApp 管理，通过 bubbleText prop 传入

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

      {externalBubbleText && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-1 z-10 max-w-50 px-3 py-1.5 rounded-xl bg-white/95 text-[11px] text-[#4A4A4A] shadow-md animate-bubble-in pointer-events-none"
          style={{ fontFamily: '-apple-system, PingFang SC, sans-serif' }}
        >
          {externalBubbleText}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-white/95 rotate-45" />
        </div>
      )}
    </div>
  )
}
