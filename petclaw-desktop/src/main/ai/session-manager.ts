import path from 'path'

import type { CoworkStore } from './cowork-store'
import type { CoworkController } from './cowork-controller'
import type { CoworkSession, CoworkStartOptions } from './types'
import type { AgentManager } from '../agents/agent-manager'

export class SessionManager {
  constructor(
    private store: CoworkStore,
    private controller: CoworkController,
    // Phase 2: 注入 AgentManager，用于 workspace 路由和 agent 感知
    private agentManager: AgentManager,
    private workspacePath: string,
    private stateDir: string
  ) {}

  createAndStart(
    title: string,
    cwd: string,
    prompt: string,
    options?: CoworkStartOptions
  ): CoworkSession {
    // 未指定 agentId 时回落到 main（系统默认 agent）
    const agentId = options?.agentId || 'main'
    const session = this.store.createSession(
      title,
      cwd,
      options?.systemPrompt,
      undefined,
      options?.skillIds,
      agentId
    )

    // 根据 agent 类型决定 workspace 路径：
    // - isDefault agent（main）使用全局 workspacePath
    // - 自定义 agent 使用隔离子目录，避免文件系统污染
    const agent = this.agentManager.get(agentId)
    const workspace = agent?.isDefault
      ? this.workspacePath
      : path.join(this.stateDir, `workspace-${agentId}`)

    this.controller.startSession(session.id, prompt, {
      ...options,
      agentId,
      workspaceRoot: workspace
    })
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

  // 按 agentId 过滤会话，供 Agent 维度的会话列表展示
  getSessionsByAgent(agentId: string): CoworkSession[] {
    return this.store.getSessions().filter((s) => s.agentId === agentId)
  }

  deleteSession(id: string): void {
    // 正在运行的会话需先停止，避免残留 process
    if (this.controller.isSessionActive(id)) {
      this.controller.stopSession(id)
    }
    this.store.deleteSession(id)
  }

  getRecentWorkingDirs(limit?: number): string[] {
    return this.store.getRecentWorkingDirs(limit)
  }

  // 生成 agent 感知的会话 key，格式：agent:{agentId}:petclaw:{sessionId}
  // 用于 Openclaw 运行时识别会话归属
  private buildSessionKey(agentId: string, sessionId: string): string {
    return `agent:${agentId}:petclaw:${sessionId}`
  }
}
