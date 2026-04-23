// src/renderer/src/chat/components/ImChannelsPage.tsx
import { useState, useEffect } from 'react'
import { Settings2, MoreHorizontal, Info } from 'lucide-react'

import { ImConfigDialog } from './ImConfigDialog'

// 平台静态元数据，key 与后端 IM 配置 key 保持一致
const PLATFORMS = [
  { key: 'dingtalk', name: '钉钉', icon: '📌', description: '通过钉钉机器人接收用户消息' },
  { key: 'feishu', name: '飞书', icon: '🐦', description: '通过飞书机器人接收用户消息' },
  { key: 'wechat', name: '微信', icon: '💬', description: '通过微信接收用户消息' },
  { key: 'wecom', name: '企业微信', icon: '🏢', description: '通过企业微信机器人接收用户消息' }
] as const

interface PlatformStatus {
  enabled: boolean
  connected?: boolean
}

export function ImChannelsPage() {
  const [statuses, setStatuses] = useState<Record<string, PlatformStatus>>({})
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)

  useEffect(() => {
    loadStatuses()
    // 订阅后端推送的状态变更，保持列表实时更新
    const unsub = window.api.im.onStatusUpdate(() => loadStatuses())
    return unsub
  }, [])

  const loadStatuses = () => {
    window.api.im.getStatus().then((data: unknown) => {
      setStatuses(data as Record<string, PlatformStatus>)
    })
  }

  // toggle 开关：加载当前配置并更新 enabled 字段后保存
  const handleToggle = async (key: string, enabled: boolean) => {
    const existing = await window.api.im.loadConfig()
    const platforms = (
      existing as { platforms: Array<{ key: string; config: Record<string, unknown> }> }
    ).platforms
    const platform = platforms.find((p) => p.key === key)
    const config = platform?.config ?? {
      enabled: false,
      dmPolicy: 'open',
      groupPolicy: 'disabled',
      allowFrom: [],
      debug: false
    }
    await window.api.im.saveConfig(key, { ...config, enabled })
    loadStatuses()
  }

  const openConfig = (platformKey: string) => {
    setSelectedPlatform(platformKey)
    setConfigDialogOpen(true)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 交通灯占位区 */}
      <div className="drag-region h-[52px] shrink-0" />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[720px] mx-auto px-6 py-4">
          <h1 className="text-[24px] font-bold text-text-primary mb-2">IM 频道</h1>
          <p className="text-[14px] text-text-tertiary mb-6 leading-[1.6]">
            配置 IM 频道，让 QoderWork 接收来自钉钉、飞书等平台的消息。
            频道配置信息仅存储在本地，不会上传到云端。
          </p>

          {/* 权限提示信息条 */}
          <div className="flex items-start gap-3 px-4 py-3 mb-6 bg-accent/5 border border-accent/15 rounded-[10px]">
            <Info size={16} className="text-accent shrink-0 mt-0.5" />
            <p className="text-[13px] text-text-secondary leading-[1.6] flex-1">
              建议授予「完全磁盘访问权限」，可避免系统使用过程中反复弹出文件访问确认，体验更流畅。
            </p>
            <button className="text-[13px] text-accent hover:underline shrink-0">前往设置</button>
          </div>

          {/* 平台列表 */}
          <div className="space-y-2">
            {PLATFORMS.map(({ key, name, icon, description }) => {
              const status = statuses[key]
              const enabled = status?.enabled ?? false
              const connected = status?.connected ?? false

              return (
                <div
                  key={key}
                  className="flex items-center gap-4 px-4 py-3.5 rounded-[14px] border border-border hover:border-text-tertiary/30 transition-colors"
                >
                  {/* 平台图标 */}
                  <div className="w-10 h-10 rounded-full bg-bg-hover flex items-center justify-center text-[20px] shrink-0">
                    {icon}
                  </div>

                  {/* 名称 + 描述 */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium text-text-primary">{name}</div>
                    <div className="text-[12px] text-text-tertiary mt-0.5">{description}</div>
                  </div>

                  {/* 已连接徽标 */}
                  {connected && (
                    <span className="px-2 py-0.5 text-[11px] font-medium text-green-600 bg-green-50 rounded-full">
                      已连接
                    </span>
                  )}

                  {/* 配置按钮 */}
                  <button
                    onClick={() => openConfig(key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-text-secondary hover:text-text-primary bg-bg-hover hover:bg-bg-active rounded-[10px] transition-colors active:scale-[0.96] duration-[120ms]"
                  >
                    <Settings2 size={14} />
                    {connected ? '配置/管理' : '配置'}
                  </button>

                  {/* Toggle 开关 */}
                  <button
                    onClick={() => handleToggle(key, !enabled)}
                    className={`relative w-[36px] h-[20px] rounded-full transition-colors duration-200 ${
                      enabled ? 'bg-accent' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`absolute top-[2px] w-[16px] h-[16px] rounded-full bg-white shadow transition-transform duration-200 ${
                        enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
                      }`}
                    />
                  </button>

                  {/* 更多操作按钮 */}
                  <button className="p-1.5 text-text-tertiary hover:text-text-secondary rounded-[8px] hover:bg-bg-hover transition-colors">
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* IM 配置弹窗 */}
      <ImConfigDialog
        isOpen={configDialogOpen}
        initialPlatform={selectedPlatform}
        onClose={() => setConfigDialogOpen(false)}
        onSaved={loadStatuses}
      />
    </div>
  )
}
