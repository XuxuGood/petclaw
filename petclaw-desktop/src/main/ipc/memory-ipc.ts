// memory-ipc.ts: 工作区记忆文件（MEMORY.md）读写操作的 IPC 处理层
// MemoryManager 是纯文件驱动，workspace 参数为工作区目录绝对路径
import { safeHandle } from './ipc-registry'
import type { MemoryManager } from '../memory/memory-manager'

export interface MemoryIpcDeps {
  memoryManager: MemoryManager
}

export function registerMemoryIpcHandlers(deps: MemoryIpcDeps): void {
  const { memoryManager } = deps

  // 读取指定工作区的 MEMORY.md 完整内容，文件不存在时返回空字符串
  safeHandle('memory:read', async (_event, workspace: string) =>
    memoryManager.readMemory(workspace)
  )

  // 以 Markdown 列表行形式追加一条记忆条目
  safeHandle('memory:append', async (_event, workspace: string, entry: string) => {
    memoryManager.appendMemory(workspace, entry)
  })

  // 删除包含指定文本的记忆行
  safeHandle('memory:remove', async (_event, workspace: string, text: string) => {
    memoryManager.removeMemory(workspace, text)
  })

  // 按关键词搜索记忆（大小写不敏感），返回匹配行数组
  safeHandle('memory:search', async (_event, workspace: string, keyword: string) =>
    memoryManager.searchMemory(workspace, keyword)
  )

  // 列出所有以 '- ' 开头的条目，附带行号（1-indexed）
  safeHandle('memory:list-entries', async (_event, workspace: string) =>
    memoryManager.listEntries(workspace)
  )

  // 用 newText 替换记忆文件中首个匹配的 oldText 片段
  safeHandle(
    'memory:update-entry',
    async (_event, workspace: string, oldText: string, newText: string) => {
      memoryManager.updateEntry(workspace, oldText, newText)
    }
  )
}
