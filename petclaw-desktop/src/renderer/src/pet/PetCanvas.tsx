import { useEffect, useRef } from 'react'
import { Application } from 'pixi.js'
import { CatSprite } from './CatSprite'
import { PetState } from './state-machine'

interface PetCanvasProps {
  state: PetState
  onDragMove?: (dx: number, dy: number) => void
  onDragEnd?: () => void
  onClick?: () => void
  onContextMenu?: () => void
}

export function PetCanvas({
  state,
  onDragMove,
  onDragEnd,
  onClick,
  onContextMenu
}: PetCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const catRef = useRef<CatSprite | null>(null)
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (!containerRef.current) return

    const app = new Application()
    let mounted = true

    app
      .init({
        backgroundAlpha: 0,
        resizeTo: containerRef.current,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true
      })
      .then(() => {
        if (!mounted || !containerRef.current) return

        containerRef.current.appendChild(app.canvas)

        const cat = new CatSprite()
        cat.container.x = app.screen.width / 2
        cat.container.y = app.screen.height / 2 + 30
        app.stage.addChild(cat.container)
        catRef.current = cat

        app.ticker.add((ticker) => {
          cat.update(ticker.deltaTime)
        })
      })

    return () => {
      mounted = false
      app.destroy(true)
      catRef.current = null
    }
  }, [])

  // Update cat state when prop changes
  useEffect(() => {
    catRef.current?.setState(state)
  }, [state])

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true
    dragStart.current = { x: e.screenX, y: e.screenY }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return
    const dx = e.screenX - dragStart.current.x
    const dy = e.screenY - dragStart.current.y
    dragStart.current = { x: e.screenX, y: e.screenY }
    onDragMove?.(dx, dy)
  }

  const handleMouseUp = () => {
    if (isDragging.current) {
      isDragging.current = false
      onDragEnd?.()
    }
  }

  const handleClick = () => {
    if (!isDragging.current) {
      onClick?.()
    }
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full cursor-grab active:cursor-grabbing"
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
    />
  )
}
