import { readFileSync } from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

interface PngRgba {
  width: number
  height: number
  raw: Buffer
  rowBytes: number
}

interface SpriteDefinition {
  frameCount: number
  frameWidth: number
  frameHeight: number
  columns: number
  tileMargin: number
  tilePadding: number
}

function readPngRgba(path: string): PngRgba {
  const bytes = readFileSync(path)
  let offset = 8
  let width = 0
  let height = 0
  const idatChunks: Buffer[] = []

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      expect(data[8]).toBe(8)
      expect(data[9]).toBe(6)
    }
    if (type === 'IDAT') idatChunks.push(data)
    offset += 12 + length
  }

  const inflated = inflateSync(Buffer.concat(idatChunks))
  const rowBytes = width * 4 + 1
  const raw = Buffer.alloc(width * height * 4)

  for (let row = 0; row < height; row += 1) {
    const filter = inflated[row * rowBytes]
    expect(filter).toBe(0)
    inflated.copy(raw, row * width * 4, row * rowBytes + 1, row * rowBytes + rowBytes)
  }

  return { width, height, raw, rowBytes: width * 4 }
}

function hasDarkArtifactPixel(image: PngRgba, x: number, y: number): boolean {
  const offset = y * image.rowBytes + x * 4
  return (
    image.raw[offset + 3] > 0 &&
    image.raw[offset] < 80 &&
    image.raw[offset + 1] < 80 &&
    image.raw[offset + 2] < 80
  )
}

function findThinVerticalArtifacts(image: PngRgba, definition: SpriteDefinition): number[] {
  const artifactFrames: number[] = []
  const frameArea = definition.frameWidth * definition.frameHeight
  const queue = new Int32Array(frameArea)

  for (let frameIndex = 0; frameIndex < definition.frameCount; frameIndex += 1) {
    const column = frameIndex % definition.columns
    const row = Math.floor(frameIndex / definition.columns)
    const frameX = definition.tileMargin + column * (definition.frameWidth + definition.tilePadding)
    const frameY = definition.tileMargin + row * (definition.frameHeight + definition.tilePadding)
    const visited = new Uint8Array(frameArea)

    for (let localY = 0; localY < definition.frameHeight; localY += 1) {
      for (let localX = 0; localX < definition.frameWidth; localX += 1) {
        const localIndex = localY * definition.frameWidth + localX
        if (visited[localIndex]) continue
        if (!hasDarkArtifactPixel(image, frameX + localX, frameY + localY)) continue

        let head = 0
        let tail = 0
        let minX = localX
        let maxX = localX
        let minY = localY
        let maxY = localY
        visited[localIndex] = 1
        queue[tail] = localIndex
        tail += 1

        while (head < tail) {
          const current = queue[head]
          head += 1
          const x = current % definition.frameWidth
          const y = Math.floor(current / definition.frameWidth)
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)

          const neighbors = [
            y > 0 ? current - definition.frameWidth : -1,
            y + 1 < definition.frameHeight ? current + definition.frameWidth : -1,
            x > 0 ? current - 1 : -1,
            x + 1 < definition.frameWidth ? current + 1 : -1
          ]

          for (const neighbor of neighbors) {
            if (neighbor < 0 || visited[neighbor]) continue
            const neighborX = neighbor % definition.frameWidth
            const neighborY = Math.floor(neighbor / definition.frameWidth)
            if (!hasDarkArtifactPixel(image, frameX + neighborX, frameY + neighborY)) continue
            visited[neighbor] = 1
            queue[tail] = neighbor
            tail += 1
          }
        }

        const componentWidth = maxX - minX + 1
        const componentHeight = maxY - minY + 1
        if (minX > definition.frameWidth * 0.55 && componentWidth <= 3 && componentHeight >= 18) {
          artifactFrames.push(frameIndex)
          localX = definition.frameWidth
          localY = definition.frameHeight
        }
      }
    }
  }

  return artifactFrames
}

describe('cat sprite assets', () => {
  it('does not include isolated vertical artifacts in sleep wake-up frames', () => {
    const spritePath = path.join(
      process.cwd(),
      'src/renderer/src/assets/cat-sprites/sleep-leave.png'
    )
    const image = readPngRgba(spritePath)

    expect(
      findThinVerticalArtifacts(image, {
        frameCount: 452,
        frameWidth: 180,
        frameHeight: 145,
        columns: 16,
        tileMargin: 2,
        tilePadding: 4
      })
    ).toEqual([])
  })
})
