const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DIR = path.join(ROOT, 'src/renderer/src/assets/cat')
const OUT_DIR = path.join(ROOT, 'src/renderer/src/assets/cat-sprites')
const MANIFEST_PATH = path.join(ROOT, 'src/renderer/src/pet/cat-sprite-manifest.ts')
const FRAME_WIDTH = 180
const FRAME_HEIGHT = 145
const CONTENT_SAFE_INSET = 6
const COLUMNS = 16
const TILE_MARGIN = 2
const TILE_PADDING = TILE_MARGIN * 2
const ARTIFACT_CLEANUP_ANIMATIONS = new Set(['sleep-leave'])

const ANIMATIONS = [
  'begin',
  'static',
  'listening',
  'sleep-start',
  'sleep-loop',
  'sleep-leave',
  'task-start',
  'task-loop',
  'task-leave'
]

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CRC_TABLE = new Uint32Array(256)

for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC_TABLE[index] = value >>> 0
}

function toIdentifier(name) {
  return `${name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())}Sprite`
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: Object.hasOwn(options, 'encoding') ? options.encoding : 'utf8',
    input: options.input,
    maxBuffer: options.maxBuffer,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe']
  })
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBuffer.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length)
  return chunk
}

function writePngRgba(outputPath, rgba, width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const rowBytes = width * 4
  const scanlines = Buffer.alloc((rowBytes + 1) * height)
  for (let row = 0; row < height; row += 1) {
    const sourceStart = row * rowBytes
    const targetStart = row * (rowBytes + 1)
    scanlines[targetStart] = 0
    rgba.copy(scanlines, targetStart + 1, sourceStart, sourceStart + rowBytes)
  }

  fs.writeFileSync(
    outputPath,
    Buffer.concat([
      PNG_SIGNATURE,
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
      pngChunk('IEND', Buffer.alloc(0))
    ])
  )
}

function parseRate(rate) {
  const [numText, denText] = rate.split('/')
  const num = Number(numText)
  const den = Number(denText)
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 24
  return num / den
}

function probe(inputPath) {
  const raw = run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-count_frames',
    '-show_entries',
    'stream=nb_read_frames,r_frame_rate',
    '-of',
    'json',
    inputPath
  ])
  const parsed = JSON.parse(raw)
  const stream = parsed.streams?.[0]
  const frameCount = Number(stream?.nb_read_frames)
  return {
    frameCount: Number.isFinite(frameCount) && frameCount > 0 ? frameCount : 1,
    fps: parseRate(stream?.r_frame_rate ?? '24/1')
  }
}

function alphaBleedTransparentRgb(buffer, width, height) {
  const total = width * height
  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0

  for (let index = 0; index < total; index += 1) {
    if (buffer[index * 4 + 3] === 0) continue
    visited[index] = 1
    queue[tail] = index
    tail += 1
  }

  while (head < tail) {
    const index = queue[head]
    head += 1
    const x = index % width
    const sourceOffset = index * 4
    const neighbors = [
      index - width,
      index + width,
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1
    ]

    for (const neighbor of neighbors) {
      if (neighbor < 0 || neighbor >= total || visited[neighbor]) continue
      const offset = neighbor * 4
      buffer[offset] = buffer[sourceOffset]
      buffer[offset + 1] = buffer[sourceOffset + 1]
      buffer[offset + 2] = buffer[sourceOffset + 2]
      visited[neighbor] = 1
      queue[tail] = neighbor
      tail += 1
    }
  }

  for (let index = 0; index < total; index += 1) {
    const offset = index * 4
    if (buffer[offset + 3] !== 0) continue
    buffer[offset] = 255
    buffer[offset + 1] = 255
    buffer[offset + 2] = 255
    buffer[offset + 3] = 1
  }
}

function clearPixel(buffer, atlasWidth, x, y) {
  const offset = (y * atlasWidth + x) * 4
  buffer[offset] = 0
  buffer[offset + 1] = 0
  buffer[offset + 2] = 0
  buffer[offset + 3] = 0
}

function isVisiblePixel(buffer, atlasWidth, x, y) {
  return buffer[(y * atlasWidth + x) * 4 + 3] > 0
}

