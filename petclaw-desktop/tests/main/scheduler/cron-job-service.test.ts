// tests/main/scheduler/cron-job-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

import { initDatabase } from '../../../src/main/data/db'
import { ScheduledTaskMetaStore } from '../../../src/main/data/scheduled-task-meta-store'

// Mock GatewayClient
function createMockClient() {
  return {
    request: vi.fn()
  }
}

function createInMemoryDb() {
  const db = new Database(':memory:')
  initDatabase(db)
  return { db, metaStore: new ScheduledTaskMetaStore(db) }
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
    expect(mockClient.request).toHaveBeenCalledWith(
      'cron.add',
      expect.objectContaining({ name: 'test' })
    )
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

  // ── scheduled_task_meta ──

  describe('scheduled_task_meta', () => {
    it('should save and get task meta with timestamps', async () => {
      const { CronJobService } = await import('../../../src/main/scheduler/cron-job-service')
      const { db, metaStore } = createInMemoryDb()
      const service = new CronJobService({
        getGatewayClient: () => mockClient,
        ensureGatewayReady: async () => {},
        metaStore
      })
      const before = Date.now()
      service.saveTaskMeta('task-1', {
        directoryPath: '/projects/foo',
        agentId: 'agent-abc',
        origin: 'user',
        binding: 'dir'
      })
      const meta = service.getTaskMeta('task-1')
      expect(meta).toEqual(
        expect.objectContaining({
          taskId: 'task-1',
          directoryPath: '/projects/foo',
          agentId: 'agent-abc',
          origin: 'user',
          binding: 'dir'
        })
      )
      expect(meta!.createdAt).toBeGreaterThanOrEqual(before)
      expect(meta!.updatedAt).toBeGreaterThanOrEqual(before)
      db.close()
    })

    it('should delete task meta', async () => {
      const { CronJobService } = await import('../../../src/main/scheduler/cron-job-service')
      const { db, metaStore } = createInMemoryDb()
      const service = new CronJobService({
        getGatewayClient: () => mockClient,
        ensureGatewayReady: async () => {},
        metaStore
      })
      service.saveTaskMeta('task-2', { agentId: 'agent-xyz' })
      expect(service.getTaskMeta('task-2')).not.toBeNull()
      service.deleteTaskMeta('task-2')
      expect(service.getTaskMeta('task-2')).toBeNull()
      db.close()
    })

    it('should return null when metaStore not provided', async () => {
      const { CronJobService } = await import('../../../src/main/scheduler/cron-job-service')
      const service = new CronJobService({
        getGatewayClient: () => mockClient,
        ensureGatewayReady: async () => {}
      })
      expect(service.getTaskMeta('any-id')).toBeNull()
    })

    it('should auto-save meta on addJob with agentId', async () => {
      const { CronJobService } = await import('../../../src/main/scheduler/cron-job-service')
      const { db, metaStore } = createInMemoryDb()
      mockClient.request.mockResolvedValue({
        id: 'auto-1',
        name: 'auto-test',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        sessionTarget: 'main',
        wakeMode: 'always',
        payload: { kind: 'agentTurn', message: 'hi' },
        state: {},
        createdAtMs: Date.now(),
        updatedAtMs: Date.now()
      })
      const service = new CronJobService({
        getGatewayClient: () => mockClient,
        ensureGatewayReady: async () => {},
        metaStore
      })
      await service.addJob({
        name: 'auto-test',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        sessionTarget: 'main',
        wakeMode: 'always',
        payload: { kind: 'agentTurn', message: 'hi' },
        agentId: 'agent-auto'
      })
      const meta = service.getTaskMeta('auto-1')
      expect(meta).not.toBeNull()
      expect(meta!.agentId).toBe('agent-auto')
      db.close()
    })

    it('should auto-delete meta on removeJob', async () => {
      const { CronJobService } = await import('../../../src/main/scheduler/cron-job-service')
      const { db, metaStore } = createInMemoryDb()
      mockClient.request.mockResolvedValue({})
      const service = new CronJobService({
        getGatewayClient: () => mockClient,
        ensureGatewayReady: async () => {},
        metaStore
      })
      // 先手动保存元数据
      service.saveTaskMeta('rm-1', { agentId: 'agent-rm' })
      expect(service.getTaskMeta('rm-1')).not.toBeNull()
      // removeJob 应自动删除元数据
      await service.removeJob('rm-1')
      expect(service.getTaskMeta('rm-1')).toBeNull()
      db.close()
    })

    it('should auto-sync meta on updateJob with agentId', async () => {
      const { CronJobService } = await import('../../../src/main/scheduler/cron-job-service')
      const { db, metaStore } = createInMemoryDb()
      mockClient.request.mockResolvedValue({
        id: 'upd-1',
        name: 'updated',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 10 * * *' },
        sessionTarget: 'main',
        wakeMode: 'always',
        payload: { kind: 'agentTurn', message: 'hi' },
        state: {},
        createdAtMs: Date.now(),
        updatedAtMs: Date.now()
      })
      const service = new CronJobService({
        getGatewayClient: () => mockClient,
        ensureGatewayReady: async () => {},
        metaStore
      })
      // 先保存初始 meta
      service.saveTaskMeta('upd-1', { agentId: 'old-agent' })
      // updateJob 传入新 agentId，应同步更新 meta
      await service.updateJob('upd-1', { agentId: 'new-agent' })
      const meta = service.getTaskMeta('upd-1')
      expect(meta).not.toBeNull()
      expect(meta!.agentId).toBe('new-agent')
      db.close()
    })

    it('should preserve created_at on saveTaskMeta update', async () => {
      const { CronJobService } = await import('../../../src/main/scheduler/cron-job-service')
      const { db, metaStore } = createInMemoryDb()
      const service = new CronJobService({
        getGatewayClient: () => mockClient,
        ensureGatewayReady: async () => {},
        metaStore
      })
      service.saveTaskMeta('ts-1', { agentId: 'agent-a' })
      const first = service.getTaskMeta('ts-1')!
      await new Promise((r) => setTimeout(r, 10))
      // 再次保存（更新），created_at 应保持不变
      service.saveTaskMeta('ts-1', { agentId: 'agent-b' })
      const second = service.getTaskMeta('ts-1')!
      expect(second.createdAt).toBe(first.createdAt)
      expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
      expect(second.agentId).toBe('agent-b')
      db.close()
    })
  })
})
