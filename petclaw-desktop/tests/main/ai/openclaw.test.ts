import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocketServer } from 'ws'
import { OpencLawProvider } from '../../../src/main/ai/openclaw'

describe('OpencLawProvider', () => {
  let wss: WebSocketServer
  let port: number

  beforeEach(async () => {
    // Start a mock WebSocket server
    wss = new WebSocketServer({ port: 0 })
    port = (wss.address() as { port: number }).port
  })

  afterEach(async () => {
    wss.close()
  })

  it('connects to gateway', async () => {
    const provider = new OpencLawProvider(`ws://127.0.0.1:${port}`)
    const connected = new Promise<void>((resolve) => {
      wss.on('connection', () => resolve())
    })
    await provider.connect()
    await connected
    provider.disconnect()
  })

  it('sends chat message and receives streaming response', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'chat') {
          ws.send(JSON.stringify({ type: 'chunk', text: 'Hello' }))
          ws.send(JSON.stringify({ type: 'chunk', text: ' world' }))
          ws.send(JSON.stringify({ type: 'done' }))
        }
      })
    })

    const provider = new OpencLawProvider(`ws://127.0.0.1:${port}`)
    await provider.connect()

    const chunks: string[] = []
    for await (const chunk of provider.chat('Hi')) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(['Hello', ' world'])
    provider.disconnect()
  })

  it('handles connection error gracefully', async () => {
    const provider = new OpencLawProvider('ws://127.0.0.1:1') // invalid port
    await expect(provider.connect()).rejects.toThrow()
  })
})
