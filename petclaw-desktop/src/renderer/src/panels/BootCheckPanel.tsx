import { useState, useEffect } from 'react'
import { Check, Loader2, Circle, AlertCircle, RefreshCw, PawPrint } from 'lucide-react'

interface BootStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
}

function StepIcon({ status }: { status: BootStep['status'] }): JSX.Element {
  switch (status) {
    case 'done':
      return <Check size={18} className="text-[#16a34a]" strokeWidth={2.5} />
    case 'running':
      return <Loader2 size={18} className="text-[#18181b] animate-spin" strokeWidth={2} />
    case 'error':
      return <AlertCircle size={18} className="text-[#dc2626]" strokeWidth={2} />
    case 'pending':
    default:
      return <Circle size={18} className="text-[#d4d4d8]" strokeWidth={1.5} />
  }
}

export function BootCheckPanel({ onRetry }: { onRetry?: () => void }): JSX.Element {
  const [steps, setSteps] = useState<BootStep[]>([])
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    const unsub = window.api.onBootStepUpdate((newSteps) => {
      setSteps([...newSteps])
      setHasError(newSteps.some((s) => s.status === 'error'))
    })
    return unsub
  }, [])

  const doneCount = steps.filter((s) => s.status === 'done').length
  const progress = steps.length > 0 ? (doneCount / steps.length) * 100 : 0
  const errorStep = steps.find((s) => s.status === 'error')

  return (
    <div className="w-full h-full flex flex-col bg-white select-none">
      {/* Drag region — top bar with traffic light space */}
      <div
        className="h-[52px] shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Content — centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-[10px] bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center shadow-sm">
            <PawPrint size={20} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-[22px] font-bold text-[#18181b] tracking-tight">PetClaw</span>
        </div>

        {/* Steps */}
        <div className="w-full max-w-[340px] space-y-4 mb-8">
          {steps.map((step) => (
            <div key={step.id} className="flex items-center gap-3.5">
              <div className="w-6 flex items-center justify-center shrink-0">
                <StepIcon status={step.status} />
              </div>
              <span
                className={`text-[15px] ${
                  step.status === 'error'
                    ? 'text-[#dc2626]'
                    : step.status === 'done'
                      ? 'text-[#18181b]'
                      : step.status === 'running'
                        ? 'text-[#18181b] font-medium'
                        : 'text-[#a1a1aa]'
                }`}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        {!hasError && steps.length > 0 && (
          <div className="w-full max-w-[340px] h-[3px] bg-[#e4e4e7] rounded-full overflow-hidden mb-6">
            <div
              className="h-full bg-[#18181b] rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Error message + retry */}
        {errorStep && (
          <div className="w-full max-w-[340px]">
            <p className="text-[13px] text-[#dc2626] mb-4 leading-relaxed">{errorStep.error}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#18181b] text-white text-[14px] rounded-[10px] hover:bg-[#27272a] active:scale-[0.97] transition-all cursor-pointer"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <RefreshCw size={15} strokeWidth={2} />
                重试
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
