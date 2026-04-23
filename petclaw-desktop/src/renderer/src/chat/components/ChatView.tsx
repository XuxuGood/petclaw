import { useState, useEffect, useRef } from 'react'
import { Send, PawPrint } from 'lucide-react'

import { useChatStore } from '../../stores/chat-store'

const SUGGESTED_PROMPTS = ['你是怎么实现的？', '现在什么模型？', '你有什么能力？']

interface ChatViewProps {
  activeSessionId?: string | null
  onSessionCreated?: (id: string) => void
  currentAgentId?: string
  taskMonitorOpen?: boolean
  onToggleMonitor?: () => void
}

export function ChatView(_props: ChatViewProps) {
  const [input, setInput] = useState('')
  const { messages, isLoading, addMessage, appendToLastMessage, setLoading, loadHistory } =
    useChatStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.loadHistory(50).then((history) => {
      loadHistory(
        history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      )
    })
  }, [loadHistory])

  useEffect(() => {
    const unsub1 = window.api.onAIResponding(() => {
      setLoading(true)
      addMessage({ role: 'assistant', content: '' })
    })
    const unsub2 = window.api.onChatChunk((chunk) => {
      appendToLastMessage(chunk)
    })
    const unsub3 = window.api.onChatDone(() => {
      setLoading(false)
    })
    const unsub4 = window.api.onChatError((error) => {
      appendToLastMessage(`\n[Error: ${error}]`)
      setLoading(false)
    })
    return () => {
      unsub1()
      unsub2()
      unsub3()
      unsub4()
    }
  }, [addMessage, appendToLastMessage, setLoading])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = (text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || isLoading) return
    addMessage({ role: 'user', content: msg })
    if (!text) {
      setInput('')
      if (inputRef.current) inputRef.current.style.height = 'auto'
    }
    window.api.sendChat(msg)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Drag region */}
      <div className="drag-region h-[52px] shrink-0" />

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <EmptyState onSend={handleSend} />
        ) : (
          <div className="px-6 py-2 space-y-5">
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
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-6 pb-4 pt-3">
        <div>
          <div className="flex items-end gap-2.5 bg-bg-input rounded-[16px] px-4 py-3 border border-border-input">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                const el = e.target
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 120) + 'px'
              }}
              onKeyDown={handleKeyDown}
              placeholder="输入消息..."
              className="flex-1 text-[14px] text-text-primary bg-transparent outline-none placeholder:text-text-tertiary resize-none leading-[1.5] min-h-[24px] max-h-[120px]"
              disabled={isLoading}
            />
            <button
              onClick={() => handleSend()}
              disabled={isLoading || !input.trim()}
              className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center shrink-0 hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-[120ms] ease active:scale-[0.96]"
              aria-label="发送消息"
            >
              <Send size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onSend }: { onSend: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6">
      <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center mb-5">
        <PawPrint size={26} className="text-white" strokeWidth={2} />
      </div>
      <h2 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">
        有什么可以帮你的？
      </h2>
      <p className="text-[13px] text-text-tertiary mb-8">我是 PetClaw AI 助手，随时为你服务</p>
      <div className="flex flex-wrap gap-2 justify-center max-w-md">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onSend(prompt)}
            className="px-4 py-2 rounded-[10px] bg-bg-card text-[13px] text-text-secondary shadow-[var(--shadow-card)] border border-border hover:border-text-tertiary hover:shadow-[var(--shadow-dropdown)] transition-all duration-[120ms] ease active:scale-[0.96]"
          >
            {prompt}
          </button>
        ))}
      </div>
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
