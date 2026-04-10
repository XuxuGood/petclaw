import * as net from 'net'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { HookEvent } from './types'

type EventHandler = (event: HookEvent) => void

export class HookServer {
  private server: net.Server | null = null
  private socketPath: string = ''
  private handlers: EventHandler[] = []
  private clients: Set<net.Socket> = new Set()

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler)
  }

  async start(customPath?: string): Promise<string> {
    this.socketPath =
      customPath ?? path.join(os.tmpdir(), `petclaw-${process.getuid?.() ?? 0}.sock`)

    // Clean up stale socket file
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath)
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.clients.add(socket)
        let buffer = ''

        socket.on('data', (data) => {
          buffer += data.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const event = JSON.parse(line) as HookEvent
              event.timestamp = event.timestamp ?? Date.now()
              this.handlers.forEach((h) => h(event))
            } catch {
              // Ignore malformed JSON
            }
          }
        })

        socket.on('close', () => {
          this.clients.delete(socket)
        })

        socket.on('error', () => {
          this.clients.delete(socket)
        })
      })

      this.server.on('error', reject)
      this.server.listen(this.socketPath, () => resolve(this.socketPath))
    })
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.destroy()
    }
    this.clients.clear()

    return new Promise((resolve) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close(() => {
        if (this.socketPath && fs.existsSync(this.socketPath)) {
          fs.unlinkSync(this.socketPath)
        }
        this.server = null
        resolve()
      })
    })
  }
}
