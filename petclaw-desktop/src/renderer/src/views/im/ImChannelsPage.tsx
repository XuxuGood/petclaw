// src/renderer/src/chat/components/ImChannelsPage.tsx
import { useState, useEffect } from 'react'
import { Settings2, MoreHorizontal, Info } from 'lucide-react'

import { useI18n } from '../../i18n'
import { ImConfigDialog } from './ImConfigDialog'
import { DingTalkIcon, FeishuIcon, WeChatIcon, WeComIcon } from './im-platform-icons'

// 平台 key 列表，name/description 通过 i18n 获取
const PLATFORM_KEYS = ['dingtalk', 'feishu', 'wechat', 'wecom'] as const

type PlatformKey = (typeof PLATFORM_KEYS)[number]

// 平台品牌 SVG 图标（彩色圆底 + 白色 logo）
const PLATFORM_ICONS: Record<PlatformKey, React.ReactNode> = {
  dingtalk: <DingTalkIcon />,
  feishu: <FeishuIcon />,
  wechat: <WeChatIcon />,
  wecom: <WeComIcon />
}

interface PlatformStatus {
  enabled: boolean
  connected?: boolean
}

export function ImChannelsPage() {
  const { t } = useI18n()
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
          <h1 className="text-[24px] font-bold text-text-primary mb-2">{t('im.title')}</h1>
          <p className="text-[14px] text-text-tertiary mb-6 leading-[1.6]">
            {t('im.subtitle')}
            {t('im.localOnly')}
          </p>

          {/* 权限提示信息条 */}
          <div className="flex items-start gap-3 px-4 py-3 mb-6 bg-accent/5 border border-accent/15 rounded-[10px]">
            <Info size={16} className="text-accent shrink-0 mt-0.5" />
            <p className="text-[13px] text-text-secondary leading-[1.6] flex-1">
              {t('im.fullDiskHint')}
            </p>
            <button className="text-[13px] text-accent hover:underline shrink-0">
              {t('im.goSettings')}
            </button>
          </div>

          {/* 平台列表 */}
          <div className="space-y-2">
            {PLATFORM_KEYS.map((key) => {
              const status = statuses[key]
              const enabled = status?.enabled ?? false
              const connected = status?.connected ?? false
              // i18n 键名约定：im.dingtalk / im.dingtalkDesc 等
              const nameKey = `im.${key}` as const
              const descKey = `im.${key}Desc` as const

              return (
                <div
                  key={key}
                  className="flex items-center gap-4 px-4 py-3.5 rounded-[14px] border border-border hover:border-text-tertiary/30 transition-colors"
                >
                  {/* 平台图标 */}
                  <div className="w-10 h-10 shrink-0">{PLATFORM_ICONS[key]}</div>

                  {/* 名称 + 描述 */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium text-text-primary">{t(nameKey)}</div>
                    <div className="text-[12px] text-text-tertiary mt-0.5">{t(descKey)}</div>
                  </div>

                  {/* 已连接徽标 */}
                  {connected && (
                    <span className="px-2 py-0.5 text-[11px] font-medium text-green-600 bg-green-50 rounded-full">
                      {t('im.connected')}
                    </span>
                  )}

                  {/* 配置按钮 */}
                  <button
                    onClick={() => openConfig(key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-text-secondary hover:text-text-primary bg-bg-hover hover:bg-bg-active rounded-[10px] transition-colors active:scale-[0.96] duration-[120ms]"
                  >
                    <Settings2 size={14} />
                    {connected ? t('im.configManage') : t('im.configure')}
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
