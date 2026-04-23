// 预设 Agent 模板 — 应用首次启动时写入数据库，不可删除（isDefault 的 main 除外）
import type { Agent } from '../ai/types'

// 预设 Agent 不含时间戳字段，由 AgentManager 在写入时补充
type PresetAgent = Omit<Agent, 'createdAt' | 'updatedAt'>

export const PRESET_AGENTS: PresetAgent[] = [
  {
    id: 'main',
    name: '默认助手',
    description: '通用 AI 助手，不可删除',
    systemPrompt: '',
    identity: '',
    model: '',
    icon: '🐾',
    skillIds: [],
    enabled: true,
    isDefault: true,
    source: 'preset',
    presetId: 'main'
  },
  {
    id: 'code-expert',
    name: '代码专家',
    description: '编程辅助，代码审查与优化',
    systemPrompt: '你是一位资深编程专家，擅长代码审查、重构和调试。',
    identity: '',
    model: '',
    icon: '💻',
    skillIds: [],
    enabled: true,
    isDefault: false,
    source: 'preset',
    presetId: 'code-expert'
  },
  {
    id: 'content-creator',
    name: '内容创作',
    description: '文案写作、文章创作、内容策划',
    systemPrompt: '你是一位创意写作专家，擅长撰写各类文案和文章。',
    identity: '',
    model: '',
    icon: '✍️',
    skillIds: [],
    enabled: true,
    isDefault: false,
    source: 'preset',
    presetId: 'content-creator'
  },
  {
    id: 'pet-care',
    name: '萌宠管家',
    description: '宠物健康、行为咨询、养护建议',
    systemPrompt: '你是一位经验丰富的宠物专家，了解各类宠物的健康和行为知识。',
    identity: '',
    model: '',
    icon: '🐱',
    skillIds: [],
    enabled: true,
    isDefault: false,
    source: 'preset',
    presetId: 'pet-care'
  }
]
