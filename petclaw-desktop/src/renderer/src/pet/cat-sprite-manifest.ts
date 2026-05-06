import beginSprite from '../assets/cat-sprites/begin.png'
import staticSprite from '../assets/cat-sprites/static.png'
import listeningSprite from '../assets/cat-sprites/listening.png'
import sleepStartSprite from '../assets/cat-sprites/sleep-start.png'
import sleepLoopSprite from '../assets/cat-sprites/sleep-loop.png'
import sleepLeaveSprite from '../assets/cat-sprites/sleep-leave.png'
import taskStartSprite from '../assets/cat-sprites/task-start.png'
import taskLoopSprite from '../assets/cat-sprites/task-loop.png'
import taskLeaveSprite from '../assets/cat-sprites/task-leave.png'

export interface CatSpriteDefinition {
  src: string
  frameCount: number
  fps: number
  frameWidth: number
  frameHeight: number
  columns: number
  rows: number
  tileMargin: number
  tilePadding: number
}

export const CAT_SPRITES = {
  begin: {
    src: beginSprite,
    frameCount: 257,
    fps: 30,
    frameWidth: 180,
    frameHeight: 145,
    columns: 16,
    rows: 17,
    tileMargin: 2,
    tilePadding: 4
  },
  static: {
    src: staticSprite,
    frameCount: 249,
    fps: 30,
    frameWidth: 180,
    frameHeight: 145,
    columns: 16,
    rows: 16,
    tileMargin: 2,
    tilePadding: 4
  },
  listening: {
    src: listeningSprite,
    frameCount: 302,
    fps: 30,
    frameWidth: 180,
    frameHeight: 145,
    columns: 16,
    rows: 19,
    tileMargin: 2,
    tilePadding: 4
  },
  'sleep-start': {
    src: sleepStartSprite,
    frameCount: 302,
    fps: 30,
    frameWidth: 180,
    frameHeight: 145,
    columns: 16,
    rows: 19,
    tileMargin: 2,
    tilePadding: 4
  },
  'sleep-loop': {
    src: sleepLoopSprite,
    frameCount: 145,
    fps: 24,
    frameWidth: 180,
    frameHeight: 145,
    columns: 16,
    rows: 10,
    tileMargin: 2,
    tilePadding: 4
  },
  'sleep-leave': {
    src: sleepLeaveSprite,
    frameCount: 452,
    fps: 30,
    frameWidth: 180,
    frameHeight: 145,
    columns: 16,
    rows: 29,
    tileMargin: 2,
    tilePadding: 4
  },
  'task-start': {
    src: taskStartSprite,
    frameCount: 152,
    fps: 30,
    frameWidth: 180,
    frameHeight: 145,
    columns: 16,
    rows: 10,
    tileMargin: 2,
    tilePadding: 4
  },
  'task-loop': {
    src: taskLoopSprite,
    frameCount: 122,
    fps: 24,
    frameWidth: 180,
    frameHeight: 145,
    columns: 16,
    rows: 8,
    tileMargin: 2,
    tilePadding: 4
  },
  'task-leave': {
    src: taskLeaveSprite,
    frameCount: 267,
    fps: 30,
    frameWidth: 180,
    frameHeight: 145,
    columns: 16,
    rows: 17,
    tileMargin: 2,
    tilePadding: 4
  }
} satisfies Record<string, CatSpriteDefinition>
