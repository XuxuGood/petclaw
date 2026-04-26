import { PawPrint, FolderOpen, PenLine, BarChart3 } from 'lucide-react'

// 根据当前时段返回问候语
function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return '早上好'
  if (hour >= 12 && hour < 18) return '下午好'
  return '晚上好'
}

const QUICK_CARDS = [
  {
    icon: FolderOpen,
    title: '文件整理',
    desc: '智能整理和管理本地文件',
    prompt: '帮我整理桌面文件，按类型分类到对应文件夹'
  },
  {
    icon: PenLine,
    title: '内容创作',
    desc: '创作演讲文稿和多种内容',
    prompt: '帮我写一篇关于的文章'
  },
  {
    icon: BarChart3,
    title: '文档处理',
    desc: '处理和分析文档数据内容',
    prompt: '帮我分析这份文档的关键信息'
  }
]

interface WelcomePageProps {
  onSendPrompt: (text: string) => void
}

export function WelcomePage({ onSendPrompt }: WelcomePageProps) {
  const greeting = getGreeting()

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      {/* 吉祥物图标 */}
      <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mb-6">
        <PawPrint size={30} className="text-white" strokeWidth={2} />
      </div>

      {/* 问候语 + 标语 */}
      <h2 className="text-[20px] font-bold text-text-primary mb-2 tracking-tight">
        {greeting}，不止聊天，搞定一切
      </h2>
      <p className="text-[14px] text-text-tertiary mb-10">
        本地运行，自主规划，安全可控的 AI 工作搭子
      </p>

      {/* 快捷提示卡片 */}
      <div className="flex gap-4 max-w-[640px]">
        {QUICK_CARDS.map((card) => {
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
