// Agent 列表管理界面，支持创建/编辑/删除
// 点击列表项打开 AgentConfigDialog 进行编辑
import { useState, useEffect, useCallback } from 'react'

import { Plus, Settings2 } from 'lucide-react'

import { AgentConfigDialog } from '../AgentConfigDialog'

interface Agent {
  id: string
  name: string
  description: string
  icon: string
  isDefault: boolean
  source: 'preset' | 'custom'
}

export function AgentSettings() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // 从主进程加载 Agent 列表
  const loadAgents = useCallback(() => {
    window.api.agents.list().then((list: unknown) => {
      setAgents(list as Agent[])
    })
  }, [])

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  const handleCreate = () => {
    setEditingId(null)
    setDialogOpen(true)
  }

  const handleEdit = (id: string) => {
    setEditingId(id)
    setDialogOpen(true)
  }

  return (
    <div>
      {/* 标题区 + 创建按钮 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-bold text-text-primary mb-1">Agent 管理</h1>
          <p className="text-[13px] text-text-tertiary">创建和管理你的 AI Agent</p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-1.5 px-4 py-2 text-[13px] rounded-[10px] bg-accent text-white hover:bg-accent-hover transition-colors active:scale-[0.96] duration-[120ms]"
        >
          <Plus size={14} />
          创建 Agent
        </button>
      </div>

      {/* Agent 卡片列表 */}
      <div className="space-y-2">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => handleEdit(agent.id)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-[14px] bg-bg-card border border-border hover:bg-bg-hover transition-colors text-left"
          >
            <span className="text-[20px]">{agent.icon || '🤖'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-medium text-text-primary">
                {agent.name}
                {agent.isDefault && (
                  <span className="ml-2 text-[11px] text-text-tertiary bg-bg-hover px-1.5 py-0.5 rounded">
                    默认
                  </span>
                )}
              </div>
              {agent.description && (
                <div className="text-[12px] text-text-tertiary truncate mt-0.5">
                  {agent.description}
                </div>
              )}
            </div>
            <Settings2 size={14} className="text-text-tertiary shrink-0" />
          </button>
        ))}
      </div>

      {/* 配置对话框，创建和编辑复用同一组件 */}
      <AgentConfigDialog
        isOpen={dialogOpen}
        agentId={editingId}
        onClose={() => setDialogOpen(false)}
        onSaved={loadAgents}
      />
    </div>
  )
}
