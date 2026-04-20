import { describe, it, expect, beforeEach } from 'vitest'
import { useOnboardingStore } from '../../../src/renderer/src/stores/onboarding-store'

describe('OnboardingStore', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset()
  })

  it('starts with welcome step and empty state', () => {
    const state = useOnboardingStore.getState()
    expect(state.step).toBe('welcome')
    expect(state.petName).toBe('')
    expect(state.envStatus.nodeOk).toBe(false)
    expect(state.hookStatus.status).toBe('idle')
  })

  it('sets pet name', () => {
    useOnboardingStore.getState().setPetName('Mochi')
    expect(useOnboardingStore.getState().petName).toBe('Mochi')
  })

  it('advances steps', () => {
    useOnboardingStore.getState().setStep('environment')
    expect(useOnboardingStore.getState().step).toBe('environment')
    useOnboardingStore.getState().setStep('hooks')
    expect(useOnboardingStore.getState().step).toBe('hooks')
  })

  it('merges env status partially', () => {
    useOnboardingStore.getState().setEnvStatus({ nodeOk: true, nodeVersion: 'v22.0.0' })
    expect(useOnboardingStore.getState().envStatus.nodeOk).toBe(true)
    expect(useOnboardingStore.getState().envStatus.gatewayOk).toBe(false)

    useOnboardingStore.getState().setEnvStatus({ gatewayOk: true })
    expect(useOnboardingStore.getState().envStatus.nodeOk).toBe(true)
    expect(useOnboardingStore.getState().envStatus.gatewayOk).toBe(true)
  })

  it('sets hook status', () => {
    useOnboardingStore.getState().setHookStatus({ status: 'installing' })
    expect(useOnboardingStore.getState().hookStatus.status).toBe('installing')

    useOnboardingStore.getState().setHookStatus({ status: 'error', error: 'Failed' })
    expect(useOnboardingStore.getState().hookStatus.error).toBe('Failed')
  })

  it('resets to initial state', () => {
    useOnboardingStore.getState().setPetName('Test')
    useOnboardingStore.getState().setStep('ready')
    useOnboardingStore.getState().reset()
    expect(useOnboardingStore.getState().step).toBe('welcome')
    expect(useOnboardingStore.getState().petName).toBe('')
  })
})
