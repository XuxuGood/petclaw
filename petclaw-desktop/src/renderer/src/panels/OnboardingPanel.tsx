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
  return (
    <div className="flex items-center justify-between px-8 pb-6 pt-3">
      <button
        onClick={onSkip}
        className="text-[14px] text-text-tertiary hover:text-text-secondary transition-colors"
      >
        跳过
      </button>
      <div className="flex items-center gap-3">
        {showPrev && (
          <button
            onClick={onPrev}
            className="px-5 py-2 text-[14px] text-text-primary bg-bg-card border border-border rounded-[10px] hover:bg-bg-hover active:scale-[0.96] transition-all duration-[120ms]"
          >
            上一步
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

  const handlePermission = async (type: 'accessibility' | 'microphone') => {
    // In production: call system API to request permission
    // For now, toggle to simulate
    setPermission(type, !permissions[type])
  }

  return (
    <div className="flex-1 flex flex-col px-8 pt-2">
      <h1 className="text-[24px] font-bold text-text-primary leading-tight">
        在您的电脑上设置 PetClaw
      </h1>
      <p className="mt-3 text-[14px] text-text-secondary leading-relaxed">
        PetClaw 需要以下权限才能正常工作。您的数据仅在本地处理，我们不会存储任何内容。
      </p>

      <div className="mt-8 space-y-4">
        {/* Accessibility */}
        <button
          onClick={() => handlePermission('accessibility')}
          className="w-full flex items-center justify-between p-4 border border-border-input rounded-[10px] hover:bg-bg-hover transition-colors text-left"
        >
          <span className="text-[15px] text-text-primary font-medium">
            允许 PetClaw 使用辅助功能
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
            允许 PetClaw 使用您的麦克风
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
      <h1 className="text-[24px] font-bold text-text-primary leading-tight">告诉我们关于您</h1>
      <p className="mt-2 text-[14px] text-text-tertiary">帮助 PetClaw 为您打造个性化体验</p>

      <div className="mt-6 space-y-5">
        {/* Nickname */}
        <div>
          <label className="block text-[16px] font-semibold text-text-primary mb-2">
            怎么称呼您?
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
            选择您的身份角色
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
            提交
          </button>
        )}
        {profileSubmitted && (
          <button
            onClick={handleResubmit}
            className="w-full py-3 bg-accent text-white text-[15px] font-semibold rounded-[10px] hover:bg-accent-hover active:scale-[0.96] transition-all duration-[120ms]"
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
function SkillsStep() {
  const { skills, toggleSkill } = useOnboardingStore()

  return (
    <div className="flex-1 flex flex-col px-8 pt-2 min-h-0">
      <h1 className="text-[24px] font-bold text-text-primary leading-tight">PetClaw 拥有的技能</h1>
      <p className="mt-2 text-[14px] text-text-tertiary italic">
        我们为您默认安装好用且安全的 Skill
      </p>

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
                    需配置
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
  const [isRecording, setIsRecording] = useState(false)

  return (
    <div className="flex-1 flex flex-col px-8 pt-2">
      <h1 className="text-[24px] font-bold text-text-primary leading-tight">语音快捷键</h1>
      <p className="mt-3 text-[14px] text-text-secondary leading-relaxed">
        按下快捷键开始说话，再按一次确认发送。
      </p>

      {/* Shortcut display */}
      <div className="mt-8 flex items-center justify-between p-4 border border-border-input rounded-[10px]">
        <div className="flex items-center gap-3">
          <Keyboard size={20} className="text-text-secondary" />
          <span className="text-[15px] text-text-primary">键盘快捷键</span>
        </div>
        <span className="px-3 py-1 bg-bg-input rounded-[10px] text-[14px] font-mono text-text-secondary">
          {shortcut}
        </span>
      </div>

      {/* Mic test */}
      <div className="mt-8">
        <h3 className="text-[16px] font-semibold text-text-primary">口述以测试您的麦克风</h3>
        <p className="mt-2 text-[14px] text-text-secondary leading-relaxed">
          点击下方按钮或按快捷键开始说话，介绍一下自己，顺便给我取个名字吧。
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
            {isRecording ? '正在录音...' : '点击开始说话'}
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

// 快捷任务卡片数据，集中定义避免魔法值散落
const STARTER_CARDS = [
  {
    icon: '📰',
    title: '帮我整理今日资讯',
    description: '搜集 AI、科技领域的最新动态，整理成简报',
    message: '请帮我整理今日 AI 和科技领域的最新资讯，按重要性排序'
  },
  {
    icon: '✉️',
    title: '帮我写一封邮件',
    description: '根据你的描述，生成一封专业的邮件',
    message: '我需要写一封邮件'
  },
  {
    icon: '📋',
    title: '整理代码仓库',
    description: '分析项目结构，生成文档和改进建议',
    message: '帮我分析当前项目结构，列出改进建议'
  },
  {
    icon: '📅',
    title: '创建每日工作计划',
    description: '根据待办事项，制定今日工作安排',
    message: '帮我制定今天的工作计划'
  }
]

function StarterCardsStep({ onSelectCard }: { onSelectCard: (message: string) => void }) {
  return (
    <div className="flex-1 flex flex-col px-8 pt-2">
      <h1 className="text-[24px] font-bold text-text-primary leading-tight">
        试试让 PetClaw 帮你做点什么
      </h1>
      <p className="mt-3 text-[14px] text-text-secondary leading-relaxed">
        选择一个快捷任务开始，或者跳过直接开始使用
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
        nextLabel={isLastStep ? '开始使用' : '下一步'}
      />
    </div>
  )
}
