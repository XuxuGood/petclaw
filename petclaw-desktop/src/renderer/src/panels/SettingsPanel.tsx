import { useState, useEffect } from 'react'

export function SettingsPanel({ onClose }: { onClose: () => void }): JSX.Element {
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

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-80 h-96 bg-white/95 backdrop-blur-md rounded-t-2xl shadow-2xl flex flex-col border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">设置</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Settings */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Gateway URL */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Openclaw Gateway URL
          </label>
          <input
            type="text"
            value={gatewayUrl}
            onChange={(e) => setGatewayUrl(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-gray-100 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          className="w-full py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover"
        >
          {saved ? '已保存' : '保存设置'}
        </button>

        {/* Shortcuts info */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">快捷键</label>
          <div className="space-y-1 text-xs text-gray-600">
            <div className="flex justify-between">
              <span>显示/隐藏宠物</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">⌘⇧P</kbd>
            </div>
            <div className="flex justify-between">
              <span>打开聊天</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">⌘⇧C</kbd>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-100 text-center">
        <span className="text-xs text-gray-400">PetClaw v{appVersion}</span>
      </div>
    </div>
  )
}
