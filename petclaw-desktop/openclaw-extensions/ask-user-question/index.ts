// openclaw-extensions/ask-user-question/index.ts
// AskUserQuestion — OpenClaw 本地扩展
//
// 让 AI Agent 在执行危险操作（删除文件、git clean 等）前，向用户弹出结构化确认弹窗。
//
// 工作流程：
//   1. Agent 调用 AskUserQuestion tool，传入 questions 数组（每个问题 2-4 选项）
//   2. 本扩展将 questions 通过 HTTP POST 发送到 PetClaw 桌面端的 callbackUrl
//   3. PetClaw 在 Renderer 中展示 CoworkPermissionModal 审批弹窗
//   4. 用户选择后，PetClaw 返回 { behavior: 'allow'|'deny', answers }
//   5. 扩展将结果返回给 Agent，Agent 据此决定是否继续执行
//
// 安全机制：
//   - x-ask-user-secret 头：防止未授权的第三方调用 callbackUrl
//   - 120 秒超时：用户未响应自动 deny，避免 Agent 永久挂起
//   - session-key 过滤：仅 desktop 本地 session（agent:main:petclaw:*）注入此工具，
//     IM 频道 session 不注入（IM 场景下无法弹窗，Agent 直接执行命令）
//
// 配置来源：openclaw.json → plugins → ask-user-question → config
//   - callbackUrl: PetClaw HookServer 的审批端点（如 http://127.0.0.1:{port}/ask-user）
//   - secret: 随 Gateway 启动时生成的共享密钥

import { Type } from '@sinclair/typebox'
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'

// ── 类型定义 ────────────────────────────────────────────────────────────────────

type PluginConfig = {
  callbackUrl: string
  secret: string
}

type QuestionOption = {
  label: string
  description?: string
}

type Question = {
  question: string
  header?: string
  options: QuestionOption[]
  multiSelect?: boolean
}

type AskUserInput = {
  questions: Question[]
}

type AskUserResponse = {
  behavior: 'allow' | 'deny'
  answers?: Record<string, string>
}

// ── 常量 ────────────────────────────────────────────────────────────────────────

// 等待用户响应的超时时间，超时后自动 deny
const DEFAULT_TIMEOUT_MS = 120_000

// ── 工具函数 ────────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 从 unknown 配置中安全提取 callbackUrl 和 secret */
const parsePluginConfig = (value: unknown): PluginConfig => {
  const raw = isRecord(value) ? value : {}
  return {
    callbackUrl: typeof raw.callbackUrl === 'string' ? raw.callbackUrl.trim() : '',
    secret: typeof raw.secret === 'string' ? raw.secret.trim() : ''
  }
}

// ── TypeBox Schema ──────────────────────────────────────────────────────────────
// 定义 Agent 调用此 tool 时的参数结构，OpenClaw 会在调用前做 JSON Schema 校验

const QuestionOptionSchema = Type.Object({
  label: Type.String({ description: 'Display text for this option (1-5 words).' }),
  description: Type.Optional(Type.String({ description: 'Explanation of what this option means.' }))
})

const QuestionSchema = Type.Object({
  question: Type.String({
    description: 'The question to ask. Should be clear and end with a question mark.'
  }),
  header: Type.Optional(
    Type.String({
      description:
        'Short label displayed as a tag (max 12 chars). Examples: "Auth method", "Confirm".'
    })
  ),
  options: Type.Array(QuestionOptionSchema, {
    minItems: 2,
    maxItems: 4,
    description: 'Available choices (2-4 options).'
  }),
  multiSelect: Type.Optional(Type.Boolean({ description: 'Allow selecting multiple options.' }))
})

const AskUserQuestionSchema = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    maxItems: 4,
    description: 'Questions to ask the user (1-4 questions).'
  })
})

// ── 核心逻辑：向 PetClaw 发起 HTTP 回调 ────────────────────────────────────────

