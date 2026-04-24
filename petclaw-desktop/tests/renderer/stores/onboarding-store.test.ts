import { describe, it, expect, beforeEach } from 'vitest'
import { useOnboardingStore, STEPS } from '../../../src/renderer/src/stores/onboarding-store'

describe('OnboardingStore', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset()
  })

  it('starts with permissions step and empty state', () => {
    const state = useOnboardingStore.getState()
    // 新版 onboarding 从 permissions 开始（权限申请步骤）
    expect(state.step).toBe('permissions')
    expect(state.nickname).toBe('')
    expect(state.roles).toHaveLength(0)
    expect(state.permissions.accessibility).toBe(false)
    expect(state.permissions.microphone).toBe(false)
  })

  it('sets nickname', () => {
    useOnboardingStore.getState().setNickname('Mochi')
    expect(useOnboardingStore.getState().nickname).toBe('Mochi')
  })

  it('advances steps', () => {
    useOnboardingStore.getState().setStep('profile')
    expect(useOnboardingStore.getState().step).toBe('profile')
    useOnboardingStore.getState().setStep('skills')
    expect(useOnboardingStore.getState().step).toBe('skills')
  })

  it('goNext / goPrev navigate through STEPS', () => {
    const store = useOnboardingStore.getState()
    expect(store.step).toBe(STEPS[0])

    useOnboardingStore.getState().goNext()
    expect(useOnboardingStore.getState().step).toBe(STEPS[1])

    useOnboardingStore.getState().goPrev()
    expect(useOnboardingStore.getState().step).toBe(STEPS[0])
  })

  it('sets permission flags', () => {
    useOnboardingStore.getState().setPermission('accessibility', true)
    expect(useOnboardingStore.getState().permissions.accessibility).toBe(true)
    expect(useOnboardingStore.getState().permissions.microphone).toBe(false)
  })

  it('resets to initial state', () => {
    useOnboardingStore.getState().setNickname('Test')
    useOnboardingStore.getState().setStep('skills')
    useOnboardingStore.getState().reset()
    expect(useOnboardingStore.getState().step).toBe('permissions')
    expect(useOnboardingStore.getState().nickname).toBe('')
  })
})
