import { describe, it, expect, beforeEach, vi } from 'vitest'

import { CoworkSessionManager } from '../../../src/main/ai/cowork-session-manager'
import type { CoworkStore } from '../../../src/main/data/cowork-store'
import type { CoworkController } from '../../../src/main/ai/cowork-controller'
import type { DirectoryManager } from '../../../src/main/ai/directory-manager'
import type { CoworkSession } from '../../../src/main/ai/types'
import { deriveAgentId } from '../../../src/main/ai/types'

// ── 测试辅助：构造 mock session ──
function makeMockSession(overrides?: Partial<CoworkSession>): CoworkSession {
  return {
    id: 'sess-001',
    title: '测试会话',
    engineSessionId: null,
    status: 'idle',
    pinned: false,
    directoryPath: '/workspace',
    agentId: deriveAgentId('/workspace'),
    modelOverride: '',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

// ── Mock 工厂 ──
function createMocks() {
  const mockStore = {
    createSession: vi.fn(),
    getSession: vi.fn(),
    getSessions: vi.fn(),
    deleteSession: vi.fn(),
    getRecentDirectories: vi.fn()
  } as unknown as CoworkStore

  const mockController = {
    startSession: vi.fn(),
    continueSession: vi.fn(),
    stopSession: vi.fn(),
    isSessionActive: vi.fn()
  } as unknown as CoworkController

  const mockDirectoryManager = {
    ensureRegistered: vi.fn()
  } as unknown as DirectoryManager

  return { mockStore, mockController, mockDirectoryManager }
}

describe('CoworkSessionManager', () => {
  let mockStore: CoworkStore
  let mockController: CoworkController
  let mockDirectoryManager: DirectoryManager
  let manager: CoworkSessionManager

  beforeEach(() => {
    const mocks = createMocks()
    mockStore = mocks.mockStore
    mockController = mocks.mockController
    mockDirectoryManager = mocks.mockDirectoryManager

    manager = new CoworkSessionManager(mockStore, mockController, mockDirectoryManager)
  })

  // ── createAndStart ──

  describe('createAndStart', () => {
    it('自动注册目录并派生 agentId', () => {
      const cwd = '/home/user/project'
      const expectedAgentId = deriveAgentId(cwd)
      const session = makeMockSession({ directoryPath: cwd, agentId: expectedAgentId })
      vi.mocked(mockStore.createSession).mockReturnValue(session)

      manager.createAndStart('测试', cwd, 'hello')

      // 验证 ensureRegistered 被调用
      expect(mockDirectoryManager.ensureRegistered).toHaveBeenCalledWith(cwd)
      // 验证 store.createSession 用 3 参数调用（title, directoryPath, agentId）
      expect(mockStore.createSession).toHaveBeenCalledWith('测试', cwd, expectedAgentId)
    })

    it('controller.startSession 不再传递 workspaceRoot 和 agentId', () => {
      const cwd = '/home/user/project'
      const session = makeMockSession({ directoryPath: cwd })
      vi.mocked(mockStore.createSession).mockReturnValue(session)

      manager.createAndStart('测试', cwd, 'hello', { autoApprove: true })

      expect(mockController.startSession).toHaveBeenCalledWith(session.id, 'hello', {
        autoApprove: true
      })
    })

    it('无 options 时 controller.startSession 第三参数为 undefined', () => {
      const cwd = '/workspace'
      const session = makeMockSession({ directoryPath: cwd })
      vi.mocked(mockStore.createSession).mockReturnValue(session)

      manager.createAndStart('测试', cwd, 'hello')

      expect(mockController.startSession).toHaveBeenCalledWith(session.id, 'hello', undefined)
    })

    it('返回由 store 创建的 session 对象', () => {
      const session = makeMockSession()
      vi.mocked(mockStore.createSession).mockReturnValue(session)

      const result = manager.createAndStart('测试', '/workspace', 'hello')

      expect(result).toBe(session)
    })
  })

  // ── getSessionsByDirectory ──

  describe('getSessionsByDirectory', () => {
    it('只返回指定目录路径对应 agentId 的会话', () => {
      const dirPath = '/home/user/project-a'
      const agentIdA = deriveAgentId(dirPath)
      const agentIdB = deriveAgentId('/home/user/project-b')
      const sessions = [
        makeMockSession({ id: 's1', agentId: agentIdA }),
        makeMockSession({ id: 's2', agentId: agentIdB }),
        makeMockSession({ id: 's3', agentId: agentIdA })
      ]
      vi.mocked(mockStore.getSessions).mockReturnValue(sessions)

      const result = manager.getSessionsByDirectory(dirPath)

      expect(result).toHaveLength(2)
      expect(result.every((s) => s.agentId === agentIdA)).toBe(true)
    })

    it('无匹配时返回空数组', () => {
      vi.mocked(mockStore.getSessions).mockReturnValue([
        makeMockSession({ agentId: deriveAgentId('/some/path') })
      ])

      expect(manager.getSessionsByDirectory('/nonexistent')).toEqual([])
    })
  })

  // ── buildSessionKey（通过公开方法间接验证格式）──

  describe('buildSessionKey 格式', () => {
    it('格式为 agent:{agentId}:petclaw:{sessionId}', () => {
      const key = (
        manager as unknown as { buildSessionKey(a: string, b: string): string }
      ).buildSessionKey('main', 'sess-001')
      expect(key).toBe('agent:main:petclaw:sess-001')
    })

    it('非默认 agentId 的 key 格式正确', () => {
      const key = (
        manager as unknown as { buildSessionKey(a: string, b: string): string }
      ).buildSessionKey('agent-42', 'sess-999')
      expect(key).toBe('agent:agent-42:petclaw:sess-999')
    })
  })

  // ── 已有方法回归测试 ──

  describe('continueSession', () => {
    it('转发给 controller.continueSession', () => {
      manager.continueSession('sess-001', 'follow-up')
      expect(mockController.continueSession).toHaveBeenCalledWith('sess-001', 'follow-up')
    })
  })

  describe('stopSession', () => {
    it('转发给 controller.stopSession', () => {
      manager.stopSession('sess-001')
      expect(mockController.stopSession).toHaveBeenCalledWith('sess-001')
    })
  })

  describe('deleteSession', () => {
    it('活跃会话先 stop 再 delete', () => {
      vi.mocked(mockController.isSessionActive).mockReturnValue(true)
      manager.deleteSession('sess-001')
      expect(mockController.stopSession).toHaveBeenCalledWith('sess-001')
      expect(mockStore.deleteSession).toHaveBeenCalledWith('sess-001')
    })

    it('非活跃会话直接 delete', () => {
      vi.mocked(mockController.isSessionActive).mockReturnValue(false)
      manager.deleteSession('sess-001')
      expect(mockController.stopSession).not.toHaveBeenCalled()
      expect(mockStore.deleteSession).toHaveBeenCalledWith('sess-001')
    })
  })

  describe('getRecentDirectories', () => {
    it('转发给 store.getRecentDirectories', () => {
      vi.mocked(mockStore.getRecentDirectories).mockReturnValue(['/a', '/b'])
      expect(manager.getRecentDirectories(5)).toEqual(['/a', '/b'])
      expect(mockStore.getRecentDirectories).toHaveBeenCalledWith(5)
    })
  })
})
