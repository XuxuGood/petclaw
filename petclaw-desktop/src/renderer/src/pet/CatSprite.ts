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
