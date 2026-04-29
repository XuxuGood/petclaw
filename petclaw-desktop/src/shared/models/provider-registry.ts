import type { ProviderDefinition } from './types'

const BUILT_IN_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'petclaw',
    openClawProviderId: 'petclaw',
    name: 'PetClaw',
    logo: 'petclaw',
    defaultBaseUrl: 'https://petclaw.ai/api/v1',
    apiFormat: 'openai-completions',
    auth: 'none',
    isPreset: true,
    defaultModels: [
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
    openClawProviderId: 'openai',
    name: 'OpenAI',
    logo: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    apiFormat: 'openai-completions',
    auth: 'api-key',
    isPreset: true,
    defaultModels: [
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
    openClawProviderId: 'anthropic',
    name: 'Anthropic',
    logo: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    apiFormat: 'anthropic',
    auth: 'api-key',
    isPreset: true,
    defaultModels: [
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
    openClawProviderId: 'deepseek',
    name: 'DeepSeek',
    logo: 'deepseek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    apiFormat: 'openai-completions',
    auth: 'api-key',
    isPreset: true,
    defaultModels: [
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
    openClawProviderId: 'zai',
    name: 'Zhipu',
    logo: 'zhipu',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiFormat: 'openai-completions',
    auth: 'api-key',
    isPreset: true,
    defaultModels: [
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
    openClawProviderId: 'minimax',
    name: 'MiniMax',
    logo: 'minimax',
    defaultBaseUrl: 'https://api.minimax.chat/v1',
    apiFormat: 'openai-completions',
    auth: 'api-key',
    isPreset: true,
    defaultModels: [
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
    openClawProviderId: 'volcengine',
    name: 'Volcengine',
    logo: 'volcengine',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiFormat: 'openai-completions',
    auth: 'api-key',
    isPreset: true,
    defaultModels: []
  },
  {
    id: 'youdao',
    openClawProviderId: 'youdaozhiyun',
    name: 'Youdao',
    logo: 'youdao',
    defaultBaseUrl: 'https://api.youdao.com/v1',
    apiFormat: 'openai-completions',
    auth: 'api-key',
    isPreset: true,
    defaultModels: []
  },
  {
    id: 'qianfan',
    openClawProviderId: 'qianfan',
    name: 'Qianfan',
    logo: 'qianfan',
    defaultBaseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1',
    apiFormat: 'openai-completions',
    auth: 'api-key',
    isPreset: true,
    defaultModels: []
  },
  {
    id: 'stepfun',
    openClawProviderId: 'stepfun',
    name: 'Stepfun',
    logo: 'stepfun',
    defaultBaseUrl: 'https://api.stepfun.com/v1',
    apiFormat: 'openai-completions',
    auth: 'api-key',
    isPreset: true,
    defaultModels: []
  },
  {
    id: 'xiaomi',
    openClawProviderId: 'xiaomi',
    name: 'Xiaomi',
    logo: 'xiaomi',
    defaultBaseUrl: 'https://api.xiaomi.com/v1',
    apiFormat: 'openai-completions',
    auth: 'api-key',
    isPreset: true,
    defaultModels: []
  },
  {
    id: 'ollama',
    openClawProviderId: 'ollama',
    name: 'Ollama',
    logo: 'ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    apiFormat: 'openai-completions',
    auth: 'none',
    isPreset: true,
    defaultModels: []
  },
  {
    id: 'gemini',
    openClawProviderId: 'google',
    name: 'Google Gemini',
    logo: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiFormat: 'google-generative-ai',
    auth: 'api-key',
    isPreset: true,
    defaultModels: [
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
    openClawProviderId: 'qwen-portal',
    name: 'Alibaba Bailian',
    logo: 'alibaba',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiFormat: 'openai-completions',
    auth: 'api-key',
    isPreset: true,
    defaultModels: [
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
    openClawProviderId: 'mistral',
    name: 'Mistral',
    logo: 'mistral',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    apiFormat: 'openai-completions',
    auth: 'api-key',
    isPreset: true,
    defaultModels: [
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
    openClawProviderId: 'groq',
    name: 'Groq',
    logo: 'groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    apiFormat: 'openai-completions',
    auth: 'api-key',
    isPreset: true,
    defaultModels: [
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

export class ProviderRegistry {
  private providersById = new Map(BUILT_IN_PROVIDERS.map((provider) => [provider.id, provider]))

  list(): ProviderDefinition[] {
    return [...this.providersById.values()].map((provider) => ({
      ...provider,
      defaultModels: provider.defaultModels.map((model) => ({ ...model }))
    }))
  }

  get(id: string): ProviderDefinition | undefined {
    const provider = this.providersById.get(id)
    if (!provider) return undefined
    return {
      ...provider,
      defaultModels: provider.defaultModels.map((model) => ({ ...model }))
    }
  }

  isBuiltIn(id: string): boolean {
    return this.providersById.has(id)
  }

  toOpenClawProviderId(id: string): string {
    return this.providersById.get(id)?.openClawProviderId ?? id
  }
}
