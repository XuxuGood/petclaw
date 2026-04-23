import { useState, useEffect } from 'react'
import { Check, AlertCircle, RefreshCw, PawPrint } from 'lucide-react'

/* Inject keyframes — only for continuously running animations */
const RING_STYLE = document.createElement('style')
RING_STYLE.textContent = `
  @keyframes arc-spin-cw  { to { transform: rotate(360deg); } }
  @keyframes arc-spin-ccw { to { transform: rotate(-360deg); } }
`
document.head.appendChild(RING_STYLE)

interface BootStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
  hint?: string
}

const STEP_ESTIMATES: Record<string, string> = {
  env: '~1秒',
  engine: '~10秒',
  connect: '~5秒'
}

/* ── Logo area: squash-and-swap transition ── */
function LogoArea({ success }: { success: boolean }) {
  // Phase machine: loading → shrinking (center scales down) → success (bounce back with new content)
  const [phase, setPhase] = useState<'loading' | 'shrinking' | 'success'>('loading')

  useEffect(() => {
    if (success) {
      // Phase 1: shrink the center circle
      setPhase('shrinking')
      // Phase 2: at smallest point, swap content + bounce back
      const timer = setTimeout(() => setPhase('success'), 180)
      return () => clearTimeout(timer)
    }
    setPhase('loading')
  }, [success])

  const size = 130
  const cx = size / 2
  const cy = size / 2

  // Spinning arcs geometry
  const rBlack = 58
  const cBlack = 2 * Math.PI * rBlack
  const dashBlack = cBlack * 0.28
  const gapBlack = cBlack - dashBlack

  const rPurple = 50
  const cPurple = 2 * Math.PI * rPurple
  const dashPurple = cPurple * 0.78
  const gapPurple = cPurple - dashPurple

  const isLoading = phase === 'loading'
  const isShrinking = phase === 'shrinking'
  const isSuccess = phase === 'success'

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Layer 1: Spinning arcs — fade out as soon as transition starts */}
      <svg
        width={size}
        height={size}
        className="absolute inset-0"
        style={{
          opacity: isLoading ? 1 : 0,
          transition: 'opacity 220ms ease-out'
        }}
      >
        <circle
          cx={cx}
          cy={cy}
          r={rPurple}
          fill="none"
          stroke="#c4b5fd"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={`${dashPurple} ${gapPurple}`}
          style={{
            animation: 'arc-spin-cw 5s linear infinite',
            transformOrigin: `${cx}px ${cy}px`
          }}
        />
        <circle
          cx={cx}
          cy={cy}
          r={rBlack}
          fill="none"
          stroke="var(--color-text-primary)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${dashBlack} ${gapBlack}`}
          style={{
            animation: 'arc-spin-ccw 4s linear infinite',
            transformOrigin: `${cx}px ${cy}px`
          }}
        />
      </svg>

      {/* Layer 2: Success ring — scales in after swap */}
      <svg
        width={size}
        height={size}
        className="absolute inset-0"
        style={{
          opacity: isSuccess ? 1 : 0,
          transform: isSuccess ? 'scale(1)' : 'scale(0.88)',
          transition: isSuccess
            ? 'opacity 350ms ease-out 60ms, transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1) 60ms'
            : 'none'
        }}
      >
        <circle cx={cx} cy={cy} r={54} fill="none" stroke="#86efac" strokeWidth={2} />
      </svg>

      {/* Layer 3: Shared center — squash then bounce-back with swapped content */}
      <div
        className="absolute z-10 flex items-center justify-center"
        style={{
          left: '50%',
          top: '50%',
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: isSuccess ? 'var(--color-success)' : 'var(--color-bg-card)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          // Shrink phase: quick ease-in; Success phase: spring bounce-back
          transform: `translate(-50%, -50%) scale(${isShrinking ? 0.72 : 1})`,
          transition: isShrinking
            ? 'transform 180ms ease-in'
            : isSuccess
              ? 'transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0ms'
              : 'none'
        }}
      >
        {/* Paw icon — visible until swap (instant hide) */}
        <div
          className="absolute flex items-center justify-center"
          style={{
            opacity: isSuccess ? 0 : 1,
            transition: 'none'
          }}
        >
          <div className="w-10 h-10 rounded-[11px] bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center">
            <PawPrint size={20} className="text-white" strokeWidth={2.5} />
          </div>
        </div>

        {/* Check icon — instant show at swap, rides the bounce-back */}
        <div
          className="absolute flex items-center justify-center"
          style={{
            opacity: isSuccess ? 1 : 0,
            transition: 'none'
          }}
        >
          <Check size={28} className="text-white" strokeWidth={2.5} />
        </div>
      </div>
    </div>
  )
}

