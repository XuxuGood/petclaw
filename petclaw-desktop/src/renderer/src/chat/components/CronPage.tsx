import { Clock } from 'lucide-react'

export function CronPage() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="drag-region h-[52px] shrink-0" />
      <div className="flex-1 flex flex-col items-center justify-center">
        <Clock size={48} className="text-text-tertiary mb-4" strokeWidth={1.25} />
        <h2 className="text-[17px] font-semibold text-text-primary mb-1">定时任务</h2>
        <p className="text-[13px] text-text-tertiary">即将推出，敬请期待</p>
      </div>
    </div>
  )
}
