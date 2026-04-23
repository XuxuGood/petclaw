import type { CoworkStore } from './cowork-store'
import type { CoworkController } from './cowork-controller'
import type { CoworkSession, CoworkStartOptions } from './types'

export class SessionManager {
  constructor(
    private store: CoworkStore,
    private controller: CoworkController
  ) {}

  createAndStart(
    title: string,
    cwd: string,
    prompt: string,
    options?: CoworkStartOptions
  ): CoworkSession {
    const session = this.store.createSession(
      title,
      cwd,
      options?.systemPrompt,
      undefined,
      options?.skillIds,
      options?.agentId
    )
    this.controller.startSession(session.id, prompt, options)
    return session
  }

  continueSession(sessionId: string, prompt: string): void {
    this.controller.continueSession(sessionId, prompt)
  }

  stopSession(sessionId: string): void {
    this.controller.stopSession(sessionId)
  }

  getSession(id: string): CoworkSession | null {
    return this.store.getSession(id)
  }

  getSessions(): CoworkSession[] {
    return this.store.getSessions()
  }

  deleteSession(id: string): void {
    if (this.controller.isSessionActive(id)) {
      this.controller.stopSession(id)
    }
    this.store.deleteSession(id)
  }

  getRecentWorkingDirs(limit?: number): string[] {
    return this.store.getRecentWorkingDirs(limit)
  }
}
