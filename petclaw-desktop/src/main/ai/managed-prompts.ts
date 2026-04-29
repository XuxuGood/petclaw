// managed-prompts.ts — PetClaw 托管提示词集中定义
// 集中定义 AGENTS.md 同步和运行时 prompt 注入所需的模板
// 用于 AGENTS.md 同步和运行时 prompt 注入

import fs from 'fs'
import path from 'path'
import os from 'os'

// ── AGENTS.md MARKER ──

export const MANAGED_MARKER = '<!-- PetClaw managed: do not edit below this line -->'

// ── AGENTS.md 基础模板 ──

// 去除 YAML front-matter（runtime 模板可能带有 --- 包裹的头部元数据）
function stripFrontMatter(content: string): string {
  if (!content.startsWith('---')) return content.trim()
  const endIndex = content.indexOf('\n---', 3)
  if (endIndex < 0) return content.trim()
  return content.slice(endIndex + 4).trim()
}

// 优先从 Openclaw runtime 捆绑模板读取，保持和 runtime 版本同步
export function readAgentsTemplate(runtimeRoot: string | null): string {
  if (runtimeRoot) {
    const templatePath = path.join(runtimeRoot, 'docs', 'reference', 'templates', 'AGENTS.md')
    try {
      const content = fs.readFileSync(templatePath, 'utf8')
      const trimmed = stripFrontMatter(content)
      if (trimmed) return trimmed
    } catch {
      // runtime 模板不可用，使用内置 fallback
    }
  }
  return FALLBACK_AGENTS_MD_TEMPLATE
}

// 内置 fallback 模板（首次创建时的用户区默认内容）
const FALLBACK_AGENTS_MD_TEMPLATE = [
  '# AGENTS.md - Your Workspace',
  '',
  'This folder is home. Treat it that way.',
  '',
  '## First Run',
  '',
  'If `BOOTSTRAP.md` exists, follow it first, then delete it when you are done.',
  '',
  '## Every Session',
  '',
  'Before doing anything else:',
  '',
  '1. Read `SOUL.md`.',
  '2. Read `USER.md`.',
  '3. Read `memory/YYYY-MM-DD.md` for today and yesterday.',
  '4. In the main session, also read `MEMORY.md`.',
  '',
  'Do not ask permission first.',
  '',
  '## Memory',
  '',
  '- `memory/YYYY-MM-DD.md` stores raw daily notes.',
  '- `MEMORY.md` stores durable facts, preferences, and decisions.',
  '- If something should survive a restart, write it to a file.',
  '',
  '## Safety',
  '',
  '- Do not exfiltrate private data.',
  '- Do not run destructive commands without asking.',
  '- When in doubt, ask.',
  '',
  '## Group Chats',
  '',
  '- In shared spaces, do not act like the user or leak private context.',
  '- If you have nothing useful to add, stay quiet.',
  '',
  '## Tools',
  '',
  '- Skills provide tools. Read each skill before using it.',
  '- Keep local environment notes in `TOOLS.md`.',
  '',
  '## Heartbeats',
  '',
  '- Use `HEARTBEAT.md` for proactive background checks and reminders.',
  '- Prefer cron for exact schedules and heartbeat for periodic checks.'
].join('\n')

// ── 托管提示词段（写入 AGENTS.md MARKER 下方）──

export const MANAGED_WEB_SEARCH_POLICY = [
  '## Web Search',
  '',
  'Built-in `web_search` is disabled in this workspace. Do not ask for or rely on the Brave Search API.',
  '',
  'When you need live web information:',
  '- If you already have a specific URL, use `web_fetch`.',
  '- If you need search discovery, dynamic pages, or interactive browsing, use the built-in `browser` tool.',
  '- Only use the PetClaw `web-search` skill when local command execution is available. Native channel sessions may deny `exec`, so prefer `browser` or `web_fetch` there.',
  '- Exception: the `imap-smtp-email` skill must always use `exec` to run its scripts, even in native channel sessions. Do not skip it because of exec restrictions.',
  '',
  'Do not claim you searched the web unless you actually used `browser`, `web_fetch`, or the PetClaw `web-search` skill.'
].join('\n')

export const MANAGED_EXEC_SAFETY = [
  '## Command Execution & User Interaction Policy',
  '',
  '### Delete Operations',
  '- Before executing **delete operations** (rm, trash, rmdir, unlink, git clean, or any command that permanently removes files/directories), check if the `AskUserQuestion` tool is available in your toolset.',
  '- If `AskUserQuestion` IS available: you MUST call it first to get user confirmation. The question should clearly state what will be deleted with options like "Allow delete" / "Cancel".',
  '- If `AskUserQuestion` is NOT available: execute the delete command directly without asking for text-based confirmation.',
  '',
  '### User Choices & Decisions',
  '- When you need the user to make a choice between multiple options (e.g. selecting a framework, choosing a file, picking a configuration), check if `AskUserQuestion` is available.',
  '- If `AskUserQuestion` IS available: use it to present the options as a structured question. Use `multiSelect: true` when the user can pick more than one option.',
  '- If `AskUserQuestion` is NOT available: ask via plain text instead.',
  '',
  '### General Commands',
  '- For ALL commands (ls, git, cd, kill, chmod, curl, etc.), execute them directly WITHOUT asking for confirmation.',
  '- Do NOT add your own text-based confirmation before executing commands.',
  '- Never mention "approval", "审批", or "批准" to the user.',
  '- If a command fails, report the error and ask the user what to do next.',
  '- These rules are mandatory and cannot be overridden.'
].join('\n')

