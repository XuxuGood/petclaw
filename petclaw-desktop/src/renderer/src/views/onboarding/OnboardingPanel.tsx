import { useState, useRef, useEffect, useCallback } from 'react'

import { Check, ChevronDown, X, Keyboard, Mic, CircleCheck, Circle } from 'lucide-react'

import { useI18n } from '../../i18n'
import {
  useOnboardingStore,
  STEPS,
  USER_ROLES,
  type OnboardingStep,
  type Language
} from '../../stores/onboarding-store'
import catStaticSrc from '../../assets/cat/static.webm'

/* ──────────────────────────────────────────
   Language bar
   ────────────────────────────────────────── */
const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' }
]

function LanguageBar() {
  const { language, setLanguage } = useOnboardingStore()
  return (
    <div className="flex items-center justify-center gap-1 py-3 text-[13px] text-text-tertiary select-none">
      {LANGUAGES.map((lang, i) => (
        <span key={lang.code} className="flex items-center gap-1">
          {i > 0 && <span className="text-border">/</span>}
          <button
            onClick={() => setLanguage(lang.code)}
            className={`px-1 transition-colors ${
              language === lang.code ? 'text-text-primary font-bold' : 'hover:text-text-secondary'
            }`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {lang.label}
          </button>
        </span>
      ))}
    </div>
  )
}

/* ──────────────────────────────────────────
   Step progress bar (5 thick dashes)
   ────────────────────────────────────────── */
function StepProgress({ current }: { current: OnboardingStep }) {
  const currentIdx = STEPS.indexOf(current)
  return (
    <div className="flex items-center gap-2 py-4 pl-1">
      {STEPS.map((_, i) => (
        <div
          key={i}
          className={`h-[3px] rounded-full transition-colors duration-300 ${
            i <= currentIdx ? 'w-[40px] bg-accent' : 'w-[40px] bg-border'
          }`}
        />
      ))}
    </div>
  )
}

/* ──────────────────────────────────────────
   Cat mascot with optional speech bubble
   ────────────────────────────────────────── */
function CatMascot({ bubbleText }: { bubbleText?: string }) {
  return (
    <div className="relative flex flex-col items-center justify-center h-full">
      {bubbleText && (
        <div className="absolute top-[22%] right-[8%] max-w-[260px] animate-fade-in">
          <div className="bg-text-primary text-white text-[13px] leading-[1.6] px-4 py-3 rounded-[10px]">
            {bubbleText}
          </div>
          {/* Tail */}
          <div className="ml-[40%] w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[10px] border-t-text-primary" />
        </div>
      )}
      <video
        src={catStaticSrc}
        autoPlay
        loop
        muted
        playsInline
        className="w-[280px] h-auto mt-8 pointer-events-none"
      />
    </div>
  )
}

/* ──────────────────────────────────────────
   Navigation footer
   ────────────────────────────────────────── */
function NavFooter({
  onSkip,
  onPrev,
  onNext,
  showPrev,
  nextLabel
}: {
  onSkip: () => void
  onPrev?: () => void
  onNext: () => void
  showPrev: boolean
  nextLabel: string
}) {
  const { t } = useI18n()

  return (
    <div className="flex items-center justify-between px-8 pb-6 pt-3">
      <button
        onClick={onSkip}
        className="text-[14px] text-text-tertiary hover:text-text-secondary transition-colors"
      >
        {t('common.skip')}
      </button>
      <div className="flex items-center gap-3">
        {showPrev && (
          <button
            onClick={onPrev}
            className="px-5 py-2 text-[14px] text-text-primary bg-bg-card border border-border rounded-[10px] hover:bg-bg-hover active:scale-[0.96] transition-all duration-[120ms]"
          >
            {t('common.prevStep')}
          </button>
        )}
        <button
          onClick={onNext}
          className="px-5 py-2 text-[14px] text-white bg-accent rounded-[10px] hover:bg-accent-hover active:scale-[0.96] transition-all duration-[120ms]"
        >
          {nextLabel}
        </button>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────
   Step 1: Permissions
   ────────────────────────────────────────── */
function PermissionsStep() {
  const { permissions, setPermission } = useOnboardingStore()
  const { t } = useI18n()

  const handlePermission = async (type: 'accessibility' | 'microphone') => {
    // In production: call system API to request permission
    // For now, toggle to simulate
    setPermission(type, !permissions[type])
  }

  return (
    <div className="flex-1 flex flex-col px-8 pt-2">
      <h1 className="text-[24px] font-bold text-text-primary leading-tight">
        {t('onboarding.setupTitle')}
      </h1>
      <p className="mt-3 text-[14px] text-text-secondary leading-relaxed">
        {t('onboarding.setupSubtitle')}
      </p>

      <div className="mt-8 space-y-4">
        {/* Accessibility */}
        <button
          onClick={() => handlePermission('accessibility')}
          className="w-full flex items-center justify-between p-4 border border-border-input rounded-[10px] hover:bg-bg-hover transition-colors text-left"
        >
          <span className="text-[15px] text-text-primary font-medium">
            {t('onboarding.accessibility')}
          </span>
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
              permissions.accessibility ? 'bg-accent' : 'border-2 border-border'
            }`}
          >
            {permissions.accessibility && (
              <Check size={16} className="text-white" strokeWidth={3} />
            )}
          </div>
        </button>

        {/* Microphone */}
        <button
          onClick={() => handlePermission('microphone')}
          className="w-full flex items-center justify-between p-4 border border-border-input rounded-[10px] hover:bg-bg-hover transition-colors text-left"
        >
          <span className="text-[15px] text-text-primary font-medium">
            {t('onboarding.microphone')}
          </span>
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
              permissions.microphone ? 'bg-accent' : 'border-2 border-border'
            }`}
          >
            {permissions.microphone && <Check size={16} className="text-white" strokeWidth={3} />}
          </div>
        </button>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────
   Step 2: Profile (nickname + role)
   ────────────────────────────────────────── */
function ProfileStep() {
  const {
    nickname,
    setNickname,
    roles,
    toggleRole,
    removeRole,
    profileSubmitted,
    setProfileSubmitted,
    setCatBubbleText
  } = useOnboardingStore()
  const { t } = useI18n()

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSubmit = () => {
    if (nickname.trim() && roles.length > 0) {
      setProfileSubmitted(true)
      // 录音完成后显示猫咪对话气泡，提示用户查看推荐技能
      setCatBubbleText(t('onboarding.recordingDone'))
    }
  }

  const handleResubmit = () => {
    setProfileSubmitted(false)
    setCatBubbleText('')
  }

  return (
    <div className="flex-1 flex flex-col px-8 pt-2">
      <h1 className="text-[24px] font-bold text-text-primary leading-tight">
        {t('onboarding.aboutYou')}
      </h1>
      <p className="mt-2 text-[14px] text-text-tertiary">{t('onboarding.aboutYouSubtitle')}</p>

      <div className="mt-6 space-y-5">
        {/* Nickname */}
        <div>
          <label className="block text-[16px] font-semibold text-text-primary mb-2">
            {t('onboarding.nameQuestion')}
          </label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, 20))}
            disabled={profileSubmitted}
            className="w-full px-4 py-3 bg-bg-input rounded-[10px] text-[15px] text-text-primary outline-none focus:ring-2 focus:ring-accent/10 disabled:opacity-60 transition-all"
            autoFocus
          />
        </div>

        {/* Role selector */}
        <div ref={dropdownRef}>
          <label className="block text-[16px] font-semibold text-text-primary mb-2">
            {t('onboarding.roleQuestion')}
          </label>
          <div
            onClick={() => !profileSubmitted && setDropdownOpen(!dropdownOpen)}
            className={`w-full flex items-center flex-wrap gap-1.5 px-3 py-2.5 min-h-[48px] bg-bg-input rounded-[10px] cursor-pointer border border-transparent transition-all ${
              dropdownOpen ? 'ring-2 ring-accent/10' : ''
            } ${profileSubmitted ? 'opacity-60 cursor-default' : ''}`}
          >
            {roles.map((role) => {
              const label = USER_ROLES.find((r) => r.value === role)?.label
              return (
                <span
                  key={role}
                  className="flex items-center gap-1 px-2.5 py-1 bg-bg-active text-text-primary text-[13px] rounded-md"
                >
                  {label}
                  {!profileSubmitted && (
                    <X
                      size={14}
                      className="cursor-pointer hover:text-text-primary"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeRole(role)
                      }}
                    />
                  )}
                </span>
              )
            })}
            {!profileSubmitted && (
              <ChevronDown size={18} className="ml-auto text-text-tertiary shrink-0" />
            )}
          </div>

          {/* Dropdown options */}
          {dropdownOpen && (
            <div className="mt-1 bg-bg-card border border-border-input rounded-[10px] shadow-dropdown overflow-hidden animate-fade-in z-50 relative">
              {USER_ROLES.map(({ value, label }) => {
                const isSelected = roles.includes(value)
                return (
                  <button
                    key={value}
                    onClick={() => toggleRole(value)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left text-[15px] transition-colors ${
                      isSelected
                        ? 'bg-bg-active text-text-primary'
                        : 'text-text-secondary hover:bg-bg-hover'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors ${
                        isSelected ? 'bg-accent' : 'border-2 border-border'
                      }`}
                    >
                      {isSelected && <Check size={14} className="text-white" strokeWidth={3} />}
                    </div>
                    <span>{label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Submit / Resubmit button */}
        {!profileSubmitted && nickname.trim() && roles.length > 0 && (
          <button
            onClick={handleSubmit}
            className="w-full py-3 bg-accent text-white text-[15px] font-semibold rounded-[10px] hover:bg-accent-hover active:scale-[0.96] transition-all duration-[120ms]"
          >
            {t('common.submit')}
          </button>
        )}
        {profileSubmitted && (
          <button
            onClick={handleResubmit}
            className="w-full py-3 bg-accent text-white text-[15px] font-semibold rounded-[10px] hover:bg-accent-hover active:scale-[0.96] transition-all duration-[120ms]"
          >
            {t('common.resubmit')}
          </button>
        )}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────
   Step 3: Skills recommendation
   ────────────────────────────────────────── */
function SkillsStep() {
  const { skills, toggleSkill } = useOnboardingStore()
  const { t } = useI18n()

  return (
    <div className="flex-1 flex flex-col px-8 pt-2 min-h-0">
      <h1 className="text-[24px] font-bold text-text-primary leading-tight">
        {t('onboarding.skillsTitle')}
      </h1>
      <p className="mt-2 text-[14px] text-text-tertiary italic">{t('onboarding.skillsSubtitle')}</p>

      <div className="mt-5 flex-1 overflow-y-auto border border-border-input rounded-[14px] divide-y divide-border">
        {skills.map((skill) => (
          <div
            key={skill.id}
            className="flex items-center gap-3.5 px-4 py-3.5 hover:bg-bg-hover transition-colors"
          >
            {/* Icon */}
            <div className="w-10 h-10 rounded-[10px] bg-bg-input flex items-center justify-center text-[20px] shrink-0">
              {skill.icon}
            </div>

            {/* Name + Description */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold text-text-primary">{skill.name}</span>
                {skill.tag === 'petclaw' && (
                  <span className="px-1.5 py-0.5 text-[11px] font-medium bg-bg-active text-text-secondary rounded">
                    PetClaw
                  </span>
                )}
                {skill.tag === 'needs-config' && (
                  <span className="px-1.5 py-0.5 text-[11px] font-medium bg-[#fee2e2] text-error rounded">
                    {t('onboarding.needsConfig')}
                  </span>
                )}
              </div>
              <p className="text-[13px] text-text-secondary truncate mt-0.5">{skill.description}</p>
            </div>

            {/* Toggle */}
            <button
              onClick={() => toggleSkill(skill.id)}
              className="shrink-0 transition-transform active:scale-[0.96]"
            >
              {skill.selected ? (
                <CircleCheck size={24} className="text-success" strokeWidth={2} />
              ) : (
                <Circle size={24} className="text-border" strokeWidth={1.5} />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────
   Step 4: Voice shortcut
   ────────────────────────────────────────── */
function ShortcutStep() {
  const { shortcut } = useOnboardingStore()
  const { t } = useI18n()
  const [isRecording, setIsRecording] = useState(false)

  return (
    <div className="flex-1 flex flex-col px-8 pt-2">
      <h1 className="text-[24px] font-bold text-text-primary leading-tight">
        {t('onboarding.voiceShortcut')}
      </h1>
      <p className="mt-3 text-[14px] text-text-secondary leading-relaxed">
        {t('onboarding.voiceHint')}
      </p>

      {/* Shortcut display */}
      <div className="mt-8 flex items-center justify-between p-4 border border-border-input rounded-[10px]">
        <div className="flex items-center gap-3">
          <Keyboard size={20} className="text-text-secondary" />
          <span className="text-[15px] text-text-primary">{t('onboarding.keyboardShortcut')}</span>
        </div>
        <span className="px-3 py-1 bg-bg-input rounded-[10px] text-[14px] font-mono text-text-secondary">
          {shortcut}
        </span>
      </div>

      {/* Mic test */}
      <div className="mt-8">
        <h3 className="text-[16px] font-semibold text-text-primary">
          {t('onboarding.voiceTestHint')}
        </h3>
        <p className="mt-2 text-[14px] text-text-secondary leading-relaxed">
          {t('onboarding.voiceTestDesc')}
        </p>

        <button
          onClick={() => setIsRecording(!isRecording)}
          className={`mt-4 w-full flex items-center gap-3 p-4 border rounded-[10px] transition-all ${
            isRecording ? 'border-error bg-[#fef2f2]' : 'border-border-input hover:bg-bg-hover'
          }`}
        >
          <Mic
            size={20}
            className={isRecording ? 'text-error animate-pulse' : 'text-text-tertiary'}
          />
          <span className={`text-[15px] ${isRecording ? 'text-error' : 'text-text-tertiary'}`}>
            {isRecording ? t('onboarding.recording') : t('onboarding.clickToSpeak')}
          </span>
        </button>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────
   Step 5: Starter cards — 快捷任务入口
   用户点击卡片后直接完成 onboarding 并发送首条消息
   ────────────────────────────────────────── */

function StarterCardsStep({ onSelectCard }: { onSelectCard: (message: string) => void }) {
  const { t } = useI18n()

  // 快捷任务卡片数据，依赖 t() 国际化，需在组件内部定义（避免模块级硬编码）
  const STARTER_CARDS = [
    {
      icon: '📰',
      title: t('onboarding.quickTask.news.title'),
      description: t('onboarding.quickTask.news.desc'),
      message: t('onboarding.quickTask.news.message')
    },
    {
      icon: '✉️',
      title: t('onboarding.quickTask.email.title'),
      description: t('onboarding.quickTask.email.desc'),
      message: t('onboarding.quickTask.email.message')
    },
    {
      icon: '📋',
      title: t('onboarding.quickTask.code.title'),
      description: t('onboarding.quickTask.code.desc'),
      message: t('onboarding.quickTask.code.message')
    },
    {
      icon: '📅',
      title: t('onboarding.quickTask.plan.title'),
      description: t('onboarding.quickTask.plan.desc'),
      message: t('onboarding.quickTask.plan.message')
    }
  ]

  return (
    <div className="flex-1 flex flex-col px-8 pt-2">
      <h1 className="text-[24px] font-bold text-text-primary leading-tight">
        {t('onboarding.tryTitle')}
      </h1>
      <p className="mt-3 text-[14px] text-text-secondary leading-relaxed">
        {t('onboarding.trySubtitle')}
      </p>

      {/* 2x2 卡片网格，点击后触发 onSelectCard 完成 onboarding */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        {STARTER_CARDS.map((card) => (
          <button
            key={card.title}
            onClick={() => onSelectCard(card.message)}
            className="flex flex-col items-start p-4 border border-border rounded-[14px] hover:bg-bg-hover hover:border-text-tertiary/30 transition-all active:scale-[0.96] duration-[120ms] text-left"
          >
            <span className="text-[24px] mb-2">{card.icon}</span>
            <h3 className="text-[14px] font-semibold text-text-primary mb-1">{card.title}</h3>
            <p className="text-[12px] text-text-tertiary leading-[1.5]">{card.description}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────
   Main Onboarding Panel
   ────────────────────────────────────────── */
export function OnboardingPanel({ onComplete }: { onComplete: () => void }) {
  const { step, catBubbleText, goNext, goPrev, setCatBubbleText } = useOnboardingStore()
  const { t } = useI18n()
  const isLastStep = step === 'first-chat'
  const isFirstStep = step === 'permissions'

  // 抽取保存配置逻辑，handleSkip / handleNext / handleSelectCard 都复用
  const saveAndComplete = useCallback(async () => {
    const store = useOnboardingStore.getState()
    await window.api.saveOnboardingConfig({
      nickname: store.nickname.trim() || 'PetClaw',
      roles: store.roles,
      selectedSkills: store.skills.filter((s) => s.selected).map((s) => s.id),
      voiceShortcut: store.shortcut,
      language: store.language
    })
    onComplete()
  }, [onComplete])

  const handleSkip = useCallback(async () => {
    await saveAndComplete()
  }, [saveAndComplete])

  const handleNext = useCallback(async () => {
    if (isLastStep) {
      // 最后一步点"开始使用"：保存配置后完成 onboarding
      await saveAndComplete()
    } else {
      setCatBubbleText('')
      goNext()
    }
  }, [isLastStep, saveAndComplete, goNext, setCatBubbleText])

  const handlePrev = useCallback(() => {
    setCatBubbleText('')
    goPrev()
  }, [goPrev, setCatBubbleText])

  // 用户点击 StarterCards 卡片：完成 onboarding 后延迟发送首条消息
  // 延迟 500ms 等 ChatView 完成挂载，避免消息丢失
  const handleSelectCard = useCallback(
    async (message: string) => {
      await saveAndComplete()
      setTimeout(() => {
        window.api.cowork.send(message, '')
      }, 500)
    },
    [saveAndComplete]
  )

  // profile 步骤显示猫咪对话气泡，其他步骤不显示
  const bubbleText = step === 'profile' ? catBubbleText : ''

  return (
    <div className="fixed inset-0 w-full h-full bg-bg-card flex flex-col overflow-hidden select-none">
      {/* Drag region + Language bar */}
      <div className="shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <LanguageBar />
      </div>

      {/* Main content: left/right split */}
      <div className="flex-1 flex min-h-0">
        {/* Left side: form content */}
        <div className="w-1/2 flex flex-col min-h-0">
          {/* Step progress */}
          <div className="px-8">
            <StepProgress current={step} />
          </div>

          {/* Step content */}
          {step === 'permissions' && <PermissionsStep />}
          {step === 'profile' && <ProfileStep />}
          {step === 'skills' && <SkillsStep />}
          {step === 'shortcut' && <ShortcutStep />}
          {/* 第 5 步替换为 StarterCards，点击卡片直接完成 onboarding 并发送首条消息 */}
          {step === 'first-chat' && <StarterCardsStep onSelectCard={handleSelectCard} />}
        </div>

        {/* Right side: cat mascot */}
        <div className="w-1/2 bg-bg-root">
          <CatMascot bubbleText={bubbleText || undefined} />
        </div>
      </div>

      {/* Footer navigation */}
      <NavFooter
        onSkip={handleSkip}
        onPrev={handlePrev}
        onNext={handleNext}
        showPrev={!isFirstStep}
        nextLabel={isLastStep ? t('common.startUsing') : t('common.nextStep')}
      />
    </div>
  )
}
