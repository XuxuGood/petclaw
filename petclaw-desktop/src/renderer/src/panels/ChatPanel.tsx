import { useState, useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chat-store'

export function ChatPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [input, setInput] = useState('')
  const { messages, isLoading, addMessage, appendToLastMessage, setLoading, loadHistory } =
    useChatStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load history on mount
  useEffect(() => {
    window.api.loadHistory(50).then((history) => {
      loadHistory(
        history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      )
    })
  }, [loadHistory])

  // Subscribe to streaming events
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

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const handleSend = () => {
    const text = input.trim()
    if (!text || isLoading) return
    addMessage({ role: 'user', content: text })
    setInput('')
    window.api.sendChat(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-80 h-96 bg-white/95 backdrop-blur-md rounded-t-2xl shadow-2xl flex flex-col border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">PetClaw Chat</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {messages.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-8">说点什么吧 🐱</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-primary text-white rounded-br-md'
                  : 'bg-gray-100 text-gray-800 rounded-bl-md'
              }`}
            >
              {msg.content || (isLoading && i === messages.length - 1 ? '...' : '')}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            className="flex-1 px-3 py-2 rounded-full bg-gray-100 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-primary text-white rounded-full text-sm hover:bg-primary-hover disabled:opacity-50"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
