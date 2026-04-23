import { describe, it, expect, beforeEach, vi } from 'vitest'

import { SessionManager } from '../../../src/main/ai/session-manager'
import type { CoworkStore } from '../../../src/main/ai/cowork-store'
import type { CoworkController } from '../../../src/main/ai/cowork-controller'
import type { AgentManager } from '../../../src/main/agents/agent-manager'
import type { CoworkSession } from '../../../src/main/ai/types'

// ── 测试辅助：构造 mock session ──
function makeMockSession(overrides?: Partial<CoworkSession>): CoworkSession {
  return {
    id: 'sess-001',
    title: '测试会话',
    claudeSessionId: null,
    status: 'idle',
    pinned: false,
    cwd: '/workspace',
    systemPrompt: '',
    modelOverride: '',
    executionMode: 'local',
    activeSkillIds: [],
    agentId: 'main',
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
    getRecentWorkingDirs: vi.fn()
  } as unknown as CoworkStore

  const mockController = {
    startSession: vi.fn(),
    continueSession: vi.fn(),
    stopSession: vi.fn(),
    isSessionActive: vi.fn()
  } as unknown as CoworkController

  // agentManager.get 返回 undefined 表示非 default agent，返回带 isDefault:true 的对象表示 main agent
  const mockAgentManager = {
    get: vi.fn()
  } as unknown as AgentManager

  return { mockStore, mockController, mockAgentManager }
}

describe('SessionManager', () => {
  const WORKSPACE = '/home/user/workspace'
  const STATE_DIR = '/home/user/.petclaw/state'

  let mockStore: CoworkStore
  let mockController: CoworkController
  let mockAgentManager: AgentManager
  let manager: SessionManager

  beforeEach(() => {
    const mocks = createMocks()
    mockStore = mocks.mockStore
    mockController = mocks.mockController
    mockAgentManager = mocks.mockAgentManager

    manager = new SessionManager(mockStore, mockController, mockAgentManager, WORKSPACE, STATE_DIR)
  })

  // ── createAndStart ──

  describe('createAndStart', () => {
    it('默认使用 main agentId 创建会话', () => {
      const session = makeMockSession({ agentId: 'main' })
      vi.mocked(mockStore.createSession).mockReturnValue(session)
      // main agent 是 default
      vi.mocked(mockAgentManager.get).mockReturnValue({
        id: 'main',
        isDefault: true
      } as ReturnType<AgentManager['get']>)

      manager.createAndStart('测试', '/cwd', 'hello')

      expect(mockStore.createSession).toHaveBeenCalledWith(
        '测试',
        '/cwd',
        undefined,
        undefined,
        undefined,
        'main'
      )
    })

    it('options.agentId 被传递给 store.createSession', () => {
      const session = makeMockSession({ agentId: 'agent-42' })
      vi.mocked(mockStore.createSession).mockReturnValue(session)
      vi.mocked(mockAgentManager.get).mockReturnValue(undefined)

      manager.createAndStart('测试', '/cwd', 'hello', { agentId: 'agent-42' })

      expect(mockStore.createSession).toHaveBeenCalledWith(
        '测试',
        '/cwd',
        undefined,
        undefined,
        undefined,
        'agent-42'
      )
    })

    it('default agent 使用 workspacePath 作为 workspaceRoot', () => {
      const session = makeMockSession({ agentId: 'main' })
      vi.mocked(mockStore.createSession).mockReturnValue(session)
      vi.mocked(mockAgentManager.get).mockReturnValue({
        id: 'main',
        isDefault: true
      } as ReturnType<AgentManager['get']>)

      manager.createAndStart('测试', '/cwd', 'hello', { agentId: 'main' })

      expect(mockController.startSession).toHaveBeenCalledWith(
        session.id,
        'hello',
        expect.objectContaining({ workspaceRoot: WORKSPACE })
      )
    })

    it('非 default agent 使用 stateDir/workspace-{agentId} 作为 workspaceRoot', () => {
      const session = makeMockSession({ agentId: 'agent-42' })
      vi.mocked(mockStore.createSession).mockReturnValue(session)
      // 返回 undefined 表示非 default agent（或 agent 不存在）
      vi.mocked(mockAgentManager.get).mockReturnValue(undefined)

      manager.createAndStart('测试', '/cwd', 'hello', { agentId: 'agent-42' })

      expect(mockController.startSession).toHaveBeenCalledWith(
        session.id,
        'hello',
        expect.objectContaining({ workspaceRoot: `${STATE_DIR}/workspace-agent-42` })
      )
    })

    it('返回由 store 创建的 session 对象', () => {
      const session = makeMockSession()
      vi.mocked(mockStore.createSession).mockReturnValue(session)
      vi.mocked(mockAgentManager.get).mockReturnValue({ id: 'main', isDefault: true } as ReturnType<
        AgentManager['get']
      >)

      const result = manager.createAndStart('测试', '/cwd', 'hello')

      expect(result).toBe(session)
    })
  })

  // ── getSessionsByAgent ──

  describe('getSessionsByAgent', () => {
    it('只返回指定 agentId 的会话', () => {
      const sessions = [
        makeMockSession({ id: 's1', agentId: 'main' }),
        makeMockSession({ id: 's2', agentId: 'agent-x' }),
        makeMockSession({ id: 's3', agentId: 'main' })
      ]
      vi.mocked(mockStore.getSessions).mockReturnValue(sessions)

      const result = manager.getSessionsByAgent('main')

      expect(result).toHaveLength(2)
      expect(result.every((s) => s.agentId === 'main')).toBe(true)
    })

    it('无匹配时返回空数组', () => {
      vi.mocked(mockStore.getSessions).mockReturnValue([makeMockSession({ agentId: 'main' })])

      expect(manager.getSessionsByAgent('nonexistent')).toEqual([])
    })
  })

  // ── buildSessionKey（通过公开方法间接验证格式）──

  describe('buildSessionKey 格式', () => {
    it('格式为 agent:{agentId}:petclaw:{sessionId}', () => {
      // buildSessionKey 是私有方法，通过暴露测试辅助或反射验证
      // 使用 any 转型访问私有方法
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

  describe('getRecentWorkingDirs', () => {
    it('转发给 store.getRecentWorkingDirs', () => {
      vi.mocked(mockStore.getRecentWorkingDirs).mockReturnValue(['/a', '/b'])
      expect(manager.getRecentWorkingDirs(5)).toEqual(['/a', '/b'])
      expect(mockStore.getRecentWorkingDirs).toHaveBeenCalledWith(5)
    })
  })
})
