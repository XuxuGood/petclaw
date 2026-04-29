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

  // Issue-5: AI 极快返回时 Thinking 直接收到 AIDone
  it('transitions from thinking to happy on AI_DONE (fast AI response)', () => {
    const sm = new PetStateMachine()
    sm.send(PetEvent.ChatSent)
    expect(sm.current).toBe(PetState.Thinking)
    sm.send(PetEvent.AIDone)
    expect(sm.current).toBe(PetState.Happy)
  })

  // Issue-6: Happy 期间新 hook 事件不被丢弃
  it('transitions from happy to working on HOOK_ACTIVE', () => {
    const sm = new PetStateMachine()
    sm.send(PetEvent.ChatSent)
    sm.send(PetEvent.AIResponding)
    sm.send(PetEvent.AIDone)
    expect(sm.current).toBe(PetState.Happy)
    sm.send(PetEvent.HookActive)
    expect(sm.current).toBe(PetState.Working)
  })

  // Sleep 状态下 hook 事件唤醒宠物
  it('transitions from sleep to working on HOOK_ACTIVE', () => {
    const sm = new PetStateMachine()
    sm.send(PetEvent.SleepStart)
    expect(sm.current).toBe(PetState.Sleep)
    sm.send(PetEvent.HookActive)
    expect(sm.current).toBe(PetState.Working)
  })
})
