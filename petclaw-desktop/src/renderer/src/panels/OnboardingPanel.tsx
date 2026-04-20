import { useState, useRef, useEffect, useCallback } from 'react'
import { Check, ChevronDown, X, Keyboard, Mic, CircleCheck, Circle } from 'lucide-react'
import {
  useOnboardingStore,
  STEPS,
  USER_ROLES,
  type OnboardingStep,
  type Language
} from '../stores/onboarding-store'
import catStaticSrc from '../assets/cat/static.webm'

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

function LanguageBar(): JSX.Element {
  const { language, setLanguage } = useOnboardingStore()
  return (
    <div className="flex items-center justify-center gap-1 py-3 text-[13px] text-[#a1a1aa] select-none">
      {LANGUAGES.map((lang, i) => (
        <span key={lang.code} className="flex items-center gap-1">
          {i > 0 && <span className="text-[#d4d4d8]">/</span>}
          <button
            onClick={() => setLanguage(lang.code)}
            className={`px-1 transition-colors ${
              language === lang.code ? 'text-[#18181b] font-bold' : 'hover:text-[#52525b]'
            }`}
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
function StepProgress({ current }: { current: OnboardingStep }): JSX.Element {
  const currentIdx = STEPS.indexOf(current)
  return (
    <div className="flex items-center gap-2 py-4 pl-1">
      {STEPS.map((_, i) => (
        <div
          key={i}
          className={`h-[3px] rounded-full transition-colors duration-300 ${
            i <= currentIdx ? 'w-[40px] bg-[#18181b]' : 'w-[40px] bg-[#d4d4d8]'
          }`}
        />
      ))}
    </div>
  )
}

/* ──────────────────────────────────────────
   Cat mascot with optional speech bubble
   ────────────────────────────────────────── */
function CatMascot({ bubbleText }: { bubbleText?: string }): JSX.Element {
  return (
    <div className="relative flex flex-col items-center justify-center h-full">
      {bubbleText && (
        <div className="absolute top-[22%] right-[8%] max-w-[260px] animate-fade-in">
          <div className="bg-[#27272a] text-white text-[13px] leading-[1.6] px-4 py-3 rounded-xl">
            {bubbleText}
          </div>
          {/* Tail */}
          <div className="ml-[40%] w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[10px] border-t-[#27272a]" />
        </div>
      )}
      <video
        src={catStaticSrc}
        autoPlay
        loop
        muted
        playsInline
        className="w-[220px] h-auto mt-8 pointer-events-none"
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
}): JSX.Element {
  return (
    <div className="flex items-center justify-between px-8 pb-6 pt-3">
      <button
        onClick={onSkip}
        className="text-[14px] text-[#a1a1aa] hover:text-[#52525b] transition-colors"
      >
        跳过
      </button>
      <div className="flex items-center gap-3">
        {showPrev && (
          <button
            onClick={onPrev}
            className="px-5 py-2 text-[14px] text-[#18181b] bg-white border border-[#d4d4d8] rounded-lg hover:bg-[#f4f4f5] active:scale-[0.97] transition-all"
          >
            上一步
          </button>
        )}
        <button
          onClick={onNext}
          className="px-5 py-2 text-[14px] text-white bg-[#18181b] rounded-lg hover:bg-[#27272a] active:scale-[0.97] transition-all"
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
function PermissionsStep(): JSX.Element {
  const { permissions, setPermission } = useOnboardingStore()

  const handlePermission = async (type: 'accessibility' | 'microphone') => {
    // In production: call system API to request permission
    // For now, toggle to simulate
    setPermission(type, !permissions[type])
  }

  return (
    <div className="flex-1 flex flex-col px-8 pt-2">
      <h1 className="text-[24px] font-bold text-[#18181b] leading-tight">
        在您的电脑上设置 PetClaw
      </h1>
      <p className="mt-3 text-[14px] text-[#71717a] leading-relaxed">
        PetClaw 需要以下权限才能正常工作。您的数据仅在本地处理，我们不会存储任何内容。
      </p>

      <div className="mt-8 space-y-4">
        {/* Accessibility */}
        <button
          onClick={() => handlePermission('accessibility')}
          className="w-full flex items-center justify-between p-4 border border-[#e4e4e7] rounded-xl hover:bg-[#fafafa] transition-colors text-left"
        >
          <span className="text-[15px] text-[#18181b] font-medium">允许 PetClaw 使用辅助功能</span>
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
              permissions.accessibility ? 'bg-[#18181b]' : 'border-2 border-[#d4d4d8]'
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
          className="w-full flex items-center justify-between p-4 border border-[#e4e4e7] rounded-xl hover:bg-[#fafafa] transition-colors text-left"
        >
          <span className="text-[15px] text-[#18181b] font-medium">
            允许 PetClaw 使用您的麦克风
          </span>
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
              permissions.microphone ? 'bg-[#18181b]' : 'border-2 border-[#d4d4d8]'
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
function ProfileStep(): JSX.Element {
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
      setCatBubbleText('记录完成！已为您推荐了合适的技能，点击下一步查看吧~')
    }
  }

  const handleResubmit = () => {
    setProfileSubmitted(false)
    setCatBubbleText('')
  }

  return (
    <div className="flex-1 flex flex-col px-8 pt-2">
      <h1 className="text-[24px] font-bold text-[#18181b] leading-tight">告诉我们关于您</h1>
      <p className="mt-2 text-[14px] text-[#a1a1aa]">帮助 PetClaw 为您打造个性化体验</p>

      <div className="mt-6 space-y-5">
        {/* Nickname */}
        <div>
          <label className="block text-[16px] font-semibold text-[#18181b] mb-2">怎么称呼您?</label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, 20))}
            disabled={profileSubmitted}
            className="w-full px-4 py-3 bg-[#f4f4f5] rounded-xl text-[15px] text-[#18181b] outline-none focus:ring-2 focus:ring-[#18181b]/10 disabled:opacity-60 transition-all"
            autoFocus
          />
        </div>

        {/* Role selector */}
        <div ref={dropdownRef}>
          <label className="block text-[16px] font-semibold text-[#18181b] mb-2">
            选择您的身份角色
          </label>
          <div
            onClick={() => !profileSubmitted && setDropdownOpen(!dropdownOpen)}
            className={`w-full flex items-center flex-wrap gap-1.5 px-3 py-2.5 min-h-[48px] bg-[#f4f4f5] rounded-xl cursor-pointer border border-transparent transition-all ${
              dropdownOpen ? 'ring-2 ring-[#18181b]/10' : ''
            } ${profileSubmitted ? 'opacity-60 cursor-default' : ''}`}
          >
            {roles.map((role) => {
              const label = USER_ROLES.find((r) => r.value === role)?.label
              return (
                <span
                  key={role}
                  className="flex items-center gap-1 px-2.5 py-1 bg-[#e0e7ff] text-[#3730a3] text-[13px] rounded-md"
                >
                  {label}
                  {!profileSubmitted && (
                    <X
                      size={14}
                      className="cursor-pointer hover:text-[#1e1b4b]"
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
              <ChevronDown size={18} className="ml-auto text-[#a1a1aa] shrink-0" />
            )}
          </div>

          {/* Dropdown options */}
          {dropdownOpen && (
            <div className="mt-1 bg-white border border-[#e4e4e7] rounded-xl shadow-lg overflow-hidden animate-fade-in z-50 relative">
              {USER_ROLES.map(({ value, label }) => {
                const isSelected = roles.includes(value)
                return (
                  <button
                    key={value}
                    onClick={() => toggleRole(value)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left text-[15px] transition-colors ${
                      isSelected
                        ? 'bg-[#eef2ff] text-[#18181b]'
                        : 'text-[#3f3f46] hover:bg-[#fafafa]'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors ${
                        isSelected ? 'bg-[#6366f1]' : 'border-2 border-[#d4d4d8]'
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
            className="w-full py-3 bg-[#18181b] text-white text-[15px] font-semibold rounded-xl hover:bg-[#27272a] active:scale-[0.98] transition-all"
          >
            提交
          </button>
        )}
        {profileSubmitted && (
          <button
            onClick={handleResubmit}
            className="w-full py-3 bg-[#18181b] text-white text-[15px] font-semibold rounded-xl hover:bg-[#27272a] active:scale-[0.98] transition-all"
          >
            重新提交
          </button>
        )}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────
   Step 3: Skills recommendation
   ────────────────────────────────────────── */
function SkillsStep(): JSX.Element {
  const { skills, toggleSkill } = useOnboardingStore()

  return (
    <div className="flex-1 flex flex-col px-8 pt-2 min-h-0">
      <h1 className="text-[24px] font-bold text-[#18181b] leading-tight">PetClaw 拥有的技能</h1>
      <p className="mt-2 text-[14px] text-[#a1a1aa] italic">我们为您默认安装好用且安全的 Skill</p>

      <div className="mt-5 flex-1 overflow-y-auto border border-[#e4e4e7] rounded-2xl divide-y divide-[#f4f4f5]">
        {skills.map((skill) => (
          <div
            key={skill.id}
            className="flex items-center gap-3.5 px-4 py-3.5 hover:bg-[#fafafa] transition-colors"
          >
            {/* Icon */}
            <div className="w-10 h-10 rounded-xl bg-[#f4f4f5] flex items-center justify-center text-[20px] shrink-0">
              {skill.icon}
            </div>

            {/* Name + Description */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold text-[#18181b]">{skill.name}</span>
                {skill.tag === 'petclaw' && (
                  <span className="px-1.5 py-0.5 text-[11px] font-medium bg-[#ede9fe] text-[#7c3aed] rounded">
                    PetClaw
                  </span>
                )}
                {skill.tag === 'needs-config' && (
                  <span className="px-1.5 py-0.5 text-[11px] font-medium bg-[#fee2e2] text-[#dc2626] rounded">
                    需配置
                  </span>
                )}
              </div>
              <p className="text-[13px] text-[#71717a] truncate mt-0.5">{skill.description}</p>
            </div>

            {/* Toggle */}
            <button
              onClick={() => toggleSkill(skill.id)}
              className="shrink-0 transition-transform active:scale-90"
            >
              {skill.selected ? (
                <CircleCheck size={24} className="text-[#16a34a]" strokeWidth={2} />
              ) : (
                <Circle size={24} className="text-[#d4d4d8]" strokeWidth={1.5} />
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
function ShortcutStep(): JSX.Element {
  const { shortcut } = useOnboardingStore()
  const [isRecording, setIsRecording] = useState(false)

  return (
    <div className="flex-1 flex flex-col px-8 pt-2">
      <h1 className="text-[24px] font-bold text-[#18181b] leading-tight">语音快捷键</h1>
      <p className="mt-3 text-[14px] text-[#71717a] leading-relaxed">
        按下快捷键开始说话，再按一次确认发送。
      </p>

      {/* Shortcut display */}
      <div className="mt-8 flex items-center justify-between p-4 border border-[#e4e4e7] rounded-xl">
        <div className="flex items-center gap-3">
          <Keyboard size={20} className="text-[#71717a]" />
          <span className="text-[15px] text-[#18181b]">键盘快捷键</span>
        </div>
        <span className="px-3 py-1 bg-[#f4f4f5] rounded-lg text-[14px] font-mono text-[#3f3f46]">
          {shortcut}
        </span>
      </div>

      {/* Mic test */}
      <div className="mt-8">
        <h3 className="text-[16px] font-semibold text-[#18181b]">口述以测试您的麦克风</h3>
        <p className="mt-2 text-[14px] text-[#71717a] leading-relaxed">
          点击下方按钮或按快捷键开始说话，介绍一下自己，顺便给我取个名字吧。
        </p>

        <button
          onClick={() => setIsRecording(!isRecording)}
          className={`mt-4 w-full flex items-center gap-3 p-4 border rounded-xl transition-all ${
            isRecording ? 'border-[#dc2626] bg-[#fef2f2]' : 'border-[#e4e4e7] hover:bg-[#fafafa]'
          }`}
        >
          <Mic
            size={20}
            className={isRecording ? 'text-[#dc2626] animate-pulse' : 'text-[#a1a1aa]'}
          />
          <span className={`text-[15px] ${isRecording ? 'text-[#dc2626]' : 'text-[#a1a1aa]'}`}>
            {isRecording ? '正在录音...' : '点击开始说话'}
          </span>
        </button>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────
   Step 5: First chat experience
   ────────────────────────────────────────── */
function FirstChatStep(): JSX.Element {
  const [isRecording, setIsRecording] = useState(false)

  return (
    <div className="flex-1 flex flex-col px-8 pt-2">
      <h1 className="text-[24px] font-bold text-[#18181b] leading-tight">获取今日资讯</h1>
      <p className="mt-3 text-[14px] text-[#71717a] leading-relaxed">
        再来一次，让小猫帮您搜集整理信息。
      </p>

      {/* Example conversation bubble */}
      <div className="mt-6 flex items-center gap-3 p-4 bg-[#f4f4f5] rounded-xl">
        <div className="w-8 h-8 rounded-lg bg-[#e4e4e7] flex items-center justify-center shrink-0">
          <span className="text-[14px]">🖼️</span>
        </div>
        <span className="text-[15px] text-[#18181b]">"请整理今日最新 AI 资讯"</span>
      </div>

      {/* Divider: "现在轮到您了" */}
      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-[#e4e4e7]" />
        <span className="text-[13px] text-[#a1a1aa]">现在轮到您了</span>
        <div className="flex-1 h-px bg-[#e4e4e7]" />
      </div>

      {/* Voice input */}
      <button
        onClick={() => setIsRecording(!isRecording)}
        className={`w-full flex items-center gap-3 p-4 border rounded-xl transition-all ${
          isRecording ? 'border-[#dc2626] bg-[#fef2f2]' : 'border-[#e4e4e7] hover:bg-[#fafafa]'
        }`}
      >
        <Mic
          size={20}
          className={isRecording ? 'text-[#dc2626] animate-pulse' : 'text-[#a1a1aa]'}
        />
        <span
          className={`text-[15px] flex-1 text-left ${isRecording ? 'text-[#dc2626]' : 'text-[#a1a1aa]'}`}
        >
          {isRecording ? '正在录音...' : '点击开始说话'}
        </span>
        {!isRecording && (
          <div className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 bg-[#f4f4f5] border border-[#e4e4e7] rounded text-[12px] font-mono text-[#71717a]">
              Command
            </span>
            <span className="px-2 py-0.5 bg-[#f4f4f5] border border-[#e4e4e7] rounded text-[12px] font-mono text-[#71717a]">
              D
            </span>
          </div>
        )}
      </button>
    </div>
  )
}

/* ──────────────────────────────────────────
   Main Onboarding Panel
   ────────────────────────────────────────── */
export function OnboardingPanel({ onComplete }: { onComplete: () => void }): JSX.Element {
  const { step, catBubbleText, goNext, goPrev, setCatBubbleText } = useOnboardingStore()
  const isLastStep = step === 'first-chat'
  const isFirstStep = step === 'permissions'

  const handleSkip = useCallback(async () => {
    await window.api.setSetting('onboardingCompleted', 'true')
    onComplete()
  }, [onComplete])

  const handleNext = useCallback(async () => {
    if (isLastStep) {
      await window.api.setSetting('onboardingCompleted', 'true')
      // Save user data to SQLite
      const store = useOnboardingStore.getState()
      await window.api.setSetting('petName', store.nickname.trim() || 'PetClaw')
      await window.api.setSetting('userRoles', JSON.stringify(store.roles))
      await window.api.setSetting(
        'selectedSkills',
        JSON.stringify(store.skills.filter((s) => s.selected).map((s) => s.id))
      )
      await window.api.setSetting('voiceShortcut', store.shortcut)
      // Save to ~/.petclaw config files
      await window.api.saveOnboardingConfig({
        nickname: store.nickname.trim() || 'PetClaw',
        roles: store.roles,
        selectedSkills: store.skills.filter((s) => s.selected).map((s) => s.id),
        voiceShortcut: store.shortcut,
        language: store.language
      })
      onComplete()
    } else {
      setCatBubbleText('')
      goNext()
    }
  }, [isLastStep, onComplete, goNext, setCatBubbleText])

  const handlePrev = useCallback(() => {
    setCatBubbleText('')
    goPrev()
  }, [goPrev, setCatBubbleText])

  // Determine bubble text based on step
  const bubbleText = step === 'profile' ? catBubbleText : ''

  return (
    <div className="fixed inset-0 w-full h-full bg-white flex flex-col overflow-hidden select-none">
      {/* Language bar */}
      <LanguageBar />

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
          {step === 'first-chat' && <FirstChatStep />}
        </div>

        {/* Right side: cat mascot */}
        <div className="w-1/2 bg-[#fafafa]">
          <CatMascot bubbleText={bubbleText || undefined} />
        </div>
      </div>

      {/* Footer navigation */}
      <NavFooter
        onSkip={handleSkip}
        onPrev={handlePrev}
        onNext={handleNext}
        showPrev={!isFirstStep}
        nextLabel={isLastStep ? '开始使用' : '下一步'}
      />
    </div>
  )
}
