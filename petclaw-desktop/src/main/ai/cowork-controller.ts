import { EventEmitter } from 'events'

import type { OpenclawGateway } from './gateway'
import type { CoworkStore } from './cowork-store'
import type { CoworkStartOptions, PermissionResult, CoworkMessage } from './types'

export class CoworkController extends EventEmitter {
  private activeSessionIds = new Set<string>()

  constructor(
    private gateway: OpenclawGateway,
    private store: CoworkStore
  ) {
    super()
    this.bindGatewayEvents()
  }

  async startSession(
    sessionId: string,
    prompt: string,
    options?: CoworkStartOptions
  ): Promise<void> {
    this.activeSessionIds.add(sessionId)
    this.store.updateSession(sessionId, { status: 'running' })
    const msg = this.store.addMessage(sessionId, 'user', prompt)
    this.emit('message', sessionId, msg)
    await this.gateway.chatSend(sessionId, prompt, options as Record<string, unknown>)
  }

  async continueSession(sessionId: string, prompt: string): Promise<void> {
    if (!this.activeSessionIds.has(sessionId)) {
      this.activeSessionIds.add(sessionId)
    }
    this.store.updateSession(sessionId, { status: 'running' })
    const msg = this.store.addMessage(sessionId, 'user', prompt)
    this.emit('message', sessionId, msg)
    await this.gateway.chatSend(sessionId, prompt)
  }

  stopSession(sessionId: string): void {
    this.activeSessionIds.delete(sessionId)
    this.store.updateSession(sessionId, { status: 'idle' })
    this.emit('sessionStopped', sessionId)
  }

  respondToPermission(requestId: string, result: PermissionResult): void {
    this.gateway.approvalResolve(requestId, result)
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessionIds.has(sessionId)
  }

  getActiveSessionCount(): number {
    return this.activeSessionIds.size
  }

  private bindGatewayEvents(): void {
    this.gateway.on('message', (sessionId: string, msg: CoworkMessage) => {
      this.store.addMessage(sessionId, msg.type, msg.content, msg.metadata)
      this.emit('message', sessionId, msg)
    })

    this.gateway.on('messageUpdate', (sessionId: string, msgId: string, content: string) => {
      this.store.updateMessageContent(msgId, content)
      this.emit('messageUpdate', sessionId, msgId, content)
    })

    this.gateway.on('permissionRequest', (sessionId: string, req: unknown) => {
      this.emit('permissionRequest', sessionId, req)
    })

    this.gateway.on('complete', (sessionId: string, claudeSessionId: string | null) => {
      this.activeSessionIds.delete(sessionId)
      this.store.updateSession(sessionId, { status: 'completed', claudeSessionId })
      this.emit('complete', sessionId, claudeSessionId)
    })

    this.gateway.on('error', (sessionId: string, error: string) => {
      this.activeSessionIds.delete(sessionId)
      this.store.updateSession(sessionId, { status: 'error' })
      this.emit('error', sessionId, error)
    })
  }
}
