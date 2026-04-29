# Engine Manager & Gateway 全面对齐 LobsterAI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PetClaw 的 engine-manager.ts 和 gateway.ts 全面对齐 LobsterAI 参考实现，补齐所有缺失的工具模块、功能增强和依赖。

**Architecture:** 从 LobsterAI 搬运 9 个工具模块文件，按依赖顺序创建；增强 engine-manager（running phase、progressPercent、secretEnvVars、完整 env 注入、clientEntryPath、asar 解压、CLI shims、local extensions）；重构 gateway（无参构造 + connectionInfo connect、WS 自动重连、tick 心跳看门狗、版本检测、initLock）；适配 controller 和 index.ts。

**Tech Stack:** TypeScript, Electron (utilityProcess/child_process), Node.js fs/path/net/crypto, EventEmitter

**参考代码库:** `/Users/xiaoxuxuy/Desktop/工作/AI/开源项目/LobsterAI`

---

## 文件结构

### 新建文件
| 文件 | 职责 |
|------|------|
| `src/main/fs-compat.ts` | 递归复制 polyfill（非 ASCII 路径安全） |
| `src/main/ai/cowork-logger.ts` | 结构化文件日志（5MB 轮转） |
| `src/main/ai/cowork-model-api.ts` | 模型 API 协议适配（Anthropic/Gemini URL 构建、响应提取） |
| `src/main/ai/system-proxy.ts` | 系统代理解析（Electron session.resolveProxy） |
| `src/main/ai/python-runtime.ts` | Windows Python 嵌入式运行时管理 |
| `src/main/ai/openclaw-local-extensions.ts` | 本地扩展同步 + stale 清理 |
| `src/main/ai/claude-settings.ts` | API 配置管理（provider 解析、env 构造） |
| `src/main/ai/cowork-util.ts` | 环境变量构造、node/npm shim、Skills 目录、会话标题生成 |
| `src/main/ai/cowork-openai-compat-proxy.ts` | OpenAI 兼容 API 代理服务器 |
| `tests/main/ai/system-proxy.test.ts` | system-proxy 单元测试 |
| `tests/main/ai/cowork-logger.test.ts` | cowork-logger 单元测试 |
| `tests/main/ai/cowork-model-api.test.ts` | cowork-model-api 单元测试 |
| `tests/main/ai/cowork-util.test.ts` | cowork-util 单元测试 |

### 修改文件
| 文件 | 变更概要 |
|------|----------|
| `src/main/ai/types.ts` | EnginePhase 加 `'running'`、EngineStatus 加 `progressPercent`、GatewayConnectionInfo 提升到 types 并加 `clientEntryPath` |
| `src/main/ai/engine-manager.ts` | secretEnvVars、完整 env 注入、clientEntryPath、asar 解压、local extensions、CLI shims、daily log dir、rewriteUtcTimestamps、running phase、progressPercent |
| `src/main/ai/gateway.ts` | 无参构造、connect(connectionInfo)、WS 自动重连、tick 看门狗、版本检测、pendingClient、initLock |
| `src/main/ai/cowork-controller.ts` | disconnected 事件处理、messageUpdate 节流 |
| `src/main/index.ts` | initializeRuntimeServices 使用 connectionInfo |
| `tests/main/ai/engine-manager.test.ts` | 补测 running phase、progressPercent、secretEnvVars |
| `tests/main/ai/gateway.test.ts` | 补测重连、tick 看门狗、版本检测 |
| `tests/main/ai/cowork-controller.test.ts` | 补测 disconnected 处理 |

---

## Task 1: fs-compat.ts — 递归复制 polyfill

**Files:**
- Create: `src/main/fs-compat.ts`
- Reference: `LobsterAI/src/main/fsCompat.ts`

- [ ] **Step 1: 创建 fs-compat.ts**

从 LobsterAI 的 `src/main/fsCompat.ts` 搬运，命名改为 kebab-case。代码完全一致：

```typescript
// src/main/fs-compat.ts
/**
 * Safe recursive copy that bypasses fs.cpSync, which can crash (native-level)
 * when source paths contain non-ASCII characters (e.g. Chinese) on Windows
 * with certain Node.js/Electron versions.
 *
 * Uses fs.readdirSync + fs.copyFileSync as building blocks, which are proven
 * to handle non-ASCII paths correctly via libuv's wide-char API wrappers.
 */
import fs from 'fs'
import path from 'path'

export function cpRecursiveSync(
  src: string,
  dest: string,
  opts: { dereference?: boolean; force?: boolean; errorOnExist?: boolean } = {}
): void {
  const { dereference = false, force = false } = opts
  const stat = dereference ? fs.statSync(src) : fs.lstatSync(src)

  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true })
    }
    for (const entry of fs.readdirSync(src)) {
      cpRecursiveSync(path.join(src, entry), path.join(dest, entry), opts)
    }
  } else if (stat.isFile()) {
    if (fs.existsSync(dest) && !force) {
      return
    }
    const destDir = path.dirname(dest)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    fs.copyFileSync(src, dest)
  } else if (stat.isSymbolicLink()) {
    if (fs.existsSync(dest)) {
      if (!force) return
      fs.unlinkSync(dest)
    }
    const target = fs.readlinkSync(src)
    fs.symlinkSync(target, dest)
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `cd petclaw-desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/main/fs-compat.ts
git commit -m "feat(desktop): add fs-compat recursive copy polyfill"
```

---

## Task 2: cowork-logger.ts — 结构化日志

**Files:**
- Create: `src/main/ai/cowork-logger.ts`
- Test: `tests/main/ai/cowork-logger.test.ts`
- Reference: `LobsterAI/src/main/libs/coworkLogger.ts`

- [ ] **Step 1: 写测试**

```typescript
// tests/main/ai/cowork-logger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/petclaw-test-userdata')
  }
}))

describe('cowork-logger', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any)
    vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {})
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 100 } as fs.Stats)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should write formatted log line', async () => {
    const { coworkLog } = await import('../../src/main/ai/cowork-logger')
    coworkLog('INFO', 'test-tag', 'hello world')
    expect(fs.appendFileSync).toHaveBeenCalledOnce()
    const written = (fs.appendFileSync as any).mock.calls[0][1] as string
    expect(written).toContain('[INFO]')
    expect(written).toContain('[test-tag]')
    expect(written).toContain('hello world')
  })

  it('should include extra fields', async () => {
    const { coworkLog } = await import('../../src/main/ai/cowork-logger')
    coworkLog('WARN', 'tag', 'msg', { key: 'value' })
    const written = (fs.appendFileSync as any).mock.calls[0][1] as string
    expect(written).toContain('key: value')
  })

  it('should return log path', async () => {
    const { getCoworkLogPath } = await import('../../src/main/ai/cowork-logger')
    const logPath = getCoworkLogPath()
    expect(logPath).toContain('cowork.log')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-logger.test.ts 2>&1 | tail -10`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 cowork-logger.ts**

从 LobsterAI 的 `src/main/libs/coworkLogger.ts` 搬运，保持代码风格一致（去分号、单引号）：

```typescript
// src/main/ai/cowork-logger.ts
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5MB

let logFilePath: string | null = null

function getLogFilePath(): string {
  if (!logFilePath) {
    const logDir = path.join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }
    logFilePath = path.join(logDir, 'cowork.log')
  }
  return logFilePath
}

function rotateIfNeeded(): void {
  try {
    const filePath = getLogFilePath()
    if (!fs.existsSync(filePath)) return
    const stat = fs.statSync(filePath)
    if (stat.size > MAX_LOG_SIZE) {
      const backupPath = filePath + '.old'
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath)
      }
      fs.renameSync(filePath, backupPath)
    }
  } catch {
    // 忽略轮转错误
  }
}

