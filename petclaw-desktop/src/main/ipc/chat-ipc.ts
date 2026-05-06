import { type BrowserWindow } from 'electron'

import { safeHandle } from './ipc-registry'
import type { CoworkSessionManager } from '../ai/cowork-session-manager'
import type { CoworkController } from '../ai/cowork-controller'
import type { ImageAttachment, PathReference, PermissionResult, SelectedModel } from '../ai/types'
import type { CoworkConfigStore, CoworkConfigUpdate } from '../data/cowork-config-store'
import type { SkillManager } from '../skills/skill-manager'
import type { ConfigSync, ConfigSyncResult } from '../ai/config-sync'
import type { McpBridgeServer, AskUserResponse } from '../mcp/mcp-bridge-server'
import { mergeCoworkSystemPrompt } from '../ai/system-prompt'
import { t } from '../i18n'
import { getLogger } from '../logging/facade'

type ConfigSynchronizer = Pick<ConfigSync, 'sync'>

const logger = getLogger('ChatIPC')

export interface ChatIpcDeps {
  coworkSessionManager: CoworkSessionManager
  coworkController: CoworkController
  coworkConfigStore: CoworkConfigStore
  skillManager: SkillManager
  configSync: ConfigSynchronizer
  mcpBridgeServer?: McpBridgeServer
  getMainWindow: () => BrowserWindow | null
  getPetWindow: () => BrowserWindow | null
}

