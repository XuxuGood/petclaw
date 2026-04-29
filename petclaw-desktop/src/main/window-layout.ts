import type { PetclawSettings } from './app-settings'

export interface ScreenSize {
  width: number
  height: number
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowSize {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export const PET_W = 180
export const PET_H = 145
export const CHAT_W_MIN = 800
export const CHAT_H_MIN = 560

const PET_ANCHOR_OFFSET_X = 150
const PET_ANCHOR_OFFSET_Y = 200
const PET_SCREEN_MARGIN_X = 220
const PET_SCREEN_MARGIN_Y = 185
const CHAT_W_RATIO = 0.55
const CHAT_W_MAX = 1200
const CHAT_H_RATIO = 0.7
const CHAT_H_MAX = 900

export function resolveChatSize(screenSize: ScreenSize): WindowSize {
  return {
    width: Math.round(Math.min(Math.max(screenSize.width * CHAT_W_RATIO, CHAT_W_MIN), CHAT_W_MAX)),
    height: Math.round(Math.min(Math.max(screenSize.height * CHAT_H_RATIO, CHAT_H_MIN), CHAT_H_MAX))
  }
}

export function resolveMainWindowBounds(options: {
  screen: ScreenSize
  savedBounds?: PetclawSettings['windowBounds']
}): Partial<WindowBounds> & WindowSize {
  const chatSize = resolveChatSize(options.screen)
  const saved = options.savedBounds
  let initialW = chatSize.width
  let initialH = chatSize.height
  let initialX: number | undefined
  let initialY: number | undefined

  if (saved && saved.width >= CHAT_W_MIN && saved.height >= CHAT_H_MIN) {
    if (
      saved.x >= 0 &&
      saved.y >= 0 &&
      saved.x + saved.width <= options.screen.width + 100 &&
      saved.y + saved.height <= options.screen.height + 100
    ) {
      initialW = saved.width
      initialH = saved.height
      initialX = saved.x
      initialY = saved.y
    } else {
      initialW = Math.min(saved.width, options.screen.width)
      initialH = Math.min(saved.height, options.screen.height)
    }
  }

  return {
    width: initialW,
    height: initialH,
    ...(initialX !== undefined && initialY !== undefined ? { x: initialX, y: initialY } : {})
  }
}

export function resolvePetWindowBounds(options: {
  screen: ScreenSize
  savedPetPosition?: PetclawSettings['petPosition']
  chatBounds?: WindowBounds
}): Point {
  let petX = options.screen.width - PET_SCREEN_MARGIN_X
  let petY = options.screen.height - PET_SCREEN_MARGIN_Y

  if (
    options.savedPetPosition &&
    options.savedPetPosition.x >= 0 &&
    options.savedPetPosition.y >= 0 &&
    options.savedPetPosition.x <= options.screen.width - PET_W &&
    options.savedPetPosition.y <= options.screen.height - PET_H
  ) {
    petX = options.savedPetPosition.x
    petY = options.savedPetPosition.y
  } else if (options.chatBounds) {
    petX = options.chatBounds.x + options.chatBounds.width - PET_ANCHOR_OFFSET_X
    petY = options.chatBounds.y + options.chatBounds.height - PET_ANCHOR_OFFSET_Y

    petX = Math.min(petX, options.screen.width - PET_W)
    petY = Math.min(petY, options.screen.height - PET_H)
    petX = Math.max(petX, 0)
    petY = Math.max(petY, 0)
  }

  return { x: petX, y: petY }
}