function formatTimestamp(): string {
  const date = new Date()
  const pad = (value: number, length = 2): string => value.toString().padStart(length, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const minute = pad(date.getMinutes())
  const second = pad(date.getSeconds())
  const millisecond = pad(date.getMilliseconds(), 3)

  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const offsetHour = pad(Math.floor(absOffset / 60))
  const offsetMinute = pad(absOffset % 60)

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}${sign}${offsetHour}:${offsetMinute}`
}

export function coworkLog(
  level: 'INFO' | 'WARN' | 'ERROR',
  tag: string,
  message: string,
  extra?: Record<string, unknown>
): void {
  try {
    rotateIfNeeded()
    const parts = [`[${formatTimestamp()}] [${level}] [${tag}] ${message}`]
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        parts.push(`  ${key}: ${serialized}`)
      }
    }
    parts.push('')
    fs.appendFileSync(getLogFilePath(), parts.join('\n'), 'utf-8')
  } catch {
    // 日志绝不应该抛异常
  }
}

export function getCoworkLogPath(): string {
  return getLogFilePath()
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-logger.test.ts 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/cowork-logger.ts tests/main/ai/cowork-logger.test.ts
git commit -m "feat(desktop): add cowork-logger structured file logging"
```

---

## Task 3: cowork-model-api.ts — 模型 API 协议适配

**Files:**
- Create: `src/main/ai/cowork-model-api.ts`
- Test: `tests/main/ai/cowork-model-api.test.ts`
- Reference: `LobsterAI/src/main/libs/coworkModelApi.ts`

- [ ] **Step 1: 写测试**

```typescript
// tests/main/ai/cowork-model-api.test.ts
import { describe, it, expect } from 'vitest'
import {
  buildAnthropicMessagesUrl,
  buildGeminiGenerateContentUrl,
  extractApiErrorSnippet,
  extractTextFromAnthropicResponse,
  extractTextFromGeminiResponse,
  CoworkModelProtocol
} from '../../src/main/ai/cowork-model-api'

describe('cowork-model-api', () => {
  describe('CoworkModelProtocol', () => {
    it('should have Anthropic and GeminiNative', () => {
      expect(CoworkModelProtocol.Anthropic).toBe('anthropic')
      expect(CoworkModelProtocol.GeminiNative).toBe('gemini_native')
    })
  })

  describe('buildAnthropicMessagesUrl', () => {
    it('should append /v1/messages to base URL', () => {
      expect(buildAnthropicMessagesUrl('https://api.anthropic.com')).toBe(
        'https://api.anthropic.com/v1/messages'
      )
    })

    it('should not duplicate /v1/messages', () => {
      expect(buildAnthropicMessagesUrl('https://api.anthropic.com/v1/messages')).toBe(
        'https://api.anthropic.com/v1/messages'
      )
    })

    it('should handle /v1 suffix', () => {
      expect(buildAnthropicMessagesUrl('https://api.anthropic.com/v1')).toBe(
        'https://api.anthropic.com/v1/messages'
      )
    })

    it('should handle empty string', () => {
      expect(buildAnthropicMessagesUrl('')).toBe('/v1/messages')
    })
  })

  describe('extractApiErrorSnippet', () => {
    it('should extract error message from JSON', () => {
      const json = JSON.stringify({ error: { message: 'rate limited' } })
      expect(extractApiErrorSnippet(json)).toBe('rate limited')
    })

    it('should handle plain text', () => {
      expect(extractApiErrorSnippet('something went wrong')).toBe('something went wrong')
    })

    it('should truncate long text', () => {
      const long = 'a'.repeat(300)
      expect(extractApiErrorSnippet(long).length).toBeLessThanOrEqual(240)
    })
  })

  describe('extractTextFromAnthropicResponse', () => {
    it('should extract text blocks', () => {
      const payload = {
        content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }]
      }
      expect(extractTextFromAnthropicResponse(payload)).toBe('hello\nworld')
    })

    it('should handle output_text', () => {
      expect(extractTextFromAnthropicResponse({ output_text: 'test' })).toBe('test')
    })
  })

  describe('extractTextFromGeminiResponse', () => {
    it('should extract text from candidates', () => {
      const payload = {
        candidates: [{ content: { parts: [{ text: 'gemini reply' }] } }]
      }
      expect(extractTextFromGeminiResponse(payload)).toBe('gemini reply')
    })
  })

  describe('buildGeminiGenerateContentUrl', () => {
    it('should build URL with model', () => {
      const url = buildGeminiGenerateContentUrl(
        'https://generativelanguage.googleapis.com/v1beta',
        'gemini-pro'
      )
      expect(url).toContain('models/gemini-pro:generateContent')
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-model-api.test.ts 2>&1 | tail -10`
Expected: FAIL

- [ ] **Step 3: 创建 cowork-model-api.ts**

从 LobsterAI 的 `src/main/libs/coworkModelApi.ts` 完整搬运，调整代码风格（去分号）。代码是纯函数，无需改名或适配，直接按原样搬运所有 159 行。

实现者：打开 `LobsterAI/src/main/libs/coworkModelApi.ts`，完整复制内容到 `src/main/ai/cowork-model-api.ts`，仅去掉分号、改双引号为单引号。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-model-api.test.ts 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/cowork-model-api.ts tests/main/ai/cowork-model-api.test.ts
git commit -m "feat(desktop): add cowork-model-api protocol adapters"
```

---

## Task 4: system-proxy.ts — 系统代理解析

**Files:**
- Create: `src/main/ai/system-proxy.ts`
- Test: `tests/main/ai/system-proxy.test.ts`
- Reference: `LobsterAI/src/main/libs/systemProxy.ts`

- [ ] **Step 1: 写测试**

```typescript
// tests/main/ai/system-proxy.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  app: { isReady: vi.fn().mockReturnValue(true) },
  session: {
    defaultSession: {
      resolveProxy: vi.fn().mockResolvedValue('DIRECT')
    }
  }
}))

