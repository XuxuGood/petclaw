import type { CoworkStore } from '../data/cowork-store'
import type { CoworkController } from './cowork-controller'
import type { CoworkSession, CoworkStartOptions } from './types'
import { deriveAgentId } from './types'
import type { DirectoryManager } from './directory-manager'

export class CoworkSessionManager {
  constructor(
    private store: CoworkStore,
    private controller: CoworkController,
    private directoryManager: DirectoryManager
  ) {}

  createAndStart(
    title: string,
    cwd: string,
    prompt: string,
    options?: CoworkStartOptions
  ): CoworkSession {
    // 幂等注册目录，确保 directories 表有记录
    this.directoryManager.ensureRegistered(cwd)
    // 由目录路径确定性派生 agentId，不再依赖用户传入
    const agentId = deriveAgentId(cwd)
    const session = this.store.createSession(title, cwd, agentId)
    // workspace = cwd 本身，不再需要 workspaceRoot 路由
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

  // 按目录路径过滤会话：先派生 agentId 再匹配
  getSessionsByDirectory(directoryPath: string): CoworkSession[] {
    const agentId = deriveAgentId(directoryPath)
    return this.store.getSessions().filter((s) => s.agentId === agentId)
  }

  deleteSession(id: string): void {
    // 正在运行的会话需先停止，避免残留 process
    if (this.controller.isSessionActive(id)) {
      this.controller.stopSession(id)
    }
    this.store.deleteSession(id)
  }

  getRecentDirectories(limit?: number): string[] {
    return this.store.getRecentDirectories(limit)
  }

  // 生成 agent 感知的会话 key，格式：agent:{agentId}:petclaw:{sessionId}
  // 用于 Openclaw 运行时识别会话归属
  private buildSessionKey(agentId: string, sessionId: string): string {
    return `agent:${agentId}:petclaw:${sessionId}`
  }
}
