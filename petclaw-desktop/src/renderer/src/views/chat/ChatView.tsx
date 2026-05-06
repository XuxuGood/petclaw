import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Calendar,
  Check,
  Clock,
  Edit3,
  FileText,
  FolderOpen,
  Image,
  Paperclip,
  PawPrint,
  Search
} from 'lucide-react'

import { useChatStore } from '../../stores/chat-store'
import { i18nService, useI18n } from '../../i18n'
import { ChatInputBox } from './ChatInputBox'
import type { SelectedModel } from '../../components/ModelSelector'
import { WelcomePage, type WelcomeSuggestionCategory } from '../../components/WelcomePage'

interface ChatImageAttachment {
  name: string
  mimeType: string
  base64Data: string
}

// 路径引用（文件或目录的绝对路径）：不预读内容，仅把路径注入本轮 prompt，由 AI 按需调用 Read/Glob 抓取
export interface ChatPathReference {
  path: string
  kind: 'file' | 'directory'
}

interface ChatViewProps {
  activeSessionId?: string | null
  onSessionCreated?: (id: string) => void
  currentDirectoryId?: string
  draftResetSignal?: number
}

interface WelcomeSuggestion {
  id: string
  icon: typeof FileText
  text: string
}

function getWelcomeSuggestions(
  category: WelcomeSuggestionCategory | null,
  t: (key: string) => string
): WelcomeSuggestion[] {
  if (!category) return []
  const suggestionsByCategory: Record<
    WelcomeSuggestionCategory,
    Array<{ key: string; icon: typeof FileText }>
  > = {
    fileOrganize: [
      { key: 'welcome.suggestion.fileOrganize.duplicateDownloads', icon: Search },
      { key: 'welcome.suggestion.fileOrganize.sortDesktop', icon: FolderOpen },
      { key: 'welcome.suggestion.fileOrganize.renamePhotos', icon: Image }
    ],
    contentCreation: [
      { key: 'welcome.suggestion.contentCreation.brandGuide', icon: Paperclip },
      { key: 'welcome.suggestion.contentCreation.meetingSubtitles', icon: Clock },
      { key: 'welcome.suggestion.contentCreation.refractionLesson', icon: Edit3 }
    ],
    docProcess: [
      { key: 'welcome.suggestion.docProcess.weeklyMeetings', icon: Check },
      { key: 'welcome.suggestion.docProcess.paperReferences', icon: FileText },
      { key: 'welcome.suggestion.docProcess.formatProposals', icon: Calendar }
    ]
  }
  return suggestionsByCategory[category].map(({ key, icon }) => ({
    id: key,
    icon,
    text: t(key)
  }))
}