describe('system-proxy', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('isSystemProxyEnabled defaults to false', async () => {
    const { isSystemProxyEnabled } = await import('../../src/main/ai/system-proxy')
    expect(isSystemProxyEnabled()).toBe(false)
  })

  it('setSystemProxyEnabled toggles state', async () => {
    const { isSystemProxyEnabled, setSystemProxyEnabled } = await import(
      '../../src/main/ai/system-proxy'
    )
    setSystemProxyEnabled(true)
    expect(isSystemProxyEnabled()).toBe(true)
    setSystemProxyEnabled(false)
    expect(isSystemProxyEnabled()).toBe(false)
  })

  it('applySystemProxyEnv sets env vars', async () => {
    const { applySystemProxyEnv } = await import('../../src/main/ai/system-proxy')
    applySystemProxyEnv('http://proxy:8080')
    expect(process.env.http_proxy).toBe('http://proxy:8080')
    expect(process.env.HTTPS_PROXY).toBe('http://proxy:8080')
    // 清理
    applySystemProxyEnv(null)
  })

  it('resolveSystemProxyUrl parses PROXY rule', async () => {
    const { session } = await import('electron')
    vi.mocked(session.defaultSession.resolveProxy).mockResolvedValue('PROXY 10.0.0.1:3128')
    const { resolveSystemProxyUrl } = await import('../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrl('https://api.anthropic.com')
    expect(result).toBe('http://10.0.0.1:3128')
  })

  it('resolveSystemProxyUrl returns null for DIRECT', async () => {
    const { session } = await import('electron')
    vi.mocked(session.defaultSession.resolveProxy).mockResolvedValue('DIRECT')
    const { resolveSystemProxyUrl } = await import('../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrl('https://api.anthropic.com')
    expect(result).toBeNull()
  })

  it('resolveSystemProxyUrl parses SOCKS5 rule', async () => {
    const { session } = await import('electron')
    vi.mocked(session.defaultSession.resolveProxy).mockResolvedValue('SOCKS5 127.0.0.1:1080')
    const { resolveSystemProxyUrl } = await import('../../src/main/ai/system-proxy')
    const result = await resolveSystemProxyUrl('https://api.anthropic.com')
    expect(result).toBe('socks5://127.0.0.1:1080')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/system-proxy.test.ts 2>&1 | tail -10`
Expected: FAIL

- [ ] **Step 3: 创建 system-proxy.ts**

从 LobsterAI 的 `src/main/libs/systemProxy.ts` 完整搬运，去分号、单引号。代码 134 行，无需任何命名替换（无 LOBSTERAI 引用）。

实现者：打开 `LobsterAI/src/main/libs/systemProxy.ts`，完整复制到 `src/main/ai/system-proxy.ts`，调整代码风格。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/system-proxy.test.ts 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/system-proxy.ts tests/main/ai/system-proxy.test.ts
git commit -m "feat(desktop): add system-proxy resolver for Electron"
```

---

## Task 5: python-runtime.ts — Windows Python 运行时管理

**Files:**
- Create: `src/main/ai/python-runtime.ts`
- Reference: `LobsterAI/src/main/libs/pythonRuntime.ts`

- [ ] **Step 1: 创建 python-runtime.ts**

从 LobsterAI 的 `src/main/libs/pythonRuntime.ts`（391 行）完整搬运。

命名调整：
- `import { cpRecursiveSync } from './pythonRuntime'` 中依赖的 `fsCompat` → `import { cpRecursiveSync } from '../fs-compat'`
- `lobsterai` 相关日志标签改为 `petclaw`（仅出现在日志字符串中）

实现者：打开 LobsterAI 的 `src/main/libs/pythonRuntime.ts`，复制到 `src/main/ai/python-runtime.ts`，做以下替换：
1. `import { cpRecursiveSync } from '../fsCompat'` → `import { cpRecursiveSync } from '../fs-compat'`
2. 日志中的 `LobsterAI` → `PetClaw`（如果有的话）
3. 去分号、单引号代码风格

- [ ] **Step 2: 验证编译**

Run: `cd petclaw-desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/main/ai/python-runtime.ts
git commit -m "feat(desktop): add python-runtime Windows embedded runtime manager"
```

---

## Task 6: openclaw-local-extensions.ts — 本地扩展同步

**Files:**
- Create: `src/main/ai/openclaw-local-extensions.ts`
- Reference: `LobsterAI/src/main/libs/openclawLocalExtensions.ts`

- [ ] **Step 1: 创建 openclaw-local-extensions.ts**

从 LobsterAI 的 `src/main/libs/openclawLocalExtensions.ts`（179 行）完整搬运。

需要适配：
- `import { cpRecursiveSync } from '../fsCompat'` → `import { cpRecursiveSync } from '../fs-compat'`
- `cfmind` 路径引用保持原样（这是 LobsterAI 的 packaged 路径名，PetClaw 用 `petmind`），但搬运时实现者需检查是否有 `cfmind` 字面量——如果有改为 `petmind`

实现者：打开 LobsterAI 的 `src/main/libs/openclawLocalExtensions.ts`，完整复制到 `src/main/ai/openclaw-local-extensions.ts`，做以下替换：
1. import 路径调整
2. `cfmind` → `petmind`（如果在代码中出现的话）
3. 代码风格

- [ ] **Step 2: 验证编译**

Run: `cd petclaw-desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/main/ai/openclaw-local-extensions.ts
git commit -m "feat(desktop): add openclaw-local-extensions sync module"
```

---

## Task 7: claude-settings.ts — API 配置管理

**Files:**
- Create: `src/main/ai/claude-settings.ts`
- Reference: `LobsterAI/src/main/libs/claudeSettings.ts`

- [ ] **Step 1: 创建 claude-settings.ts**

从 LobsterAI 的 `src/main/libs/claudeSettings.ts`（555 行）搬运。

**重要适配：**
1. LobsterAI 使用 SQLite store（`SqliteStore`），PetClaw 使用 `better-sqlite3`。实现者需检查 PetClaw 现有的数据访问模式，用兼容的 store getter 模式
2. `import ... from '../../shared/providers'` — PetClaw 可能没有这个 shared 模块，需要内联必要的类型定义或创建最小兼容层
3. `import ... from './coworkOpenAICompatProxy'` — 依赖 cowork-openai-compat-proxy（Task 9 创建）
4. `import ... from './coworkFormatTransform'` — 需要检查是否存在，不存在则创建最小兼容实现
5. `ProviderName.LobsteraiServer` → `ProviderName.PetclawServer`
6. `sk-lobsterai-local` → `sk-petclaw-local`
7. 所有 `lobsterai` 字符串引用改为 `petclaw`

实现者：先完整阅读 LobsterAI 的 `claudeSettings.ts`，理解所有外部依赖。然后：
- 搬运时把缺失的类型定义内联到文件顶部
- 对于 `coworkOpenAICompatProxy` 的依赖，使用类型导入 + 运行时 lazy require 模式
- 所有 `LobsterAI/lobsterai` → `PetClaw/petclaw`

- [ ] **Step 2: 验证编译**

Run: `cd petclaw-desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/main/ai/claude-settings.ts
git commit -m "feat(desktop): add claude-settings API config management"
```

---

## Task 8: cowork-util.ts — 环境变量构造和工具函数

**Files:**
- Create: `src/main/ai/cowork-util.ts`
- Test: `tests/main/ai/cowork-util.test.ts`
- Reference: `LobsterAI/src/main/libs/coworkUtil.ts`

- [ ] **Step 1: 写测试**

```typescript
// tests/main/ai/cowork-util.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn().mockReturnValue('/tmp/petclaw-test'),
    getName: vi.fn().mockReturnValue('PetClaw'),
    getAppPath: vi.fn().mockReturnValue('/tmp/petclaw-app')
  }
}))

vi.mock('./cowork-logger', () => ({
  coworkLog: vi.fn()
}))

vi.mock('./system-proxy', () => ({
  isSystemProxyEnabled: vi.fn().mockReturnValue(false),
  resolveSystemProxyUrlForTargets: vi.fn().mockResolvedValue({ proxyUrl: null, targetUrl: null })
}))

vi.mock('./python-runtime', () => ({
  appendPythonRuntimeToEnv: vi.fn()
}))

describe('cowork-util', () => {
  it('getElectronNodeRuntimePath returns process.execPath in dev', async () => {
    const { getElectronNodeRuntimePath } = await import('../../src/main/ai/cowork-util')
    const result = getElectronNodeRuntimePath()
    expect(result).toBe(process.execPath)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-util.test.ts 2>&1 | tail -10`
Expected: FAIL

- [ ] **Step 3: 创建 cowork-util.ts**

从 LobsterAI 的 `src/main/libs/coworkUtil.ts`（1692 行）完整搬运。这是最大的文件，需要大量命名替换。

**命名替换清单：**
| 原始 | 替换 |
|------|------|
| `LOBSTERAI_ELECTRON_PATH` | `PETCLAW_ELECTRON_PATH` |
| `LOBSTERAI_OPENCLAW_ENTRY` | `PETCLAW_OPENCLAW_ENTRY` |
| `LOBSTERAI_SKILLS_ROOT` | `PETCLAW_SKILLS_ROOT` |
| `LOBSTERAI_NPM_BIN_DIR` | `PETCLAW_NPM_BIN_DIR` |
| `LOBSTERAI_NODE_SHIM_ACTIVE` | `PETCLAW_NODE_SHIM_ACTIVE` |
| `LOBSTERAI_PYTHON_ROOT` | `PETCLAW_PYTHON_ROOT` |
| `LOBSTERAI_GIT_BASH_RESOLUTION_ERROR` | `PETCLAW_GIT_BASH_RESOLUTION_ERROR` |
| `LobsterAI` (应用名) | `PetClaw` |
| `cfmind` (packaged 路径) | `petmind` |

**保持不变：**
- `CLAUDE_CODE_GIT_BASH_PATH` — 上游 SDK 约定

**import 替换：**
- `import { ... } from './claudeSettings'` → `import { ... } from './claude-settings'`
- `import { coworkLog } from './coworkLogger'` → `import { coworkLog } from './cowork-logger'`
- `import { ... } from './coworkModelApi'` → `import { ... } from './cowork-model-api'`
- `import type { ... } from './coworkOpenAICompatProxy'` → `import type { ... } from './cowork-openai-compat-proxy'`
- `import { appendPythonRuntimeToEnv } from './pythonRuntime'` → `import { appendPythonRuntimeToEnv } from './python-runtime'`
- `import { isSystemProxyEnabled, ... } from './systemProxy'` → `import { isSystemProxyEnabled, ... } from './system-proxy'`

实现者：打开 LobsterAI 的 `src/main/libs/coworkUtil.ts`，完整复制到 `src/main/ai/cowork-util.ts`，执行上述所有替换。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-util.test.ts 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无新增错误

- [ ] **Step 6: Commit**

```bash
git add src/main/ai/cowork-util.ts tests/main/ai/cowork-util.test.ts
git commit -m "feat(desktop): add cowork-util env builder and shim tools"
```

---

## Task 9: cowork-openai-compat-proxy.ts — OpenAI 兼容代理

**Files:**
- Create: `src/main/ai/cowork-openai-compat-proxy.ts`
- Reference: `LobsterAI/src/main/libs/coworkOpenAICompatProxy.ts`

- [ ] **Step 1: 创建 cowork-openai-compat-proxy.ts**

从 LobsterAI 的 `src/main/libs/coworkOpenAICompatProxy.ts`（2930 行）完整搬运。

**命名替换：**
- `lobsterai` → `petclaw`（日志、注释中的应用名引用）
- import 路径按 PetClaw 的 kebab-case 命名调整

实现者：这是最大的单文件，建议直接复制并做全局替换。确保所有 import 路径正确指向 PetClaw 的文件。

- [ ] **Step 2: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无新增错误（可能有外部依赖缺失需要处理）

- [ ] **Step 3: Commit**

```bash
git add src/main/ai/cowork-openai-compat-proxy.ts
git commit -m "feat(desktop): add cowork-openai-compat-proxy server"
```

---

## Task 10: types.ts 更新

**Files:**
- Modify: `src/main/ai/types.ts:78-91`

- [ ] **Step 1: 更新 EnginePhase 增加 'running'**

```typescript
// 原:
export type EnginePhase = 'not_installed' | 'starting' | 'ready' | 'error'

// 改为:
export type EnginePhase = 'not_installed' | 'starting' | 'ready' | 'running' | 'error'
```

- [ ] **Step 2: 更新 EngineStatus 增加 progressPercent**

```typescript
// 原:
export interface EngineStatus {
  phase: EnginePhase
  version: string | null
  message: string
  canRetry: boolean
}

// 改为:
export interface EngineStatus {
  phase: EnginePhase
  version: string | null
  progressPercent?: number
  message: string
  canRetry: boolean
}
```

- [ ] **Step 3: 新增 GatewayConnectionInfo 到 types.ts**

在 `EngineStatus` 后面添加：

```typescript
export interface GatewayConnectionInfo {
  version: string | null
  port: number | null
  token: string | null
  url: string | null
  clientEntryPath: string | null
}
```

- [ ] **Step 4: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 可能有 engine-manager.ts 中的错误（还在用旧类型），先记录

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/types.ts
git commit -m "feat(desktop): extend types with running phase, progressPercent, GatewayConnectionInfo"
```

---

## Task 11: engine-manager.ts 增强

**Files:**
- Modify: `src/main/ai/engine-manager.ts`
- Modify: `tests/main/ai/engine-manager.test.ts`
- Reference: `LobsterAI/src/main/libs/openclawEngineManager.ts`

这是核心改动，逐步对齐 LobsterAI 的 OpenClawEngineManager。

### Sub-task 11a: secretEnvVars 支持

- [ ] **Step 1: 添加 secretEnvVars 成员和公开 API**

在 engine-manager.ts 的类成员声明中添加：

```typescript
private secretEnvVars: Record<string, string> = {}
```

在公开 API 区域添加：

```typescript
setSecretEnvVars(vars: Record<string, string>): void {
  this.secretEnvVars = vars
}

getSecretEnvVars(): Record<string, string> {
  return this.secretEnvVars
}
```

### Sub-task 11b: GatewayConnectionInfo 使用 types 中的定义

- [ ] **Step 2: 移除本地 GatewayConnectionInfo，使用 types 中的**

删除 engine-manager.ts 顶部的本地 `interface GatewayConnectionInfo`，改为从 types 导入：

```typescript
import type { EnginePhase, EngineStatus, GatewayConnectionInfo, RuntimeMetadata } from './types'
```

更新 `getGatewayConnectionInfo()` 返回值增加 `clientEntryPath` 字段。

### Sub-task 11c: resolveGatewayClientEntry

- [ ] **Step 3: 添加 resolveGatewayClientEntry 方法**

参考 LobsterAI 的 `resolveGatewayClientEntry` 和 `findGatewayClientEntryFromDistRoot`：

```typescript
private resolveGatewayClientEntry(runtimeRoot: string): string | null {
  const distRoots = [
    path.join(runtimeRoot, 'dist'),
    path.join(runtimeRoot, 'gateway.asar', 'dist')
  ]

  for (const distRoot of distRoots) {
    const clientEntry = this.findGatewayClientEntryFromDistRoot(distRoot)
    if (clientEntry) return clientEntry
  }
  return null
}

private findGatewayClientEntryFromDistRoot(distRoot: string): string | null {
  // v2026.4.5+: plugin-sdk barrel re-exports GatewayClient
  const pluginSdkGatewayRuntime = path.join(distRoot, 'plugin-sdk', 'gateway-runtime.js')
  if (fs.existsSync(pluginSdkGatewayRuntime)) return pluginSdkGatewayRuntime

  // Pre-v2026.4.5 fallbacks
  const gatewayClient = path.join(distRoot, 'gateway', 'client.js')
  if (fs.existsSync(gatewayClient)) return gatewayClient

  const directClient = path.join(distRoot, 'client.js')
  if (fs.existsSync(directClient)) return directClient

  // Last resort: client-*.js glob
  try {
    if (!fs.existsSync(distRoot) || !fs.statSync(distRoot).isDirectory()) return null
    const candidates = fs.readdirSync(distRoot)
      .filter((name) => /^client(?:-.*)?\.js$/i.test(name))
      .sort()
    if (candidates.length > 0) return path.join(distRoot, candidates[0])
  } catch { /* ignore */ }

  return null
}
```

更新 `getGatewayConnectionInfo()`:

```typescript
getGatewayConnectionInfo(): GatewayConnectionInfo {
  const runtime = this.resolveRuntimeMetadata()
  const port = this.gatewayPort ?? this.readGatewayPort()
  const token = this.readGatewayToken()
  const clientEntryPath = runtime.root ? this.resolveGatewayClientEntry(runtime.root) : null

  return {
    version: runtime.version,
    port,
    token,
    url: port ? `ws://127.0.0.1:${port}` : null,
    clientEntryPath
  }
}
```

### Sub-task 11d: asar 解压支持

- [ ] **Step 4: 添加 ensureBareEntryFiles、ensureControlUiFiles、copyDirFromAsar**

从 LobsterAI 搬运这三个方法（参考 `openclawEngineManager.ts:688-833`）：

```typescript
private ensureBareEntryFiles(runtimeRoot: string): void {
  const t0 = Date.now()
  const bundlePath = path.join(runtimeRoot, 'gateway-bundle.mjs')
  if (fs.existsSync(bundlePath)) {
    console.debug('[OpenClaw] ensureBareEntryFiles: bundle 存在，跳过 dist 解压')
    this.ensureControlUiFiles(runtimeRoot)
    console.debug(`[OpenClaw] ensureBareEntryFiles: 完成 (${Date.now() - t0}ms)`)
    return
  }

  const bareEntry = path.join(runtimeRoot, 'openclaw.mjs')
  const bareDistEntry = path.join(runtimeRoot, 'dist', 'entry.js')
  if (fs.existsSync(bareEntry) && fs.existsSync(bareDistEntry)) return

  const asarRoot = path.join(runtimeRoot, 'gateway.asar')
  const asarEntry = path.join(asarRoot, 'openclaw.mjs')
  if (!fs.existsSync(asarEntry)) return

  console.info('[OpenClaw] ensureBareEntryFiles: 从 gateway.asar 解压')
  try {
    if (!fs.existsSync(bareEntry)) {
      fs.writeFileSync(bareEntry, fs.readFileSync(asarEntry))
    }
    const asarDist = path.join(asarRoot, 'dist')
    const bareDist = path.join(runtimeRoot, 'dist')
    if (fs.existsSync(asarDist) && !fs.existsSync(bareDistEntry)) {
      this.copyDirFromAsar(asarDist, bareDist)
    }
  } catch (err) {
    console.error('[OpenClaw] 从 gateway.asar 解压入口文件失败:', err)
  }
}

private ensureControlUiFiles(runtimeRoot: string): void {
  const controlUiIndex = path.join(runtimeRoot, 'dist', 'control-ui', 'index.html')
  if (fs.existsSync(controlUiIndex)) return

  const asarControlUi = path.join(runtimeRoot, 'gateway.asar', 'dist', 'control-ui')
  if (!fs.existsSync(asarControlUi)) return

  try {
    this.copyDirFromAsar(asarControlUi, path.join(runtimeRoot, 'dist', 'control-ui'))
  } catch (err) {
    console.error('[OpenClaw] 解压 dist/control-ui/ 失败:', err)
  }
}

private copyDirFromAsar(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true })
  const entries = fs.readdirSync(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      this.copyDirFromAsar(srcPath, destPath)
    } else {
      fs.writeFileSync(destPath, fs.readFileSync(srcPath))
    }
  }
}
```

### Sub-task 11e: ensureBundledCliShims

- [ ] **Step 5: 添加 ensureBundledCliShims 方法**

从 LobsterAI 搬运（`openclawEngineManager.ts:762-819`），**所有 `LOBSTERAI_*` 改为 `PETCLAW_*`**：

```typescript
private ensureBundledCliShims(): string | null {
  const shimDir = path.join(this.stateDir, 'bin')
  const shellWrapper = [
    '#!/usr/bin/env bash',
    'if [ -z "${PETCLAW_OPENCLAW_ENTRY:-}" ]; then',
    '  echo "PETCLAW_OPENCLAW_ENTRY is not set" >&2',
    '  exit 127',
    'fi',
    'if [ -n "${PETCLAW_ELECTRON_PATH:-}" ]; then',
    '  exec env ELECTRON_RUN_AS_NODE=1 "${PETCLAW_ELECTRON_PATH}" "${PETCLAW_OPENCLAW_ENTRY}" "$@"',
    'fi',
    'if command -v node >/dev/null 2>&1; then',
    '  exec node "${PETCLAW_OPENCLAW_ENTRY}" "$@"',
    'fi',
    'echo "Neither PETCLAW_ELECTRON_PATH nor node is available for OpenClaw CLI." >&2',
    'exit 127',
    ''
  ].join('\n')
  const windowsWrapper = [
    '@echo off',
    'if "%PETCLAW_OPENCLAW_ENTRY%"=="" (',
    '  echo PETCLAW_OPENCLAW_ENTRY is not set 1>&2',
    '  exit /b 127',
    ')',
    'if not "%PETCLAW_ELECTRON_PATH%"=="" (',
    '  set ELECTRON_RUN_AS_NODE=1',
    '  "%PETCLAW_ELECTRON_PATH%" "%PETCLAW_OPENCLAW_ENTRY%" %*',
    '  exit /b %ERRORLEVEL%',
    ')',
    'node "%PETCLAW_OPENCLAW_ENTRY%" %*',
    ''
  ].join('\r\n')

  try {
    ensureDir(shimDir)
    for (const commandName of ['openclaw', 'claw']) {
      const shellPath = path.join(shimDir, commandName)
      const existingShell = fs.existsSync(shellPath) ? fs.readFileSync(shellPath, 'utf8') : ''
      if (existingShell !== shellWrapper) {
        fs.writeFileSync(shellPath, shellWrapper, 'utf8')
        fs.chmodSync(shellPath, 0o755)
      }
      if (process.platform === 'win32') {
        const cmdPath = path.join(shimDir, `${commandName}.cmd`)
        const existingCmd = fs.existsSync(cmdPath) ? fs.readFileSync(cmdPath, 'utf8') : ''
        if (existingCmd !== windowsWrapper) {
          fs.writeFileSync(cmdPath, windowsWrapper, 'utf8')
        }
      }
    }
    return shimDir
  } catch (error) {
    console.error('[OpenClaw] CLI shims 生成失败:', error)
    return null
  }
}
```

### Sub-task 11f: ensureGatewayLauncherCjsForBundle + 完整版 CJS launcher

- [ ] **Step 6: 添加 ensureGatewayLauncherCjsForBundle 和更新 ensureGatewayLauncherCjs**

从 LobsterAI 搬运完整版 `ensureGatewayLauncherCjs`（含 V8 compile cache、argv patch、fallback）和 `ensureGatewayLauncherCjsForBundle`。

更新 `resolveOpenClawEntry` 以支持 bundle fast path：

```typescript
private resolveOpenClawEntry(runtimeRoot: string): string | null {
  // Windows bundle fast-path
  if (process.platform === 'win32') {
    const bundlePath = path.join(runtimeRoot, 'gateway-bundle.mjs')
    if (fs.existsSync(bundlePath)) {
      return this.ensureGatewayLauncherCjsForBundle(runtimeRoot)
    }
  }

  const esmEntry = findPath([
    path.join(runtimeRoot, 'openclaw.mjs'),
    path.join(runtimeRoot, 'dist', 'entry.js'),
    path.join(runtimeRoot, 'dist', 'entry.mjs'),
    path.join(runtimeRoot, 'gateway.asar', 'openclaw.mjs')
  ])
  if (!esmEntry) return null

  if (process.platform === 'win32') {
    return this.ensureGatewayLauncherCjs(runtimeRoot, esmEntry)
  }
  return esmEntry
}
```

实现者：参考 `LobsterAI/src/main/libs/openclawEngineManager.ts:835-1035` 搬运完整的 `ensureGatewayLauncherCjs` 和 `ensureGatewayLauncherCjsForBundle`，将 `LOBSTERAI_*` 改为 `PETCLAW_*`。

### Sub-task 11g: 完整 env 变量注入 + local extensions

- [ ] **Step 7: 更新 doStartGateway 的 env 对象和 ensureReady**

添加 import：
```typescript
import { ensureElectronNodeShim, getElectronNodeRuntimePath, getSkillsRoot } from './cowork-util'
import {
  cleanupStaleThirdPartyPluginsFromBundledDir,
  listLocalOpenClawExtensionIds,
  syncLocalOpenClawExtensionsIntoRuntime
} from './openclaw-local-extensions'
import { appendPythonRuntimeToEnv } from './python-runtime'
import { isSystemProxyEnabled, resolveSystemProxyUrlForTargets } from './system-proxy'
```

更新 `ensureReady()` 添加 local extensions 同步和 stale 清理（参考 LobsterAI `ensureReady:303-351`）。

更新 `doStartGateway()` 的 env 对象，添加缺失的环境变量：

```typescript
const skillsRoot = getSkillsRoot().replace(/\\/g, '/')
const electronNodeRuntimePath = getElectronNodeRuntimePath()
const cliShimDir = this.ensureBundledCliShims()
const compileCacheDir = path.join(this.stateDir, '.compile-cache')

const env: NodeJS.ProcessEnv = {
  ...process.env,
  // 现有变量保持...
  SKILLS_ROOT: skillsRoot,
  PETCLAW_SKILLS_ROOT: skillsRoot,
  OPENCLAW_BUNDLED_PLUGINS_DIR: path.join(runtime.root, 'dist', 'extensions'),
  OPENCLAW_SKIP_MODEL_PRICING: '1',
  OPENCLAW_DISABLE_BONJOUR: '1',
  OPENCLAW_LOG_LEVEL: 'debug',
  NODE_COMPILE_CACHE: compileCacheDir,
  PETCLAW_ELECTRON_PATH: electronNodeRuntimePath.replace(/\\/g, '/'),
  PETCLAW_OPENCLAW_ENTRY: openclawEntry.replace(/\\/g, '/'),
  ...this.secretEnvVars,
}
```

之后添加 CLI shim PATH、Python runtime PATH、node/npm shim PATH、系统代理注入（参考 LobsterAI `doStartGateway:495-527`）。

### Sub-task 11h: running phase + progressPercent + rewriteUtcTimestamps + getOpenClawDailyLogDir

- [ ] **Step 8: 更新 phase 和进度逻辑**

1. `doStartGateway` 中 `ensureReady` 后接受 `running` phase：
```typescript
if (ensured.phase !== 'ready' && ensured.phase !== 'running') {
  return ensured
}
```

2. `starting` 初始设置 `progressPercent: 10`

3. `waitForGatewayReady` 轮询中更新 progressPercent：
```typescript
const progress = Math.min(90, 10 + Math.round((elapsedMs / timeoutMs) * 80))
this.setStatus({
  phase: 'starting',
  version: this.status.version,
  progressPercent: progress,
  message: `正在启动 OpenClaw gateway...（${Math.round(elapsedMs / 1000)}s）`,
  canRetry: false
})
```

4. 启动成功后设为 `running`：
```typescript
this.setStatus({
  phase: 'running',
  version: runtime.version,
  progressPercent: 100,
  message: `OpenClaw gateway 运行中，端口 ${port}。`,
  canRetry: false
})
```

5. `stopGateway` 后回到 `ready`

6. 添加 `rewriteUtcTimestamps` 静态方法（从 LobsterAI 搬运）和 `getOpenClawDailyLogDir` 方法

7. `attachGatewayProcessLogs` 中使用 `rewriteUtcTimestamps`

- [ ] **Step 9: 运行现有测试**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/engine-manager.test.ts 2>&1 | tail -20`
Expected: 可能需要更新测试适配新字段

- [ ] **Step 10: 更新 engine-manager 测试**

在 `tests/main/ai/engine-manager.test.ts` 中补测：
- `running` phase 和 `progressPercent`
- `secretEnvVars` 的 set/get
- `getGatewayConnectionInfo()` 包含 `clientEntryPath`

- [ ] **Step 11: 运行所有测试确认通过**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/engine-manager.test.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/main/ai/engine-manager.ts tests/main/ai/engine-manager.test.ts
git commit -m "feat(desktop): align engine-manager with LobsterAI — full env injection, asar, CLI shims, running phase"
```

---

## Task 12: gateway.ts 重构

**Files:**
- Modify: `src/main/ai/gateway.ts`
- Modify: `tests/main/ai/gateway.test.ts`
- Reference: `LobsterAI/src/main/libs/agentEngine/openclawRuntimeAdapter.ts:1639-2087`

### Sub-task 12a: 无参构造 + connect(connectionInfo)

- [ ] **Step 1: 重构构造函数和 connect 签名**

```typescript
import { app } from 'electron'
import type { GatewayConnectionInfo } from './types'

export class OpenclawGateway extends EventEmitter {
  private client: GatewayClientLike | null = null
  private pendingGatewayClient: GatewayClientLike | null = null
  private connected = false

  // 版本/路径变更检测
  private gatewayClientVersion: string | null = null
  private gatewayClientEntryPath: string | null = null

  // WS 自动重连
  private gatewayReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private gatewayReconnectAttempt = 0
  private gatewayStoppingIntentionally = false
  private lastConnectionInfo: GatewayConnectionInfo | null = null
  private static readonly GATEWAY_RECONNECT_MAX_ATTEMPTS = 10
  private static readonly GATEWAY_RECONNECT_DELAYS = [2_000, 5_000, 10_000, 15_000, 30_000]

  // Tick 心跳看门狗
  private lastTickTimestamp = 0
  private tickWatchdogTimer: ReturnType<typeof setInterval> | null = null
  private static readonly TICK_WATCHDOG_INTERVAL_MS = 60_000
  private static readonly TICK_TIMEOUT_MS = 90_000

  // 并发锁
  private gatewayClientInitLock: Promise<void> | null = null

  constructor() {
    super()
  }

  async connect(connectionInfo: GatewayConnectionInfo): Promise<void> {
    if (this.gatewayClientInitLock) {
      await this.gatewayClientInitLock
      return
    }
    this.gatewayClientInitLock = this._connectImpl(connectionInfo)
    try {
      await this.gatewayClientInitLock
    } finally {
      this.gatewayClientInitLock = null
    }
  }
  // ...
}
```

### Sub-task 12b: _connectImpl 和版本检测

- [ ] **Step 2: 实现 _connectImpl**

```typescript
private async _connectImpl(connectionInfo: GatewayConnectionInfo): Promise<void> {
  const { url, token, version, clientEntryPath } = connectionInfo
  if (!url || !token || !clientEntryPath) {
    throw new Error('Gateway 连接信息不完整')
  }

  // 版本/路径变更 → 先断开旧连接
  if (
    (this.gatewayClientVersion && this.gatewayClientVersion !== version) ||
    (this.gatewayClientEntryPath && this.gatewayClientEntryPath !== clientEntryPath)
  ) {
    console.info('[Gateway] 检测到版本/路径变更，断开旧连接')
    this.disconnect()
  }

  // 已连接且无变更 → 跳过
  if (this.connected && this.client) return

  this.gatewayClientVersion = version
  this.gatewayClientEntryPath = clientEntryPath

  const Ctor = await this.loadGatewayClientCtor(clientEntryPath)

  return new Promise<void>((resolve, reject) => {
    let settled = false

    const client = new Ctor({
      url,
      token,
      clientDisplayName: 'PetClaw',
      clientVersion: app.getVersion(),
      mode: 'backend',
      caps: ['tool-events'],
      role: 'operator',
      scopes: ['operator.admin'],
      onHelloOk: () => {
        // promote pending → active
        this.client = client
        this.pendingGatewayClient = null
        this.connected = true
        this.lastConnectionInfo = connectionInfo
        this.gatewayReconnectAttempt = 0
        this.lastTickTimestamp = Date.now()
        this.startTickWatchdog()
        if (!settled) {
          settled = true
          resolve()
        }
        this.emit('connected')
      },
      onConnectError: (error: Error) => {
        const msg = error.message.toLowerCase()
        if (msg.includes('auth') || msg.includes('denied') || msg.includes('forbidden')) {
          if (!settled) {
            settled = true
            reject(error)
          }
        }
      },
      onClose: (_code: number, reason: string) => {
        this.connected = false
        this.stopTickWatchdog()
        if (!settled) {
          return
        }
        this.emit('disconnected', reason || 'Connection closed')
        if (!this.gatewayStoppingIntentionally) {
          this.scheduleGatewayReconnect()
        }
      },
      onEvent: (event: GatewayEventFrame) => {
        this.handleEvent(event)
      }
    })

    this.pendingGatewayClient = client
    client.start()

    setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error('Gateway connection timeout (60s)'))
      }
    }, 60_000)
  })
}
```

### Sub-task 12c: WS 自动重连

- [ ] **Step 3: 实现重连方法**

```typescript
private scheduleGatewayReconnect(): void {
  if (this.gatewayStoppingIntentionally) return
  if (this.gatewayReconnectTimer) return
  if (this.gatewayReconnectAttempt >= OpenclawGateway.GATEWAY_RECONNECT_MAX_ATTEMPTS) {
    console.error('[Gateway] 重连次数已达上限，放弃重连')
    return
  }

  const delays = OpenclawGateway.GATEWAY_RECONNECT_DELAYS
  const delay = delays[Math.min(this.gatewayReconnectAttempt, delays.length - 1)]
  this.gatewayReconnectAttempt++
  console.warn(`[Gateway] 调度重连 #${this.gatewayReconnectAttempt}，延迟 ${delay}ms`)

  this.gatewayReconnectTimer = setTimeout(() => {
    this.gatewayReconnectTimer = null
    void this.attemptGatewayReconnect()
  }, delay)
}

