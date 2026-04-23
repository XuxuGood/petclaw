// 16 个内置预设 Provider，不含用户运行时字段（apiKey / enabled / isCustom）
import type { ModelProvider } from '../ai/types'

type PresetProvider = Omit<ModelProvider, 'apiKey' | 'enabled' | 'isCustom'>

export const PRESET_PROVIDERS: PresetProvider[] = [
  {
    id: 'petclaw',
    name: 'PetClaw',
    logo: 'petclaw',
    baseUrl: 'https://petclaw.ai/api/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      {
        id: 'petclaw-fast',
        name: 'PetClaw Fast',
        reasoning: false,
        supportsImage: true,
        contextWindow: 128000,
        maxTokens: 4096
      },
      {
        id: 'petclaw-pro',
        name: 'PetClaw Pro',
        reasoning: true,
        supportsImage: true,
        contextWindow: 200000,
        maxTokens: 8192
      }
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    logo: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        reasoning: false,
        supportsImage: true,
        contextWindow: 128000,
        maxTokens: 16384
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o mini',
        reasoning: false,
        supportsImage: true,
        contextWindow: 128000,
        maxTokens: 16384
      },
      {
        id: 'o3-mini',
        name: 'o3-mini',
        reasoning: true,
        supportsImage: false,
        contextWindow: 200000,
        maxTokens: 100000
      }
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    logo: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiFormat: 'anthropic',
    isPreset: true,
    models: [
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        reasoning: false,
        supportsImage: true,
        contextWindow: 200000,
        maxTokens: 8192
      },
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        reasoning: true,
        supportsImage: true,
        contextWindow: 200000,
        maxTokens: 8192
      }
    ]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    logo: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        reasoning: false,
        supportsImage: false,
        contextWindow: 64000,
        maxTokens: 8192
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        reasoning: true,
        supportsImage: false,
        contextWindow: 64000,
        maxTokens: 8192
      }
    ]
  },
  {
    id: 'zhipu',
    name: '智谱 Zhipu',
    logo: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      {
        id: 'glm-4-plus',
        name: 'GLM-4 Plus',
        reasoning: false,
        supportsImage: true,
        contextWindow: 128000,
        maxTokens: 4096
      }
    ]
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    logo: 'minimax',
    baseUrl: 'https://api.minimax.chat/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      {
        id: 'abab6.5s-chat',
        name: 'ABAB 6.5s',
        reasoning: false,
        supportsImage: false,
        contextWindow: 245760,
        maxTokens: 6144
      }
    ]
  },
  {
    id: 'volcengine',
    name: '火山引擎',
    logo: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: []
  },
  {
    id: 'youdao',
    name: '有道 Youdao',
    logo: 'youdao',
    baseUrl: 'https://api.youdao.com/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: []
  },
  {
    id: 'qianfan',
    name: '百度千帆',
    logo: 'qianfan',
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: []
  },
  {
    id: 'stepfun',
    name: '阶跃星辰',
    logo: 'stepfun',
    baseUrl: 'https://api.stepfun.com/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: []
  },
  {
    id: 'xiaomi',
    name: '小米 Xiaomi',
    logo: 'xiaomi',
    baseUrl: 'https://api.xiaomi.com/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: []
  },
  {
    id: 'ollama',
    name: 'Ollama',
    logo: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: []
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    logo: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        reasoning: false,
        supportsImage: true,
        contextWindow: 1048576,
        maxTokens: 8192
      }
    ]
  },
  {
    id: 'alibaba',
    name: '阿里百炼',
    logo: 'alibaba',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      {
        id: 'qwen-max',
        name: 'Qwen Max',
        reasoning: false,
        supportsImage: true,
        contextWindow: 32768,
        maxTokens: 8192
      }
    ]
  },
  {
    id: 'mistral',
    name: 'Mistral',
    logo: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      {
        id: 'mistral-large-latest',
        name: 'Mistral Large',
        reasoning: false,
        supportsImage: false,
        contextWindow: 128000,
        maxTokens: 8192
      }
    ]
  },
  {
    id: 'groq',
    name: 'Groq',
    logo: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiFormat: 'openai-completions',
    isPreset: true,
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        name: 'Llama 3.3 70B',
        reasoning: false,
        supportsImage: false,
        contextWindow: 128000,
        maxTokens: 32768
      }
    ]
  }
]
