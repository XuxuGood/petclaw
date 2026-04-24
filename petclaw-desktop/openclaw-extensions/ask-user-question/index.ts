// 让 Agent 在执行危险操作前弹出结构化确认弹窗
// 通过 HTTP POST 回调 App（callbackUrl），携带 x-ask-user-secret 头
// App 在 Renderer 显示审批弹窗，用户选择后返回 { behavior: 'allow'|'deny', answers }
// 120s 超时自动 deny

export interface AskUserQuestionConfig {
  callbackUrl: string
  secret: string
  requestTimeoutMs?: number
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionInput {
  questions: Array<{
    question: string
    header: string
    options: QuestionOption[]
    multiSelect?: boolean
  }>
}

// 插件入口由 Openclaw plugin-sdk 约定
// 实际实现依赖 plugin-sdk 类型，此处仅提供骨架
// 完整实现参考 LobsterAI openclaw-extensions/ask-user-question/
export function register(_sdk: unknown): void {
  // _sdk.registerTool('AskUserQuestion', { ... })
  // tool handler:
  //   1. 构建 HTTP POST body: { requestId, questions }
  //   2. fetch(config.callbackUrl, { method: 'POST', headers: { 'x-ask-user-secret': config.secret }, body })
  //   3. 等待响应或 120s 超时
  //   4. 返回 { behavior, answers }
  console.warn('[ask-user-question] Extension registered (skeleton)')
}
