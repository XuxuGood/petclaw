import type { LoggingPlatform } from './facade'
import type { LogSource } from './types'

export interface ProcessLogStream {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown
}

export interface AttachProcessLoggerOptions {
  platform: LoggingPlatform
  source: Extract<LogSource, 'gateway' | 'runtime' | 'installer' | 'updater'>
  module: string
  stdout?: ProcessLogStream | null
  stderr?: ProcessLogStream | null
}

function chunkToText(chunk: Buffer | string): string {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf8')
}

export function attachProcessLogger(options: AttachProcessLoggerOptions): void {
  const logger = options.platform.getLogger(options.module, options.source)

  options.stdout?.on('data', (chunk: Buffer | string) => {
    const text = chunkToText(chunk)
    logger.info('process.stdout', 'Process wrote to stdout', { text })
    if (/\[gateway\]/.test(text)) {
      options.platform
        .getLogger(options.module)
        .warn('process.milestone', 'Process milestone detected', {
          source: options.source,
          summary: text.replace(/\n+$/g, '').split('\n')[0]
        })
    }
  })

  options.stderr?.on('data', (chunk: Buffer | string) => {
    logger.warn('process.stderr', 'Process wrote to stderr', { text: chunkToText(chunk) })
  })
}
