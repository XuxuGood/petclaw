import { useState, useEffect, useRef } from 'react'
import { Server, X, Loader2 } from 'lucide-react'

interface McpServer {
  id: string
  name: string
  enabled: boolean
}

interface ConnectorPopupProps {
  open: boolean
  onClose: () => void
}

/**
 * MCP 服务器快捷开关弹窗。
 * 通过 window.api.mcp.list() 加载服务器列表，每行提供一个开关。
 * 浮层模式，点击遮罩或 × 关闭。
 */
export function ConnectorPopup({ open, onClose }: ConnectorPopupProps) {
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 每次打开时重新加载服务器列表
  useEffect(() => {
    if (!open) return
    setLoading(true)
    window.api.mcp
      .list()
      .then((raw) => {
        if (!Array.isArray(raw)) return
        setServers(raw as McpServer[])
      })
      .finally(() => setLoading(false))
  }, [open])

  // 点击弹窗外部区域关闭
  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open, onClose])

  // Escape 键关闭
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const handleToggle = async (server: McpServer) => {
    // 乐观更新：先翻转本地状态，再调用 IPC
    const newEnabled = !server.enabled
    setToggling(server.id)
    setServers((prev) => prev.map((s) => (s.id === server.id ? { ...s, enabled: newEnabled } : s)))
    try {
      await window.api.mcp.setEnabled(server.id, newEnabled)
    } catch {
      // 失败则回滚
      setServers((prev) =>
        prev.map((s) => (s.id === server.id ? { ...s, enabled: server.enabled } : s))
      )
    } finally {
      setToggling(null)
    }
  }

  return (
    // 全屏遮罩（透明，用于点击外部关闭）
    <div className="fixed inset-0 z-50 flex items-end justify-start pointer-events-none">
      {/* 弹窗本体，右下角定位留给调用方通过 className/style 覆盖 */}
      <div
        ref={panelRef}
        className="pointer-events-auto mb-[72px] ml-4 w-[260px] bg-bg-card rounded-[14px] shadow-[var(--shadow-dropdown)] border border-border overflow-hidden"
      >
        {/* 顶栏 */}
        <div className="flex items-center gap-2 px-3.5 py-3 border-b border-border">
          <Server size={14} strokeWidth={2} className="text-accent shrink-0" />
          <span className="flex-1 text-[13px] font-semibold text-text-primary">MCP 服务器</span>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-[10px] text-text-tertiary hover:text-text-secondary hover:bg-bg-input transition-all duration-[120ms] ease active:scale-[0.96]"
            aria-label="关闭"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>

        {/* 服务器列表 */}
        <div className="max-h-[240px] overflow-y-auto py-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-text-tertiary">
              <Loader2 size={14} strokeWidth={2} className="animate-spin" />
              <span className="text-[12.5px]">加载中…</span>
            </div>
          ) : servers.length === 0 ? (
            <div className="py-6 text-center text-[12.5px] text-text-tertiary">
              暂未配置 MCP 服务器
            </div>
          ) : (
            servers.map((server) => (
              <ServerRow
                key={server.id}
                server={server}
                toggling={toggling === server.id}
                onToggle={() => handleToggle(server)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// --------------- 内部子组件 ---------------

interface ServerRowProps {
  server: McpServer
  toggling: boolean
  onToggle: () => void
}

function ServerRow({ server, toggling, onToggle }: ServerRowProps) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-bg-input transition-all duration-[120ms] ease">
      {/* 状态指示点 */}
      <div
        className={`w-2 h-2 rounded-full shrink-0 ${
          server.enabled ? 'bg-success' : 'bg-text-tertiary'
        }`}
      />

      <span className="flex-1 text-[13px] text-text-primary truncate">{server.name}</span>

      {/* 开关按钮 */}
      <button
        onClick={onToggle}
        disabled={toggling}
        aria-checked={server.enabled}
        role="switch"
        className={`relative w-9 h-5 rounded-full shrink-0 transition-all duration-[120ms] ease active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed ${
          server.enabled ? 'bg-accent' : 'bg-bg-input border border-border'
        }`}
        aria-label={`${server.enabled ? '禁用' : '启用'} ${server.name}`}
      >
        {toggling ? (
          <Loader2
            size={10}
            strokeWidth={2}
            className="absolute inset-0 m-auto animate-spin text-white"
          />
        ) : (
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-[120ms] ease ${
              server.enabled ? 'left-[18px]' : 'left-0.5'
            }`}
          />
        )}
      </button>
    </div>
  )
}
