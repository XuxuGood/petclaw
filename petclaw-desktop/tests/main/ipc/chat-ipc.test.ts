import { describe, it, expect, beforeEach, vi } from 'vitest'

import { registerChatIpcHandlers } from '../../../src/main/ipc/chat-ipc'
import type { CoworkSessionManager } from '../../../src/main/ai/cowork-session-manager'
import type { CoworkController } from '../../../src/main/ai/cowork-controller'
import type { CoworkConfigStore } from '../../../src/main/data/cowork-config-store'
import type { SkillManager } from '../../../src/main/skills/skill-manager'

vi.mock('../../../src/main/i18n', () => ({
  t: (key: string) => key
}))

// safeHandle 记录注册的 channel 和 handler，测试通过 registeredHandlers 取回
const registeredHandlers = new Map<string, (...args: never[]) => unknown>()

vi.mock('../../../src/main/ipc/ipc-registry', () => ({
  safeHandle: vi.fn((channel: string, handler: (...args: never[]) => unknown) => {
    registeredHandlers.set(channel, handler)
  }),
  safeOn: vi.fn()
}))

type ControllerListener = (...args: never[]) => void

function getHandler(channel: string) {
  const handler = registeredHandlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler
}

function createForwarderDeps() {
  const listeners = new Map<string, ControllerListener>()
  const coworkController = {
    on: vi.fn((event: string, listener: ControllerListener) => {
      listeners.set(event, listener)
      return coworkController
    })
  } as unknown as CoworkController
  const mainSend = vi.fn()
  const petSend = vi.fn()
  const mainWindow = {
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: { send: mainSend }
  }
  const petWindow = {
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: { send: petSend }
  }

  registerChatIpcHandlers({
    coworkSessionManager: {} as CoworkSessionManager,
    coworkController,
    coworkConfigStore: {
      getConfig: vi.fn(),
      setConfig: vi.fn()
    } as unknown as CoworkConfigStore,
    skillManager: { buildSelectedSkillPrompt: vi.fn() } as unknown as SkillManager,
    configSync: { sync: vi.fn() },
    getMainWindow: () => mainWindow as never,
    getPetWindow: () => petWindow as never
  })

  return { listeners, mainSend, petSend }
}