/**
 * 向 PetClaw callbackUrl 发送审批请求，等待用户响应。
 * 超时或网络错误时返回 deny（安全默认值）。
 */
async function askUser(config: PluginConfig, input: AskUserInput): Promise<AskUserResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(config.callbackUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ask-user-secret': config.secret
      },
      body: JSON.stringify(input),
      signal: controller.signal
    })

    const text = await response.text()

    if (!response.ok) {
      throw new Error(
        `AskUserQuestion callback HTTP ${response.status}: ${text.trim() || response.statusText}`
      )
    }

    // 空响应视为 deny（PetClaw 可能在弹窗关闭时返回空体）
    if (!text.trim()) {
      return { behavior: 'deny' }
    }

    const parsed = JSON.parse(text)
    return {
      behavior: parsed?.behavior === 'allow' ? 'allow' : 'deny',
      answers: isRecord(parsed?.answers) ? (parsed.answers as Record<string, string>) : undefined
    }
  } catch (error) {
    // 超时 → 自动 deny，不中断 Agent 执行流
    if (error instanceof Error && error.name === 'AbortError') {
      return { behavior: 'deny' }
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

// ── 插件定义 ────────────────────────────────────────────────────────────────────

const plugin = {
  id: 'ask-user-question',
  name: 'AskUserQuestion',
  description: 'Structured user confirmation tool for PetClaw desktop.',
  configSchema: {
    parse(value: unknown): PluginConfig {
      return parsePluginConfig(value)
    }
  },
  register(api: OpenClawPluginApi) {
    const config = parsePluginConfig(api.pluginConfig)
    if (!config.callbackUrl || !config.secret) {
      api.logger.info('[ask-user-question] skipped: callbackUrl or secret not configured.')
      return
    }

    // 工厂模式注册：registerTool 接收函数而非对象，OpenClaw 为每个 session 调用此函数
    // 返回 tool 对象 → 注入该 session；返回 null → 该 session 不可见此 tool
    api.registerTool((ctx) => {
      // 仅 PetClaw desktop 本地 session 注入此工具
      // IM 频道 session（dingtalk、qqbot、weixin、feishu 等）返回 null → tool 不可见
      // 这样 IM 场景下 Agent 会直接执行删除命令，不弹无意义的确认框
      const sessionKey = ctx.sessionKey ?? ''
      const isLocalDesktop = sessionKey.startsWith('agent:main:petclaw:')
      if (!isLocalDesktop) {
        return null
      }

      return {
        name: 'AskUserQuestion',
        label: 'Ask User Question',
        description: [
          'Ask the user a question with predefined options and wait for their response.',
          'Use this tool BEFORE executing any delete operation (rm, trash, rmdir, unlink, git clean).',
          'The user will see a confirmation dialog with the options you provide.',
          'Do NOT use this tool for non-delete commands.'
        ].join(' '),
        parameters: AskUserQuestionSchema,
        async execute(_id: string, params: unknown) {
          const input = params as AskUserInput
          if (!input?.questions?.length) {
            return {
              content: [{ type: 'text', text: 'No questions provided.' }],
              isError: true
            }
          }

          try {
            const response = await askUser(config, input)

            if (response.behavior === 'deny') {
              return {
                content: [{ type: 'text', text: 'User denied the operation.' }]
              }
            }

            // allow 时将用户的选择以 "问题: 答案" 格式返回给 Agent
            const answerLines = response.answers
              ? Object.entries(response.answers)
                  .map(([q, a]) => `${q}: ${a}`)
                  .join('\n')
              : 'User approved.'

            return {
              content: [{ type: 'text', text: answerLines }]
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return {
              content: [{ type: 'text', text: `AskUserQuestion failed: ${message}` }],
              isError: true
            }
          }
        }
      }
    })

    api.logger.info('[ask-user-question] registered AskUserQuestion tool factory.')
  }
}

export default plugin