export function registerChatIpcHandlers(deps: ChatIpcDeps): void {
  const {
    coworkSessionManager,
    coworkController,
    coworkConfigStore,
    skillManager,
    configSync,
    mcpBridgeServer,
    getMainWindow,
    getPetWindow
  } = deps

  const sendCoworkStream = (channel: string, payload: unknown): void => {
    const windows = [getMainWindow(), getPetWindow()].filter(
      (win): win is BrowserWindow => Boolean(win) && !win!.isDestroyed()
    )
    const sent = new Set<BrowserWindow>()
    for (const win of windows) {
      if (sent.has(win)) continue
      sent.add(win)
      win.webContents.send(channel, payload)
    }
  }

  safeHandle('cowork:config:get', async () => {
    return coworkConfigStore.getConfig()
  })

  safeHandle('cowork:config:set', async (_event, patch: CoworkConfigUpdate) => {
    const config = coworkConfigStore.setConfig(patch)
    const syncResult: ConfigSyncResult = configSync.sync('cowork-config-change')
    if (!syncResult.ok) {
      logger.warn('configSync.afterCoworkConfigUpdate.failed', {}, syncResult.error)
    }
    return config
  })

  // IPC channel 统一命名规范：cowork:session:*
  safeHandle(
    'cowork:session:start',
    async (
      _event,
      options: {
        prompt: string
        cwd?: string
        systemPrompt?: string
        imageAttachments?: ImageAttachment[]
        pathReferences?: PathReference[]
        skillIds?: string[]
        selectedModel?: SelectedModel
      }
    ) => {
      const config = coworkConfigStore.getConfig()
      const hasExplicitCwd = typeof options.cwd === 'string' && options.cwd.trim().length > 0
      const hasConfiguredDefaultDirectory = coworkConfigStore.hasDefaultDirectory()
      const cwd = hasExplicitCwd ? options.cwd!.trim() : config.defaultDirectory.trim()
      if (!cwd) {
        return { success: false, error: t('error.dirRequired') }
      }
      const skillPrompt = skillManager.buildSelectedSkillPrompt(options.skillIds ?? [])
      const systemPrompt = mergeCoworkSystemPrompt({
        userPrompt: options.systemPrompt ?? config.systemPrompt
      })
      // Title：取 prompt 第一行前 50 字符，空则 fallback
      const title = options.prompt.split('\n')[0].slice(0, 50) || 'New Session'
      return coworkSessionManager.createAndStart(title, cwd, options.prompt, {
        autoApprove: false,
        confirmationMode: 'modal',
        systemPrompt,
        skillPrompt,
        imageAttachments: options.imageAttachments,
        pathReferences: options.pathReferences,
        skillIds: options.skillIds,
        selectedModel: options.selectedModel,
        useMainAgent: !hasExplicitCwd && !hasConfiguredDefaultDirectory,
        origin: 'chat'
      })
    }
  )

  safeHandle(
    'cowork:session:continue',
    async (
      _event,
      options: {
        sessionId: string
        prompt: string
        systemPrompt?: string
        imageAttachments?: ImageAttachment[]
        pathReferences?: PathReference[]
        skillIds?: string[]
        selectedModel?: SelectedModel
      }
    ) => {
      const session = coworkSessionManager.getSession(options.sessionId)
      const skillPrompt = skillManager.buildSelectedSkillPrompt(options.skillIds ?? [])
      const systemPrompt =
        options.systemPrompt !== undefined
          ? mergeCoworkSystemPrompt({
              userPrompt: options.systemPrompt
            })
          : (session?.systemPrompt ?? '')
      coworkSessionManager.continueSession(options.sessionId, options.prompt, {
        systemPrompt,
        skillPrompt,
        imageAttachments: options.imageAttachments,
        pathReferences: options.pathReferences,
        skillIds: options.skillIds,
        selectedModel: options.selectedModel
      })
    }
  )

  safeHandle('cowork:session:stop', async (_event, sessionId: string) => {
    coworkSessionManager.stopSession(sessionId)
  })

  safeHandle('cowork:session:list', async () => {
    return coworkSessionManager.getSessions()
  })

  safeHandle('cowork:session:get', async (_event, id: string) => {
    return coworkSessionManager.getSession(id)
  })

  safeHandle('cowork:session:delete', async (_event, id: string) => {
    coworkSessionManager.deleteSession(id)
  })

  // Dual-dispatch 模式：权限响应通过同一个 IPC channel 到达，
  // 但可能针对两个独立子系统：
  // - resolveAskUser()：处理 ask-user-question 扩展通过 McpBridgeServer HTTP 回调发来的请求，
  //   requestId 不匹配时为 no-op
  // - respondToPermission()：处理标准 OpenClaw SDK 权限请求，
  //   requestId 不匹配时为 no-op
  // 两者都可以无条件调用，恰好只有一个会匹配
  safeHandle(
    'cowork:permission:respond',
    async (_event, requestId: string, result: PermissionResult) => {
      // AskUser 响应：转发到 McpBridgeServer 解除挂起的 HTTP 请求
      if (mcpBridgeServer && requestId) {
        const askUserResponse: AskUserResponse = {
          behavior: result.behavior === 'allow' ? 'allow' : 'deny',
          answers:
            result.behavior === 'allow' &&
            result.updatedInput &&
            typeof result.updatedInput === 'object'
              ? ((result.updatedInput as Record<string, unknown>).answers as
                  | Record<string, string>
                  | undefined)
              : undefined
        }
        mcpBridgeServer.resolveAskUser(requestId, askUserResponse)
      }

      // 标准 SDK 权限请求：转发到 CoworkController
      coworkController.respondToPermission(requestId, result)
    }
  )

  coworkController.on('message', (sessionId: string, msg: unknown) => {
    sendCoworkStream('cowork:stream:message', { sessionId, message: msg })
  })

  coworkController.on('messageUpdate', (sessionId: string, msgId: string, content: string) => {
    sendCoworkStream('cowork:stream:message-update', {
      sessionId,
      messageId: msgId,
      content
    })
  })

  coworkController.on('permissionRequest', (sessionId: string, req: unknown) => {
    sendCoworkStream('cowork:stream:permission', { sessionId, request: req })
  })

  coworkController.on('permissionDismiss', (requestId: string) => {
    sendCoworkStream('cowork:stream:permission-dismiss', { requestId })
  })

  coworkController.on('complete', (sessionId: string, engineSessionId: string | null) => {
    sendCoworkStream('cowork:stream:complete', { sessionId, engineSessionId })
  })

  coworkController.on('error', (sessionId: string, error: string) => {
    sendCoworkStream('cowork:stream:error', { sessionId, error })
  })

  coworkController.on('sessionStopped', (sessionId: string) => {
    sendCoworkStream('cowork:stream:session-stopped', { sessionId })
  })
}