describe('registerChatIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredHandlers.clear()
  })

  it('starts session with selected skill prompt as turn-scoped prompt', async () => {
    const coworkSessionManager = {
      createAndStart: vi.fn().mockReturnValue({ id: 'session-1' })
    } as unknown as CoworkSessionManager
    const coworkController = {
      on: vi.fn()
    } as unknown as CoworkController
    const coworkConfigStore = {
      getConfig: vi.fn().mockReturnValue({
        defaultDirectory: '/workspace',
        systemPrompt: 'Base system prompt',
        memoryEnabled: true,
        skipMissedJobs: true
      }),
      hasDefaultDirectory: vi.fn().mockReturnValue(false)
    } as unknown as CoworkConfigStore
    const skillManager = {
      buildSelectedSkillPrompt: vi.fn().mockReturnValue('## Skill: web-search\nUse web search.')
    } as unknown as SkillManager

    registerChatIpcHandlers({
      coworkSessionManager,
      coworkController,
      coworkConfigStore,
      skillManager,
      configSync: { sync: vi.fn() },
      getMainWindow: () => null,
      getPetWindow: () => null
    })

    const handler = getHandler('cowork:session:start')
    await handler({} as never, {
      prompt: 'hello',
      cwd: '/workspace',
      skillIds: ['web-search'],
      selectedModel: { providerId: 'gemini', modelId: 'gemini-2.0-flash' }
    })

    expect(skillManager.buildSelectedSkillPrompt).toHaveBeenCalledWith(['web-search'])
    const options = vi.mocked(coworkSessionManager.createAndStart).mock.calls[0][3]
    expect(options?.systemPrompt).toContain('## Scheduled Tasks')
    expect(options?.systemPrompt).toContain('Base system prompt')
    expect(options?.systemPrompt).not.toContain('## Skill: web-search')
    expect(options?.skillPrompt).toContain('## Skill: web-search')
    expect(options?.skillPrompt).toContain('Use web search.')
    expect(options?.skillIds).toEqual(['web-search'])
    expect(options?.selectedModel).toEqual({
      providerId: 'gemini',
      modelId: 'gemini-2.0-flash'
    })
  })

  it('continues session with selected skill prompt as turn-scoped prompt', async () => {
    const coworkSessionManager = {
      getSession: vi.fn().mockReturnValue({ systemPrompt: 'Stored base prompt' }),
      continueSession: vi.fn()
    } as unknown as CoworkSessionManager
    const coworkController = {
      on: vi.fn()
    } as unknown as CoworkController
    const coworkConfigStore = {
      getConfig: vi.fn(),
      setConfig: vi.fn()
    } as unknown as CoworkConfigStore
    const skillManager = {
      buildSelectedSkillPrompt: vi.fn().mockReturnValue('## Skill: docx\nUse docx.')
    } as unknown as SkillManager

    registerChatIpcHandlers({
      coworkSessionManager,
      coworkController,
      coworkConfigStore,
      skillManager,
      configSync: { sync: vi.fn() },
      getMainWindow: () => null,
      getPetWindow: () => null
    })

    const handler = getHandler('cowork:session:continue')
    await handler({} as never, {
      sessionId: 'session-1',
      prompt: 'continue',
      skillIds: ['docx']
    })

    expect(skillManager.buildSelectedSkillPrompt).toHaveBeenCalledWith(['docx'])
    expect(coworkSessionManager.continueSession).toHaveBeenCalledWith('session-1', 'continue', {
      systemPrompt: 'Stored base prompt',
      skillPrompt: '## Skill: docx\nUse docx.',
      skillIds: ['docx'],
      selectedModel: undefined
    })
  })

  it('syncs openclaw config after cowork config changes', async () => {
    const coworkConfigStore = {
      getConfig: vi.fn(),
      setConfig: vi.fn().mockReturnValue({
        defaultDirectory: '/workspace',
        systemPrompt: 'updated',
        memoryEnabled: true,
        skipMissedJobs: true
      })
    } as unknown as CoworkConfigStore
    const configSync = {
      sync: vi.fn().mockReturnValue({ ok: true, changed: true, configPath: '/tmp/openclaw.json' })
    }

    registerChatIpcHandlers({
      coworkSessionManager: {} as CoworkSessionManager,
      coworkController: { on: vi.fn() } as unknown as CoworkController,
      coworkConfigStore,
      skillManager: { buildSelectedSkillPrompt: vi.fn() } as unknown as SkillManager,
      configSync,
      getMainWindow: () => null,
      getPetWindow: () => null
    })

    const handler = getHandler('cowork:config:set')
    const result = await handler({} as never, { systemPrompt: 'updated' })

    expect(coworkConfigStore.setConfig).toHaveBeenCalledWith({ systemPrompt: 'updated' })
    expect(configSync.sync).toHaveBeenCalledWith('cowork-config-change')
    expect(result).toEqual({
      defaultDirectory: '/workspace',
      systemPrompt: 'updated',
      memoryEnabled: true,
      skipMissedJobs: true
    })
  })

  it('forwards complete with engineSessionId to available windows', () => {
    const { listeners, mainSend, petSend } = createForwarderDeps()

    listeners.get('complete')?.('session-1' as never, 'run-1' as never)

    expect(mainSend).toHaveBeenCalledWith('cowork:stream:complete', {
      sessionId: 'session-1',
      engineSessionId: 'run-1'
    })
    expect(petSend).toHaveBeenCalledWith('cowork:stream:complete', {
      sessionId: 'session-1',
      engineSessionId: 'run-1'
    })
  })

  it('forwards permission dismiss events', () => {
    const { listeners, mainSend } = createForwarderDeps()

    listeners.get('permissionDismiss')?.('approval-1' as never)

    expect(mainSend).toHaveBeenCalledWith('cowork:stream:permission-dismiss', {
      requestId: 'approval-1'
    })
  })

  it('forwards session stopped events', () => {
    const { listeners, mainSend } = createForwarderDeps()

    listeners.get('sessionStopped')?.('session-1' as never)

    expect(mainSend).toHaveBeenCalledWith('cowork:stream:session-stopped', {
      sessionId: 'session-1'
    })
  })
})
