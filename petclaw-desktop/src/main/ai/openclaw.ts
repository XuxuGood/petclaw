import WebSocket from 'ws'
import { AIProvider } from './provider'

const CHAT_TIMEOUT_MS = 30_000

export class OpencLawProvider implements AIProvider {
  private ws: WebSocket | null = null
  private gatewayUrl: string
  private gatewayToken: string

  constructor(gatewayUrl: string = 'ws://127.0.0.1:29890', gatewayToken: string = '') {
    this.gatewayUrl = gatewayUrl
    this.gatewayToken = gatewayToken
  }

  setGatewayUrl(url: string): void {
    this.gatewayUrl = url
  }

  setGatewayToken(token: string): void {
    this.gatewayToken = token
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {}
      if (this.gatewayToken) {
        headers['Authorization'] = `Bearer ${this.gatewayToken}`
      }
      this.ws = new WebSocket(this.gatewayUrl, { headers })

      this.ws.on('open', () => resolve())
      this.ws.on('error', (err) => reject(err))
    })
  }

  async *chat(message: string): AsyncGenerator<string, void, unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to Openclaw Gateway')
    }

    this.ws.send(JSON.stringify({ type: 'chat', text: message }))

    const chunks: string[] = []
    let done = false
    let error: Error | null = null
    let resolveChunk: (() => void) | null = null

    const handler = (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'chunk') {
          chunks.push(msg.text)
          resolveChunk?.()
        } else if (msg.type === 'done') {
          done = true
          resolveChunk?.()
        } else if (msg.type === 'error') {
          error = new Error(msg.message ?? 'Gateway error')
          resolveChunk?.()
        }
      } catch {
        error = new Error('Invalid JSON from Gateway')
        resolveChunk?.()
      }
    }

    const closeHandler = () => {
      error = error ?? new Error('WebSocket connection closed during chat')
      resolveChunk?.()
    }

    const errorHandler = (err: Error) => {
      error = err
      resolveChunk?.()
    }

    this.ws.on('message', handler)
    this.ws.on('close', closeHandler)
    this.ws.on('error', errorHandler)

    try {
      while (!done && !error) {
        if (chunks.length > 0) {
          yield chunks.shift()!
        } else {
          await new Promise<void>((r) => {
            resolveChunk = r
            setTimeout(() => {
              error = error ?? new Error('Chat response timed out')
              r()
            }, CHAT_TIMEOUT_MS)
          })
        }
      }
      if (error) throw error
      // Yield remaining chunks
      while (chunks.length > 0) {
        yield chunks.shift()!
      }
    } finally {
      this.ws?.removeListener('message', handler)
      this.ws?.removeListener('close', closeHandler)
      this.ws?.removeListener('error', errorHandler)
    }
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
