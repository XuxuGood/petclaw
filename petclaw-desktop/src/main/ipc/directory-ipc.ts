// directory-ipc.ts: 目录配置 IPC 处理层
import { safeHandle } from './ipc-registry'
import type { DirectoryManager } from '../ai/directory-manager'

export interface DirectoryIpcDeps {
  directoryManager: DirectoryManager
}

export function registerDirectoryIpcHandlers(deps: DirectoryIpcDeps): void {
  const { directoryManager } = deps

  safeHandle('directory:list', async () => directoryManager.list())

  safeHandle('directory:get', async (_event, agentId: string) => directoryManager.get(agentId))

  safeHandle('directory:get-by-path', async (_event, directoryPath: string) =>
    directoryManager.getByPath(directoryPath)
  )

  safeHandle('directory:update-name', async (_event, agentId: string, name: string) =>
    directoryManager.updateName(agentId, name)
  )

  safeHandle('directory:update-model', async (_event, agentId: string, model: string) =>
    directoryManager.updateModelOverride(agentId, model)
  )

  safeHandle('directory:update-skills', async (_event, agentId: string, skillIds: string[]) =>
    directoryManager.updateSkillIds(agentId, skillIds)
  )
}
