import { PawPrint, FolderOpen, PenLine, BarChart3 } from 'lucide-react'

import { useI18n } from '../i18n'

interface WelcomePageProps {
  onSendPrompt: (text: string) => void
}

export function WelcomePage({ onSendPrompt }: WelcomePageProps) {
  const { t } = useI18n()

  // 根据当前时段返回问候语（依赖 t，必须在组件内调用）
  const hour = new Date().getHours()
  let greeting: string
  if (hour >= 5 && hour < 12) greeting = t('welcome.morning')
  else if (hour >= 12 && hour < 18) greeting = t('welcome.afternoon')
  else greeting = t('welcome.evening')

  // 快捷卡片数据（包含中文文案，必须放在组件内部使用 t()）
  const quickCards = [
    {
      icon: FolderOpen,
      title: t('welcome.card.fileOrganize.title'),
      desc: t('welcome.card.fileOrganize.desc'),
      prompt: t('welcome.card.fileOrganize.prompt')
    },
    {
      icon: PenLine,
      title: t('welcome.card.contentCreation.title'),
      desc: t('welcome.card.contentCreation.desc'),
      prompt: t('welcome.card.contentCreation.prompt')
    },
    {
      icon: BarChart3,
      title: t('welcome.card.docProcess.title'),
      desc: t('welcome.card.docProcess.desc'),
      prompt: t('welcome.card.docProcess.prompt')
    }
  ]

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      {/* 吉祥物图标 */}
      <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mb-6">
        <PawPrint size={30} className="text-white" strokeWidth={2} />
      </div>

      {/* 问候语 + 标语 */}
      <h2 className="text-[20px] font-bold text-text-primary mb-2 tracking-tight">
        {greeting}，{t('welcome.tagline')}
      </h2>
      <p className="text-[14px] text-text-tertiary mb-10">{t('welcome.subtitle')}</p>

      {/* 快捷提示卡片 */}
      <div className="flex gap-4 max-w-[640px]">
        {quickCards.map((card) => {
          const Icon = card.icon
          return (
            <button
              key={card.title}
              onClick={() => onSendPrompt(card.prompt)}
              className="flex-1 flex flex-col items-start p-4 rounded-[14px] bg-bg-card border border-border shadow-[var(--shadow-card)] hover:border-text-tertiary hover:shadow-[var(--shadow-dropdown)] active:scale-[0.96] transition-all duration-[120ms] text-left"
            >
              <Icon size={20} className="text-text-secondary mb-3" strokeWidth={1.75} />
              <span className="text-[14px] font-medium text-text-primary mb-1">{card.title}</span>
              <span className="text-[12px] text-text-tertiary leading-[1.5]">{card.desc}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
