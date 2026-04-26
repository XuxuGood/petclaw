import { useState, useEffect, useRef } from 'react'
import { PawPrint } from 'lucide-react'

import { useChatStore } from '../../stores/chat-store'
import { ChatHeader } from './ChatHeader'
import { ChatInputBox } from './ChatInputBox'
import { CoworkPermissionModal } from './CoworkPermissionModal'
import { WelcomePage } from './WelcomePage'
import { TaskMonitorPanel } from './TaskMonitorPanel'

interface ChatViewProps {
  activeSessionId?: string | null
  onSessionCreated?: (id: string) => void
  currentDirectoryId?: string
  taskMonitorOpen?: boolean
  onToggleMonitor?: () => void
}

export function ChatView({
  activeSessionId,
  onSessionCreated,
  currentDirectoryId: _currentDirectoryId,
  taskMonitorOpen,
  onToggleMonitor
}: ChatViewProps) {
  const { messages, isLoading, addMessage, appendToLastMessage, setLoading } = useChatStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  // 会话标题（后续可从 session 数据中读取，此处先用默认值）
  const [sessionTitle, setSessionTitle] = useState('新对话')

  // 权限审批弹窗状态
  const [pendingPermission, setPendingPermission] = useState<{
    requestId: string
    toolName: string
    toolInput: Record<string, unknown>
    toolUseId?: string | null
  } | null>(null)

  // 订阅 v3 cowork 消息事件
  useEffect(() => {
    // 收到助手新消息块时追加到最后一条 assistant 消息
    const unsubMessage = window.api.cowork.onMessage((data) => {
      // data 结构: { sessionId, role, content, ... }
      const d = data as Record<string, unknown>
      if (d.role === 'assistant') {
        // 首次收到时表示新一轮响应开始
        setLoading(true)
        addMessage({ role: 'assistant', content: String(d.content ?? '') })
      }
    })

    // 流式 chunk 更新
    const unsubUpdate = window.api.cowork.onMessageUpdate((data) => {
      const d = data as Record<string, unknown>
      if (typeof d.delta === 'string') {
        appendToLastMessage(d.delta)
      }
    })

    // 任务完成
    const unsubComplete = window.api.cowork.onComplete(() => {
      setLoading(false)
    })

    // 错误
    const unsubError = window.api.cowork.onError((data) => {
      const d = data as Record<string, unknown>
      const msg = typeof d.message === 'string' ? d.message : '未知错误'
      appendToLastMessage(`\n[错误：${msg}]`)
      setLoading(false)
    })

    // 权限审批请求：主进程发来待审批工具调用，展示弹窗等待用户决策
    const unsubPermission = window.api.cowork.onPermission((data) => {
      const d = data as { sessionId: string; request: typeof pendingPermission }
      if (d.request) {
        setPendingPermission(d.request)
      }
    })

    return () => {
      unsubMessage()
      unsubUpdate()
      unsubComplete()
      unsubError()
      unsubPermission()
    }
  }, [addMessage, appendToLastMessage, setLoading])

  // 消息列表更新时自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  /**
   * 发送消息主逻辑：
   * - 无 activeSessionId 时调用 cowork.send 创建新会话，主进程返回 sessionId 后通知父组件
   * - 有 activeSessionId 时调用 cowork.continue 追加消息
   */
  const handleSend = async (message: string, cwd: string) => {
    if (!message || isLoading) return
    addMessage({ role: 'user', content: message })

    if (!activeSessionId) {
      // 新建会话
      const result = await window.api.cowork.send(message, cwd)
      const r = result as Record<string, unknown>
      // 主进程返回的 sessionId 通知父组件（Sidebar 侧边栏渲染任务列表）
      if (typeof r.sessionId === 'string') {
        onSessionCreated?.(r.sessionId)
        setSessionTitle(message.slice(0, 30) || '新对话')
      }
    } else {
      // 继续已有会话
      await window.api.cowork.continue(activeSessionId, message)
    }
  }

  /** WelcomePage 快捷卡片点击时直接发送，使用空 cwd */
  const handleSendFromWelcome = (text: string) => {
    handleSend(text, '')
  }

  return (
    // 外层横向布局：左侧主聊天区 + 右侧可选任务监控面板
    <div className="flex-1 flex min-h-0">
      {/* 主聊天区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeSessionId ? (
          <>
            {/* 有会话：顶栏 + 消息列表 + 输入框 */}
            <ChatHeader
              sessionTitle={sessionTitle}
              onToggleMonitor={onToggleMonitor ?? (() => {})}
              monitorOpen={taskMonitorOpen}
            />
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              <MessageList messages={messages} isLoading={isLoading} />
            </div>
            <ChatInputBox onSend={handleSend} disabled={isLoading} />
          </>
        ) : (
          <>
            {/* 无会话：拖拽占位 + 欢迎页 + 输入框 */}
            <div className="drag-region h-[52px] shrink-0" />
            <div ref={scrollRef} className="flex-1 overflow-y-auto flex flex-col">
              <WelcomePage onSendPrompt={handleSendFromWelcome} />
            </div>
            <ChatInputBox onSend={handleSend} disabled={isLoading} />
          </>
        )}
      </div>

      {/* 右侧任务监控面板：仅在 taskMonitorOpen 且有活跃会话时显示 */}
      {taskMonitorOpen && activeSessionId && <TaskMonitorPanel sessionId={activeSessionId} />}

      {/* 权限审批弹窗：AI 请求工具调用时需用户明确授权 */}
      {pendingPermission && (
        <CoworkPermissionModal
          permission={pendingPermission}
          onRespond={(result) => {
            window.api.cowork.respondPermission(pendingPermission.requestId, result)
            setPendingPermission(null)
          }}
        />
      )}
    </div>
  )
}

// ─── 内部子组件 ────────────────────────────────────────────────

interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
}

function MessageList({ messages, isLoading }: { messages: Message[]; isLoading: boolean }) {
  return (
    <div className="px-6 py-4 space-y-5">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
        >
          {msg.role === 'assistant' && (
            <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0 mt-0.5">
              <PawPrint size={13} className="text-white" strokeWidth={2.5} />
            </div>
          )}

          <div
            className={`max-w-[75%] px-4 py-2.5 text-[13.5px] leading-[1.65] ${
              msg.role === 'user'
                ? 'bg-bg-bubble-user text-text-bubble-user rounded-[14px] rounded-br-[6px]'
                : 'bg-bg-bubble-ai text-text-bubble-ai rounded-[14px] rounded-bl-[6px] shadow-[var(--shadow-card)]'
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