export function ChatView({
  activeSessionId,
  onSessionCreated,
  currentDirectoryId: _currentDirectoryId,
  draftResetSignal = 0
}: ChatViewProps) {
  const {
    messages,
    isLoading,
    isHistoryLoading,
    historyLoadError,
    addMessage,
    replaceLastAssistantMessage,
    setLoading,
    beginHistoryLoad,
    loadHistory,
    failHistoryLoad,
    setActiveSession,
    bindDraftToSession
  } = useChatStore()
  const { t } = useI18n()
  const [welcomeCategory, setWelcomeCategory] = useState<WelcomeSuggestionCategory | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadRequestIdRef = useRef(0)
  const welcomeSuggestions = getWelcomeSuggestions(welcomeCategory, t)

  useEffect(() => {
    setActiveSession(activeSessionId ?? null)
    setWelcomeCategory(null)
    if (!activeSessionId) return

    let cancelled = false
    const requestId = ++loadRequestIdRef.current
    beginHistoryLoad(activeSessionId)
    window.api.cowork
      .getSession(activeSessionId)
      .then((raw) => {
        if (cancelled || requestId !== loadRequestIdRef.current) return
        if (!raw || typeof raw !== 'object') {
          failHistoryLoad(activeSessionId, i18nService.t('chat.unknownError'))
          return
        }
        const maybeMessages = (raw as Record<string, unknown>).messages
        if (!Array.isArray(maybeMessages)) {
          failHistoryLoad(activeSessionId, i18nService.t('chat.unknownError'))
          return
        }
        loadHistory(parseDisplayMessages(maybeMessages), activeSessionId)
      })
      .catch(() => {
        if (!cancelled && requestId === loadRequestIdRef.current) {
          failHistoryLoad(activeSessionId, i18nService.t('chat.unknownError'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeSessionId, beginHistoryLoad, failHistoryLoad, loadHistory, setActiveSession])

  useEffect(() => {
    setWelcomeCategory(null)
  }, [draftResetSignal])

  useEffect(() => {
    if (activeSessionId || messages.length > 0) setWelcomeCategory(null)
  }, [activeSessionId, messages.length])

  // 订阅协作消息事件
  useEffect(() => {
    // 收到助手新消息块时追加到最后一条 assistant 消息
    const unsubMessage = window.api.cowork.onMessage((data) => {
      const d = data as Record<string, unknown>
      const sessionId = typeof d.sessionId === 'string' ? d.sessionId : null
      if (!sessionId) return
      const message = d.message as Record<string, unknown> | undefined
      if (message?.type === 'assistant') {
        const sourceId = typeof message.id === 'string' ? message.id : undefined
        // 首次收到时表示新一轮响应开始
        setLoading(true, sessionId)
        addMessage(
          { role: 'assistant', content: String(message.content ?? ''), sourceId },
          sessionId
        )
      }
    })

    // 主进程发送的是当前消息快照 content，不是 delta，因此这里替换最后一条 assistant 内容
    const unsubUpdate = window.api.cowork.onMessageUpdate((data) => {
      const d = data as Record<string, unknown>
      const sessionId = typeof d.sessionId === 'string' ? d.sessionId : null
      const messageId = typeof d.messageId === 'string' ? d.messageId : null
      if (sessionId && typeof d.content === 'string') {
        replaceLastAssistantMessage(d.content, sessionId, messageId)
      }
    })

    // 任务完成
    const unsubComplete = window.api.cowork.onComplete((data) => {
      const d = data as Record<string, unknown>
      const sessionId = typeof d.sessionId === 'string' ? d.sessionId : null
      if (sessionId) setLoading(false, sessionId)
    })

    // 错误
    const unsubError = window.api.cowork.onError((data) => {
      const d = data as Record<string, unknown>
      const sessionId = typeof d.sessionId === 'string' ? d.sessionId : null
      const msg = typeof d.error === 'string' ? d.error : i18nService.t('chat.unknownError')
      addMessage(
        { role: 'assistant', content: i18nService.t('chat.errorPrefix', { msg }) },
        sessionId
      )
      setLoading(false, sessionId)
    })

    const unsubSessionStopped = window.api.cowork.onSessionStopped((data) => {
      const d = data as Record<string, unknown>
      const sessionId = typeof d.sessionId === 'string' ? d.sessionId : null
      if (sessionId) setLoading(false, sessionId)
    })

    return () => {
      unsubMessage()
      unsubUpdate()
      unsubComplete()
      unsubError()
      unsubSessionStopped()
    }
  }, [addMessage, replaceLastAssistantMessage, setLoading])

  // 消息列表更新时自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  /**
   * 发送消息主逻辑：
   * - 无 activeSessionId 时调用 cowork.startSession 创建新会话，主进程返回 sessionId 后通知父组件
   * - 有 activeSessionId 时调用 cowork.continueSession 追加消息
   */
  const handleSend = useCallback(
    async (
      message: string,
      cwd: string,
      skillIds?: string[],
      selectedModel?: SelectedModel | null,
      imageAttachments?: ChatImageAttachment[],
      pathReferences?: ChatPathReference[]
    ) => {
      if (!message || isLoading) return
      addMessage({ role: 'user', content: message }, activeSessionId ?? null)
      setLoading(true, activeSessionId ?? null)

      try {
        if (!activeSessionId) {
          // 新建会话：主进程可能因未配置工作目录返回结构化错误，前端负责显式展示。
          const result = await window.api.cowork.startSession({
            prompt: message,
            cwd,
            imageAttachments,
            pathReferences,
            skillIds,
            selectedModel: selectedModel ?? undefined
          })
          const r = result as Record<string, unknown>
          if (r.success === false) {
            const msg = typeof r.error === 'string' ? r.error : t('chat.unknownError')
            addMessage({ role: 'assistant', content: t('chat.errorPrefix', { msg }) }, null)
            setLoading(false, null)
            return
          }
          // 主进程返回的 sessionId 通知父组件（Sidebar 侧边栏渲染任务列表）
          if (typeof r.sessionId === 'string') {
            bindDraftToSession(r.sessionId)
            onSessionCreated?.(r.sessionId)
          }
        } else {
          // 继续已有会话
          await window.api.cowork.continueSession({
            sessionId: activeSessionId,
            prompt: message,
            imageAttachments,
            pathReferences,
            skillIds,
            selectedModel: selectedModel ?? undefined
          })
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : t('chat.unknownError')
        addMessage(
          { role: 'assistant', content: t('chat.errorPrefix', { msg }) },
          activeSessionId ?? null
        )
        setLoading(false, activeSessionId ?? null)
      }
    },
    [activeSessionId, addMessage, bindDraftToSession, isLoading, onSessionCreated, setLoading, t]
  )

  return (
    <div className="flex-1 flex min-h-0 flex-col">
      {activeSessionId || messages.length > 0 ? (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {isHistoryLoading && messages.length === 0 ? (
              <SessionHistoryState text={t('common.loading')} />
            ) : historyLoadError && messages.length === 0 ? (
              <SessionHistoryState text={historyLoadError} />
            ) : (
              <MessageList messages={messages} isLoading={isLoading} />
            )}
          </div>
          <ChatInputBox
            key={`session-${activeSessionId ?? 'draft'}`}
            onSend={handleSend}
            disabled={isLoading}
          />
        </>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto flex flex-col">
            <WelcomePage selectedCategory={welcomeCategory} onSelectCategory={setWelcomeCategory} />
          </div>
          <ChatInputBox
            key={`draft-${draftResetSignal}`}
            onSend={handleSend}
            disabled={isLoading}
            promptSuggestions={welcomeSuggestions}
          />
        </>
      )}
    </div>
  )
}

// ─── 内部子组件 ────────────────────────────────────────────────

function parseDisplayMessages(rawMessages: unknown[]): Array<Omit<Message, 'id'>> {
  return rawMessages.flatMap((item): Array<Omit<Message, 'id'>> => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (record.type !== 'user' && record.type !== 'assistant') return []
    return [
      {
        sourceId: typeof record.id === 'string' ? record.id : undefined,
        role: record.type,
        content: typeof record.content === 'string' ? record.content : ''
      }
    ]
  })
}

interface Message {
  id: number
  sourceId?: string
  role: 'user' | 'assistant'
  content: string
}

function SessionHistoryState({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-[var(--space-page-x)] py-[var(--space-page-y)]">
      <div className="rounded-[12px] border border-border bg-bg-surface px-4 py-3 text-[13px] text-text-secondary shadow-[var(--shadow-card)]">
        {text}
      </div>
    </div>
  )
}

function MessageList({ messages, isLoading }: { messages: Message[]; isLoading: boolean }) {
  return (
    <div className="w-full space-y-5 px-[var(--space-page-x)] py-[var(--space-page-y)]">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
        >
          {msg.role === 'assistant' && (
            <div className="w-7 h-7 rounded-full border border-border bg-white/80 flex items-center justify-center shrink-0 mt-0.5 shadow-[var(--shadow-card)]">
              <PawPrint size={13} className="text-text-secondary" strokeWidth={2.2} />
            </div>
          )}

          <div
            className={`max-w-[75%] px-4 py-2.5 text-[13.5px] leading-[1.65] ${
              msg.role === 'user'
                ? 'message-bubble-user bg-bg-bubble-user text-text-bubble-user rounded-[12px] rounded-br-[6px]'
                : 'message-bubble-ai bg-bg-bubble-ai text-text-bubble-ai rounded-[12px] rounded-bl-[6px] shadow-[var(--shadow-card)]'
            }`}
          >
            {msg.content ? (
              <pre className="message-prose">{msg.content}</pre>
            ) : isLoading ? (
              <TypingIndicator />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1 px-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary typing-dot" />
      <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary typing-dot" />
      <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary typing-dot" />
    </div>
  )
}
