import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { GatewayRestartScheduler } from '../../../src/main/ai/gateway-restart-scheduler'

describe('GatewayRestartScheduler', () => {
  let hasActiveWorkloads: ReturnType<typeof vi.fn>
  let executeRestart: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    hasActiveWorkloads = vi.fn().mockReturnValue(false)
    executeRestart = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createScheduler(): GatewayRestartScheduler {
    return new GatewayRestartScheduler({ hasActiveWorkloads, executeRestart })
  }

  it('should restart immediately when no active workloads', () => {
    const scheduler = createScheduler()
    hasActiveWorkloads.mockReturnValue(false)

    scheduler.requestRestart('test-reason')

    expect(executeRestart).toHaveBeenCalledTimes(1)
    expect(executeRestart).toHaveBeenCalledWith('test-reason')
    expect(scheduler.isPending).toBe(false)
  })

  it('should defer restart when active workloads exist', () => {
    const scheduler = createScheduler()
    hasActiveWorkloads.mockReturnValue(true)

    scheduler.requestRestart('deferred-reason')

    // 不应立即重启
    expect(executeRestart).not.toHaveBeenCalled()
    expect(scheduler.isPending).toBe(true)
  })

  it('should execute restart when workloads become idle after poll interval', () => {
    const scheduler = createScheduler()
    hasActiveWorkloads.mockReturnValue(true)

    scheduler.requestRestart('poll-reason')
    expect(executeRestart).not.toHaveBeenCalled()

    // 工作负载变空闲
    hasActiveWorkloads.mockReturnValue(false)

    // 推进到第一个轮询周期（3 秒）
    vi.advanceTimersByTime(3_000)

    expect(executeRestart).toHaveBeenCalledTimes(1)
    expect(executeRestart).toHaveBeenCalledWith('poll-reason')
    expect(scheduler.isPending).toBe(false)
  })

  it('should keep polling while workloads are active', () => {
    const scheduler = createScheduler()
    hasActiveWorkloads.mockReturnValue(true)

    scheduler.requestRestart('busy-reason')

    // 前两个轮询周期：仍有活跃工作负载
    vi.advanceTimersByTime(3_000)
    expect(executeRestart).not.toHaveBeenCalled()

    vi.advanceTimersByTime(3_000)
    expect(executeRestart).not.toHaveBeenCalled()

    // 第三个轮询周期：工作负载变空闲
    hasActiveWorkloads.mockReturnValue(false)
    vi.advanceTimersByTime(3_000)

    expect(executeRestart).toHaveBeenCalledTimes(1)
    expect(scheduler.isPending).toBe(false)
  })

  it('should force restart after max wait timeout (5 minutes)', () => {
    const scheduler = createScheduler()
    hasActiveWorkloads.mockReturnValue(true)

    scheduler.requestRestart('timeout-reason')

    // 推进到 5 分钟硬超时
    vi.advanceTimersByTime(5 * 60_000)

    expect(executeRestart).toHaveBeenCalledTimes(1)
    expect(executeRestart).toHaveBeenCalledWith('timeout-reason')
    expect(scheduler.isPending).toBe(false)
  })

  it('should not duplicate schedules when requestRestart called multiple times', () => {
    const scheduler = createScheduler()
    hasActiveWorkloads.mockReturnValue(true)

    scheduler.requestRestart('first-reason')
    scheduler.requestRestart('second-reason')
    scheduler.requestRestart('third-reason')

    // 工作负载变空闲
    hasActiveWorkloads.mockReturnValue(false)
    vi.advanceTimersByTime(3_000)

    // 应该只执行一次重启，使用首次请求的原因
    expect(executeRestart).toHaveBeenCalledTimes(1)
    expect(executeRestart).toHaveBeenCalledWith('first-reason')
  })

  it('should cancel pending restart', () => {
    const scheduler = createScheduler()
    hasActiveWorkloads.mockReturnValue(true)

    scheduler.requestRestart('cancel-reason')
    expect(scheduler.isPending).toBe(true)

    scheduler.cancelPending()
    expect(scheduler.isPending).toBe(false)

    // 推进时间，不应有重启发生
    hasActiveWorkloads.mockReturnValue(false)
    vi.advanceTimersByTime(5 * 60_000)

    expect(executeRestart).not.toHaveBeenCalled()
  })

  it('should allow new restart request after cancel', () => {
    const scheduler = createScheduler()
    hasActiveWorkloads.mockReturnValue(true)

    scheduler.requestRestart('old-reason')
    scheduler.cancelPending()

    // 新请求应正常工作
    hasActiveWorkloads.mockReturnValue(false)
    scheduler.requestRestart('new-reason')

    expect(executeRestart).toHaveBeenCalledTimes(1)
    expect(executeRestart).toHaveBeenCalledWith('new-reason')
  })

  it('should allow new restart request after previous restart completed', () => {
    const scheduler = createScheduler()
    hasActiveWorkloads.mockReturnValue(false)

    scheduler.requestRestart('first')
    expect(executeRestart).toHaveBeenCalledTimes(1)

    scheduler.requestRestart('second')
    expect(executeRestart).toHaveBeenCalledTimes(2)
    expect(executeRestart).toHaveBeenCalledWith('second')
  })

  it('should not execute restart after hard timeout if poll already triggered it', () => {
    const scheduler = createScheduler()
    hasActiveWorkloads.mockReturnValue(true)

    scheduler.requestRestart('race-reason')

    // 在 3 秒后工作负载变空闲，轮询触发重启
    hasActiveWorkloads.mockReturnValue(false)
    vi.advanceTimersByTime(3_000)
    expect(executeRestart).toHaveBeenCalledTimes(1)

    // 继续推进到超时时间，不应重复重启
    vi.advanceTimersByTime(5 * 60_000)
    expect(executeRestart).toHaveBeenCalledTimes(1)
  })
})