private async attemptGatewayReconnect(): Promise<void> {
  if (!this.lastConnectionInfo) return
  try {
    await this.connect(this.lastConnectionInfo)
    console.info('[Gateway] 重连成功')
  } catch (err) {
    console.warn('[Gateway] 重连失败:', err instanceof Error ? err.message : err)
  }
}

private cancelGatewayReconnect(): void {
  if (this.gatewayReconnectTimer) {
    clearTimeout(this.gatewayReconnectTimer)
    this.gatewayReconnectTimer = null
  }
}
```

### Sub-task 12d: Tick 心跳看门狗

- [ ] **Step 4: 实现 tick 看门狗**

```typescript
private startTickWatchdog(): void {
  this.stopTickWatchdog()
  this.lastTickTimestamp = Date.now()
  this.tickWatchdogTimer = setInterval(() => {
    this.checkTickHealth()
  }, OpenclawGateway.TICK_WATCHDOG_INTERVAL_MS)
}

private stopTickWatchdog(): void {
  if (this.tickWatchdogTimer) {
    clearInterval(this.tickWatchdogTimer)
    this.tickWatchdogTimer = null
  }
}

private checkTickHealth(): void {
  if (!this.connected || !this.client) return
  const elapsed = Date.now() - this.lastTickTimestamp
  if (elapsed > OpenclawGateway.TICK_TIMEOUT_MS) {
    console.warn(`[Gateway] tick 超时 (${elapsed}ms > ${OpenclawGateway.TICK_TIMEOUT_MS}ms)，触发重连`)
    this.disconnect()
    this.scheduleGatewayReconnect()
  }
}
```

更新 `handleEvent` 中 tick 事件更新 `lastTickTimestamp`：

```typescript
case 'tick':
  this.lastTickTimestamp = Date.now()
  this.emit('tick')
  break
