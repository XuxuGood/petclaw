import crypto from 'crypto'
import { createRequire } from 'module'
import { EventEmitter } from 'events'

import type { CoworkMessage, CoworkMessageType, PermissionRequest } from './types'

// GatewayClient 的 duck-type 接口（从 runtime 动态加载）
interface GatewayClientLike {
  start: () => void
  stop: () => void
  request: <T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean; timeoutMs?: number | null }
  ) => Promise<T>
}

type GatewayClientCtor = new (options: Record<string, unknown>) => GatewayClientLike

interface GatewayEventFrame {
  event: string
  seq?: number
  payload?: unknown
}

// Gateway 发射的事件签名
export interface OpenclawGatewayEvents {
  message: (sessionId: string, message: CoworkMessage) => void
  messageUpdate: (sessionId: string, messageId: string, content: string) => void
  permissionRequest: (sessionId: string, request: PermissionRequest) => void
  complete: (sessionId: string, claudeSessionId: string | null) => void
  error: (sessionId: string, error: string) => void
  connected: () => void
  disconnected: (reason: string) => void
}

export class OpenclawGateway extends EventEmitter {
  private client: GatewayClientLike | null = null
  private clientEntryPath: string | null = null
  private connected = false

  constructor(
    private port: number,
    private token: string
  ) {
    super()
  }

