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
    const existing = await window.api.im.listInstances()
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
    await window.api.im.updateInstance(key, { ...config, enabled })
    loadStatuses()
  }

  const openConfig = (platformKey: string) => {
    setSelectedPlatform(platformKey)
    setConfigDialogOpen(true)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="page-scroll">
        <div className="page-container-workbench workspace-page-container">
          <div className="page-hero">
            <h1 className="page-title">{t('im.title')}</h1>
            <p className="page-subtitle">
              {t('im.subtitle')}
              {t('im.localOnly')}
            </p>
          </div>

          {/* 权限提示信息条 */}
          <div className="flex flex-col gap-3 px-4 py-3 mb-6 bg-accent/5 border border-accent/15 rounded-[8px] sm:flex-row sm:items-start">
            <Info size={16} className="text-accent shrink-0 mt-0.5" />
            <p className="text-[13px] text-text-secondary leading-[1.6] flex-1">
              {t('im.fullDiskHint')}
            </p>
            <button className="min-h-[32px] text-left text-[13px] text-accent hover:underline shrink-0 ui-focus">
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
                  className="flex min-w-0 flex-col gap-3 px-4 py-3.5 rounded-[12px] border border-border hover:border-text-tertiary/30 transition-colors md:flex-row md:items-center md:gap-4"
                >
                  {/* 平台图标 */}
                  <div className="w-10 h-10 shrink-0">{PLATFORM_ICONS[key]}</div>

                  {/* 名称 + 描述 */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium text-text-primary">{t(nameKey)}</div>
                    <div className="text-[12px] text-text-tertiary mt-0.5 leading-[1.55]">
                      {t(descKey)}
                    </div>
                  </div>

                  {/* 已连接徽标 */}
                  {connected && (
                    <span className="px-2 py-0.5 text-[11px] font-medium text-success bg-safe-bg rounded-full">
                      {t('im.connected')}
                    </span>
                  )}

                  {/* 配置按钮：卡片内的紧凑 CTA，与顶栏 topbar-btn 解耦；
                      r8 方正形态与卡片内其他元素对齐，常驻灰底表达“固定入口”语义。 */}
                  <button
                    onClick={() => openConfig(key)}
                    className="h-8 inline-flex items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-medium text-text-primary bg-[var(--color-workspace-state-active)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--color-workspace-state-hover)] ui-focus"
                  >
                    <Settings2 size={14} />
                    {connected ? t('im.configManage') : t('im.configure')}
                  </button>

                  {/* Toggle 开关 */}
                  <button
                    onClick={() => handleToggle(key, !enabled)}
                    className={`relative h-[32px] w-[44px] shrink-0 rounded-full transition-colors duration-200 ui-focus ${
                      enabled ? 'bg-accent' : 'bg-border'
                    }`}
                  >
                    <div
                      className={`absolute top-[7px] w-[18px] h-[18px] rounded-full bg-white shadow transition-transform duration-200 ${
                        enabled ? 'translate-x-[22px]' : 'translate-x-[4px]'
                      }`}
                    />
                  </button>

                  {/* 更多操作按钮 */}
                  <button className="min-h-[var(--size-control-min)] min-w-[var(--size-control-min)] p-1.5 text-text-tertiary hover:text-text-secondary rounded-[8px] hover:bg-bg-hover transition-colors ui-focus">
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