```

### Sub-task 12e: disconnect + 公开接口

- [ ] **Step 5: 更新 disconnect 和添加公开接口**

```typescript
disconnect(): void {
  this.gatewayStoppingIntentionally = true
  this.cancelGatewayReconnect()
  this.stopTickWatchdog()

  if (this.pendingGatewayClient) {
    try { this.pendingGatewayClient.stop() } catch { /* ignore */ }
    this.pendingGatewayClient = null
  }
  if (this.client) {
    try { this.client.stop() } catch { /* ignore */ }
    this.client = null
    this.connected = false
  }

  this.gatewayStoppingIntentionally = false
}

async connectIfNeeded(connectionInfo: GatewayConnectionInfo): Promise<void> {
  if (this.connected && this.client) return
  await this.connect(connectionInfo)
}

async reconnect(connectionInfo: GatewayConnectionInfo): Promise<void> {
  this.disconnect()
  await this.connect(connectionInfo)
}
```

### Sub-task 12f: loadGatewayClientCtor 简化

- [ ] **Step 6: 简化 loadGatewayClientCtor**

```typescript
private async loadGatewayClientCtor(clientEntryPath: string): Promise<GatewayClientCtor> {
  const req = createRequire(import.meta.url)
  const loaded = req(clientEntryPath) as Record<string, unknown>

  // 优先查找命名导出 GatewayClient
  if (typeof loaded.GatewayClient === 'function') {
    return loaded.GatewayClient as GatewayClientCtor
  }

  // Duck-type 检测
  for (const value of Object.values(loaded)) {
    if (typeof value !== 'function') continue
    const ctor = value as { name?: string; prototype?: Record<string, unknown> }
    if (ctor.name === 'GatewayClient') return value as GatewayClientCtor
    if (
      ctor.prototype &&
      typeof ctor.prototype.start === 'function' &&
      typeof ctor.prototype.stop === 'function' &&
      typeof ctor.prototype.request === 'function'
    ) {
      return value as GatewayClientCtor
    }
  }

  throw new Error(`GatewayClient class not found in ${clientEntryPath}`)
}
```

- [ ] **Step 7: 删除旧的 clientEntryPath 成员（已被 gatewayClientEntryPath 替代）和 loadGatewayClientCtor(runtimeRoot) 签名**

- [ ] **Step 8: 更新 gateway 测试**

在 `tests/main/ai/gateway.test.ts` 中：
- 更新构造和 connect 调用方式（无参构造 + connectionInfo）
- 补测重连逻辑
- 补测 tick 看门狗
- 补测版本检测

- [ ] **Step 9: 运行测试**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/gateway.test.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/main/ai/gateway.ts tests/main/ai/gateway.test.ts
git commit -m "feat(desktop): align gateway with LobsterAI — connectionInfo connect, reconnect, tick watchdog"
```

