import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'

import { CoworkSessionManager } from '../../../src/main/ai/cowork-session-manager'
import type { CoworkStore } from '../../../src/main/data/cowork-store'
import type { CoworkController } from '../../../src/main/ai/cowork-controller'
import type { DirectoryManager } from '../../../src/main/ai/directory-manager'
import type { CoworkSession } from '../../../src/main/ai/types'
import { deriveAgentId } from '../../../src/main/ai/types'

// mock i18n，使 t() 返回中文模板插值结果
vi.mock('../../../src/main/i18n', () => ({
  t: (key: string, params?: Record<string, string>) => {
    const templates: Record<string, string> = {
      'error.dirNotFound': '工作目录不存在：{path}',
      'error.dirDeleted': '该会话的工作目录已不存在：{path}，请创建新会话选择新路径'
    }
    const tpl = templates[key]
    if (!tpl) return key
    return tpl.replace(/\{(\w+)\}/g, (_, k: string) => params?.[k] ?? '')
  }
}))

// ── 测试辅助：构造 mock session ──
function makeMockSession(overrides?: Partial<CoworkSession>): CoworkSession {
  return {
    id: 'sess-001',
    title: '测试会话',
    engineSessionId: null,
    status: 'idle',
    origin: 'chat',
    pinned: false,
    directoryPath: '/workspace',
    agentId: deriveAgentId('/workspace'),
    selectedModel: null,
    systemPrompt: '',
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
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
    getRecentDirectories: vi.fn()
  } as unknown as CoworkStore

  const mockController = {
    startSession: vi.fn().mockResolvedValue(undefined),
    continueSession: vi.fn().mockResolvedValue(undefined),
    stopSession: vi.fn(),
    isSessionActive: vi.fn(),
    onSessionDeleted: vi.fn()
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

    // 默认所有路径都存在，路径校验测试单独 mock
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)

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
      // 验证 store.createSession 固化 systemPrompt，默认空字符串，origin 默认 chat
      expect(mockStore.createSession).toHaveBeenCalledWith(
        '测试',
        cwd,
        expectedAgentId,
        '',
        undefined,
        'chat'
      )
    })

    it('main workspace fallback 使用固定 main agent 且不注册目录', () => {
      const cwd = '/user-data/openclaw/workspace'
      const session = makeMockSession({ directoryPath: cwd, agentId: 'main' })
      vi.mocked(mockStore.createSession).mockReturnValue(session)

      manager.createAndStart('测试', cwd, 'hello', { useMainAgent: true })

      expect(mockDirectoryManager.ensureRegistered).not.toHaveBeenCalled()
      expect(mockStore.createSession).toHaveBeenCalledWith(
        '测试',
        cwd,
        'main',
        '',
        undefined,
        'chat'
      )
    })

    it('创建会话时将 systemPrompt 固化到 store', () => {
      const cwd = '/workspace'
      const session = makeMockSession({ directoryPath: cwd })
      vi.mocked(mockStore.createSession).mockReturnValue(session)

      manager.createAndStart('测试', cwd, 'hello', { systemPrompt: 'fixed prompt' })

      expect(mockStore.createSession).toHaveBeenCalledWith(
        '测试',
        cwd,
        deriveAgentId(cwd),
        'fixed prompt',
        undefined,
        'chat'
      )
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

    it('工作目录不存在时抛出错误', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false)
      expect(() => manager.createAndStart('测试', '/nonexistent', 'hello')).toThrow(
        '工作目录不存在'
      )
    })

    it('传入 selectedModel 时创建会话即固化到 store', () => {
      const cwd = '/workspace'
      const session = makeMockSession({ directoryPath: cwd })
      vi.mocked(mockStore.createSession).mockReturnValue(session)

      manager.createAndStart('测试', cwd, 'hello', {
        selectedModel: { providerId: 'openai', modelId: 'gpt-4o' }
      })

      expect(mockStore.createSession).toHaveBeenCalledWith(
        '测试',
        cwd,
        deriveAgentId(cwd),
        '',
        {
          providerId: 'openai',
          modelId: 'gpt-4o'
        },
        'chat'
      )
    })

    it('未传 selectedModel 时不调用 updateSession', () => {
      const cwd = '/workspace'
      const session = makeMockSession({ directoryPath: cwd })
      vi.mocked(mockStore.createSession).mockReturnValue(session)

      manager.createAndStart('测试', cwd, 'hello')

      expect(mockStore.updateSession).not.toHaveBeenCalled()
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

  // ── 已有方法回归测试 ──

  describe('continueSession', () => {
    it('转发给 controller.continueSession', () => {
      vi.mocked(mockStore.getSession).mockReturnValue(makeMockSession())
      manager.continueSession('sess-001', 'follow-up', { systemPrompt: 'fixed prompt' })
      expect(mockController.continueSession).toHaveBeenCalledWith('sess-001', 'follow-up', {
        systemPrompt: 'fixed prompt'
      })
    })

    it('继续会话时转发本轮 skillIds 和 skillPrompt', () => {
      vi.mocked(mockStore.getSession).mockReturnValue(makeMockSession())
      manager.continueSession('sess-001', 'follow-up', {
        skillIds: ['docx'],
        skillPrompt: '## Skill: docx'
      })
      expect(mockController.continueSession).toHaveBeenCalledWith('sess-001', 'follow-up', {
        skillIds: ['docx'],
        skillPrompt: '## Skill: docx'
      })
    })

    it('继续会话时传入 selectedModel 会先更新 session', () => {
      vi.mocked(mockStore.getSession).mockReturnValue(makeMockSession())
      manager.continueSession('sess-001', 'follow-up', {
        selectedModel: { providerId: 'gemini', modelId: 'gemini-2.0-flash' }
      })

      expect(mockStore.updateSession).toHaveBeenCalledWith('sess-001', {
        selectedModel: { providerId: 'gemini', modelId: 'gemini-2.0-flash' }
      })
      expect(mockController.continueSession).toHaveBeenCalledWith('sess-001', 'follow-up', {
        selectedModel: { providerId: 'gemini', modelId: 'gemini-2.0-flash' }
      })
    })

    it('工作目录不存在时抛出错误', () => {
      vi.mocked(mockStore.getSession).mockReturnValue(makeMockSession({ directoryPath: '/gone' }))
      vi.spyOn(fs, 'existsSync').mockReturnValue(false)
      expect(() => manager.continueSession('sess-001', 'hello')).toThrow('工作目录已不存在')
    })
  })

  describe('stopSession', () => {
    it('转发给 controller.stopSession', () => {
      manager.stopSession('sess-001')
      expect(mockController.stopSession).toHaveBeenCalledWith('sess-001')
    })
  })

  describe('deleteSession', () => {
    it('活跃会话先 stop 再 delete 再清理 controller 状态', () => {
      vi.mocked(mockController.isSessionActive).mockReturnValue(true)
      manager.deleteSession('sess-001')
      expect(mockController.stopSession).toHaveBeenCalledWith('sess-001')
      expect(mockStore.deleteSession).toHaveBeenCalledWith('sess-001')
      expect(mockController.onSessionDeleted).toHaveBeenCalledWith('sess-001')
    })

    it('非活跃会话直接 delete 并清理 controller 状态', () => {
      vi.mocked(mockController.isSessionActive).mockReturnValue(false)
      manager.deleteSession('sess-001')
      expect(mockController.stopSession).not.toHaveBeenCalled()
      expect(mockStore.deleteSession).toHaveBeenCalledWith('sess-001')
      expect(mockController.onSessionDeleted).toHaveBeenCalledWith('sess-001')
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
