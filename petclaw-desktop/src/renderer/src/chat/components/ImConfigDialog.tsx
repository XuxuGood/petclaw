// src/renderer/src/chat/components/ImConfigDialog.tsx
import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Plus } from 'lucide-react'

// 弹窗内左侧平台列表（与 ImChannelsPage 保持一致顺序）
const PLATFORMS = [
  { key: 'feishu', name: '飞书', icon: '🐦' },
  { key: 'dingtalk', name: '钉钉', icon: '📌' },
  { key: 'wechat', name: '微信', icon: '💬' },
  { key: 'wecom', name: '企业微信', icon: '🏢' }
] as const

// 各平台的配置字段定义，type='password' 的字段支持显示/隐藏切换
const PLATFORM_FIELDS: Record<
  string,
  Array<{
    key: string
    label: string
    type: 'text' | 'password'
    placeholder: string
    defaultValue?: string
  }>
> = {
  feishu: [
    { key: 'appId', label: 'App ID', type: 'text', placeholder: '输入飞书 App ID' },
    { key: 'appSecret', label: 'App Secret', type: 'password', placeholder: '输入飞书 App Secret' },
    {
      key: 'domain',
      label: 'Domain',
      type: 'text',
      placeholder: 'feishu.cn',
      defaultValue: 'feishu.cn'
    }
  ],
  dingtalk: [
    { key: 'appKey', label: 'App Key', type: 'text', placeholder: '输入钉钉 App Key' },
    { key: 'appSecret', label: 'App Secret', type: 'password', placeholder: '输入钉钉 App Secret' }
  ],
  wechat: [
    { key: 'accountId', label: 'Account ID', type: 'text', placeholder: '输入微信 Account ID' }
  ],
  wecom: [
    { key: 'corpId', label: 'Corp ID', type: 'text', placeholder: '输入企业微信 Corp ID' },
    { key: 'agentId', label: 'Agent ID', type: 'text', placeholder: '输入 Agent ID' },
    { key: 'secret', label: 'Secret', type: 'password', placeholder: '输入 Secret' }
  ]
}

interface ImConfigDialogProps {
  isOpen: boolean
  initialPlatform: string | null
  onClose: () => void
  onSaved: () => void
}

export function ImConfigDialog({ isOpen, initialPlatform, onClose, onSaved }: ImConfigDialogProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<string>('feishu')
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  // 弹窗打开时初始化：定位到来源平台并加载已有配置
  useEffect(() => {
    if (!isOpen) return
    const platform = initialPlatform ?? 'feishu'
    setSelectedPlatform(platform)
    setShowSecrets({})
    loadPlatformConfig(platform)
  }, [isOpen, initialPlatform])

  // 从后端加载指定平台的配置，并写入表单；无配置时填充字段默认值
  const loadPlatformConfig = (key: string) => {
    window.api.im.loadConfig().then((data: unknown) => {
      const result = data as { platforms: Array<{ key: string; config: Record<string, unknown> }> }
      const existing = result.platforms.find((p) => p.key === key)
      if (existing) {
        setFormData(existing.config as Record<string, string>)
      } else {
        // 无配置时填充有 defaultValue 的字段
        const defaults: Record<string, string> = {}
        const fields = PLATFORM_FIELDS[key] ?? []
        for (const field of fields) {
          if (field.defaultValue) defaults[field.key] = field.defaultValue
        }
        setFormData(defaults)
      }
    })
  }

  const handlePlatformChange = (key: string) => {
    setSelectedPlatform(key)
    // 切换平台时重置密码可见状态，再加载新平台配置
    setShowSecrets({})
    loadPlatformConfig(key)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // 合并通用字段后保存；enabled=true 表示保存时自动启用
      const config = {
        ...formData,
        enabled: true,
        dmPolicy: 'open',
        groupPolicy: 'disabled',
        allowFrom: [],
        debug: false
      }
      await window.api.im.saveConfig(selectedPlatform, config)
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const toggleSecret = (fieldKey: string) => {
    setShowSecrets((prev) => ({ ...prev, [fieldKey]: !prev[fieldKey] }))
  }

  // 弹窗关闭时不渲染，避免遮挡主界面
  if (!isOpen) return null

  const fields = PLATFORM_FIELDS[selectedPlatform] ?? []
  const currentPlatformInfo = PLATFORMS.find((p) => p.key === selectedPlatform)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-root rounded-[14px] shadow-lg w-[680px] h-[520px] flex flex-col overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-[15px] font-semibold text-text-primary">IM 机器人</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-[8px] hover:bg-bg-hover transition-colors"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        {/* 两栏内容区 */}
        <div className="flex-1 flex min-h-0">
          {/* 左侧平台列表 */}
          <div className="w-[200px] shrink-0 border-r border-border flex flex-col">
            <div className="flex-1 overflow-y-auto py-2">
              {PLATFORMS.map(({ key, name, icon }) => (
                <button
                  key={key}
                  onClick={() => handlePlatformChange(key)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] transition-colors ${
                    selectedPlatform === key
                      ? 'bg-bg-active text-text-primary font-medium'
                      : 'text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  <span className="text-[15px]">{icon}</span>
                  <span>{name}</span>
                </button>
              ))}
            </div>
            {/* 底部引导创建按钮 */}
            <div className="p-3 border-t border-border">
              <button className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] text-text-tertiary hover:text-text-secondary bg-bg-hover hover:bg-bg-active rounded-[8px] transition-colors">
                <Plus size={13} />
                扫码创建机器人
              </button>
            </div>
          </div>

          {/* 右侧配置面板 */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* 平台名称 + 连接状态 */}
              <div className="flex items-center gap-2 mb-5">
                <span className="text-[20px]">{currentPlatformInfo?.icon}</span>
                <h3 className="text-[16px] font-semibold text-text-primary">
                  {currentPlatformInfo?.name}
                </h3>
                <span className="px-2 py-0.5 text-[11px] text-text-tertiary bg-bg-hover rounded-full">
                  未连接
                </span>
              </div>

              {/* 手动填写分割线 */}
              <div className="flex items-center gap-3 mb-5">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[12px] text-text-tertiary">手动填写配置</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* 配置字段列表 */}
              <div className="space-y-4">
                {fields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-[12px] text-text-tertiary mb-1.5">
                      {field.label}
                    </label>
                    <div className="relative">
                      <input
                        type={
                          field.type === 'password' && !showSecrets[field.key] ? 'password' : 'text'
                        }
                        value={formData[field.key] ?? ''}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        placeholder={field.placeholder}
                        className="w-full px-3 py-2 text-[13px] rounded-[10px] bg-bg-hover border border-border text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/40 pr-10"
                      />
                      {/* 密码字段显示/隐藏切换 */}
                      {field.type === 'password' && (
                        <button
                          onClick={() => toggleSecret(field.key)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-tertiary hover:text-text-secondary transition-colors"
                        >
                          {showSecrets[field.key] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 底部操作按钮 */}
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button
                onClick={onClose}
                className="px-4 py-2 text-[13px] rounded-[10px] text-text-secondary hover:bg-bg-hover transition-colors active:scale-[0.96] duration-[120ms]"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-[13px] rounded-[10px] bg-accent text-white hover:bg-accent-hover transition-colors active:scale-[0.96] duration-[120ms] disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
