// provider-display.ts：Provider 显示元数据（缩写和颜色），供 renderer 侧 UI 使用。
// 与 provider-registry.ts 的 logo 字段对齐，logo 值作为 key。

// 文字缩写 Logo，用于 Provider 列表的头像圆角方块
const PROVIDER_ABBREVIATION: Record<string, string> = {
  petclaw: 'PC',
  openai: 'OAI',
  anthropic: 'ANT',
  deepseek: 'DS',
  zhipu: 'GLM',
  minimax: 'MM',
  volcengine: 'ARK',
  youdao: 'YD',
  qianfan: 'QF',
  stepfun: 'SF',
  xiaomi: 'MI',
  ollama: 'OLL',
  gemini: 'GGL',
  alibaba: 'ALI',
  mistral: 'MIS',
  groq: 'GRQ'
}

// Tailwind 背景色 class，用于 Provider 头像圆角方块
const PROVIDER_COLOR: Record<string, string> = {
  petclaw: 'bg-violet-500',
  openai: 'bg-emerald-600',
  anthropic: 'bg-amber-600',
  deepseek: 'bg-sky-600',
  zhipu: 'bg-teal-600',
  minimax: 'bg-cyan-600',
  volcengine: 'bg-indigo-500',
  youdao: 'bg-red-500',
  qianfan: 'bg-blue-600',
  stepfun: 'bg-fuchsia-600',
  xiaomi: 'bg-orange-500',
  ollama: 'bg-slate-600',
  gemini: 'bg-blue-500',
  alibaba: 'bg-orange-600',
  mistral: 'bg-purple-600',
  groq: 'bg-lime-600'
}

export function getProviderAbbreviation(id: string, fallbackName: string): string {
  return PROVIDER_ABBREVIATION[id] ?? fallbackName.slice(0, 2).toUpperCase()
}

export function getProviderColor(id: string): string {
  return PROVIDER_COLOR[id] ?? 'bg-gray-500'
}