/* ── Step row ── */
function StepRow({ step }: { step: BootStep }) {
  const rightText = step.hint || STEP_ESTIMATES[step.id] || ''
  const showRight = (step.status === 'running' || step.status === 'pending') && rightText
  const label = step.label

  return (
    <div className="flex items-center gap-3.5">
      {/* Icon area — fixed size, content crossfades via opacity */}
      <div className="w-6 h-6 flex items-center justify-center shrink-0 relative">
        {/* Pending dot */}
        <div
          className="absolute w-[6px] h-[6px] rounded-full bg-border transition-opacity duration-300"
          style={{ opacity: step.status === 'pending' ? 1 : 0 }}
        />
        {/* Running spinner */}
        <div
          className="absolute transition-opacity duration-300"
          style={{ opacity: step.status === 'running' ? 1 : 0 }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" className="animate-spin">
            <circle cx="9" cy="9" r="7" fill="none" stroke="var(--color-border)" strokeWidth="2" />
            <path
              d="M9 2a7 7 0 0 1 7 7"
              fill="none"
              stroke="var(--color-text-primary)"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        {/* Done check */}
        <div
          className="absolute transition-all duration-300"
          style={{
            opacity: step.status === 'done' ? 1 : 0,
            transform: step.status === 'done' ? 'scale(1)' : 'scale(0.5)'
          }}
        >
          <Check size={16} className="text-success" strokeWidth={2.5} />
        </div>
        {/* Error icon */}
        <div
          className="absolute transition-opacity duration-300"
          style={{ opacity: step.status === 'error' ? 1 : 0 }}
        >
          <AlertCircle size={16} className="text-error" strokeWidth={2} />
        </div>
      </div>

      {/* Label — smooth color/weight transition */}
      <span
        className="text-[15px] flex-1 transition-all duration-300"
        style={{
          color:
            step.status === 'error'
              ? 'var(--color-error)'
              : step.status === 'running'
                ? 'var(--color-text-primary)'
                : 'var(--color-text-tertiary)',
          fontWeight: step.status === 'running' ? 600 : 400
        }}
      >
        {label}
      </span>

      {/* Right-side hint / estimate — fade transition */}
      <span
        className="text-[13px] shrink-0 tabular-nums transition-opacity duration-300"
        style={{
          opacity: showRight ? 1 : 0,
          color: step.status === 'running' ? 'var(--color-text-tertiary)' : 'var(--color-border)'
        }}
      >
        {rightText}
      </span>
    </div>
  )
}

export function BootCheckPanel({ onRetry }: { onRetry?: () => void }) {
  const [steps, setSteps] = useState<BootStep[]>([])
  const [hasError, setHasError] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  const handleRetry = (): void => {
    setSteps([])
    setHasError(false)
    setShowSuccess(false)
    onRetry?.()
  }

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
  const allDone = steps.length > 0 && doneCount === steps.length

  // Choreographed success transition
  const [stepsVisible, setStepsVisible] = useState(true)

  useEffect(() => {
    if (allDone) {
      // t+300: steps start fading out
      const fadeTimer = setTimeout(() => setStepsVisible(false), 300)
      // t+700: steps gone, trigger logo morph
      const successTimer = setTimeout(() => setShowSuccess(true), 700)
      return () => {
        clearTimeout(fadeTimer)
        clearTimeout(successTimer)
      }
    }
    setStepsVisible(true)
    setShowSuccess(false)
  }, [allDone])

  const runningStep = steps.find((s) => s.status === 'running')
  const title = showSuccess ? '设置完成！' : '正在启动 PetClaw...'
  const subtitle = !showSuccess ? runningStep?.hint : undefined

  return (
    <div className="w-full h-full flex flex-col bg-bg-root select-none">
      {/* Drag region */}
      <div
        className="h-[52px] shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Content — centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        {/* ── Logo area: shared center morphs between loading → success ── */}
        <LogoArea success={showSuccess} />

        {/* ── Title area: crossfade with fixed height ── */}
        <div className="mt-8 relative h-[28px] flex items-center justify-center">
          {/* Running title */}
          <h1
            className="text-[20px] font-bold text-text-primary tracking-tight text-center whitespace-nowrap transition-all duration-400 ease-out absolute"
            style={{
              opacity: showSuccess ? 0 : 1,
              transform: showSuccess ? 'translateY(-8px)' : 'translateY(0)'
            }}
          >
            {title}
          </h1>
          {/* Success title */}
          <h1
            className="text-[20px] font-bold text-text-primary tracking-tight text-center whitespace-nowrap transition-all duration-400 ease-out absolute"
            style={{
              opacity: showSuccess ? 1 : 0,
              transform: showSuccess ? 'translateY(0)' : 'translateY(8px)'
            }}
          >
            设置完成！
          </h1>
        </div>

        {/* Subtitle */}
        <div className="h-[24px] mt-1 flex items-center justify-center">
          <p
            className="text-[15px] text-text-tertiary text-center transition-opacity duration-300"
            style={{ opacity: subtitle ? 1 : 0 }}
          >
            {subtitle || '\u00A0'}
          </p>
        </div>

        {/* Steps + Progress — fade out as a group on success */}
        <div
          style={{
            opacity: stepsVisible ? 1 : 0,
            transform: stepsVisible ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
            pointerEvents: stepsVisible ? ('auto' as const) : ('none' as const)
          }}
        >
          {/* Steps */}
          <div className="w-full max-w-[400px] mt-8 space-y-5 mx-auto">
            {steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </div>

          {/* Progress bar */}
          {!hasError && steps.length > 0 && (
            <div className="w-full max-w-[400px] mt-8 h-[5px] bg-border-input rounded-full overflow-hidden mx-auto">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${progress}%`,
                  background: allDone
                    ? 'linear-gradient(to right, var(--color-text-primary), var(--color-success))'
                    : 'var(--color-success)'
                }}
              />
            </div>
          )}

          {/* Error message + retry */}
          {errorStep && (
            <div className="w-full max-w-[400px] mt-8 flex flex-col items-center gap-4 mx-auto">
              <div className="w-full rounded-[10px] bg-[#fef2f2] border border-[#fecaca] px-4 py-3">
                <p className="text-[13px] text-[#991b1b] leading-relaxed">{errorStep.error}</p>
              </div>
              {onRetry && (
                <button
                  onClick={handleRetry}
                  className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-white text-[14px] font-medium rounded-[10px] hover:bg-accent-hover active:scale-[0.96] transition-all duration-[120ms] cursor-pointer shadow-sm"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                  <RefreshCw size={15} strokeWidth={2.5} />
                  重试
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