function removeThinVerticalArtifacts(buffer, atlasWidth, frameCount) {
  const frameArea = FRAME_WIDTH * FRAME_HEIGHT
  const queue = new Int32Array(frameArea)
  const componentPixels = new Int32Array(frameArea)

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const column = frameIndex % COLUMNS
    const row = Math.floor(frameIndex / COLUMNS)
    const frameX = TILE_MARGIN + column * (FRAME_WIDTH + TILE_PADDING)
    const frameY = TILE_MARGIN + row * (FRAME_HEIGHT + TILE_PADDING)
    const visited = new Uint8Array(frameArea)

    for (let localY = 0; localY < FRAME_HEIGHT; localY += 1) {
      for (let localX = 0; localX < FRAME_WIDTH; localX += 1) {
        const localIndex = localY * FRAME_WIDTH + localX
        if (visited[localIndex]) continue
        if (!isVisiblePixel(buffer, atlasWidth, frameX + localX, frameY + localY)) continue

        let head = 0
        let tail = 0
        let pixelCount = 0
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
          componentPixels[pixelCount] = current
          pixelCount += 1

          const x = current % FRAME_WIDTH
          const y = Math.floor(current / FRAME_WIDTH)
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)

          const neighbors = [
            y > 0 ? current - FRAME_WIDTH : -1,
            y + 1 < FRAME_HEIGHT ? current + FRAME_WIDTH : -1,
            x > 0 ? current - 1 : -1,
            x + 1 < FRAME_WIDTH ? current + 1 : -1
          ]

          for (const neighbor of neighbors) {
            if (neighbor < 0 || visited[neighbor]) continue
            const neighborX = neighbor % FRAME_WIDTH
            const neighborY = Math.floor(neighbor / FRAME_WIDTH)
            if (!isVisiblePixel(buffer, atlasWidth, frameX + neighborX, frameY + neighborY)) continue
            visited[neighbor] = 1
            queue[tail] = neighbor
            tail += 1
          }
        }

        const componentWidth = maxX - minX + 1
        const componentHeight = maxY - minY + 1
        // 源 sleep-leave.webm 自带一条孤立竖线，必须在 atlas 阶段清掉，否则点击睡眠猫唤醒时会露出黑边。
        if (minX > FRAME_WIDTH * 0.55 && componentWidth <= 3) {
          for (let index = 0; index < pixelCount; index += 1) {
            const localPixel = componentPixels[index]
            const x = localPixel % FRAME_WIDTH
            const y = Math.floor(localPixel / FRAME_WIDTH)
            clearPixel(buffer, atlasWidth, frameX + x, frameY + y)
          }
        }
      }
    }
  }
}

function buildSprite(name) {
  const inputPath = path.join(SOURCE_DIR, `${name}.webm`)
  const outputPath = path.join(OUT_DIR, `${name}.png`)
  const { frameCount, fps } = probe(inputPath)
  const rows = Math.ceil(frameCount / COLUMNS)
  const atlasWidth = COLUMNS * FRAME_WIDTH + (COLUMNS - 1) * TILE_PADDING + TILE_MARGIN * 2
  const atlasHeight = rows * FRAME_HEIGHT + (rows - 1) * TILE_PADDING + TILE_MARGIN * 2

  const raw = run(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-c:v',
      'libvpx-vp9',
      '-i',
      inputPath,
      '-an',
      '-vf',
      [
        `fps=${fps}`,
        `scale=${FRAME_WIDTH - CONTENT_SAFE_INSET * 2}:${FRAME_HEIGHT - CONTENT_SAFE_INSET * 2}:force_original_aspect_ratio=decrease:flags=lanczos`,
        `pad=${FRAME_WIDTH}:${FRAME_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
        'format=rgba',
        `tile=${COLUMNS}x${rows}:padding=${TILE_PADDING}:margin=${TILE_MARGIN}:color=0x00000000`
      ].join(','),
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      'pipe:1'
    ],
    {
      encoding: null,
      maxBuffer: atlasWidth * atlasHeight * 4 + 1024 * 1024
    }
  )

  if (ARTIFACT_CLEANUP_ANIMATIONS.has(name)) {
    removeThinVerticalArtifacts(raw, atlasWidth, frameCount)
  }
  alphaBleedTransparentRgb(raw, atlasWidth, atlasHeight)

  writePngRgba(outputPath, raw, atlasWidth, atlasHeight)

  return {
    name,
    importName: toIdentifier(name),
    frameCount,
    fps,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    columns: COLUMNS,
    rows,
    tileMargin: TILE_MARGIN,
    tilePadding: TILE_PADDING
  }
}

function writeManifest(entries) {
  const imports = entries
    .map((entry) => `import ${entry.importName} from '../assets/cat-sprites/${entry.name}.png'`)
    .join('\n')
  const body = entries
    .map(
      (entry) =>
        `  '${entry.name}': { src: ${entry.importName}, frameCount: ${entry.frameCount}, fps: ${Number(
          entry.fps.toFixed(3)
        )}, frameWidth: ${entry.frameWidth}, frameHeight: ${entry.frameHeight}, columns: ${entry.columns}, rows: ${entry.rows}, tileMargin: ${entry.tileMargin}, tilePadding: ${entry.tilePadding} }`
    )
    .join(',\n')

  fs.writeFileSync(
    MANIFEST_PATH,
    `${imports}\n\nexport interface CatSpriteDefinition {\n  src: string\n  frameCount: number\n  fps: number\n  frameWidth: number\n  frameHeight: number\n  columns: number\n  rows: number\n  tileMargin: number\n  tilePadding: number\n}\n\nexport const CAT_SPRITES = {\n${body}\n} satisfies Record<string, CatSpriteDefinition>\n`,
    'utf8'
  )
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const entries = ANIMATIONS.map(buildSprite)
writeManifest(entries)
