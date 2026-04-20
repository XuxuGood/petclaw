import { useState, useEffect } from 'react'
import { Globe, Keyboard, Info, Check, ExternalLink } from 'lucide-react'

export function SettingsView(): JSX.Element {
  const [gatewayUrl, setGatewayUrl] = useState('ws://127.0.0.1:18789')
  const [appVersion, setAppVersion] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.getSetting('gatewayUrl').then((v) => {
      if (v) setGatewayUrl(v)
    })
    window.api.getAppVersion().then(setAppVersion)
  }, [])

  const handleSave = async () => {
    await window.api.setSetting('gatewayUrl', gatewayUrl)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const isMac = navigator.platform.includes('Mac')
  const mod = isMac ? '⌘' : 'Ctrl'

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="drag-region h-[52px] shrink-0 flex items-center px-6">
        <div className="w-[70px]" />
        <h2 className="text-[13px] font-semibold text-text-primary">设置</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="max-w-[520px] mx-auto space-y-6">
          {/* Gateway URL */}
          <section>
            <SectionHeader icon={Globe} label="Openclaw Gateway" />
            <div className="bg-bg-card rounded-[10px] shadow-[var(--shadow-card)] border border-border p-4">
              <label className="block text-[12px] text-text-tertiary mb-2 font-medium">
                WebSocket 地址
              </label>
              <input
                type="text"
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-input text-[13px] text-text-primary outline-none border border-border-input focus:border-accent transition-all duration-150 ease"
              />
              <button
                onClick={handleSave}
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-[10px] text-[13px] font-medium hover:bg-accent-hover transition-all duration-150 ease active:scale-[0.97]"
              >
                {saved ? (
                  <>
                    <Check size={14} strokeWidth={2.5} />
                    <span>已保存</span>
                  </>
                ) : (
                  '保存'
                )}
              </button>
            </div>
          </section>

          {/* Shortcuts */}
          <section>
            <SectionHeader icon={Keyboard} label="快捷键" />
            <div className="bg-bg-card rounded-[10px] shadow-[var(--shadow-card)] border border-border divide-y divide-border">
              <ShortcutRow label="显示/隐藏宠物" shortcut={`${mod}+Shift+P`} />
              <ShortcutRow label="打开/关闭聊天" shortcut={`${mod}+Shift+C`} />
            </div>
          </section>

          {/* About */}
          <section>
            <SectionHeader icon={Info} label="关于" />
            <div className="bg-bg-card rounded-[10px] shadow-[var(--shadow-card)] border border-border px-4 py-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium text-text-primary">PetClaw Desktop</p>
                  <p className="text-[11px] text-text-tertiary mt-0.5">AI 桌面宠物助手</p>
                </div>
                <span className="text-[12px] text-text-tertiary font-mono">v{appVersion}</span>
              </div>
              <div className="mt-3 pt-3 border-t border-border">
                <a
                  href="https://petclaw.ai"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] text-text-secondary hover:text-text-primary transition-all duration-150 ease"
                >
                  <span>petclaw.ai</span>
                  <ExternalLink size={11} strokeWidth={2} />
                </a>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ icon: Icon, label }: { icon: typeof Globe; label: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 mb-2.5 px-0.5">
      <Icon size={14} className="text-text-tertiary" strokeWidth={2} />
      <span className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">
        {label}
      </span>
    </div>
  )
}

function ShortcutRow({ label, shortcut }: { label: string; shortcut: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[13px] text-text-secondary">{label}</span>
      <kbd className="px-2.5 py-1 bg-bg-input rounded-lg text-[11px] text-text-tertiary font-mono font-medium">
        {shortcut}
      </kbd>
    </div>
  )
}
