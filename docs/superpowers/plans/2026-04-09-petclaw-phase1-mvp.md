# PetClaw Phase 1 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a functional Electron desktop pet application with transparent window, animated cat character, text chat via Openclaw Gateway, system tray, global shortcuts, and Claude Code hook monitoring.

**Architecture:** Electron main process handles AI communication (Openclaw WebSocket), Hook server (Unix Socket), system tray, and SQLite storage. React renderer process renders the cat animation (PixiJS) and interaction panels (chat, settings, monitor). Communication via typed IPC with contextBridge.

**Tech Stack:** Electron 33+, React 19, TypeScript, electron-vite, PixiJS 8, Tailwind CSS v4, Zustand 5, better-sqlite3, Node.js net (Unix Socket)

**Spec Reference:** `docs/superpowers/specs/2026-04-09-petclaw-design.md`

---

## File Structure

```
petclaw-desktop/
├── electron.vite.config.ts          # electron-vite config (main/preload/renderer)
├── package.json
├── tsconfig.json                    # root tsconfig (references)
├── tsconfig.node.json               # main + preload tsconfig
├── tsconfig.web.json                # renderer tsconfig
├── resources/
│   └── icon.png                     # app icon
├── src/
│   ├── main/
│   │   ├── index.ts                 # app entry, window creation
│   │   ├── ipc.ts                   # IPC handler registration
│   │   ├── ai/
│   │   │   ├── provider.ts          # AIProvider interface
│   │   │   └── openclaw.ts          # OpencLawProvider (WebSocket)
│   │   ├── hooks/
│   │   │   ├── server.ts            # HookServer (Unix Socket listener)
│   │   │   ├── installer.ts         # ConfigInstaller (inject hooks into AI tools)
│   │   │   └── types.ts             # HookEvent types
│   │   ├── system/
│   │   │   ├── tray.ts              # system tray setup
│   │   │   └── shortcuts.ts         # global shortcuts
│   │   └── data/
│   │       └── db.ts                # SQLite init + queries
│   ├── preload/
│   │   ├── index.ts                 # contextBridge expose
│   │   └── index.d.ts              # global Window type declarations
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx             # React entry
│           ├── App.tsx              # root component with panel routing
│           ├── assets/
│           │   └── main.css         # Tailwind entry
│           ├── pet/
│           │   ├── PetCanvas.tsx     # PixiJS canvas component
│           │   ├── CatSprite.ts     # cat sprite sheet loader + renderer
│           │   └── state-machine.ts # pet state machine (idle/thinking/working/happy)
│           ├── panels/
│           │   ├── ChatPanel.tsx     # text chat interface
│           │   ├── MonitorPanel.tsx  # AI tool status monitor
│           │   └── SettingsPanel.tsx # basic settings
│           └── stores/
│               ├── chat-store.ts    # chat messages state
│               ├── pet-store.ts     # pet animation state
│               └── hook-store.ts    # AI tool hook events state
└── tests/
    ├── main/
    │   ├── ai/
    │   │   └── openclaw.test.ts
    │   ├── hooks/
    │   │   ├── server.test.ts
    │   │   └── installer.test.ts
    │   └── data/
    │       └── db.test.ts
    └── renderer/
        ├── pet/
        │   └── state-machine.test.ts
        └── stores/
            └── chat-store.test.ts
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `petclaw-desktop/package.json`
- Create: `petclaw-desktop/electron.vite.config.ts`
- Create: `petclaw-desktop/tsconfig.json`
- Create: `petclaw-desktop/tsconfig.node.json`
- Create: `petclaw-desktop/tsconfig.web.json`
- Create: `petclaw-desktop/src/main/index.ts`
- Create: `petclaw-desktop/src/preload/index.ts`
- Create: `petclaw-desktop/src/preload/index.d.ts`
- Create: `petclaw-desktop/src/renderer/index.html`
- Create: `petclaw-desktop/src/renderer/src/main.tsx`
- Create: `petclaw-desktop/src/renderer/src/App.tsx`
- Create: `petclaw-desktop/src/renderer/src/assets/main.css`

- [ ] **Step 1: Create project directory and package.json**

```bash
mkdir -p petclaw-desktop
cd petclaw-desktop
```

```json
// petclaw-desktop/package.json
{
  "name": "petclaw-desktop",
  "version": "0.1.0",
  "description": "AI Desktop Pet Assistant",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "package": "electron-vite build && electron-builder",
    "postinstall": "electron-rebuild -f -w better-sqlite3",
    "typecheck": "npm run typecheck:node && npm run typecheck:web",
    "typecheck:node": "tsc --noEmit -p tsconfig.node.json",
    "typecheck:web": "tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@electron-toolkit/utils": "^3.0.0",
    "better-sqlite3": "^11.0.0",
    "pixi.js": "^8.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "@types/better-sqlite3": "^7.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^3.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create electron-vite config**

```typescript
// petclaw-desktop/electron.vite.config.ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['better-sqlite3']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      include: ['pixi.js']
    }
  }
})
```

- [ ] **Step 3: Create TypeScript configs**

```json
// petclaw-desktop/tsconfig.json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

```json
// petclaw-desktop/tsconfig.node.json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "lib": ["ESNext"],
    "outDir": "./out",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/main/**/*", "src/preload/**/*", "electron.vite.config.ts"]
}
```

```json
// petclaw-desktop/tsconfig.web.json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "outDir": "./out",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "paths": {
      "@renderer/*": ["./src/renderer/src/*"]
    }
  },
  "include": ["src/renderer/src/**/*", "src/preload/index.d.ts"]
}
```

- [ ] **Step 4: Create main process entry with transparent window**

```typescript
// petclaw-desktop/src/main/index.ts
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 300,
    height: 350,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

export { mainWindow }
```

- [ ] **Step 5: Create preload script and type declarations**

```typescript
// petclaw-desktop/src/preload/index.ts
import { contextBridge } from 'electron'

const api = {}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
}
```

```typescript
// petclaw-desktop/src/preload/index.d.ts
interface ElectronAPI {}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
```

- [ ] **Step 6: Create renderer entry files**

```html
<!-- petclaw-desktop/src/renderer/index.html -->
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PetClaw</title>
  </head>
  <body style="background: transparent; margin: 0; overflow: hidden;">
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

```tsx
// petclaw-desktop/src/renderer/src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './assets/main.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

```tsx
// petclaw-desktop/src/renderer/src/App.tsx
export function App(): JSX.Element {
  return (
    <div className="w-full h-full bg-transparent">
      <p className="text-white text-center pt-4">PetClaw</p>
    </div>
  )
}
```

```css
/* petclaw-desktop/src/renderer/src/assets/main.css */
@import "tailwindcss";

@theme {
  --color-primary: #d97757;
  --color-primary-hover: #e49b7b;
}

html, body, #root {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  background: transparent;
  overflow: hidden;
}
```

- [ ] **Step 7: Install dependencies and verify app launches**

```bash
cd petclaw-desktop
pnpm install
pnpm dev
```

Expected: transparent Electron window appears showing "PetClaw" text, desktop visible through window.

- [ ] **Step 8: Commit**

```bash
git add petclaw-desktop/
git commit -m "feat: scaffold petclaw-desktop with electron-vite, transparent window"
```

---

## Task 2: Pet State Machine

**Files:**
- Create: `petclaw-desktop/src/renderer/src/pet/state-machine.ts`
- Create: `petclaw-desktop/tests/renderer/pet/state-machine.test.ts`

- [ ] **Step 1: Write failing tests for pet state machine**

```typescript
// petclaw-desktop/tests/renderer/pet/state-machine.test.ts
import { describe, it, expect } from 'vitest'
import { PetStateMachine, PetState, PetEvent } from '../../../src/renderer/src/pet/state-machine'