---

## Task 13: cowork-controller.ts 适配

**Files:**
- Modify: `src/main/ai/cowork-controller.ts`
- Modify: `tests/main/ai/cowork-controller.test.ts`

- [ ] **Step 1: 添加 disconnected 事件处理**

在 controller 的 `bindGatewayEvents()` 方法中添加（或在构造函数中添加）：

```typescript
this.gateway.on('disconnected', (reason: string) => {
  console.warn('[CoworkController] gateway 断开:', reason)
  for (const [sessionId] of this.activeTurns) {
    this.store.updateSession(sessionId, { status: 'error' })
    this.emit('error', sessionId, `Gateway 连接断开: ${reason}`)
    this.cleanupSessionTurn(sessionId)
  }
})
```

实现者：先阅读 `cowork-controller.ts` 的完整代码，找到事件绑定的位置，在合适的地方添加上述逻辑。注意 `activeTurns` 和 `cleanupSessionTurn` 的实际名称可能略有不同，以代码中的实际名称为准。

- [ ] **Step 2: 检查 messageUpdate 节流是否已实现**

实现者：阅读 `cowork-controller.ts`，检查是否已有 `MESSAGE_UPDATE_THROTTLE_MS` 和相关节流逻辑。如果已有且值为 200ms，则无需改动。如果没有，参考 spec 中 §4.2 实现 leading + trailing 节流。

