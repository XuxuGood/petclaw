// Agent 三 Tab 配置对话框
// Tab 顺序：基础信息 → 技能 → IM 渠道
// agentId 为 null 时是创建模式，有值时是编辑模式
import { useState, useEffect, useCallback } from 'react'

import { X, Trash2 } from 'lucide-react'

import { AgentSkillSelector } from './AgentSkillSelector'

type ConfigTab = 'basic' | 'skills' | 'im'

interface Agent {
  id: string
  name: string
  description: string
  systemPrompt: string
  identity: string
  model: string
  icon: string
  skillIds: string[]
  isDefault: boolean
  source: 'preset' | 'custom'
}

// 4 个 IM 平台（Phase 3 范围），互斥绑定
const IM_PLATFORMS = [
  { key: 'feishu', name: '飞书', icon: '🐦' },
  { key: 'dingtalk', name: '钉钉', icon: '📌' },
  { key: 'wechat', name: '微信', icon: '💬' },
  { key: 'wecom', name: '企业微信', icon: '🏢' }
] as const

interface AgentConfigDialogProps {
  isOpen: boolean
  agentId: string | null // null = 创建新 Agent
  onClose: () => void
  onSaved: () => void
  onUseAgent?: (agentId: string) => void
}

export function AgentConfigDialog({
  isOpen,
  agentId,
  onClose,
  onSaved,
  onUseAgent
}: AgentConfigDialogProps) {
  const [activeTab, setActiveTab] = useState<ConfigTab>('basic')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // 表单状态
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [identity, setIdentity] = useState('')
  const [model, setModel] = useState('')
  const [icon, setIcon] = useState('')
  const [skillIds, setSkillIds] = useState<string[]>([])

  // IM 绑定状态：platformBindings 是当前 agent 自己的选中状态，allBindings 是全局映射
  const [platformBindings, setPlatformBindings] = useState<Record<string, boolean>>({})
  const [allBindings, setAllBindings] = useState<Record<string, string>>({})
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([])

  // 每次对话框打开时重新加载数据
  useEffect(() => {
    if (!isOpen) return
    setActiveTab('basic')

    // 加载所有 Agent（用于 IM 渠道 Tab 显示已被占用的平台归属）
    window.api.agents.list().then((list: unknown) => {
      setAgents(list as Array<{ id: string; name: string }>)
    })

    // 加载 IM 设置，提取平台 → agentId 映射
    window.api.im.loadSettings().then((settings: unknown) => {
      const s = settings as { platformAgentBindings?: Record<string, string> }
      const bindings = s.platformAgentBindings ?? {}
      setAllBindings(bindings)
      // 标记哪些平台当前绑定的是本 agent
      const myBindings: Record<string, boolean> = {}
      for (const [key, boundAgent] of Object.entries(bindings)) {
        myBindings[key] = boundAgent === agentId
      }
      setPlatformBindings(myBindings)
    })

    if (agentId) {
      // 编辑模式：从主进程加载 agent 数据回填表单
      window.api.agents.get(agentId).then((agent: unknown) => {
        const a = agent as Agent
        if (a) {
          setName(a.name)
          setDescription(a.description)
          setSystemPrompt(a.systemPrompt)
          setIdentity(a.identity)
          setModel(a.model)
          setIcon(a.icon)
          setSkillIds(a.skillIds)
        }
      })
    } else {
      // 创建模式：重置所有字段
      setName('')
      setDescription('')
      setSystemPrompt('')
      setIdentity('')
      setModel('')
      setIcon('')
      setSkillIds([])
      setPlatformBindings({})
    }
  }, [isOpen, agentId])

  const handleSave = useCallback(async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      let savedId = agentId
      if (agentId) {
        // 更新已有 Agent
        await window.api.agents.update(agentId, {
          name,
          description,
          systemPrompt,
          identity,
          model,
          icon,
          skillIds
        })
      } else {
        // 创建新 Agent，拿到返回的 id 用于 IM 绑定
        const result = await window.api.agents.create({
          name,
          description,
          systemPrompt,
          identity,
          model,
          icon,
          skillIds
        })
        savedId = (result as { id: string }).id
      }

      // 同步 IM 平台绑定：选中的平台写入当前 agent，取消选中则从映射里删除
      const currentSettings = (await window.api.im.loadSettings()) as {
        systemPrompt?: string
        skillsEnabled?: boolean
        platformAgentBindings?: Record<string, string>
      }
      const bindings: Record<string, string> = { ...currentSettings.platformAgentBindings }
      for (const [key, isBound] of Object.entries(platformBindings)) {
        if (isBound && savedId) {
          bindings[key] = savedId
        } else if (!isBound && bindings[key] === savedId) {
          delete bindings[key]
        }
      }
      await window.api.im.saveSettings({
        ...currentSettings,
        platformAgentBindings: bindings
      })

      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }, [
    name,
    description,
    systemPrompt,
    identity,
    model,
    icon,
    skillIds,
    platformBindings,
    agentId,
    onSaved,
    onClose
  ])

  const handleDelete = useCallback(async () => {
    if (!agentId) return
    setDeleting(true)
    try {
      await window.api.agents.delete(agentId)
      onSaved()
      onClose()
    } finally {
      setDeleting(false)
    }
  }, [agentId, onSaved, onClose])

  if (!isOpen) return null

  const TABS: Array<{ id: ConfigTab; label: string }> = [
    { id: 'basic', label: '基础信息' },
    { id: 'skills', label: '技能' },
    { id: 'im', label: 'IM 渠道' }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-root rounded-[14px] shadow-lg w-[560px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* 标题栏：icon emoji + Agent 名称同行，右侧关闭按钮 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            {icon && <span className="text-[20px]">{icon}</span>}
            <h2 className="text-[15px] font-semibold text-text-primary">
              {agentId ? name || '编辑 Agent' : '创建 Agent'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-[8px] hover:bg-bg-hover transition-colors"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        {/* Tab 栏：纯文字，无图标，激活项底部蓝线 */}
        <div className="flex gap-4 px-5 pt-3 border-b border-border">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`pb-2.5 text-[13px] transition-colors duration-[120ms] border-b-2 ${
                activeTab === id
                  ? 'text-text-primary font-medium border-accent'
                  : 'text-text-tertiary hover:text-text-secondary border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 内容区域，可滚动 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'basic' && (
            <div className="space-y-4">
              {/* icon(52px 正方形) + name(flex-1) 同行 */}
              <Field label="名称" required>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    placeholder="🤖"
                    className="w-[52px] px-2 py-2 text-[16px] text-center rounded-[10px] bg-bg-hover border border-border focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="给 Agent 起个名字"
                    className="flex-1 px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                </div>
              </Field>
              <Field label="描述">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="简要描述这个 Agent 的用途"
                  className="w-full px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary resize-none focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              </Field>
              <Field label="系统提示词">
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={5}
                  placeholder="定义 Agent 的行为和个性..."
                  className="w-full px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary resize-none focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              </Field>
              <Field label="身份">
                <textarea
                  value={identity}
                  onChange={(e) => setIdentity(e.target.value)}
                  rows={3}
                  placeholder="身份描述（IDENTITY.md）..."
                  className="w-full px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary resize-none focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              </Field>
              <Field label="Agent 默认模型">
                {/* model 字段暂时用文本输入，待 models API 支持列表后再换 select */}
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="留空则使用全局默认模型"
                  className="w-full px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
                <p className="text-[11px] text-text-tertiary mt-1">仅 OpenClaw 引擎使用此设置</p>
              </Field>
            </div>
          )}

          {activeTab === 'skills' && (
            <AgentSkillSelector selectedIds={skillIds} onChange={setSkillIds} />
          )}

          {activeTab === 'im' && (
            <div className="space-y-3">
              <p className="text-[13px] text-text-tertiary mb-4">
                选择此 Agent 接管哪些 IM 平台的消息。每个平台同一时间只能被一个 Agent 持有。
              </p>
              {IM_PLATFORMS.map(({ key, name: platformName, icon: platformIcon }) => {
                const isBoundToMe = platformBindings[key] ?? false
                // 判断是否被其他 agent 占用（不是空、也不是当前 agent）
                const boundToOther = !!(allBindings[key] && allBindings[key] !== agentId)
                const boundAgentName = boundToOther
                  ? (agents.find((a) => a.id === allBindings[key])?.name ?? allBindings[key])
                  : null

                return (
                  <label
                    key={key}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] transition-colors ${
                      boundToOther
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-bg-hover cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isBoundToMe}
                      disabled={boundToOther}
                      onChange={(e) =>
                        setPlatformBindings((prev) => ({
                          ...prev,
                          [key]: e.target.checked
                        }))
                      }
                      className="rounded"
                    />
                    <span className="text-[15px]">{platformIcon}</span>
                    <span className="text-[13px] text-text-primary flex-1">{platformName}</span>
                    {/* 已被其他 agent 占用时显示归属提示 */}
                    {boundToOther && (
                      <span className="text-[12px] text-text-tertiary">→ {boundAgentName}</span>
                    )}
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {/* 底部按钮：左侧「删除」(仅编辑模式) + 右侧「使用此Agent」/「取消」/「保存」 */}
        <div className="flex items-center px-5 py-4 border-t border-border">
          {agentId && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-red-500 hover:text-red-600 hover:bg-red-50 rounded-[10px] transition-colors active:scale-[0.96] duration-[120ms]"
            >
              <Trash2 size={14} />
              删除
            </button>
          )}
          <div className="flex-1" />
          {/* 「使用此 Agent」仅编辑模式且外部传入 onUseAgent 时显示 */}
          {agentId && onUseAgent && (
            <button
              onClick={() => onUseAgent(agentId)}
              className="px-4 py-2 text-[13px] rounded-[10px] border border-accent text-accent hover:bg-accent/5 transition-colors active:scale-[0.96] duration-[120ms] mr-2"
            >
              使用此 Agent
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] rounded-[10px] text-text-secondary hover:bg-bg-hover transition-colors active:scale-[0.96] duration-[120ms] mr-2"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-4 py-2 text-[13px] rounded-[10px] bg-accent text-white hover:bg-accent-hover transition-colors active:scale-[0.96] duration-[120ms] disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Field 子组件：统一标签 + 内容布局 ──
function Field({
  label,
  required,
  children
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-[12px] text-text-tertiary mb-1.5">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}
