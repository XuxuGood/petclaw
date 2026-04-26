// directory-ipc.ts: 目录配置 IPC 处理层
import { ipcMain } from 'electron'

import type { DirectoryManager } from '../ai/directory-manager'

export interface DirectoryIpcDeps {
  directoryManager: DirectoryManager
}

export function registerDirectoryIpcHandlers(deps: DirectoryIpcDeps): void {
  const { directoryManager } = deps

  ipcMain.handle('directory:list', async () => directoryManager.list())

  ipcMain.handle('directory:get', async (_event, agentId: string) => directoryManager.get(agentId))

  ipcMain.handle('directory:get-by-path', async (_event, directoryPath: string) =>
    directoryManager.getByPath(directoryPath)
  )

  ipcMain.handle('directory:update-name', async (_event, agentId: string, name: string) =>
    directoryManager.updateName(agentId, name)
  )

  ipcMain.handle('directory:update-model', async (_event, agentId: string, model: string) =>
    directoryManager.updateModelOverride(agentId, model)
  )

  ipcMain.handle('directory:update-skills', async (_event, agentId: string, skillIds: string[]) =>
    directoryManager.updateSkillIds(agentId, skillIds)
  )
}
