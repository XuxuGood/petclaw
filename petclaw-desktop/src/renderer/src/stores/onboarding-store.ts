import { create } from 'zustand'

export type OnboardingStep = 'permissions' | 'profile' | 'skills' | 'shortcut' | 'first-chat'

export type UserRole =
  | 'student'
  | 'entrepreneur'
  | 'developer'
  | 'designer'
  | 'creator'
  | 'researcher'

export const USER_ROLES: { value: UserRole; label: string }[] = [
  { value: 'student', label: '学生' },
  { value: 'entrepreneur', label: '创业者 / 自由职业者' },
  { value: 'developer', label: '程序员 / 开发者' },
  { value: 'designer', label: '设计师' },
  { value: 'creator', label: '内容创作者 / 博主' },
  { value: 'researcher', label: '研究员 / 学者' }
]

export interface SkillItem {
  id: string
  name: string
  description: string
  icon: string
  tag?: 'petclaw' | 'needs-config'
  selected: boolean
}

export const DEFAULT_SKILLS: SkillItem[] = [
  {
    id: 'skill-creator',
    name: '技能创建器',
    description: '通过引导式流程设计并生成新的 Claude Skill（SKILL.md 文件）',
    icon: '🔧',
    selected: true
  },
  {
    id: 'safe-browser',
    name: '安全浏览器',
    description: '操控真实浏览器浏览网页、填写表单、截图和提取内容',
    icon: '🌐',
    selected: true
  },
  {
    id: 'skill-audit',
    name: '技能安全审计',
    description: '安装外部技能前自动扫描安全风险，给出 A-F 安全评级',
    icon: '🛡️',
    selected: true
  },
  {
    id: 'apple-reminders',
    name: 'Apple 提醒事项',
    description: '管理 Apple 提醒事项，设置待办和截止日期',
    icon: '📋',
    tag: 'needs-config',
    selected: false
  },
  {
    id: 'calendar',
    name: 'Calendar',
    description: 'Create calendar events on macOS automatically via AppleScript',
    icon: '📅',
    tag: 'petclaw',
    selected: true
  },
  {
    id: 'ai-news',
    name: 'AI News',
    description: "Fetch and summarise today's latest AI news",
    icon: '📰',
    tag: 'petclaw',
    selected: true
  },
  {
    id: 'deep-research',
    name: 'Deep Research',
    description: 'Conduct deep research with structured plans, broad searches and synthesis',
    icon: '🔍',
    tag: 'petclaw',
    selected: true
  }
]

export type Language = 'en' | 'zh' | 'ja' | 'es' | 'pt'

interface PermissionStatus {
  accessibility: boolean
  microphone: boolean
}

interface OnboardingState {
  step: OnboardingStep
  language: Language
  permissions: PermissionStatus
  nickname: string
  roles: UserRole[]
  profileSubmitted: boolean
  skills: SkillItem[]
  shortcut: string
  catBubbleText: string

  // Actions
  setStep: (step: OnboardingStep) => void
  setLanguage: (lang: Language) => void
  setPermission: (key: keyof PermissionStatus, value: boolean) => void
  setNickname: (name: string) => void
  toggleRole: (role: UserRole) => void
  removeRole: (role: UserRole) => void
  setProfileSubmitted: (val: boolean) => void
  toggleSkill: (id: string) => void
  setShortcut: (shortcut: string) => void
  setCatBubbleText: (text: string) => void
  goNext: () => void
  goPrev: () => void
  reset: () => void
}

const STEPS: OnboardingStep[] = ['permissions', 'profile', 'skills', 'shortcut', 'first-chat']

export const useOnboardingStore = create<OnboardingState>()((set, get) => ({
  step: 'permissions',
  language: 'zh',
  permissions: { accessibility: false, microphone: false },
  nickname: '',
  roles: [],
  profileSubmitted: false,
  skills: DEFAULT_SKILLS.map((s) => ({ ...s })),
  shortcut: 'Command + D',
  catBubbleText: '',

  setStep: (step) => set({ step }),
  setLanguage: (language) => set({ language }),
  setPermission: (key, value) =>
    set((state) => ({ permissions: { ...state.permissions, [key]: value } })),
  setNickname: (nickname) => set({ nickname }),
  toggleRole: (role) =>
    set((state) => ({
      roles: state.roles.includes(role)
        ? state.roles.filter((r) => r !== role)
        : [...state.roles, role]
    })),
  removeRole: (role) => set((state) => ({ roles: state.roles.filter((r) => r !== role) })),
  setProfileSubmitted: (profileSubmitted) => set({ profileSubmitted }),
  toggleSkill: (id) =>
    set((state) => ({
      skills: state.skills.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s))
    })),
  setShortcut: (shortcut) => set({ shortcut }),
  setCatBubbleText: (catBubbleText) => set({ catBubbleText }),

  goNext: () => {
    const { step } = get()
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) {
      set({ step: STEPS[idx + 1] })
    }
  },
  goPrev: () => {
    const { step } = get()
    const idx = STEPS.indexOf(step)
    if (idx > 0) {
      set({ step: STEPS[idx - 1] })
    }
  },
  reset: () =>
    set({
      step: 'permissions',
      language: 'zh',
      permissions: { accessibility: false, microphone: false },
      nickname: '',
      roles: [],
      profileSubmitted: false,
      skills: DEFAULT_SKILLS.map((s) => ({ ...s })),
      shortcut: 'Command + D',
      catBubbleText: ''
    })
}))

export { STEPS }
