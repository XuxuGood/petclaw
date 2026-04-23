import { BrowserWindow } from 'electron'

import type { CoworkController } from '../ai/cowork-controller'
import type { CoworkMessage } from '../ai/types'

/**
 * PetEventBridge: 聚合 CoworkController 事件，向宠物窗口发送统一的状态事件和气泡消息。
 * 维护活跃会话计数，确保只在首个会话开始时触发 CHAT_SENT，最后一个会话结束时触发 AI_DONE。
 */
export class PetEventBridge {
  private activeSessionCount = 0
  private firstResponseSent = new Set<string>()

  constructor(
    private petWindow: BrowserWindow,
    private coworkController: CoworkController
  ) {
    this.bindEvents()
  }

  private bindEvents(): void {
    // 用户发消息 -> 活跃计数+1，首次激活时触发 CHAT_SENT
    this.coworkController.on('message', (_sessionId: string, msg: CoworkMessage) => {
      if (msg.type === 'user') {
        this.activeSessionCount++
        if (this.activeSessionCount === 1) {
          this.sendPetEvent('CHAT_SENT')
        }
      }
    })

    // 流式内容更新 -> 每个 session 首次回复时触发 AI_RESPONDING，同时发气泡文本
    this.coworkController.on(
      'messageUpdate',
      (sessionId: string, _msgId: string, content: string) => {
        if (!this.firstResponseSent.has(sessionId)) {
          this.firstResponseSent.add(sessionId)
          this.sendPetEvent('AI_RESPONDING')
        }
        this.sendBubble(content.slice(-50))
      }
    )

    // 会话完成 -> 清理状态，最后一个会话结束时触发 AI_DONE
    this.coworkController.on('complete', (sessionId: string) => {
      this.cleanupSession(sessionId)
    })

    // 会话错误 -> 同完成逻辑
    this.coworkController.on('error', (sessionId: string) => {
      this.cleanupSession(sessionId)
    })

    // 用户手动停止 -> 同完成逻辑
    this.coworkController.on('sessionStopped', (sessionId: string) => {
      this.cleanupSession(sessionId)
    })

    // 权限审批请求 -> 发送气泡提示
    this.coworkController.on('permissionRequest', (_sessionId: string, req: unknown) => {
      const toolName = (req as { toolName?: string })?.toolName ?? 'unknown'
      this.sendBubble(`等待审批：${toolName}`)
    })
  }

  /** 会话结束统一清理：删除首次响应标记，递减活跃计数，归零时发 AI_DONE */
  private cleanupSession(sessionId: string): void {
    this.firstResponseSent.delete(sessionId)
    this.activeSessionCount = Math.max(0, this.activeSessionCount - 1)
    if (this.activeSessionCount === 0) {
      this.sendPetEvent('AI_DONE')
    }
  }

  private sendPetEvent(event: string): void {
    this.petWindow.webContents.send('pet:state-event', { event })
  }

  private sendBubble(text: string): void {
    this.petWindow.webContents.send('pet:bubble', { text })
  }
}
