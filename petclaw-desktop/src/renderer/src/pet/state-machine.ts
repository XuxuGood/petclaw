export enum PetState {
  Idle = 'idle',
  Thinking = 'thinking',
  Working = 'working',
  Happy = 'happy',
  Sleep = 'sleep'
}

export enum PetEvent {
  ChatSent = 'CHAT_SENT',
  AIResponding = 'AI_RESPONDING',
  AIDone = 'AI_DONE',
  Timeout = 'TIMEOUT',
  HookActive = 'HOOK_ACTIVE',
  HookIdle = 'HOOK_IDLE',
  SleepStart = 'SLEEP_START',
  WakeUp = 'WAKE_UP'
}

type TransitionCallback = (from: PetState, to: PetState) => void

const transitions: Record<PetState, Partial<Record<PetEvent, PetState>>> = {
  [PetState.Idle]: {
    [PetEvent.ChatSent]: PetState.Thinking,
    [PetEvent.HookActive]: PetState.Working,
    [PetEvent.SleepStart]: PetState.Sleep
  },
  [PetState.Thinking]: {
    [PetEvent.AIResponding]: PetState.Working,
    [PetEvent.AIDone]: PetState.Happy, // AI 极快返回时跳过 Working 直接完成
    [PetEvent.Timeout]: PetState.Idle
  },
  [PetState.Working]: {
    [PetEvent.AIDone]: PetState.Happy,
    [PetEvent.HookIdle]: PetState.Idle,
    [PetEvent.Timeout]: PetState.Idle
  },
  [PetState.Happy]: {
    [PetEvent.Timeout]: PetState.Idle,
    [PetEvent.ChatSent]: PetState.Thinking,
    [PetEvent.HookActive]: PetState.Working // Happy 期间新 hook 事件不再被丢弃
  },
  [PetState.Sleep]: {
    [PetEvent.WakeUp]: PetState.Idle,
    [PetEvent.ChatSent]: PetState.Thinking,
    [PetEvent.HookActive]: PetState.Working
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
