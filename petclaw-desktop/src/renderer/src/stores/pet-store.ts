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
