// gateway-restart-scheduler.ts：延迟 gateway 重启调度器
// 活跃 Cowork 对话或 Cron 任务执行期间不立即重启 gateway，
// 轮询等待工作负载空闲后再执行，5 分钟硬超时兜底。

import { getLogger } from '../logging/facade'

const logger = getLogger('GatewayRestartScheduler', 'runtime')

export interface GatewayRestartSchedulerDeps {
  /** 检查是否存在活跃的 Cowork 会话或 Cron 任务 */
  hasActiveWorkloads: () => boolean
  /** 执行实际的 gateway 重启 */
  executeRestart: (reason: string) => Promise<void>
}

export class GatewayRestartScheduler {
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private hardTimeout: ReturnType<typeof setTimeout> | null = null
  private pendingReason: string | null = null

  // 3 秒轮询间隔检查工作负载是否空闲
  private static readonly POLL_INTERVAL_MS = 3_000
  // 5 分钟硬超时：防止工作负载永远不结束导致配置漂移
  private static readonly MAX_WAIT_MS = 5 * 60_000

  constructor(private deps: GatewayRestartSchedulerDeps) {}

  /**
   * 请求重启 gateway。
   * 无活跃工作负载时立即执行；有则启动轮询延迟到空闲后再执行。
   * 已有待处理的延迟重启时不重复调度（配置已写入磁盘，重启时读取最新）。
   */
  requestRestart(reason: string): void {
    // 幂等：已有待处理的延迟重启，不重复调度
    if (this.pendingReason !== null) {
      logger.warn('restart.request.skipped', { pendingReason: this.pendingReason, reason })
      return
    }

    // 无活跃工作负载 → 立即执行
    if (!this.deps.hasActiveWorkloads()) {
      logger.warn('restart.executing.immediate', { reason })
      void this.deps.executeRestart(reason)
      return
    }

    // 有活跃工作负载 → 延迟重启
    logger.warn('restart.deferred', { reason })
    this.pendingReason = reason
    this.startPolling()
  }

  /** 取消待处理的延迟重启（app quit 时调用） */
  cancelPending(): void {
    if (this.pendingReason !== null) {
      logger.warn('restart.pending.cancelled', { pendingReason: this.pendingReason })
    }
    this.clearTimers()
    this.pendingReason = null
  }

  /** 是否有待处理的延迟重启（测试用） */
  get isPending(): boolean {
    return this.pendingReason !== null
  }

  // 启动轮询定时器和硬超时定时器
  private startPolling(): void {
    // 轮询：每 3 秒检查工作负载是否空闲
    this.pollTimer = setInterval(() => {
      if (!this.deps.hasActiveWorkloads()) {
        this.execute()
      }
    }, GatewayRestartScheduler.POLL_INTERVAL_MS)

    // 硬超时：5 分钟后不管工作负载状态，强制重启
    this.hardTimeout = setTimeout(() => {
      logger.warn('restart.maxWait.exceeded', {
        maxWaitMs: GatewayRestartScheduler.MAX_WAIT_MS,
        pendingReason: this.pendingReason
      })
      this.execute()
    }, GatewayRestartScheduler.MAX_WAIT_MS)
  }

  // 执行重启并清理状态
  private execute(): void {
    const reason = this.pendingReason
    this.clearTimers()
    this.pendingReason = null

    if (reason) {
      logger.warn('restart.executing.deferred', { reason })
      void this.deps.executeRestart(reason).catch((err) => {
        logger.error('restart.failed', { reason }, err)
      })
    }
  }

  private clearTimers(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.hardTimeout) {
      clearTimeout(this.hardTimeout)
      this.hardTimeout = null
    }
  }
}