describe('PetStateMachine', () => {
  it('starts in idle state', () => {
    const sm = new PetStateMachine()
    expect(sm.current).toBe(PetState.Idle)
  })

  it('transitions to thinking on CHAT_SENT', () => {
    const sm = new PetStateMachine()
    sm.send(PetEvent.ChatSent)
    expect(sm.current).toBe(PetState.Thinking)
  })

  it('transitions to working on AI_RESPONDING', () => {
    const sm = new PetStateMachine()
    sm.send(PetEvent.ChatSent)
    sm.send(PetEvent.AIResponding)
    expect(sm.current).toBe(PetState.Working)
  })

  it('transitions to happy on AI_DONE', () => {
    const sm = new PetStateMachine()
    sm.send(PetEvent.ChatSent)
    sm.send(PetEvent.AIResponding)
    sm.send(PetEvent.AIDone)
    expect(sm.current).toBe(PetState.Happy)
  })

  it('transitions back to idle on TIMEOUT from happy', () => {
    const sm = new PetStateMachine()
    sm.send(PetEvent.ChatSent)
    sm.send(PetEvent.AIResponding)
    sm.send(PetEvent.AIDone)
    sm.send(PetEvent.Timeout)
    expect(sm.current).toBe(PetState.Idle)
  })

  it('transitions to dragging on DRAG_START', () => {
    const sm = new PetStateMachine()
    sm.send(PetEvent.DragStart)
    expect(sm.current).toBe(PetState.Dragging)
  })

  it('transitions back to idle on DRAG_END', () => {
    const sm = new PetStateMachine()
    sm.send(PetEvent.DragStart)
    sm.send(PetEvent.DragEnd)
    expect(sm.current).toBe(PetState.Idle)
  })

  it('transitions to working on HOOK_ACTIVE', () => {
    const sm = new PetStateMachine()
    sm.send(PetEvent.HookActive)
    expect(sm.current).toBe(PetState.Working)
  })

  it('transitions to idle on HOOK_IDLE', () => {
    const sm = new PetStateMachine()
    sm.send(PetEvent.HookActive)
    sm.send(PetEvent.HookIdle)
    expect(sm.current).toBe(PetState.Idle)
  })

  it('ignores invalid transitions', () => {
    const sm = new PetStateMachine()
    sm.send(PetEvent.AIDone) // invalid from Idle
    expect(sm.current).toBe(PetState.Idle)
  })

  it('calls onTransition callback', () => {
    const transitions: Array<{ from: PetState; to: PetState }> = []
    const sm = new PetStateMachine((from, to) => transitions.push({ from, to }))
    sm.send(PetEvent.ChatSent)
    expect(transitions).toEqual([{ from: PetState.Idle, to: PetState.Thinking }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd petclaw-desktop
pnpm vitest run tests/renderer/pet/state-machine.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement pet state machine**

```typescript
// petclaw-desktop/src/renderer/src/pet/state-machine.ts
export enum PetState {
  Idle = 'idle',
  Thinking = 'thinking',
  Working = 'working',
  Happy = 'happy',
  Dragging = 'dragging'
}

export enum PetEvent {
  ChatSent = 'CHAT_SENT',
  AIResponding = 'AI_RESPONDING',
  AIDone = 'AI_DONE',
  Timeout = 'TIMEOUT',
  DragStart = 'DRAG_START',
  DragEnd = 'DRAG_END',
  HookActive = 'HOOK_ACTIVE',
  HookIdle = 'HOOK_IDLE'
}

type TransitionCallback = (from: PetState, to: PetState) => void

const transitions: Record<PetState, Partial<Record<PetEvent, PetState>>> = {
  [PetState.Idle]: {
    [PetEvent.ChatSent]: PetState.Thinking,
    [PetEvent.DragStart]: PetState.Dragging,
    [PetEvent.HookActive]: PetState.Working
  },
  [PetState.Thinking]: {
    [PetEvent.AIResponding]: PetState.Working,
    [PetEvent.DragStart]: PetState.Dragging,
    [PetEvent.Timeout]: PetState.Idle
  },
  [PetState.Working]: {
    [PetEvent.AIDone]: PetState.Happy,
    [PetEvent.HookIdle]: PetState.Idle,
    [PetEvent.DragStart]: PetState.Dragging,
    [PetEvent.Timeout]: PetState.Idle
  },
  [PetState.Happy]: {
    [PetEvent.Timeout]: PetState.Idle,
    [PetEvent.ChatSent]: PetState.Thinking,
    [PetEvent.DragStart]: PetState.Dragging
  },
  [PetState.Dragging]: {
    [PetEvent.DragEnd]: PetState.Idle
  }
}

export class PetStateMachine {
  private _current: PetState = PetState.Idle
  private _onTransition: TransitionCallback | null

  constructor(onTransition?: TransitionCallback) {
    this._onTransition = onTransition ?? null
  }

  get current(): PetState {
    return this._current
  }

  send(event: PetEvent): void {
    const nextState = transitions[this._current]?.[event]
    if (nextState && nextState !== this._current) {
      const prev = this._current
      this._current = nextState
      this._onTransition?.(prev, nextState)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd petclaw-desktop
pnpm vitest run tests/renderer/pet/state-machine.test.ts
```

Expected: all 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/renderer/src/pet/state-machine.ts petclaw-desktop/tests/renderer/pet/state-machine.test.ts
git commit -m "feat: add pet state machine with idle/thinking/working/happy/dragging states"
```

---

## Task 3: PixiJS Cat Sprite Renderer

**Files:**
- Create: `petclaw-desktop/src/renderer/src/pet/CatSprite.ts`
- Create: `petclaw-desktop/src/renderer/src/pet/PetCanvas.tsx`

- [ ] **Step 1: Create CatSprite class**

This uses placeholder colored shapes initially. Real sprite sheets will be added later.

```typescript
// petclaw-desktop/src/renderer/src/pet/CatSprite.ts
import { Container, Graphics, Text } from 'pixi.js'
import { PetState } from './state-machine'

const STATE_COLORS: Record<PetState, number> = {
  [PetState.Idle]: 0x8b7355,
  [PetState.Thinking]: 0xffa500,
  [PetState.Working]: 0x4a90d9,
  [PetState.Happy]: 0x50c878,
  [PetState.Dragging]: 0xd97757
}

const STATE_LABELS: Record<PetState, string> = {
  [PetState.Idle]: '😺',
  [PetState.Thinking]: '🤔',
  [PetState.Working]: '💻',
  [PetState.Happy]: '😸',
  [PetState.Dragging]: '😼'
}

export class CatSprite {
  readonly container: Container
  private body: Graphics
  private ears: Graphics
  private label: Text
  private _state: PetState = PetState.Idle
  private bouncePhase: number = 0

  constructor() {
    this.container = new Container()

    // Cat body (oval)
    this.body = new Graphics()
    this.container.addChild(this.body)

    // Cat ears (triangles)
    this.ears = new Graphics()
    this.container.addChild(this.ears)

    // State emoji label
    this.label = new Text({ text: '😺', style: { fontSize: 40 } })
    this.label.anchor.set(0.5)
    this.label.x = 0
    this.label.y = -60
    this.container.addChild(this.label)

    this.draw()
  }

  get state(): PetState {
    return this._state
  }

  setState(state: PetState): void {
    if (this._state === state) return
    this._state = state
    this.draw()
  }

  update(deltaTime: number): void {
    // Idle bounce animation
    if (this._state === PetState.Idle) {
      this.bouncePhase += deltaTime * 0.03
      this.container.y = Math.sin(this.bouncePhase) * 3
    }
    // Thinking wobble
    else if (this._state === PetState.Thinking) {
      this.bouncePhase += deltaTime * 0.05
      this.container.rotation = Math.sin(this.bouncePhase) * 0.1
    }
    // Working vibrate
    else if (this._state === PetState.Working) {
      this.bouncePhase += deltaTime * 0.1
      this.container.x = Math.sin(this.bouncePhase * 3) * 1
    }
    // Happy jump
    else if (this._state === PetState.Happy) {
      this.bouncePhase += deltaTime * 0.06
      this.container.y = -Math.abs(Math.sin(this.bouncePhase)) * 15
    }
  }

  private draw(): void {
    const color = STATE_COLORS[this._state]

    // Body
    this.body.clear()
    this.body.ellipse(0, 0, 45, 55)
    this.body.fill({ color, alpha: 0.9 })

    // Ears
    this.ears.clear()
    // Left ear
    this.ears.moveTo(-35, -40)
    this.ears.lineTo(-20, -70)
    this.ears.lineTo(-5, -40)
    this.ears.fill({ color, alpha: 0.9 })
    // Right ear
    this.ears.moveTo(5, -40)
    this.ears.lineTo(20, -70)
    this.ears.lineTo(35, -40)
    this.ears.fill({ color, alpha: 0.9 })

    // Label
    this.label.text = STATE_LABELS[this._state]
  }
}
```

- [ ] **Step 2: Create PetCanvas React component**

```tsx
// petclaw-desktop/src/renderer/src/pet/PetCanvas.tsx
import { useEffect, useRef } from 'react'
import { Application } from 'pixi.js'
import { CatSprite } from './CatSprite'
import { PetState, PetEvent, PetStateMachine } from './state-machine'

interface PetCanvasProps {
  state: PetState
  onDragMove?: (dx: number, dy: number) => void
  onDragEnd?: () => void
  onClick?: () => void
}

export function PetCanvas({ state, onDragMove, onDragEnd, onClick }: PetCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const catRef = useRef<CatSprite | null>(null)
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (!containerRef.current) return

    const app = new Application()
    let mounted = true

    app.init({
      backgroundAlpha: 0,
      resizeTo: containerRef.current,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    }).then(() => {
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
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    />
  )
}
```

- [ ] **Step 3: Update App.tsx to render PetCanvas**

```tsx
// petclaw-desktop/src/renderer/src/App.tsx
import { useState, useCallback } from 'react'
import { PetCanvas } from './pet/PetCanvas'
import { PetState } from './pet/state-machine'

export function App(): JSX.Element {
  const [petState, setPetState] = useState<PetState>(PetState.Idle)
  const [panelOpen, setPanelOpen] = useState(false)

  const handleDragMove = useCallback((dx: number, dy: number) => {
    // Move the Electron window
    window.api?.moveWindow?.(dx, dy)
    setPetState(PetState.Dragging)
  }, [])

  const handleDragEnd = useCallback(() => {
    setPetState(PetState.Idle)
  }, [])

  const handleClick = useCallback(() => {
    setPanelOpen((prev) => !prev)
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
```

- [ ] **Step 4: Add moveWindow IPC to preload**

```typescript
// petclaw-desktop/src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  moveWindow: (dx: number, dy: number) => ipcRenderer.send('window:move', dx, dy)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
}
```

```typescript
// petclaw-desktop/src/preload/index.d.ts
interface ElectronAPI {
  moveWindow: (dx: number, dy: number) => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
```

- [ ] **Step 5: Handle moveWindow IPC in main process**

Add to `src/main/index.ts` after window creation:

```typescript
// Add this import at the top of src/main/index.ts
import { app, BrowserWindow, shell, ipcMain } from 'electron'

// Add after createWindow() in app.whenReady():
app.whenReady().then(() => {
  createWindow()

  ipcMain.on('window:move', (_event, dx: number, dy: number) => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    mainWindow.setPosition(x + dx, y + dy)
  })
})
```

- [ ] **Step 6: Run the app to verify cat renders and drag works**

```bash
cd petclaw-desktop
pnpm dev
```

Expected: transparent window with colored cat shape. Cat shows idle bounce animation. Dragging the cat moves the window. Different emoji shows per state.

- [ ] **Step 7: Commit**

```bash
git add petclaw-desktop/src/renderer/src/pet/ petclaw-desktop/src/preload/ petclaw-desktop/src/main/index.ts petclaw-desktop/src/renderer/src/App.tsx
git commit -m "feat: add PixiJS cat sprite with state-based animations and window drag"
```

---

## Task 4: SQLite Database Layer

**Files:**
- Create: `petclaw-desktop/src/main/data/db.ts`
- Create: `petclaw-desktop/tests/main/data/db.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// petclaw-desktop/tests/main/data/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase, saveMessage, getMessages, saveSetting, getSetting } from '../../../src/main/data/db'

describe('Database', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('messages', () => {
    it('saves and retrieves a message', () => {
      saveMessage(db, { role: 'user', content: 'hello' })
      const messages = getMessages(db, 10)
      expect(messages).toHaveLength(1)
      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('hello')
    })

    it('returns messages in chronological order', () => {
      saveMessage(db, { role: 'user', content: 'first' })
      saveMessage(db, { role: 'assistant', content: 'second' })
      const messages = getMessages(db, 10)
      expect(messages[0].content).toBe('first')
      expect(messages[1].content).toBe('second')
    })

    it('respects limit parameter', () => {
      saveMessage(db, { role: 'user', content: 'a' })
      saveMessage(db, { role: 'user', content: 'b' })
      saveMessage(db, { role: 'user', content: 'c' })
      const messages = getMessages(db, 2)
      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe('b')
      expect(messages[1].content).toBe('c')
    })
  })

  describe('settings', () => {
    it('saves and retrieves a setting', () => {
      saveSetting(db, 'theme', 'dark')
      expect(getSetting(db, 'theme')).toBe('dark')
    })

    it('returns null for missing setting', () => {
      expect(getSetting(db, 'nonexistent')).toBeNull()
    })

    it('upserts existing setting', () => {
      saveSetting(db, 'theme', 'dark')
      saveSetting(db, 'theme', 'light')
      expect(getSetting(db, 'theme')).toBe('light')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd petclaw-desktop
pnpm vitest run tests/main/data/db.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement database module**

```typescript
// petclaw-desktop/src/main/data/db.ts
import Database from 'better-sqlite3'

export interface ChatMessage {
  id?: number
  role: 'user' | 'assistant'
  content: string
  createdAt?: string
}

export function initDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

export function saveMessage(db: Database.Database, msg: { role: string; content: string }): void {
  db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)').run(msg.role, msg.content)
}

export function getMessages(db: Database.Database, limit: number): ChatMessage[] {
  return db
    .prepare(
      `SELECT id, role, content, created_at as createdAt
       FROM messages ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as ChatMessage[]
    .reverse()
}

export function saveSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd petclaw-desktop
pnpm vitest run tests/main/data/db.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/main/data/db.ts petclaw-desktop/tests/main/data/db.test.ts
git commit -m "feat: add SQLite database layer for messages and settings"
```

---

## Task 5: AI Provider Interface + Openclaw Provider

**Files:**
- Create: `petclaw-desktop/src/main/ai/provider.ts`
- Create: `petclaw-desktop/src/main/ai/openclaw.ts`
- Create: `petclaw-desktop/tests/main/ai/openclaw.test.ts`

- [ ] **Step 1: Write failing tests for OpencLawProvider**

```typescript
// petclaw-desktop/tests/main/ai/openclaw.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { OpencLawProvider } from '../../../src/main/ai/openclaw'

describe('OpencLawProvider', () => {
  let wss: WebSocketServer
  let port: number

  beforeEach(async () => {
    // Start a mock WebSocket server
    wss = new WebSocketServer({ port: 0 })
    port = (wss.address() as { port: number }).port
  })

  afterEach(async () => {
    wss.close()
  })

  it('connects to gateway', async () => {
    const provider = new OpencLawProvider(`ws://127.0.0.1:${port}`)
    const connected = new Promise<void>((resolve) => {
      wss.on('connection', () => resolve())
    })
    await provider.connect()
    await connected
    provider.disconnect()
  })

  it('sends chat message and receives streaming response', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'chat') {
          ws.send(JSON.stringify({ type: 'chunk', text: 'Hello' }))
          ws.send(JSON.stringify({ type: 'chunk', text: ' world' }))
          ws.send(JSON.stringify({ type: 'done' }))
        }
      })
    })

    const provider = new OpencLawProvider(`ws://127.0.0.1:${port}`)
    await provider.connect()

    const chunks: string[] = []
    for await (const chunk of provider.chat('Hi')) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(['Hello', ' world'])
    provider.disconnect()
  })

  it('handles connection error gracefully', async () => {
    const provider = new OpencLawProvider('ws://127.0.0.1:1') // invalid port
    await expect(provider.connect()).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd petclaw-desktop
pnpm add -D ws @types/ws
pnpm vitest run tests/main/ai/openclaw.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create AIProvider interface**

```typescript
// petclaw-desktop/src/main/ai/provider.ts
export interface AIProvider {
  connect(): Promise<void>
  chat(message: string): AsyncGenerator<string, void, unknown>
  disconnect(): void
  isConnected(): boolean
}
```

- [ ] **Step 4: Implement OpencLawProvider**

```typescript
// petclaw-desktop/src/main/ai/openclaw.ts
import WebSocket from 'ws'
import { AIProvider } from './provider'

export class OpencLawProvider implements AIProvider {
  private ws: WebSocket | null = null
  private gatewayUrl: string

  constructor(gatewayUrl: string = 'ws://127.0.0.1:18789') {
    this.gatewayUrl = gatewayUrl
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.gatewayUrl)

      this.ws.on('open', () => resolve())
      this.ws.on('error', (err) => reject(err))
    })
  }

  async *chat(message: string): AsyncGenerator<string, void, unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to Openclaw Gateway')
    }

    this.ws.send(JSON.stringify({ type: 'chat', text: message }))

    const chunks: string[] = []
    let done = false
    let resolveChunk: (() => void) | null = null

    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'chunk') {
        chunks.push(msg.text)
        resolveChunk?.()
      } else if (msg.type === 'done') {
        done = true
        resolveChunk?.()
      }
    }

    this.ws.on('message', handler)

    try {
      while (!done) {
        if (chunks.length > 0) {
          yield chunks.shift()!
        } else {
          await new Promise<void>((r) => {
            resolveChunk = r
          })
        }
      }
      // Yield remaining chunks
      while (chunks.length > 0) {
        yield chunks.shift()!
      }
    } finally {
      this.ws?.removeListener('message', handler)
    }
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd petclaw-desktop
pnpm vitest run tests/main/ai/openclaw.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add petclaw-desktop/src/main/ai/ petclaw-desktop/tests/main/ai/
git commit -m "feat: add AIProvider interface and OpencLawProvider with WebSocket chat"
```

---

## Task 6: Chat IPC Bridge + Zustand Store

**Files:**
- Create: `petclaw-desktop/src/renderer/src/stores/chat-store.ts`
- Create: `petclaw-desktop/src/main/ipc.ts`
- Modify: `petclaw-desktop/src/preload/index.ts`
- Modify: `petclaw-desktop/src/preload/index.d.ts`
- Modify: `petclaw-desktop/src/main/index.ts`
- Create: `petclaw-desktop/tests/renderer/stores/chat-store.test.ts`

- [ ] **Step 1: Write failing tests for chat store**

```typescript
// petclaw-desktop/tests/renderer/stores/chat-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, ChatMessage } from '../../../src/renderer/src/stores/chat-store'

describe('ChatStore', () => {
  beforeEach(() => {
    useChatStore.setState({ messages: [], isLoading: false })
  })

  it('starts with empty messages', () => {
    const state = useChatStore.getState()
    expect(state.messages).toEqual([])
    expect(state.isLoading).toBe(false)
  })

  it('adds a user message', () => {
    useChatStore.getState().addMessage({ role: 'user', content: 'hello' })
    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0].role).toBe('user')
  })

  it('appends to the last assistant message during streaming', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: '' })
    useChatStore.getState().appendToLastMessage('Hello')
    useChatStore.getState().appendToLastMessage(' world')
    expect(useChatStore.getState().messages[0].content).toBe('Hello world')
  })

  it('sets loading state', () => {
    useChatStore.getState().setLoading(true)
    expect(useChatStore.getState().isLoading).toBe(true)
  })

  it('loads history messages', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' }
    ]
    useChatStore.getState().loadHistory(history)
    expect(useChatStore.getState().messages).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd petclaw-desktop
pnpm vitest run tests/renderer/stores/chat-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement chat store**

```typescript
// petclaw-desktop/src/renderer/src/stores/chat-store.ts
import { create } from 'zustand'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatState {
  messages: ChatMessage[]
  isLoading: boolean
  addMessage: (msg: ChatMessage) => void
  appendToLastMessage: (text: string) => void
  setLoading: (loading: boolean) => void
  loadHistory: (messages: ChatMessage[]) => void
}

export const useChatStore = create<ChatState>()((set) => ({
  messages: [],
  isLoading: false,

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  appendToLastMessage: (text) =>
    set((state) => {
      const messages = [...state.messages]
      const last = messages[messages.length - 1]
      if (last && last.role === 'assistant') {
        messages[messages.length - 1] = { ...last, content: last.content + text }
      }
      return { messages }
    }),

  setLoading: (isLoading) => set({ isLoading }),

  loadHistory: (messages) => set({ messages })
}))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd petclaw-desktop
pnpm vitest run tests/renderer/stores/chat-store.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Create IPC handlers for chat**

```typescript
// petclaw-desktop/src/main/ipc.ts
import { ipcMain, BrowserWindow } from 'electron'
import { OpencLawProvider } from './ai/openclaw'
import Database from 'better-sqlite3'
import { saveMessage, getMessages } from './data/db'

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  aiProvider: OpencLawProvider,
  db: Database.Database
): void {
  // Window move
  ipcMain.on('window:move', (_event, dx: number, dy: number) => {
    const [x, y] = mainWindow.getPosition()
    mainWindow.setPosition(x + dx, y + dy)
  })

  // Chat: send message and stream response
  ipcMain.handle('chat:send', async (_event, message: string) => {
    saveMessage(db, { role: 'user', content: message })

    // Notify renderer that AI is responding
    mainWindow.webContents.send('chat:ai-responding')

    let fullResponse = ''
    try {
      for await (const chunk of aiProvider.chat(message)) {
        fullResponse += chunk
        mainWindow.webContents.send('chat:chunk', chunk)
      }
      saveMessage(db, { role: 'assistant', content: fullResponse })
      mainWindow.webContents.send('chat:done')
    } catch (err) {
      mainWindow.webContents.send('chat:error', (err as Error).message)
    }
  })

  // Chat: load history
  ipcMain.handle('chat:history', async (_event, limit: number) => {
    return getMessages(db, limit)
  })
}
```

- [ ] **Step 6: Update preload with chat IPC**

```typescript
// petclaw-desktop/src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Window
  moveWindow: (dx: number, dy: number) => ipcRenderer.send('window:move', dx, dy),

  // Chat
  sendChat: (message: string): Promise<void> => ipcRenderer.invoke('chat:send', message),
  loadHistory: (limit: number): Promise<Array<{ role: string; content: string }>> =>
    ipcRenderer.invoke('chat:history', limit),
  onChatChunk: (callback: (chunk: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, chunk: string) => callback(chunk)
    ipcRenderer.on('chat:chunk', handler)
    return () => ipcRenderer.removeListener('chat:chunk', handler)
  },
  onChatDone: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('chat:done', handler)
    return () => ipcRenderer.removeListener('chat:done', handler)
  },
  onChatError: (callback: (error: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, error: string) => callback(error)
    ipcRenderer.on('chat:error', handler)
    return () => ipcRenderer.removeListener('chat:error', handler)
  },
  onAIResponding: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('chat:ai-responding', handler)
    return () => ipcRenderer.removeListener('chat:ai-responding', handler)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
}
```

```typescript
// petclaw-desktop/src/preload/index.d.ts
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ElectronAPI {
  moveWindow: (dx: number, dy: number) => void
  sendChat: (message: string) => Promise<void>
  loadHistory: (limit: number) => Promise<ChatMessage[]>
  onChatChunk: (callback: (chunk: string) => void) => () => void
  onChatDone: (callback: () => void) => () => void
  onChatError: (callback: (error: string) => void) => () => void
  onAIResponding: (callback: () => void) => () => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
```

- [ ] **Step 7: Update main/index.ts to wire up IPC, DB, and AI**

```typescript
// petclaw-desktop/src/main/index.ts
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'
import { initDatabase } from './data/db'
import { OpencLawProvider } from './ai/openclaw'
import { registerIpcHandlers } from './ipc'

let mainWindow: BrowserWindow | null = null
let db: Database.Database
let aiProvider: OpencLawProvider

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 300,
    height: 350,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Initialize database
  const dbPath = join(app.getPath('userData'), 'petclaw.db')
  db = new Database(dbPath)
  initDatabase(db)

  // Initialize AI provider
  aiProvider = new OpencLawProvider()

  // Create window
  createWindow()

  // Register IPC handlers
  if (mainWindow) {
    registerIpcHandlers(mainWindow, aiProvider, db)
  }

  // Attempt to connect to Openclaw (non-blocking)
  aiProvider.connect().catch((err) => {
    console.warn('Openclaw not available:', err.message)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  aiProvider?.disconnect()
  db?.close()
})

export { mainWindow }
```

- [ ] **Step 8: Commit**

```bash
git add petclaw-desktop/src/main/ipc.ts petclaw-desktop/src/main/index.ts petclaw-desktop/src/preload/ petclaw-desktop/src/renderer/src/stores/chat-store.ts petclaw-desktop/tests/renderer/stores/chat-store.test.ts
git commit -m "feat: add chat IPC bridge, chat store, and wire up main process"
```

---

## Task 7: Chat Panel UI

**Files:**
- Create: `petclaw-desktop/src/renderer/src/panels/ChatPanel.tsx`
- Modify: `petclaw-desktop/src/renderer/src/App.tsx`

- [ ] **Step 1: Create ChatPanel component**

```tsx
// petclaw-desktop/src/renderer/src/panels/ChatPanel.tsx
import { useState, useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chat-store'

export function ChatPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [input, setInput] = useState('')
  const { messages, isLoading, addMessage, appendToLastMessage, setLoading, loadHistory } =
    useChatStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load history on mount
  useEffect(() => {
    window.api.loadHistory(50).then((history) => {
      loadHistory(history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })))
    })
  }, [])

  // Subscribe to streaming events
  useEffect(() => {
    const unsub1 = window.api.onAIResponding(() => {
      setLoading(true)
      addMessage({ role: 'assistant', content: '' })
    })
    const unsub2 = window.api.onChatChunk((chunk) => {
      appendToLastMessage(chunk)
    })
    const unsub3 = window.api.onChatDone(() => {
      setLoading(false)
    })
    const unsub4 = window.api.onChatError((error) => {
      appendToLastMessage(`\n[Error: ${error}]`)
      setLoading(false)
    })
    return () => {
      unsub1()
      unsub2()
      unsub3()
      unsub4()
    }
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const handleSend = () => {
    const text = input.trim()
    if (!text || isLoading) return
    addMessage({ role: 'user', content: text })
    setInput('')
    window.api.sendChat(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-80 h-96 bg-white/95 backdrop-blur-md rounded-t-2xl shadow-2xl flex flex-col border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">PetClaw Chat</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {messages.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-8">说点什么吧 🐱</p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-primary text-white rounded-br-md'
                  : 'bg-gray-100 text-gray-800 rounded-bl-md'
              }`}
            >
              {msg.content || (isLoading && i === messages.length - 1 ? '...' : '')}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            className="flex-1 px-3 py-2 rounded-full bg-gray-100 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-primary text-white rounded-full text-sm hover:bg-primary-hover disabled:opacity-50"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update App.tsx to show/hide ChatPanel**

```tsx
// petclaw-desktop/src/renderer/src/App.tsx
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
```

- [ ] **Step 3: Resize main window to accommodate chat panel**

Update `src/main/index.ts` window size to allow for the panel:

Change `width: 300, height: 350` to `width: 350, height: 500`.

- [ ] **Step 4: Run the app to verify chat UI renders**

```bash
cd petclaw-desktop
pnpm dev
```

Expected: clicking cat toggles chat panel. Messages can be typed (sending will fail without Openclaw running — this is expected).

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/renderer/src/panels/ChatPanel.tsx petclaw-desktop/src/renderer/src/App.tsx petclaw-desktop/src/main/index.ts
git commit -m "feat: add chat panel UI with streaming message display"
```

---

## Task 8: Hook Server (Unix Socket)

**Files:**
- Create: `petclaw-desktop/src/main/hooks/types.ts`
- Create: `petclaw-desktop/src/main/hooks/server.ts`
- Create: `petclaw-desktop/tests/main/hooks/server.test.ts`
- Create: `petclaw-desktop/src/renderer/src/stores/hook-store.ts`

- [ ] **Step 1: Write failing tests for HookServer**

```typescript
// petclaw-desktop/tests/main/hooks/server.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import * as net from 'net'
import * as fs from 'fs'
import { HookServer } from '../../../src/main/hooks/server'
import { HookEvent, HookEventType } from '../../../src/main/hooks/types'

describe('HookServer', () => {
  let server: HookServer

  afterEach(async () => {
    await server?.stop()
  })

  it('starts and listens on unix socket', async () => {
    server = new HookServer()
    const socketPath = await server.start()
    expect(fs.existsSync(socketPath)).toBe(true)
  })

  it('receives hook events from clients', async () => {
    const events: HookEvent[] = []
    server = new HookServer()
    server.onEvent((event) => events.push(event))
    const socketPath = await server.start()

    // Simulate a hook client sending an event
    const client = net.createConnection(socketPath)
    await new Promise<void>((resolve) => client.on('connect', resolve))

    const event: HookEvent = {
      type: HookEventType.ToolUse,
      tool: 'Claude Code',
      sessionId: 'test-123',
      data: { toolName: 'Read', status: 'running' }
    }
    client.write(JSON.stringify(event) + '\n')

    // Wait for event to be received
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(HookEventType.ToolUse)
    expect(events[0].tool).toBe('Claude Code')

    client.end()
  })

  it('handles multiple clients', async () => {
    const events: HookEvent[] = []
    server = new HookServer()
    server.onEvent((event) => events.push(event))
    const socketPath = await server.start()

    const client1 = net.createConnection(socketPath)
    const client2 = net.createConnection(socketPath)
    await Promise.all([
      new Promise<void>((r) => client1.on('connect', r)),
      new Promise<void>((r) => client2.on('connect', r))
    ])

    client1.write(
      JSON.stringify({ type: 'tool_use', tool: 'Claude Code', sessionId: 's1', data: {} }) + '\n'
    )
    client2.write(
      JSON.stringify({ type: 'tool_use', tool: 'Codex', sessionId: 's2', data: {} }) + '\n'
    )

    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    expect(events).toHaveLength(2)
    client1.end()
    client2.end()
  })

  it('cleans up socket file on stop', async () => {
    server = new HookServer()
    const socketPath = await server.start()
    expect(fs.existsSync(socketPath)).toBe(true)
    await server.stop()
    expect(fs.existsSync(socketPath)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd petclaw-desktop
pnpm vitest run tests/main/hooks/server.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create hook event types**

```typescript
// petclaw-desktop/src/main/hooks/types.ts
export enum HookEventType {
  ToolUse = 'tool_use',
  Permission = 'permission',
  Error = 'error',
  Complete = 'complete',
  SessionStart = 'session_start',
  SessionEnd = 'session_end'
}

export interface HookEvent {
  type: HookEventType | string
  tool: string
  sessionId: string
  data: Record<string, unknown>
  timestamp?: number
}

export interface AgentSession {
  sessionId: string
  tool: string
  status: 'active' | 'idle' | 'error'
  lastEvent?: HookEvent
  startedAt: number
}
```

- [ ] **Step 4: Implement HookServer**

```typescript
// petclaw-desktop/src/main/hooks/server.ts
import * as net from 'net'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { HookEvent } from './types'

type EventHandler = (event: HookEvent) => void

export class HookServer {
  private server: net.Server | null = null
  private socketPath: string = ''
  private handlers: EventHandler[] = []
  private clients: Set<net.Socket> = new Set()

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler)
  }

  async start(customPath?: string): Promise<string> {
    this.socketPath =
      customPath ?? path.join(os.tmpdir(), `petclaw-${process.getuid?.() ?? 0}.sock`)

    // Clean up stale socket file
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath)
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.clients.add(socket)
        let buffer = ''

        socket.on('data', (data) => {
          buffer += data.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const event = JSON.parse(line) as HookEvent
              event.timestamp = event.timestamp ?? Date.now()
              this.handlers.forEach((h) => h(event))
            } catch {
              // Ignore malformed JSON
            }
          }
        })

        socket.on('close', () => {
          this.clients.delete(socket)
        })

        socket.on('error', () => {
          this.clients.delete(socket)
        })
      })

      this.server.on('error', reject)
      this.server.listen(this.socketPath, () => resolve(this.socketPath))
    })
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.destroy()
    }
    this.clients.clear()

    return new Promise((resolve) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close(() => {
        if (this.socketPath && fs.existsSync(this.socketPath)) {
          fs.unlinkSync(this.socketPath)
        }
        this.server = null
        resolve()
      })
    })
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd petclaw-desktop
pnpm vitest run tests/main/hooks/server.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Create hook event store for renderer**

```typescript
// petclaw-desktop/src/renderer/src/stores/hook-store.ts
import { create } from 'zustand'

export interface AgentSession {
  sessionId: string
  tool: string
  status: 'active' | 'idle' | 'error'
  lastEventType: string
  lastEventData: Record<string, unknown>
  startedAt: number
  updatedAt: number
}

interface HookState {
  sessions: Map<string, AgentSession>
  updateSession: (session: AgentSession) => void
  removeSession: (sessionId: string) => void
}

export const useHookStore = create<HookState>()((set) => ({
  sessions: new Map(),

  updateSession: (session) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      sessions.set(session.sessionId, session)
      return { sessions }
    }),

  removeSession: (sessionId) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      sessions.delete(sessionId)
      return { sessions }
    })
}))
```

- [ ] **Step 7: Commit**

```bash
git add petclaw-desktop/src/main/hooks/ petclaw-desktop/tests/main/hooks/ petclaw-desktop/src/renderer/src/stores/hook-store.ts
git commit -m "feat: add Hook server (Unix Socket) and hook event store"
```

---

## Task 9: Hook Config Installer

**Files:**
- Create: `petclaw-desktop/src/main/hooks/installer.ts`
- Create: `petclaw-desktop/tests/main/hooks/installer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// petclaw-desktop/tests/main/hooks/installer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ConfigInstaller } from '../../../src/main/hooks/installer'

describe('ConfigInstaller', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('installs hooks into claude settings.json', () => {
    const settingsDir = path.join(tmpDir, '.claude')
    fs.mkdirSync(settingsDir, { recursive: true })
    const settingsPath = path.join(settingsDir, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({}))

    const installer = new ConfigInstaller('/path/to/bridge')
    installer.installClaudeHooks(settingsPath)

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    expect(settings.hooks).toBeDefined()
    expect(settings.hooks.afterToolUse).toContain('/path/to/bridge')
  })

  it('preserves existing settings when installing hooks', () => {
    const settingsDir = path.join(tmpDir, '.claude')
    fs.mkdirSync(settingsDir, { recursive: true })
    const settingsPath = path.join(settingsDir, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({ existingKey: 'value' }))

    const installer = new ConfigInstaller('/path/to/bridge')
    installer.installClaudeHooks(settingsPath)

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    expect(settings.existingKey).toBe('value')
    expect(settings.hooks).toBeDefined()
  })

  it('does not duplicate hooks on re-install', () => {
    const settingsDir = path.join(tmpDir, '.claude')
    fs.mkdirSync(settingsDir, { recursive: true })
    const settingsPath = path.join(settingsDir, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({}))

    const installer = new ConfigInstaller('/path/to/bridge')
    installer.installClaudeHooks(settingsPath)
    installer.installClaudeHooks(settingsPath)

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const hookEntries = settings.hooks.afterToolUse.filter((h: string) =>
      h.includes('/path/to/bridge')
    )
    expect(hookEntries).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd petclaw-desktop
pnpm vitest run tests/main/hooks/installer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement ConfigInstaller**

```typescript
// petclaw-desktop/src/main/hooks/installer.ts
import * as fs from 'fs'

export class ConfigInstaller {
  private bridgePath: string

  constructor(bridgePath: string) {
    this.bridgePath = bridgePath
  }

  installClaudeHooks(settingsPath: string): void {
    const hookCommand = this.bridgePath

    let settings: Record<string, unknown> = {}
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    }

    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {}
    }

    const hooks = settings.hooks as Record<string, unknown>

    const hookTypes = [
      'afterToolUse',
      'afterPermissionGrant',
      'afterError',
      'afterSessionStart',
      'afterSessionEnd'
    ]

    for (const hookType of hookTypes) {
      if (!Array.isArray(hooks[hookType])) {
        hooks[hookType] = []
      }
      const hookArray = hooks[hookType] as string[]
      if (!hookArray.some((h) => h.includes(this.bridgePath))) {
        hookArray.push(hookCommand)
      }
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  }

  uninstallClaudeHooks(settingsPath: string): void {
    if (!fs.existsSync(settingsPath)) return

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    if (!settings.hooks) return

    const hooks = settings.hooks as Record<string, unknown>

    for (const hookType of Object.keys(hooks)) {
      if (Array.isArray(hooks[hookType])) {
        hooks[hookType] = (hooks[hookType] as string[]).filter(
          (h) => !h.includes(this.bridgePath)
        )
      }
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd petclaw-desktop
pnpm vitest run tests/main/hooks/installer.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/main/hooks/installer.ts petclaw-desktop/tests/main/hooks/installer.test.ts
git commit -m "feat: add ConfigInstaller to inject hooks into Claude Code settings"
```

---

## Task 10: AI Tool Monitor Panel

**Files:**
- Create: `petclaw-desktop/src/renderer/src/panels/MonitorPanel.tsx`
- Modify: `petclaw-desktop/src/preload/index.ts`
- Modify: `petclaw-desktop/src/preload/index.d.ts`
- Modify: `petclaw-desktop/src/main/ipc.ts`
- Modify: `petclaw-desktop/src/main/index.ts`

- [ ] **Step 1: Add hook IPC to preload**

Add to `src/preload/index.ts` api object:

```typescript
// Add these to the api object in src/preload/index.ts
  onHookEvent: (callback: (event: { type: string; tool: string; sessionId: string; data: Record<string, unknown>; timestamp: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: any) => callback(event)
    ipcRenderer.on('hook:event', handler)
    return () => ipcRenderer.removeListener('hook:event', handler)
  }
```

Add to `src/preload/index.d.ts` ElectronAPI:

```typescript
  onHookEvent: (callback: (event: { type: string; tool: string; sessionId: string; data: Record<string, unknown>; timestamp: number }) => void) => () => void
```

- [ ] **Step 2: Wire HookServer events to IPC in main process**

Add to `src/main/ipc.ts` registerIpcHandlers function:

```typescript
// Add HookServer parameter and forwarding
import { HookServer } from './hooks/server'

// Update function signature:
export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  aiProvider: OpencLawProvider,
  db: Database.Database,
  hookServer: HookServer
): void {
  // ... existing handlers ...

  // Forward hook events to renderer
  hookServer.onEvent((event) => {
    mainWindow.webContents.send('hook:event', event)
  })
}
```

Update `src/main/index.ts` to create and start HookServer:

```typescript
// Add imports
import { HookServer } from './hooks/server'

// Add after db initialization:
  const hookServer = new HookServer()
  hookServer.start().then((socketPath) => {
    console.log('Hook server listening on:', socketPath)
  })

// Update registerIpcHandlers call:
  registerIpcHandlers(mainWindow, aiProvider, db, hookServer)

// Add to before-quit:
  hookServer.stop()
```

- [ ] **Step 3: Create MonitorPanel component**

```tsx
// petclaw-desktop/src/renderer/src/panels/MonitorPanel.tsx
import { useEffect } from 'react'
import { useHookStore, AgentSession } from '../stores/hook-store'

export function MonitorPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { sessions, updateSession, removeSession } = useHookStore()

  useEffect(() => {
    const unsub = window.api.onHookEvent((event) => {
      if (event.type === 'session_end') {
        removeSession(event.sessionId)
        return
      }

      updateSession({
        sessionId: event.sessionId,
        tool: event.tool,
        status: event.type === 'error' ? 'error' : 'active',
        lastEventType: event.type,
        lastEventData: event.data,
        startedAt: Date.now(),
        updatedAt: event.timestamp
      })
    })
    return unsub
  }, [])

  const sessionList = Array.from(sessions.values())

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-80 h-96 bg-white/95 backdrop-blur-md rounded-t-2xl shadow-2xl flex flex-col border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">AI 工具监控</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {sessionList.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-8">暂无活跃的 AI 工具</p>
        )}
        {sessionList.map((session) => (
          <SessionCard key={session.sessionId} session={session} />
        ))}
      </div>
    </div>
  )
}

function SessionCard({ session }: { session: AgentSession }): JSX.Element {
  const statusColor =
    session.status === 'active'
      ? 'bg-green-400'
      : session.status === 'error'
        ? 'bg-red-400'
        : 'bg-gray-400'

  return (
    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${statusColor} animate-pulse`} />
        <span className="text-sm font-medium text-gray-700">{session.tool}</span>
        <span className="text-xs text-gray-400 ml-auto">{session.lastEventType}</span>
      </div>
      {session.lastEventData && Object.keys(session.lastEventData).length > 0 && (
        <div className="mt-1 text-xs text-gray-500 truncate">
          {JSON.stringify(session.lastEventData).slice(0, 80)}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Update App.tsx to support panel switching**

```tsx
// petclaw-desktop/src/renderer/src/App.tsx
import { useState, useCallback, useEffect } from 'react'
import { PetCanvas } from './pet/PetCanvas'
import { PetState, PetEvent, PetStateMachine } from './pet/state-machine'
import { ChatPanel } from './panels/ChatPanel'
import { MonitorPanel } from './panels/MonitorPanel'

type PanelType = 'chat' | 'monitor' | 'settings' | null

export function App(): JSX.Element {
  const [petState, setPetState] = useState<PetState>(PetState.Idle)
  const [activePanel, setActivePanel] = useState<PanelType>(null)
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
    // Hook events drive pet state
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
    setActivePanel((prev) => (prev === null ? 'chat' : null))
  }, [])

  return (
    <div className="w-full h-full bg-transparent relative">
      <PetCanvas
        state={petState}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
      />
      {activePanel === 'chat' && <ChatPanel onClose={() => setActivePanel(null)} />}
      {activePanel === 'monitor' && <MonitorPanel onClose={() => setActivePanel(null)} />}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/renderer/src/panels/MonitorPanel.tsx petclaw-desktop/src/renderer/src/App.tsx petclaw-desktop/src/preload/ petclaw-desktop/src/main/ipc.ts petclaw-desktop/src/main/index.ts
git commit -m "feat: add AI tool monitor panel with hook event streaming"
```

---

## Task 11: System Tray + Global Shortcuts

**Files:**
- Create: `petclaw-desktop/src/main/system/tray.ts`
- Create: `petclaw-desktop/src/main/system/shortcuts.ts`
- Modify: `petclaw-desktop/src/main/index.ts`

- [ ] **Step 1: Create system tray**

```typescript
// petclaw-desktop/src/main/system/tray.ts
import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron'
import { join } from 'path'

export function createTray(mainWindow: BrowserWindow): Tray {
  // Use a small icon. In production, use a proper icon file.
  const icon = nativeImage.createEmpty()
  const tray = new Tray(icon)

  tray.setToolTip('PetClaw - AI Desktop Pet')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏宠物',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
        }
      }
    },
    {
      label: '打开聊天',
      click: () => {
        mainWindow.show()
        mainWindow.webContents.send('panel:open', 'chat')
      }
    },
    {
      label: 'AI 工具监控',
      click: () => {
        mainWindow.show()
        mainWindow.webContents.send('panel:open', 'monitor')
      }
    },
    { type: 'separator' },
    {
      label: '退出 PetClaw',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  // Click tray icon to toggle window
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
    }
  })

  return tray
}
```

- [ ] **Step 2: Create global shortcuts**

```typescript
// petclaw-desktop/src/main/system/shortcuts.ts
import { globalShortcut, BrowserWindow } from 'electron'

export function registerShortcuts(mainWindow: BrowserWindow): void {
  // Toggle pet visibility: Ctrl/Cmd + Shift + P
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // Open chat: Ctrl/Cmd + Shift + C
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('panel:open', 'chat')
  })
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
```

- [ ] **Step 3: Add panel:open IPC to preload**

Add to `src/preload/index.ts`:

```typescript
  onPanelOpen: (callback: (panel: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, panel: string) => callback(panel)
    ipcRenderer.on('panel:open', handler)
    return () => ipcRenderer.removeListener('panel:open', handler)
  }
```

Add to `src/preload/index.d.ts` ElectronAPI:

```typescript
  onPanelOpen: (callback: (panel: string) => void) => () => void
```

- [ ] **Step 4: Handle panel:open in App.tsx**

Add to App.tsx useEffect:

```typescript
  useEffect(() => {
    const unsub = window.api.onPanelOpen((panel) => {
      setActivePanel(panel as PanelType)
    })
    return unsub
  }, [])
```

- [ ] **Step 5: Wire up tray and shortcuts in main/index.ts**

Add imports:

```typescript
import { createTray } from './system/tray'
import { registerShortcuts, unregisterShortcuts } from './system/shortcuts'
```

Add after `registerIpcHandlers()`:

```typescript
  createTray(mainWindow)
  registerShortcuts(mainWindow)
```

Add to `before-quit`:

```typescript
  unregisterShortcuts()
```

- [ ] **Step 6: Run the app to verify tray and shortcuts work**

```bash
cd petclaw-desktop
pnpm dev
```

Expected: system tray icon appears. Right-click shows context menu. Cmd+Shift+P toggles pet visibility. Cmd+Shift+C opens chat panel.

- [ ] **Step 7: Commit**

```bash
git add petclaw-desktop/src/main/system/ petclaw-desktop/src/main/index.ts petclaw-desktop/src/preload/ petclaw-desktop/src/renderer/src/App.tsx
git commit -m "feat: add system tray and global shortcuts"
```

---

## Task 12: Settings Panel

**Files:**
- Create: `petclaw-desktop/src/renderer/src/panels/SettingsPanel.tsx`
- Modify: `petclaw-desktop/src/preload/index.ts`
- Modify: `petclaw-desktop/src/preload/index.d.ts`
- Modify: `petclaw-desktop/src/main/ipc.ts`
- Modify: `petclaw-desktop/src/renderer/src/App.tsx`

- [ ] **Step 1: Add settings IPC to preload**

Add to `src/preload/index.ts`:

```typescript
  getSetting: (key: string): Promise<string | null> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string): Promise<void> => ipcRenderer.invoke('settings:set', key, value),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version')
```

Add to `src/preload/index.d.ts` ElectronAPI:

```typescript
  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<void>
  getAppVersion: () => Promise<string>
```

- [ ] **Step 2: Add settings IPC handlers**

Add to `src/main/ipc.ts`:

```typescript
import { saveSetting, getSetting } from './data/db'

// Inside registerIpcHandlers:
  ipcMain.handle('settings:get', async (_event, key: string) => {
    return getSetting(db, key)
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    saveSetting(db, key, value)
  })

  ipcMain.handle('app:version', async () => {
    const { app } = await import('electron')
    return app.getVersion()
  })
```

- [ ] **Step 3: Create SettingsPanel component**

```tsx
// petclaw-desktop/src/renderer/src/panels/SettingsPanel.tsx
import { useState, useEffect } from 'react'

export function SettingsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [gatewayUrl, setGatewayUrl] = useState('ws://127.0.0.1:18789')
  const [appVersion, setAppVersion] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.getSetting('gatewayUrl').then((v) => {
      if (v) setGatewayUrl(v)
    })
    window.api.getAppVersion().then(setAppVersion)
  }, [])

  const handleSave = async () => {
    await window.api.setSetting('gatewayUrl', gatewayUrl)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-80 h-96 bg-white/95 backdrop-blur-md rounded-t-2xl shadow-2xl flex flex-col border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">设置</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Settings */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Gateway URL */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Openclaw Gateway URL
          </label>
          <input
            type="text"
            value={gatewayUrl}
            onChange={(e) => setGatewayUrl(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-gray-100 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          className="w-full py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover"
        >
          {saved ? '已保存' : '保存设置'}
        </button>

        {/* Shortcuts info */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">快捷键</label>
          <div className="space-y-1 text-xs text-gray-600">
            <div className="flex justify-between">
              <span>显示/隐藏宠物</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">⌘⇧P</kbd>
            </div>
            <div className="flex justify-between">
              <span>打开聊天</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">⌘⇧C</kbd>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-100 text-center">
        <span className="text-xs text-gray-400">PetClaw v{appVersion}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add settings panel to App.tsx and right-click context menu**

Update App.tsx to add `SettingsPanel` import and rendering:

```tsx
import { SettingsPanel } from './panels/SettingsPanel'

// In the return JSX, add:
      {activePanel === 'settings' && <SettingsPanel onClose={() => setActivePanel(null)} />}
```

Add right-click handler to PetCanvas in App.tsx:

```tsx
  const handleContextMenu = useCallback(() => {
    setActivePanel('settings')
  }, [])

  // Pass to PetCanvas:
  <PetCanvas
    state={petState}
    onDragMove={handleDragMove}
    onDragEnd={handleDragEnd}
    onClick={handleClick}
    onContextMenu={handleContextMenu}
  />
```

Update `PetCanvas.tsx` to accept and use `onContextMenu`:

```tsx
interface PetCanvasProps {
  state: PetState
  onDragMove?: (dx: number, dy: number) => void
  onDragEnd?: () => void
  onClick?: () => void
  onContextMenu?: () => void
}

// Add to the div:
  onContextMenu={(e) => {
    e.preventDefault()
    onContextMenu?.()
  }}
```

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/renderer/src/panels/SettingsPanel.tsx petclaw-desktop/src/renderer/src/App.tsx petclaw-desktop/src/renderer/src/pet/PetCanvas.tsx petclaw-desktop/src/preload/ petclaw-desktop/src/main/ipc.ts
git commit -m "feat: add settings panel with gateway URL config and shortcuts info"
```

---

## Task 13: Pet Store (Zustand) + Final Wiring

**Files:**
- Create: `petclaw-desktop/src/renderer/src/stores/pet-store.ts`
- Modify: `petclaw-desktop/src/renderer/src/App.tsx` (minor cleanup)

- [ ] **Step 1: Create pet store**

```typescript
// petclaw-desktop/src/renderer/src/stores/pet-store.ts
import { create } from 'zustand'
import { PetState } from '../pet/state-machine'

interface PetStoreState {
  state: PetState
  position: { x: number; y: number }
  setState: (state: PetState) => void
  setPosition: (x: number, y: number) => void
}

export const usePetStore = create<PetStoreState>()((set) => ({
  state: PetState.Idle,
  position: { x: 0, y: 0 },

  setState: (state) => set({ state }),
  setPosition: (x, y) => set({ position: { x, y } })
}))
```

- [ ] **Step 2: Run all tests to confirm everything passes**

```bash
cd petclaw-desktop
pnpm vitest run
```

Expected: all tests across all files PASS.

- [ ] **Step 3: Run the full app end-to-end**

```bash
cd petclaw-desktop
pnpm dev
```

Expected:
1. Transparent window with animated cat on desktop
2. Cat bounces gently in idle state
3. Drag cat to move window
4. Click cat to open chat panel
5. Right-click cat to open settings panel
6. System tray icon with context menu
7. Cmd+Shift+P toggles visibility
8. Cmd+Shift+C opens chat

- [ ] **Step 4: Commit**

```bash
git add petclaw-desktop/src/renderer/src/stores/pet-store.ts
git commit -m "feat: add pet store and complete Phase 1 MVP wiring"
```

---

## Task 14: Build & Package Configuration

**Files:**
- Modify: `petclaw-desktop/package.json` (add electron-builder config)
- Create: `petclaw-desktop/resources/icon.png` (placeholder)

- [ ] **Step 1: Add electron-builder configuration**

Add to `package.json`:

```json
{
  "build": {
    "appId": "ai.petclaw.desktop",
    "productName": "PetClaw",
    "directories": {
      "output": "dist"
    },
    "mac": {
      "category": "public.app-category.utilities",
      "icon": "resources/icon.png",
      "target": ["dmg", "zip"],
      "hardenedRuntime": true
    },
    "win": {
      "icon": "resources/icon.png",
      "target": ["nsis"]
    },
    "npmRebuild": true,
    "nativeRebuilder": "sequential"
  }
}
```

- [ ] **Step 2: Create a placeholder icon**

Create a simple 512x512 PNG icon at `petclaw-desktop/resources/icon.png`. For now, use any placeholder image.

```bash
# Create a placeholder (1x1 transparent PNG for now)
cd petclaw-desktop
mkdir -p resources
# Will need a real icon later — for now the build can proceed without one
```

- [ ] **Step 3: Test the build**

```bash
cd petclaw-desktop
pnpm build
```

Expected: build succeeds, output in `petclaw-desktop/out/`.

- [ ] **Step 4: Commit**

```bash
git add petclaw-desktop/package.json petclaw-desktop/resources/
git commit -m "feat: add electron-builder packaging configuration"
```

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | Project scaffolding + transparent window | Manual |
| 2 | Pet state machine | 11 unit tests |
| 3 | PixiJS cat sprite + PetCanvas | Manual |
| 4 | SQLite database layer | 6 unit tests |
| 5 | AI Provider interface + Openclaw | 3 integration tests |
| 6 | Chat IPC bridge + store | 5 unit tests |
| 7 | Chat panel UI | Manual |
| 8 | Hook server (Unix Socket) | 4 unit tests |
| 9 | Hook config installer | 3 unit tests |
| 10 | AI tool monitor panel | Manual |
| 11 | System tray + global shortcuts | Manual |
| 12 | Settings panel | Manual |
| 13 | Pet store + final wiring | All tests |
| 14 | Build & package config | Build test |

**Total: 14 tasks, 32 automated tests**

After completion, the MVP delivers:
- A transparent desktop cat pet with state-based animations
- Text chat via Openclaw Gateway (WebSocket)
- Claude Code hook monitoring (Unix Socket)
- System tray + global shortcuts
- Settings panel
- SQLite local storage
- macOS build
