// src/main/ipc/scheduler-ipc.ts
import { safeHandle } from './ipc-registry'
import type { CronJobService } from '../scheduler/cron-job-service'
import type { ScheduledTaskInput } from '../scheduler/types'
import { SchedulerIpcChannel } from '../scheduler/types'

export interface SchedulerIpcDeps {
  cronJobService: CronJobService
}

export function registerSchedulerIpcHandlers(deps: SchedulerIpcDeps): void {
  const { cronJobService } = deps

  // 列出所有定时任务
  safeHandle(SchedulerIpcChannel.List, async () => {
    return cronJobService.listJobs()
  })

  // 创建新定时任务
  safeHandle(SchedulerIpcChannel.Create, async (_event, input: ScheduledTaskInput) => {
    return cronJobService.addJob(input)
  })

  // 更新已有定时任务
  safeHandle(
    SchedulerIpcChannel.Update,
    async (_event, id: string, input: Partial<ScheduledTaskInput>) => {
      return cronJobService.updateJob(id, input)
    }
  )

  // 删除定时任务
  safeHandle(SchedulerIpcChannel.Delete, async (_event, id: string) => {
    return cronJobService.removeJob(id)
  })

  // 启用/禁用定时任务
  safeHandle(SchedulerIpcChannel.Toggle, async (_event, id: string, enabled: boolean) => {
    return cronJobService.toggleJob(id, enabled)
  })

  // 手动触发一次任务执行
  safeHandle(SchedulerIpcChannel.RunManually, async (_event, id: string) => {
    return cronJobService.runJob(id)
  })

  // 查询指定任务的执行记录（分页）
  safeHandle(
    SchedulerIpcChannel.ListRuns,
    async (_event, jobId: string, limit?: number, offset?: number) => {
      return cronJobService.listRuns(jobId, limit, offset)
    }
  )

  // 查询所有任务的执行记录（分页）
  safeHandle(SchedulerIpcChannel.ListAllRuns, async (_event, limit?: number, offset?: number) => {
    return cronJobService.listAllRuns(limit, offset)
  })
}
