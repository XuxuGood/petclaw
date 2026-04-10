import WebSocket from 'ws'
import { AIProvider } from './provider'

export class OpencLawProvider implements AIProvider {
  private ws: WebSocket | null = null
  private gatewayUrl: string

  constructor(gatewayUrl: string = 'ws://127.0.0.1:18789') {
    this.gatewayUrl = gatewayUrl
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.gatewayUrl)

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
    let resolveChunk: (() => void) | null = null

    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'chunk') {
        chunks.push(msg.text)
        resolveChunk?.()
      } else if (msg.type === 'done') {
        done = true
        resolveChunk?.()
      }
    }

    this.ws.on('message', handler)

    try {
      while (!done) {
        if (chunks.length > 0) {
          yield chunks.shift()!
        } else {
          await new Promise<void>((r) => {
            resolveChunk = r
          })
        }
      }
      // Yield remaining chunks
      while (chunks.length > 0) {
        yield chunks.shift()!
      }
    } finally {
      this.ws?.removeListener('message', handler)
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
