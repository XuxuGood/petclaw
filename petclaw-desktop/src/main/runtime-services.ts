import type Database from 'better-sqlite3'

import type { DirectoryManager } from './ai/directory-manager'
import type { OpenclawEngineManager } from './ai/engine-manager'
import { OpenclawGateway } from './ai/gateway'
import { CoworkController } from './ai/cowork-controller'
import { CoworkSessionManager } from './ai/cowork-session-manager'
import { CoworkStore } from './data/cowork-store'
import type { ModelRegistry } from './models/model-registry'
import { ScheduledTaskMetaStore } from './data/scheduled-task-meta-store'
import type { CronJobService } from './scheduler/cron-job-service'

export interface RuntimeServiceDeps {
  db: Database.Database
  engineManager: OpenclawEngineManager
  coworkStore: CoworkStore
  directoryManager: DirectoryManager
  modelRegistry: ModelRegistry
}

export interface RuntimeServices {
  gateway: OpenclawGateway
  coworkController: CoworkController
  coworkSessionManager: CoworkSessionManager
  cronJobService: CronJobService
}

/**
 * 创建依赖 Gateway 的运行时服务。GatewayClient 连接保持按需建立，
 * 避免 boot 阶段和首次会话阶段出现重复连接逻辑。
 */
export async function setupRuntimeServices(deps: RuntimeServiceDeps): Promise<RuntimeServices> {
  const gateway = new OpenclawGateway()
  gateway.setEngineManager(deps.engineManager)

  const coworkController = new CoworkController(gateway, deps.coworkStore, deps.modelRegistry)
  const coworkSessionManager = new CoworkSessionManager(
    deps.coworkStore,
    coworkController,
    deps.directoryManager
  )

  const { CronJobService: CronJobServiceClass } = await import('./scheduler/cron-job-service')
  const scheduledTaskMetaStore = new ScheduledTaskMetaStore(deps.db)
  const cronJobService = new CronJobServiceClass({
    getGatewayClient: () => gateway.getClient(),
    ensureGatewayReady: async () => {
      await gateway.ensureConnected()
    },
    metaStore: scheduledTaskMetaStore
  })
  cronJobService.startPolling()

  return {
    gateway,
    coworkController,
    coworkSessionManager,
    cronJobService
  }
}
