// tests/main/scheduler/cron-job-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock GatewayClient
function createMockClient() {
  return {
    request: vi.fn()
  }
}

describe('CronJobService', () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  it('should map gateway job to ScheduledTask', async () => {
    // 测试 mapGatewayJob 转换逻辑
    const { mapGatewayJob } = await import('../../../src/main/scheduler/cron-job-service')
    const gatewayJob = {
      id: 'job-1',
      name: '每日新闻',
      description: '收集科技新闻',
      enabled: true,
      schedule: { kind: 'cron' as const, expr: '0 9 * * *' },
      sessionTarget: 'main' as const,
      wakeMode: 'always' as const,
      payload: { kind: 'agentTurn' as const, message: '收集新闻' },
      state: {
        nextRunAtMs: 1714000000000,
        lastRunAtMs: null,
        lastRunStatus: undefined,
        lastError: undefined,
        lastDurationMs: undefined,
        runningAtMs: undefined,
        consecutiveErrors: 0
      },
      createdAtMs: 1713900000000,
      updatedAtMs: 1713900000000
    }
    const task = mapGatewayJob(gatewayJob)
    expect(task.id).toBe('job-1')
    expect(task.name).toBe('每日新闻')
    expect(task.schedule).toEqual({ kind: 'cron', expr: '0 9 * * *' })
    expect(task.payload).toEqual({ kind: 'agentTurn', message: '收集新闻' })
    expect(task.state.nextRunAtMs).toBe(1714000000000)
  })

  it('should map gateway schedule correctly', async () => {
    const { mapGatewaySchedule } = await import('../../../src/main/scheduler/cron-job-service')
    expect(mapGatewaySchedule({ kind: 'at', at: '2026-04-23T10:00:00Z' })).toEqual({
      kind: 'at',
      at: '2026-04-23T10:00:00Z'
    })
    expect(mapGatewaySchedule({ kind: 'every', everyMs: 60000 })).toEqual({
      kind: 'every',
      everyMs: 60000
    })
    expect(mapGatewaySchedule({ kind: 'cron', expr: '0 9 * * 1-5', tz: 'Asia/Shanghai' })).toEqual({
      kind: 'cron',
      expr: '0 9 * * 1-5',
      tz: 'Asia/Shanghai'
    })
  })

  it('should call cron.add via gateway', async () => {
    const { CronJobService } = await import('../../../src/main/scheduler/cron-job-service')
    mockClient.request.mockResolvedValue({
      id: 'new-1',
      name: 'test',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      sessionTarget: 'main',
      wakeMode: 'always',
      payload: { kind: 'agentTurn', message: 'hello' },
      state: {},
      createdAtMs: Date.now(),
      updatedAtMs: Date.now()
    })
    const service = new CronJobService({
      getGatewayClient: () => mockClient,
      ensureGatewayReady: async () => {}
    })
    const task = await service.addJob({
      name: 'test',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      sessionTarget: 'main',
      wakeMode: 'always',
      payload: { kind: 'agentTurn', message: 'hello' }
    })
    expect(mockClient.request).toHaveBeenCalledWith('cron.add', expect.objectContaining({ name: 'test' }))
    expect(task.id).toBe('new-1')
  })

  it('should call cron.remove via gateway', async () => {
    const { CronJobService } = await import('../../../src/main/scheduler/cron-job-service')
    mockClient.request.mockResolvedValue({})
    const service = new CronJobService({
      getGatewayClient: () => mockClient,
      ensureGatewayReady: async () => {}
    })
    await service.removeJob('job-1')
    expect(mockClient.request).toHaveBeenCalledWith('cron.remove', { id: 'job-1' })
  })

  it('should list jobs via gateway', async () => {
    const { CronJobService } = await import('../../../src/main/scheduler/cron-job-service')
    mockClient.request.mockResolvedValue({
      jobs: [
        {
          id: 'j1',
          name: 'Job 1',
          enabled: true,
          schedule: { kind: 'cron', expr: '0 9 * * *' },
          sessionTarget: 'main',
          wakeMode: 'always',
          payload: { kind: 'agentTurn', message: 'hi' },
          state: {},
          createdAtMs: Date.now(),
          updatedAtMs: Date.now()
        }
      ]
    })
    const service = new CronJobService({
      getGatewayClient: () => mockClient,
      ensureGatewayReady: async () => {}
    })
    const tasks = await service.listJobs()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].name).toBe('Job 1')
  })
})