注意：从 conversation summary 看到 controller 已有 `MESSAGE_UPDATE_THROTTLE_MS = 200` 和 `STORE_UPDATE_THROTTLE_MS = 250`，可能节流已经实现了。只需确认逻辑完整。

- [ ] **Step 3: 更新 controller 测试**

在 `tests/main/ai/cowork-controller.test.ts` 中补测 disconnected 事件处理：

```typescript
it('should clean up active turns on gateway disconnect', () => {
  // 模拟一个 active turn
  // 触发 disconnected 事件
  // 验证 session 状态变为 error
})
```

- [ ] **Step 4: 运行测试**

Run: `cd petclaw-desktop && npx vitest run tests/main/ai/cowork-controller.test.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/cowork-controller.ts tests/main/ai/cowork-controller.test.ts
git commit -m "feat(desktop): add disconnected event handling to cowork-controller"
```

---

## Task 14: index.ts 适配

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 重构 initializeRuntimeServices**

当前签名：`async function initializeRuntimeServices(port: number, token: string)`
新签名：`async function initializeRuntimeServices()`

```typescript
async function initializeRuntimeServices(): Promise<void> {
  const connectionInfo = engineManager.getGatewayConnectionInfo()
  if (!connectionInfo.url || !connectionInfo.token) {
    console.warn('Gateway 连接信息不完整，跳过 V3 Runtime 初始化')
    return
  }

  gateway = new OpenclawGateway()
  try {
    await gateway.connect(connectionInfo)
  } catch (err) {
    console.warn('Gateway 连接失败:', err instanceof Error ? err.message : err)
  }

  // 后续 controller/session-manager/cron 初始化保持不变
  coworkController = new CoworkController(gateway, coworkStore)
  coworkSessionManager = new CoworkSessionManager(coworkStore, coworkController, directoryManager)

  const { CronJobService: CronJobServiceClass } = await import('./scheduler/cron-job-service')
  const scheduledTaskMetaStore = new ScheduledTaskMetaStore(db)
  cronJobService = new CronJobServiceClass({
    getGatewayClient: () => gateway?.getClient() ?? null,
    ensureGatewayReady: async () => { /* gateway 已在 boot 阶段就绪 */ },
    metaStore: scheduledTaskMetaStore
  })
  cronJobService.startPolling()
}
```

