import fs from 'fs'

import type { CoworkStore } from '../data/cowork-store'
import type { CoworkController } from './cowork-controller'
import type { CoworkContinueOptions, CoworkSession, CoworkStartOptions } from './types'
import { deriveAgentId } from './types'
import type { DirectoryManager } from './directory-manager'
import { t } from '../i18n'

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
    // 校验工作目录是否存在
    if (!fs.existsSync(cwd)) {
      throw new Error(t('error.dirNotFound', { path: cwd }))
    }
    // main workspace 是 OpenClaw 默认 agent 的私有工作区，不注册为目录 agent。
    const agentId = options?.useMainAgent ? 'main' : deriveAgentId(cwd)
    if (!options?.useMainAgent) {
      // 幂等注册目录，确保 directories 表有记录
      this.directoryManager.ensureRegistered(cwd)
    }
    const origin = options?.origin ?? 'chat'
    const session = options?.selectedModel
      ? this.store.createSession(
          title,
          cwd,
          agentId,
          options?.systemPrompt ?? '',
          options.selectedModel,
          origin
        )
      : this.store.createSession(
          title,
          cwd,
          agentId,
          options?.systemPrompt ?? '',
          undefined,
          origin
        )
    // fire-and-forget: session-manager 不阻塞到 turn 完成
    // 错误通过 controller 的 error 事件传递到 UI 层
    void this.controller.startSession(session.id, prompt, options).catch(() => {
      // 错误已在 controller 内处理（status=error + emit error），这里只防止 unhandled rejection
    })
    return session
  }

  continueSession(sessionId: string, prompt: string, options?: CoworkContinueOptions): void {
    // 校验会话工作目录是否仍然存在
    const session = this.store.getSession(sessionId)
    if (session && !fs.existsSync(session.directoryPath)) {
      throw new Error(t('error.dirDeleted', { path: session.directoryPath }))
    }
    if (options?.selectedModel) {
      this.store.updateSession(sessionId, { selectedModel: options.selectedModel })
    }
    void this.controller.continueSession(sessionId, prompt, options).catch(() => {})
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
    // 清理 controller 内部关联状态（映射表、缓存等），防止内存泄漏
    this.controller.onSessionDeleted(id)
  }

  getRecentDirectories(limit?: number): string[] {
    return this.store.getRecentDirectories(limit)
  }
}