  async connect(runtimeRoot: string): Promise<void> {
    const Ctor = await this.loadGatewayClientCtor(runtimeRoot)

    return new Promise<void>((resolve, reject) => {
      let settled = false

      const client = new Ctor({
        url: `ws://127.0.0.1:${this.port}`,
        token: this.token,
        clientDisplayName: 'PetClaw',
        clientVersion: '1.0.0',
        mode: 'backend',
        caps: ['tool-events'],
        role: 'operator',
        scopes: ['operator.admin'],
        onHelloOk: () => {
          this.client = client
          this.connected = true
          if (!settled) {
            settled = true
            resolve()
          }
          this.emit('connected')
        },
        onConnectError: (error: Error) => {
          // 只有认证失败才立即拒绝，其他等自动重连
          const msg = error.message.toLowerCase()
          if (msg.includes('auth') || msg.includes('denied') || msg.includes('forbidden')) {
            if (!settled) {
              settled = true
              reject(error)
            }
          }
        },
        onClose: (_code: number, reason: string) => {
          this.connected = false
          if (!settled) {
            // 握手前断开，等重连
            return
          }
          this.emit('disconnected', reason || 'Connection closed')
        },
        onEvent: (event: GatewayEventFrame) => {
          this.handleEvent(event)
        }
      })

      client.start()

      // 60s 超时
      setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error('Gateway connection timeout (60s)'))
        }
      }, 60_000)
    })
  }

  async chatSend(
    sessionKey: string,
    message: string,
    options?: Record<string, unknown>
  ): Promise<void> {
    this.ensureConnected()
    await this.client!.request('chat.send', {
      sessionKey,
      message,
      ...options
    })
  }

  async chatStop(sessionKey: string): Promise<void> {
    this.ensureConnected()
    await this.client!.request('chat.stop', { sessionKey })
  }

  async approvalResolve(requestId: string, result: unknown): Promise<void> {
    this.ensureConnected()
    await this.client!.request('exec.approval.resolve', {
      id: requestId,
      result
    })
  }

  disconnect(): void {
    if (this.client) {
      try {
        this.client.stop()
      } catch {
        /* ignore */
      }
      this.client = null
      this.connected = false
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  private ensureConnected(): void {
    if (!this.client || !this.connected) {
      throw new Error('Gateway not connected')
    }
  }

  private handleEvent(frame: GatewayEventFrame): void {
    const { event, payload } = frame
    const p = payload as Record<string, unknown> | undefined

    switch (event) {
      case 'chat.delta':
      case 'chat.final': {
        this.handleChatEvent(event, p)
        break
      }
      case 'chat.error': {
        const sessionKey = (p?.sessionKey ?? '') as string
        const errorMsg = (p?.errorMessage ?? 'Unknown error') as string
        if (sessionKey) {
          this.emit('error', sessionKey, errorMsg)
        }
        break
      }
      case 'exec.approval.requested': {
        this.handleApprovalEvent(p)
        break
      }
      case 'agent.event': {
        this.handleAgentEvent(p)
        break
      }
      // 其他事件静默忽略
    }
  }

  private handleChatEvent(event: string, payload: Record<string, unknown> | undefined): void {
    if (!payload) return
    const sessionKey = (payload.sessionKey ?? '') as string
    if (!sessionKey) return

    if (event === 'chat.final') {
      const claudeSessionId = (payload.runId ?? null) as string | null
      this.emit('complete', sessionKey, claudeSessionId)
      return
    }

    // chat.delta — 流式文本更新
    const message = payload.message as Record<string, unknown> | undefined
    if (message) {
      const content = this.extractMessageContent(message)
      const msgId = (message.id ?? crypto.randomUUID()) as string
      const type = this.inferMessageType(message)
      this.emit('message', sessionKey, {
        id: msgId,
        type,
        content,
        timestamp: Date.now(),
        metadata: { isStreaming: true }
      } satisfies CoworkMessage)
    }
  }

  private handleApprovalEvent(payload: Record<string, unknown> | undefined): void {
    if (!payload) return
    const request = payload.request as Record<string, unknown> | undefined
    const id = (payload.id ?? '') as string
    const sessionKey = (request?.sessionKey ?? '') as string
    if (!id || !sessionKey) return

    const permReq: PermissionRequest = {
      requestId: id,
      toolName: (request?.command ?? 'unknown') as string,
      toolInput: {
        command: request?.command,
        cwd: request?.cwd,
        ask: request?.ask
      },
      toolUseId: (request?.toolUseId ?? null) as string | null
    }
    this.emit('permissionRequest', sessionKey, permReq)
  }

  private handleAgentEvent(payload: Record<string, unknown> | undefined): void {
    if (!payload) return
    const sessionKey = (payload.sessionKey ?? '') as string
    const stream = (payload.stream ?? '') as string
    const data = payload.data as Record<string, unknown> | undefined
    if (!sessionKey || !data) return

    // agent.event 中的文本更新
    if (stream === 'text' || stream === 'assistant') {
      const content = (data.text ?? data.content ?? '') as string
      const msgId = (data.id ?? '') as string
      if (msgId && content) {
        this.emit('messageUpdate', sessionKey, msgId, content)
      }
    }
  }

  private extractMessageContent(message: Record<string, unknown>): string {
    if (typeof message.content === 'string') return message.content
    if (Array.isArray(message.content)) {
      return (message.content as Array<Record<string, unknown>>)
        .filter((block) => block.type === 'text')
        .map((block) => block.text as string)
        .join('')
    }
    return ''
  }

  private inferMessageType(message: Record<string, unknown>): CoworkMessageType {
    const role = (message.role ?? '') as string
    if (role === 'user') return 'user'
    if (role === 'assistant') return 'assistant'
    return 'assistant'
  }

  private async loadGatewayClientCtor(runtimeRoot: string): Promise<GatewayClientCtor> {
    const fs = await import('fs')
    const path = await import('path')

    const candidates = [
      path.join(runtimeRoot, 'dist', 'plugin-sdk', 'gateway-runtime.js'),
      path.join(runtimeRoot, 'dist', 'plugin-sdk', 'gateway-runtime.mjs'),
      path.join(runtimeRoot, 'dist', 'gateway', 'client.js'),
      path.join(runtimeRoot, 'dist', 'client.js'),
      path.join(runtimeRoot, 'gateway.asar', 'dist', 'plugin-sdk', 'gateway-runtime.js')
    ]

    let entryPath: string | null = null
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        entryPath = candidate
        break
      }
    }

    if (!entryPath) {
      throw new Error(`GatewayClient entry not found in ${runtimeRoot}`)
    }

    this.clientEntryPath = entryPath

    // 使用 createRequire 加载 CJS 模块
    const req = createRequire(import.meta.url)
    const loaded = req(entryPath) as Record<string, unknown>

    // 优先查找命名导出 GatewayClient
    if (typeof loaded.GatewayClient === 'function') {
      return loaded.GatewayClient as GatewayClientCtor
    }

    // Duck-type 检测
    for (const value of Object.values(loaded)) {
      if (typeof value !== 'function') continue
      const ctor = value as { name?: string; prototype?: Record<string, unknown> }
      if (ctor.name === 'GatewayClient') return value as GatewayClientCtor
      if (
        ctor.prototype &&
        typeof ctor.prototype.start === 'function' &&
        typeof ctor.prototype.stop === 'function' &&
        typeof ctor.prototype.request === 'function'
      ) {
        return value as GatewayClientCtor
      }
    }

    throw new Error(`GatewayClient class not found in ${entryPath}`)
  }
}
