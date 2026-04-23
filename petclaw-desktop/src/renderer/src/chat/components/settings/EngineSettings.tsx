import { useState, useEffect } from 'react'

import { RefreshCw, Circle } from 'lucide-react'

// 引擎状态类型
interface EngineStatus {
  running: boolean
  version?: string
  uptime?: number
  pid?: number
}

export function EngineSettings() {
  const [status, setStatus] = useState<EngineStatus | null>(null)

  // 订阅引擎状态推送
  useEffect(() => {
    const unsub = window.api.engine.onStatus((raw) => {
      const s = raw as EngineStatus
      setStatus(s)
    })
    return unsub
  }, [])

  const isRunning = status?.running === true

  return (
    <div>
      <h1 className="text-[20px] font-bold text-text-primary mb-1">Agent 引擎</h1>
      <p className="text-[13px] text-text-tertiary mb-6">查看引擎运行状态和版本信息</p>

      {/* 状态卡片 */}
      <div className="rounded-[14px] bg-bg-card border border-border overflow-hidden mb-4">
        {/* 运行状态 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <span className="text-[14px] text-text-primary">运行状态</span>
          <div className="flex items-center gap-2">
            <Circle
              size={8}
              className={
                isRunning
                  ? 'text-green-500 fill-green-500'
                  : 'text-text-tertiary fill-text-tertiary'
              }
            />
            <span className={`text-[14px] ${isRunning ? 'text-green-500' : 'text-text-tertiary'}`}>
              {status === null ? '加载中...' : isRunning ? '运行中' : '未运行'}
            </span>
          </div>
        </div>

        {/* 版本号 */}
        {status?.version && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <span className="text-[14px] text-text-primary">引擎版本</span>
            <span className="text-[14px] text-text-secondary font-mono">{status.version}</span>
          </div>
        )}

        {/* 进程 ID */}
        {status?.pid && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <span className="text-[14px] text-text-primary">进程 ID</span>
            <span className="text-[14px] text-text-secondary font-mono">{status.pid}</span>
          </div>
        )}

        {/* 运行时长 */}
        {status?.uptime !== undefined && (
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-[14px] text-text-primary">运行时长</span>
            <span className="text-[14px] text-text-secondary">
              {Math.floor(status.uptime / 60)} 分钟
            </span>
          </div>
        )}
      </div>

      {/* 说明文字 */}
      <p className="text-[12px] text-text-tertiary flex items-center gap-1.5">
        <RefreshCw size={12} />
        引擎状态实时更新，如需重启请从系统托盘菜单操作
      </p>
    </div>
  )
}
