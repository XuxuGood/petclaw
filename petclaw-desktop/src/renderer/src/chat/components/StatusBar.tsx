import { useState, useEffect } from 'react'
import { Wifi } from 'lucide-react'

export function StatusBar() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.getAppVersion().then(setVersion)
  }, [])

  return (
    <div className="h-8 flex items-center justify-between px-5 border-t border-border bg-bg-root text-[11px] text-text-tertiary select-none shrink-0">
      <div className="flex items-center gap-1.5">
        <Wifi size={11} strokeWidth={2} className="text-success" />
        <span>Openclaw Gateway</span>
      </div>
      <div className="flex items-center gap-3">
        <span>
          免费使用中: <span className="font-medium text-text-secondary">0%</span> 已用
        </span>
        <span className="opacity-40">|</span>
        <span className="font-mono">v{version}</span>
      </div>
    </div>
  )
}
