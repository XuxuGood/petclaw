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
export const CHAT_W_MIN = 760
export const CHAT_H_MIN = 460

const PET_SCREEN_MARGIN_X = 220
const PET_SCREEN_MARGIN_Y = 185
const PET_COMPOSER_ESTIMATED_H = 140
// 猫素材帧是 180x145，但静态站立姿态的可见像素集中在帧内。
// 锚到聊天输入框时按可见猫体边界计算，否则透明留白会让猫看起来偏左、偏上。
export const PET_VISUAL_RIGHT_EDGE = 126
export const PET_VISUAL_BOTTOM_EDGE = 104
export const PET_COMPOSER_RIGHT_GAP = 24
export const PET_COMPOSER_TOP_GAP = 12
// 主工作台首次打开按桌面 workArea 给足纵向空间，但保留桌面上下文。
const CHAT_W_RATIO = 0.76
const CHAT_W_MAX = 1440
const CHAT_H_RATIO = 0.84
const CHAT_H_MAX = 960

export function resolveChatSize(screenSize: ScreenSize): WindowSize {
  return {
    width: Math.round(Math.min(Math.max(screenSize.width * CHAT_W_RATIO, CHAT_W_MIN), CHAT_W_MAX)),
    height: Math.round(Math.min(Math.max(screenSize.height * CHAT_H_RATIO, CHAT_H_MIN), CHAT_H_MAX))
  }
}

function resolveCenteredWindowBounds(screen: ScreenSize, size: WindowSize): WindowBounds {
  return {
    x: Math.round((screen.width - size.width) / 2),
    y: Math.round((screen.height - size.height) / 2),
    width: size.width,
    height: size.height
  }
}

export function resolveMainWindowBounds(options: {
  screen: ScreenSize
  savedBounds?: WindowBounds
}): Partial<WindowBounds> & WindowSize {
  const chatSize = resolveChatSize(options.screen)
  const saved = options.savedBounds
  let initialW = chatSize.width
  let initialH = chatSize.height
  let initialX = resolveCenteredWindowBounds(options.screen, chatSize).x
  let initialY = resolveCenteredWindowBounds(options.screen, chatSize).y

  if (saved) {
    // 旧版本可能保存过极小窗口，恢复时夹到移动式紧凑尺寸，避免内容被挤爆。
    const restoredW = Math.min(Math.max(saved.width, CHAT_W_MIN), options.screen.width)
    const restoredH = Math.min(Math.max(saved.height, CHAT_H_MIN), options.screen.height)
    if (
      saved.x >= 0 &&
      saved.y >= 0 &&
      saved.x + restoredW <= options.screen.width + 100 &&
      saved.y + restoredH <= options.screen.height + 100
    ) {
      initialW = restoredW
      initialH = restoredH
      initialX = saved.x
      initialY = saved.y
    } else {
      const centered = resolveCenteredWindowBounds(options.screen, {
        width: restoredW,
        height: restoredH
      })
      initialW = restoredW
      initialH = restoredH
      initialX = centered.x
      initialY = centered.y
    }
  }

  return {
    width: initialW,
    height: initialH,
    x: initialX,
    y: initialY
  }
}

function clamp(value: number, min: number, max: number): number {
  const normalizedMax = Math.max(min, max)
  return Math.min(Math.max(value, min), normalizedMax)
}

function isValidPetPosition(point: Point, screen: ScreenSize): boolean {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= screen.width - PET_W &&
    point.y <= screen.height - PET_H
  )
}

function resolvePetPositionNearMainWindow(screen: ScreenSize, chatBounds: WindowBounds): Point {
  // 主进程拿不到 renderer 里 composer 的 DOM 坐标，只能用主窗口 bounds
  // 估算输入区上缘。Pet 是辅助浮层，首次出现应贴近输入区，但不能反向移动主窗口。
  const x = clamp(
    chatBounds.x + chatBounds.width - PET_VISUAL_RIGHT_EDGE - PET_COMPOSER_RIGHT_GAP,
    0,
    screen.width - PET_W
  )
  const y = clamp(
    chatBounds.y +
      chatBounds.height -
      PET_COMPOSER_ESTIMATED_H -
      PET_VISUAL_BOTTOM_EDGE -
      PET_COMPOSER_TOP_GAP,
    0,
    screen.height - PET_H
  )

  return { x, y }
}

export function resolvePetWindowBounds(options: {
  screen: ScreenSize
  savedPetPosition?: Point
  chatBounds?: WindowBounds
}): Point {
  let petX = options.screen.width - PET_SCREEN_MARGIN_X
  let petY = options.screen.height - PET_SCREEN_MARGIN_Y

  if (options.savedPetPosition && isValidPetPosition(options.savedPetPosition, options.screen)) {
    petX = options.savedPetPosition.x
    petY = options.savedPetPosition.y
  } else if (options.chatBounds) {
    const petBounds = resolvePetPositionNearMainWindow(options.screen, options.chatBounds)
    petX = petBounds.x
    petY = petBounds.y
  }

  return { x: petX, y: petY }
}
