# Models 架构设计

## 1. 模块定位

Models 模块负责模型提供商、模型配置、默认模型和会话级模型上下文。

## 2. 核心概念

- provider：模型供应商。
- model config：用户配置的具体模型。
- 三级优先级：全局默认、目录/agent 默认、会话/本轮选择。
- secret env var：API key 等敏感值注入 Gateway 子进程的环境变量。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ Renderer                                                           │
│ Settings / Models: provider list, API key, model list, test connect │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ model:* IPC
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Main Process                                                        │
│  ModelRegistry                                                      │
│  ├── preset providers                                               │
│  ├── custom providers                                               │
│  ├── active/default model                                           │
│  ├── testConnection                                                 │
│  └── collectSecretEnvVars                                           │
└──────────────┬───────────────────────────────┬─────────────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────┐   ┌───────────────────────────────┐
│ ConfigSync                   │   │ CoworkSessionManager           │
│ models config + placeholders │   │ session 固化 model context      │
└──────────────┬───────────────┘   └───────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────────────────────────────┐
│ OpenClaw Runtime                                                    │
│ reads model config; API keys arrive via child process env            │
└────────────────────────────────────────────────────────────────────┘
```

关键文件：

| 层 | 文件 |
|---|---|
| Model registry | `petclaw-desktop/src/main/models/model-registry.ts` |
| Config store | `petclaw-desktop/src/main/models/model-config-store.ts` |
| Shared provider types | `petclaw-desktop/src/shared/models/types.ts` |
| Provider registry | `petclaw-desktop/src/shared/models/provider-registry.ts` |
| IPC | `petclaw-desktop/src/main/ipc/models-ipc.ts` |
| Renderer settings | `petclaw-desktop/src/renderer/src/views/settings/ModelSettings.tsx` |
| Model selector | `petclaw-desktop/src/renderer/src/components/ModelSelector.tsx` |

## 4. 端到端数据流

用户新增或编辑模型配置；main 持久化 provider/model；ConfigSync 写入 runtime 所需模型配置；Cowork 启动会话时解析三级优先级并固化到 session；后续发送继续使用 session 固化模型。

优先级解析：

```text
本轮显式选择
→ session.model_override
→ directory.model_override
→ global active/default model
→ provider 默认 fallback
```

一旦 session 创建，模型上下文必须固化；后续全局默认变化不应悄悄改变已有 session。

## 5. 状态机与生命周期

```text
draft
→ saved
→ active
→ selected
→ invalid | removed
```

## 6. 数据模型

模型提供商预设和用户配置分离。敏感 API key 不能明文进入 runtime 配置，需使用 env placeholder 或安全存储策略。

预设 provider 包括 PetClaw、OpenAI、Anthropic、Google Gemini、DeepSeek、阿里百炼、豆包、智谱、零一万物、Mistral、Groq。自定义 provider 必须明确 baseUrl、apiFormat 和模型列表。

ConfigSync 只写：

```json
{
  "apiKey": "${PETCLAW_MODEL_PROVIDER_API_KEY}"
}
```

明文由 `ModelRegistry.collectSecretEnvVars()` 返回，并通过 EngineManager 注入 Gateway 子进程。

## 7. IPC / Preload 契约

models API 提供 provider 列表、模型配置 CRUD、默认模型更新和有效模型查询。返回值要区分配置错误和 runtime 不可用。

会话级模型热切换应使用 session patch 或 Cowork 专用 API，不应触发全局 ConfigSync 重启。

## 8. Renderer 布局、状态与交互

设置页模型区域包含 provider 选择、模型表单、自定义模型配置、默认模型选择和验证错误。保存失败留在表单内，不能只 toast 后丢失草稿。

页面入口与源码：

| 区域 | 源码 |
|---|---|
| Settings 容器 | `petclaw-desktop/src/renderer/src/views/settings/SettingsPage.tsx` |
| Models 页面 | `petclaw-desktop/src/renderer/src/views/settings/ModelSettings.tsx` |
| Chat 模型选择器 | `petclaw-desktop/src/renderer/src/components/ModelSelector.tsx` |

模型设置布局：

```text
┌────────────────────────────────────────────────────────────────────┐
│  模型配置                                                           │
│  管理模型提供商、API Key、可用模型和默认模型                         │
│                                                                    │
│  默认模型                                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 当前默认模型                                      [Provider ∨]│  │
│  │ 会话未显式选择模型时使用                         [Model ∨]   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  Provider 管理                                                     │
│  ┌────────────────────┬─────────────────────────────────────────┐  │
│  │ Provider 列表       │  DeepSeek 提供商设置             [开启] │  │
│  │ ┌────────────────┐ │                                         │  │
│  │ │ ● PetClaw      │ │  API Key                                │  │
│  │ │ ● OpenAI       │ │  [ 已配置 ********              ] [显示] │  │
│  │ │ ○ Anthropic    │ │                                         │  │
│  │ │ ● DeepSeek     │ │  API Base URL                           │  │
│  │ │ ○ Zhipu        │ │  [ https://api.deepseek.com/v1       ]  │  │
│  │ │ ○ Ollama       │ │                                         │  │
│  │ │                │ │  API 格式                               │  │
│  │ │ [+ 自定义]     │ │  ( ) Anthropic 兼容   (●) OpenAI 兼容   │  │
│  │ └────────────────┘ │                                         │  │
│  │                    │  [测试连接]  连接成功 / 连接失败详情      │  │
│  │                    │                                         │  │
│  │                    │  可用模型列表                 [+ 添加]   │  │
│  │                    │  ┌───────────────────────────────────┐  │  │
│  │                    │  │ DeepSeek Chat        deepseek-chat │  │  │
│  │                    │  │ DeepSeek Reasoner    deepseek-r1   │  │  │
│  │                    │  └───────────────────────────────────┘  │  │
│  │                    │                              [保存更改] │  │
│  └────────────────────┴─────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

添加模型弹窗：

```text
┌────────────────────────────────────────┐
│  添加模型                         [x]  │
│                                        │
│  模型名称                              │
│  [ DeepSeek Reasoner                ]  │
│                                        │
│  模型 ID                               │
│  [ deepseek-reasoner                ]  │
│                                        │
│  Context Window                        │
│  [ 128000                          ]  │
│                                        │
│  [ ] Reasoning model   [ ] Image input │
│                                        │
│                         [取消] [保存]  │
└────────────────────────────────────────┘
```

状态来源：

| 状态 | 所有者 | 说明 |
|---|---|---|
| provider list | `ModelSettings` | 来自 `models:providers` |
| selected provider | `ModelSettings` 本地 state | 控制右侧详情 |
| provider draft | `ModelSettings` 本地 state | 保存前不写主数据 |
| test status | `ModelSettings` 按 providerId 分桶 | pending/success/error |
| default model | Models main store | `models:default` / `models:set-default` |
| Chat selected model | `ModelSelector` / `ChatInputBox` | 本轮或会话级选择 |

交互状态：

- provider 切换时，未保存草稿必须提示保存或放弃。
- API Key 已配置时只显示脱敏状态，不能回填明文。
- 测试连接 pending 时只禁用当前 provider 的测试按钮。
- 删除模型前必须确认；如果删除的是默认模型，必须先切换默认模型。
- runtime 未就绪时可以编辑本地配置，但测试连接和 runtime 生效提示需要 disabled 或标注等待 runtime。
```

## 9. Runtime / Gateway 集成

Models 通过 ConfigSync 影响 runtime 请求。Cowork 发送前只读取已固化模型上下文，不从 UI 临时推断。

## 10. 错误态、安全和权限

API key、base URL 等敏感配置需要脱敏展示。配置验证失败必须阻止保存或标记 invalid。

需要 Gateway 重启的变化：

- provider API key 变化。
- secret env var 集合变化。

不需要重启的变化：

- 目录 model override。
- session model patch。

## 11. 与其它模块的关系

Cowork 消费模型上下文，ConfigSync 写入 runtime 配置，Settings 提供用户编辑入口。

## 12. 测试策略

- 三级优先级解析测试。
- provider 预设和自定义模型测试。
- 敏感信息脱敏/占位测试。
- 设置页保存失败测试。
