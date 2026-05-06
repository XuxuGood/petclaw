import { useCallback, useEffect, useRef } from 'react'
import { CAT_SPRITES, type CatSpriteDefinition } from './cat-sprite-manifest'
import { PetState } from './state-machine'

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

type CatSpriteName = keyof typeof CAT_SPRITES
type SpriteStep = { name: CatSpriteName; loop: boolean }

interface PlaybackState {
  steps: SpriteStep[]
  stepIndex: number
  frameIndex: number
  lastFrameTime: number
  paused: boolean
}

function createInitialPlayback(): PlaybackState {
  return {
    steps: [
      { name: 'begin', loop: false },
      { name: 'static', loop: true }
    ],
    stepIndex: 0,
    frameIndex: 0,
    lastFrameTime: 0,
    paused: false
  }
}

function getActiveStep(playback: PlaybackState): SpriteStep {
  return playback.steps[playback.stepIndex] ?? playback.steps[playback.steps.length - 1]
}

function loadSpriteImage(src: string) {
  const image = new Image()
  image.decoding = 'async'
  image.src = src
  return image
}

function advancePlayback(playback: PlaybackState, definition: CatSpriteDefinition, now: number) {
  if (playback.paused) return

  if (playback.lastFrameTime === 0) {
    playback.lastFrameTime = now
    return
  }

  const frameDuration = 1000 / definition.fps
  let elapsedFrames = Math.floor((now - playback.lastFrameTime) / frameDuration)
  if (elapsedFrames <= 0) return

  playback.lastFrameTime += elapsedFrames * frameDuration

  while (elapsedFrames > 0) {
    const activeStep = getActiveStep(playback)
    if (playback.frameIndex + 1 < definition.frameCount) {
      playback.frameIndex += 1
      elapsedFrames -= 1
      continue
    }

    if (activeStep.loop) {
      playback.frameIndex = 0
      elapsedFrames -= 1
      continue
    }

    if (playback.stepIndex + 1 < playback.steps.length) {
      playback.stepIndex += 1
      playback.frameIndex = 0
      playback.lastFrameTime = now
      return
    }

    playback.frameIndex = definition.frameCount - 1
    return
  }
}

function resolveSpriteFrameStyle(definition: CatSpriteDefinition, frameIndex: number) {
  const sourceX =
    definition.tileMargin +
    (frameIndex % definition.columns) * (definition.frameWidth + definition.tilePadding)
  const sourceY =
    definition.tileMargin +
    Math.floor(frameIndex / definition.columns) * (definition.frameHeight + definition.tilePadding)

  return {
    backgroundPosition: `-${sourceX}px -${sourceY}px`,
    backgroundSize: `${definition.columns * (definition.frameWidth + definition.tilePadding)}px ${
      definition.rows * (definition.frameHeight + definition.tilePadding)
    }px`
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
  const spriteLayerRef = useRef<HTMLDivElement>(null)
  const spriteImagesRef = useRef(new Map<CatSpriteName, HTMLImageElement>())
  const playbackRef = useRef<PlaybackState>(createInitialPlayback())
  const prevStateRef = useRef<PetState>(PetState.Idle)
  const isMouseDown = useRef(false)
  const hasDragged = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const mouseDownPos = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const entries = Object.entries(CAT_SPRITES) as Array<[CatSpriteName, CatSpriteDefinition]>
    entries.forEach(([name, definition]) => {
      if (spriteImagesRef.current.has(name)) return
      spriteImagesRef.current.set(name, loadSpriteImage(definition.src))
    })
  }, [])

  useEffect(() => {
    const spriteLayer = spriteLayerRef.current
    if (!spriteLayer) return

    let rafId = 0

    const renderFrame = (now: number) => {
      const playback = playbackRef.current
      const activeStep = getActiveStep(playback)
      const definition = CAT_SPRITES[activeStep.name]
      const image = spriteImagesRef.current.get(activeStep.name)

      if (image?.complete && image.naturalWidth > 0) {
        advancePlayback(playback, definition, now)
        const nextStep = getActiveStep(playback)
        const nextDefinition = CAT_SPRITES[nextStep.name]
        const nextImage = spriteImagesRef.current.get(nextStep.name)
        if (nextImage?.complete && nextImage.naturalWidth > 0) {
          const style = resolveSpriteFrameStyle(nextDefinition, playback.frameIndex)
          if (spriteLayer.style.backgroundImage !== `url("${nextDefinition.src}")`) {
            spriteLayer.style.backgroundImage = `url("${nextDefinition.src}")`
          }
          spriteLayer.style.backgroundPosition = style.backgroundPosition
          spriteLayer.style.backgroundSize = style.backgroundSize
        }
      } else {
        spriteLayer.style.backgroundImage = ''
      }

      rafId = requestAnimationFrame(renderFrame)
    }

    rafId = requestAnimationFrame(renderFrame)
    return () => cancelAnimationFrame(rafId)
  }, [])

  useEffect(() => {
    playbackRef.current.paused = Boolean(paused)
  }, [paused])

  useEffect(() => {
    if (state !== PetState.Idle || paused) return
    const timer = setTimeout(() => onSleepTimeout?.(), SLEEP_DELAY)
    return () => clearTimeout(timer)
  }, [state, paused, onSleepTimeout])

  useEffect(() => {
    const prev = prevStateRef.current
    if (prev === state) return
    prevStateRef.current = state

    const wakePrefix: SpriteStep[] =
      prev === PetState.Sleep ? [{ name: 'sleep-leave', loop: false }] : []

    const playSequence = (steps: SpriteStep[]) => {
      playbackRef.current = {
        steps,
        stepIndex: 0,
        frameIndex: 0,
        lastFrameTime: 0,
        paused: Boolean(paused)
      }
    }

    if (state === PetState.Sleep) {
      playSequence([
        { name: 'sleep-start', loop: false },
        { name: 'sleep-loop', loop: true }
      ])
      return
    }

    if (state === PetState.Working) {
      playSequence([
        ...wakePrefix,
        { name: 'task-start', loop: false },
        { name: 'task-loop', loop: true }
      ])
      return
    }

    if (state === PetState.Thinking) {
      playSequence([...wakePrefix, { name: 'listening', loop: true }])
      return
    }

    if (state === PetState.Happy) {
      playSequence([
        { name: 'task-leave', loop: false },
        { name: 'static', loop: true }
      ])
      return
    }

    if (state === PetState.Idle) {
      playSequence([...wakePrefix, { name: 'static', loop: true }])
      return
    }
  }, [state, paused])

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
      className="w-full h-full relative cursor-pointer active:cursor-grabbing select-none"
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
      <div
        ref={spriteLayerRef}
        className="absolute inset-0 h-full w-full pointer-events-none bg-no-repeat"
        style={{
          width: '180px',
          height: '145px',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          contain: 'strict'
        }}
      />

      {externalBubbleText && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-1 z-10 max-w-50 px-3 py-1.5 rounded-xl bg-white/95 text-[11px] text-text-secondary shadow-md animate-bubble-in pointer-events-none"
          style={{ fontFamily: '-apple-system, PingFang SC, sans-serif' }}
        >
          {externalBubbleText}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-white/95 rotate-45" />
        </div>
      )}
    </div>
  )
}
