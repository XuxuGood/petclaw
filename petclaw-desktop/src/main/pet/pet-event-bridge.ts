import { BrowserWindow } from 'electron'

import type { CoworkController } from '../ai/cowork-controller'
import type { CoworkMessage } from '../ai/types'
import type { ImGatewayManager } from '../im/im-gateway-manager'
import type { CronJobService } from '../scheduler/cron-job-service'
import type { HookServer } from '../hooks/server'

/**
 * PetEventBridge: 聚合多源事件，向宠物窗口发送统一的状态事件和气泡消息。
 *
 * 事件源：
 * - CoworkController: 聊天消息/流式更新/完成/错误/权限审批
 * - ImGatewayManager: IM 消息到达创建会话
 * - CronJobService: 定时任务触发
 * - HookServer: Claude Code hook 活跃/空闲
 *
 * 维护 activeSessionCount 计数器，确保多会话并行时正确触发动画：
 * - 任何会话开始 → ChatSent（仅首个）
 * - 所有会话结束 → AIDone
 */
export class PetEventBridge {
  private activeSessionCount = 0
  private firstResponseSent = new Set<string>()

  constructor(
    private petWindow: BrowserWindow,
    private coworkController: CoworkController,
    private imGateway?: ImGatewayManager,
    private cronService?: CronJobService,
    private hookServer?: HookServer
  ) {
    this.bindCoworkEvents()
    if (this.hookServer) this.bindHookEvents()
    // IM 和 Scheduler 事件通过主动调用触发（不是 EventEmitter），
    // 需要在 index.ts 中将回调注入。这里提供 public 方法供外部调用。
  }

  // ── CoworkController 事件 ──

  private bindCoworkEvents(): void {
    // 用户发消息 -> 活跃计数+1，首次激活时触发 CHAT_SENT
    this.coworkController.on('message', (_sessionId: string, msg: CoworkMessage) => {
      if (msg.type === 'user') {
        this.sessionStarted()
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
        this.sendBubble(content.slice(-50), 'chat')
      }
    )

    // 会话完成 -> 清理状态，最后一个会话结束时触发 AI_DONE
    this.coworkController.on('complete', (sessionId: string) => {
      this.cleanupSession(sessionId)
      this.sendBubble('任务完成', 'system')
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
      this.sendBubble(`等待审批：${toolName}`, 'approval')
    })
  }

  // ── HookServer 事件 ──

  private bindHookEvents(): void {
    // hook 事件透传到 Pet 窗口，同时触发对应宠物动画状态
    this.hookServer!.onEvent((event) => {
      if (event.type === 'session_end') {
        this.sendPetEvent('HOOK_IDLE')
      } else {
        this.sendPetEvent('HOOK_ACTIVE')
      }
      // 透传 hook:event 到 Pet 窗口，渲染层订阅以更新 MonitorView
      this.petWindow.webContents.send('hook:event', event)
    })
  }

  // ── IM 消息触发（由 index.ts 在收到 IM 消息时调用） ──

  /** IM 平台新会话到达时由主进程调用，触发宠物动画和气泡 */
  notifyImSessionCreated(sessionId: string, platform: string): void {
    this.sessionStarted()
    this.sendBubble(`[${platform}] 收到新任务`, 'im')
  }

  // ── 定时任务触发（由 index.ts 在 cron 任务执行时调用） ──

  /** 定时任务执行时由主进程调用，触发宠物动画和气泡 */
  notifySchedulerTaskFired(sessionId: string, taskName: string): void {
    this.sessionStarted()
    this.sendBubble(`[定时] ${taskName}`, 'scheduler')
  }

  // ── 会话计数 ──

  /** 任意会话开始：计数+1，首个会话时触发 CHAT_SENT 动画 */
  private sessionStarted(): void {
    this.activeSessionCount++
    if (this.activeSessionCount === 1) {
      this.sendPetEvent('CHAT_SENT')
    }
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

  private sendBubble(text: string, source: string): void {
    this.petWindow.webContents.send('pet:bubble', { text, source })
  }
}
