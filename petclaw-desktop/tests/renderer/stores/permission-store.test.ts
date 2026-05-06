import { describe, it, expect, beforeEach } from 'vitest'
import { usePermissionStore } from '../../../src/renderer/src/stores/permission-store'

const makeRequest = (id: string) => ({
  sessionId: `session-${id}`,
  requestId: id,
  toolName: 'AskUserQuestion',
  toolInput: { questions: [] },
  toolUseId: null
})

describe('usePermissionStore', () => {
  beforeEach(() => {
    usePermissionStore.getState().clear()
  })

  it('enqueue 追加到队列尾部', () => {
    const store = usePermissionStore.getState()
    store.enqueue(makeRequest('a'))
    store.enqueue(makeRequest('b'))
    expect(usePermissionStore.getState().pendingPermissions).toHaveLength(2)
    expect(usePermissionStore.getState().pendingPermissions[0].requestId).toBe('a')
    expect(usePermissionStore.getState().pendingPermissions[1].requestId).toBe('b')
    expect(usePermissionStore.getState().pendingPermissions[0].sessionId).toBe('session-a')
  })

  it('enqueue 按 requestId 去重', () => {
    const store = usePermissionStore.getState()
    store.enqueue(makeRequest('a'))
    store.enqueue(makeRequest('a'))
    expect(usePermissionStore.getState().pendingPermissions).toHaveLength(1)
  })

  it('dequeue 精确删除指定 requestId', () => {
    const store = usePermissionStore.getState()
    store.enqueue(makeRequest('a'))
    store.enqueue(makeRequest('b'))
    store.dequeue('a')
    const remaining = usePermissionStore.getState().pendingPermissions
    expect(remaining).toHaveLength(1)
    expect(remaining[0].requestId).toBe('b')
  })

  it('dequeue 无参数时 shift 队首', () => {
    const store = usePermissionStore.getState()
    store.enqueue(makeRequest('a'))
    store.enqueue(makeRequest('b'))
    store.dequeue()
    const remaining = usePermissionStore.getState().pendingPermissions
    expect(remaining).toHaveLength(1)
    expect(remaining[0].requestId).toBe('b')
  })

  it('dequeue 对不存在的 requestId 为 no-op', () => {
    const store = usePermissionStore.getState()
    store.enqueue(makeRequest('a'))
    store.dequeue('nonexistent')
    expect(usePermissionStore.getState().pendingPermissions).toHaveLength(1)
  })

  it('clear 清空全部', () => {
    const store = usePermissionStore.getState()
    store.enqueue(makeRequest('a'))
    store.enqueue(makeRequest('b'))
    store.clear()
    expect(usePermissionStore.getState().pendingPermissions).toHaveLength(0)
  })
})