- [ ] **Step 2: 更新所有调用点**

将 `initializeRuntimeServices(bootResult.port!, bootResult.token!)` 改为 `initializeRuntimeServices()`：

```typescript
// 约 419 行
if (retryResult.success) {
  await initializeRuntimeServices()
  // ...
}

// 约 429 行
if (bootResult.success) {
  await initializeRuntimeServices()
}
```

- [ ] **Step 3: 更新前端 phase 检查**

实现者：搜索前端代码中 `phase === 'ready'` 的判断，改为 `phase === 'ready' || phase === 'running'`。这样前端能正确识别 gateway 正在运行的状态。

Run: `cd petclaw-desktop && grep -rn "phase.*===.*'ready'" src/renderer/ 2>/dev/null | head -10`

如果有匹配，更新为兼容 `running`。

- [ ] **Step 4: 类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "refactor(desktop): initializeRuntimeServices uses connectionInfo from engineManager"
```

---

## Task 15: 全量测试 + 类型检查

- [ ] **Step 1: 运行完整类型检查**

Run: `cd petclaw-desktop && npx tsc --noEmit --pretty 2>&1`
Expected: 无错误

- [ ] **Step 2: 运行所有测试**

Run: `cd petclaw-desktop && npx vitest run 2>&1 | tail -30`
Expected: 全部 PASS

- [ ] **Step 3: 修复任何失败**

如果有测试失败，逐一修复。

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix(desktop): resolve remaining type and test issues after alignment"
```

---

## Task 16: 同步文档

- [ ] **Step 1: 更新 .ai/README.md**

在对应章节中记录：
- 新增的 9 个工具模块及其职责
- engine-manager 的新功能（running phase、secretEnvVars、full env injection）
- gateway 的新功能（auto-reconnect、tick watchdog、connectionInfo connect）
- 环境变量前缀 `PETCLAW_*`

- [ ] **Step 2: 更新 v3 架构规格文档**

在 `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md` 中同步新增模块和改动。

- [ ] **Step 3: Commit**

```bash
git add .ai/README.md docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md
git commit -m "docs(desktop): sync engine-gateway alignment changes to architecture docs"
```
