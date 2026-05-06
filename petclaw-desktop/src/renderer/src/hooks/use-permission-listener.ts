// 全局 IPC 监听 hook：订阅权限请求到达和超时关闭事件，维护 permission store 队列
import { useEffect } from 'react'
import { usePermissionStore } from '../stores/permission-store'
import type { PermissionRequest } from '../stores/permission-store'

type IncomingPermissionRequest = Omit<PermissionRequest, 'sessionId'>

export function usePermissionListener(): void {
  const enqueue = usePermissionStore((s) => s.enqueue)
  const dequeue = usePermissionStore((s) => s.dequeue)

  useEffect(() => {
    // 权限/AskUser 请求到达 → 入队
    const unsubPermission = window.api.cowork.onPermission((data) => {
      const d = data as { sessionId: string; request: IncomingPermissionRequest }
      if (d.request && typeof d.sessionId === 'string') {
        enqueue({ ...d.request, sessionId: d.sessionId })
      }
    })

    // 超时/已响应后关闭弹窗 → 出队
    const unsubDismiss = window.api.cowork.onPermissionDismiss((data) => {
      const d = data as { requestId: string }
      if (d.requestId) {
        dequeue(d.requestId)
      }
    })

    return () => {
      unsubPermission()
      unsubDismiss()
    }
  }, [enqueue, dequeue])
}