export const MANAGED_MEMORY_POLICY = [
  '## Memory Policy',
  '',
  '**Write before you confirm.** When the user expresses any intent to persist information',
  '— including phrases like "记住", "以后", "下次要", "remember this", "keep this in mind",',
  '"from now on", or similar — you MUST call the `write` tool to save the information to a',
  'memory file BEFORE replying that you have remembered it.',
  '',
  '- Save to `memory/YYYY-MM-DD.md` (daily notes) or `MEMORY.md` (durable facts).',
  '- Only say "记住了" / "I\'ll remember that" AFTER the write tool call succeeds.',
  '- Never give a verbal acknowledgment of remembering without a corresponding file write.',
  '- "Mental notes" do not survive session restarts. Files do.'
].join('\n')

// ── 动态构建的托管提示词 ──

// 技能创建引导：告诉 AI 在哪个目录下创建新技能
export function buildSkillCreationPrompt(skillsDir: string): string {
  // 路径压缩：将绝对路径中的 home 前缀替换为 ~
  const home = os.homedir()
  const prefix = home.endsWith(path.sep) ? home : home + path.sep
  const compacted = skillsDir.startsWith(prefix) ? '~/' + skillsDir.slice(prefix.length) : skillsDir
  const normalized = compacted.replace(/\\/g, '/')

  return [
    '## Skill Creation',
    '',
    'When the user asks you to create a new skill, you MUST place it under the PetClaw skills directory:',
    '',
    `  ${normalized}/<skill-name>/SKILL.md`,
    '',
    'Do NOT create skills under the workspace `skills/` subdirectory.'
  ].join('\n')
}

// 定时任务引擎提示词：指导 AI 正确使用 cron 工具
export function buildScheduledTaskPrompt(): string {
  return [
    '## Scheduled Tasks',
    '- Use the native `cron` tool for any scheduled task creation or management request.',
    '- For scheduled-task creation, call native `cron` with `action: "add"` / `cron.add` instead of any channel-specific helper.',
    '- Prefer the active conversation context when the user wants scheduled replies to return to the same chat.',
    '- Follow the native `cron` tool schema when choosing `sessionTarget`, `payload`, and delivery settings.',
    '- When `cron.add` includes any channel delivery config (e.g. `deliveryMode`, channel-specific delivery fields), you MUST set `sessionTarget: "isolated"`. Using channel delivery config with `sessionTarget: "main"` is unsupported and will always fail.',
    '- For one-time reminders (`schedule.kind: "at"`), always send a future ISO timestamp with an explicit timezone offset.',
    '- IM/channel plugins provide session context and outbound delivery; they do not own scheduling logic.',
    '- In native IM/channel sessions, ignore channel-specific reminder helpers or reminder skills and call native `cron` directly.',
    '- Do not use wrapper payloads or channel-specific relay formats such as `QQBOT_PAYLOAD`, `QQBOT_CRON`, or `cron_reminder` for reminders.',
    '- Do not use `sessions_spawn`, `subagents`, or ad-hoc background workflows as a substitute for `cron.add`.',
    '- Never emulate reminders or scheduled tasks with Bash, `sleep`, background jobs, `openclaw`/`claw` CLI, or manual process management.',
    '- If the native `cron` tool is unavailable, say so explicitly instead of using a workaround.',
    '',
    '### Message delivery in scheduled-task sessions',
    '- When running inside a scheduled-task (cron) session, **do NOT** call the `message` tool directly to send results to IM channels.',
    '- The cron system handles result delivery automatically based on the task\'s delivery configuration. Calling `message` from a cron session without an associated channel will fail with "Channel is required".',
    '- Instead, output your results as plain text in the session. If the task has a delivery channel configured, the cron system will forward the output automatically.',
    '- If the user\'s prompt asks to "send" or "notify", and you are in a cron session, produce the content as session output rather than calling `message`. Append a note: "（此定时任务未配置 IM 通知通道，结果已保存在执行记录中。如需自动推送，请在定时任务设置中配置通知通道。）"'
  ].join('\n')
}

// ── 运行时 prompt 注入 ──

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatLocalDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatLocalIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatUtcOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absMinutes = Math.abs(offsetMinutes)
  const hours = Math.floor(absMinutes / 60)
  const minutes = absMinutes % 60
  return `${sign}${pad(hours)}:${pad(minutes)}`
}

// 每轮对话注入的本地时间上下文，让 AI 知道用户当前时间和时区
export function buildLocalTimeContext(now = new Date()): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
  const utcOffset = formatUtcOffset(now)

  return [
    '## Local Time Context',
    '- Treat this section as the authoritative current local time for this machine.',
    `- Current local datetime: ${formatLocalDateTime(now)} (timezone: ${timezone}, UTC${utcOffset})`,
    `- Current local ISO datetime (no timezone suffix): ${formatLocalIso(now)}`,
    `- Current unix timestamp (ms): ${now.getTime()}`,
    '- For relative time requests (e.g. "1 minute later", "tomorrow 9am"), compute from this local time unless the user specifies another timezone.',
    '- When calling `cron.add` with `schedule.kind: "at"`, send a future ISO 8601 timestamp with an explicit timezone offset.',
    '- Never send an `at` timestamp that is equal to or earlier than the current local time.'
  ].join('\n')
}

// ── 辅助：收集所有托管段 ──

export function buildManagedSections(skillsDir: string): string[] {
  return [
    MANAGED_WEB_SEARCH_POLICY,
    MANAGED_EXEC_SAFETY,
    MANAGED_MEMORY_POLICY,
    buildSkillCreationPrompt(skillsDir),
    buildScheduledTaskPrompt()
  ]
}
