// 权限请求队列 store：管理 AskUserQuestion 和���准 exec-approval 请求的 FIFO 队列
import { create } from 'zustand'

export interface PermissionRequest {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId?: string | null
}

interface PermissionState {
  pendingPermissions: PermissionRequest[]
  // 按 requestId 去重后追加到队列尾部
  enqueue: (request: PermissionRequest) => void
  // 精确删除匹配项；无参数时 shift 队首
  dequeue: (requestId?: string) => void
  // 清空全部（会话中止时使用）
  clear: () => void
}

export const usePermissionStore = create<PermissionState>()((set) => ({
  pendingPermissions: [],

  enqueue: (request) =>
    set((state) => {
      // 按 requestId 去重，避免 IPC 重复推送
      if (state.pendingPermissions.some((p) => p.requestId === request.requestId)) {
        return state
      }
      return { pendingPermissions: [...state.pendingPermissions, request] }
    }),

  dequeue: (requestId?) =>
    set((state) => {
      if (requestId) {
        // 精确匹配删除
        const filtered = state.pendingPermissions.filter((p) => p.requestId !== requestId)
        if (filtered.length === state.pendingPermissions.length) return state
        return { pendingPermissions: filtered }
      }
      // 无参数：shift 队首
      if (state.pendingPermissions.length === 0) return state
      return { pendingPermissions: state.pendingPermissions.slice(1) }
    }),

  clear: () => set({ pendingPermissions: [] })
}))
