// command-safety.ts：命令安全等级判定
// 用于 Cowork 和 IM channel 的 auto-approve 逻辑、permission 弹窗的危险等级展示。
// 参考 LobsterAI commandSafety.ts

// ── 删除命令模式 ──
const DELETE_COMMAND_RE = /\b(rm|rmdir|unlink|del|erase|remove-item|trash)\b/i
const FIND_DELETE_COMMAND_RE = /\bfind\b[\s\S]*\s-delete\b/i
const GIT_CLEAN_COMMAND_RE = /\bgit\s+clean\b/i
const OSASCRIPT_DELETE_RE = /\bosascript\b[\s\S]*\bdelete\b/i

// ── 高危破坏性命令模式 ──
const RM_RECURSIVE_RE = /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|--recursive)\b/i
const GIT_PUSH_FORCE_RE = /\bgit\s+push\s+.*(?:--force|-f)\b/i
const GIT_RESET_HARD_RE = /\bgit\s+reset\s+--hard\b/i
const DD_COMMAND_RE = /\bdd\b/i
const MKFS_COMMAND_RE = /\bmkfs\b/i

// ── 中等危险命令模式 ──
const GIT_PUSH_RE = /\bgit\s+push\b/i
const KILL_COMMAND_RE = /\b(kill|killall|pkill)\b/i
const CHMOD_COMMAND_RE = /\b(chmod|chown)\b/i

export type DangerLevel = 'safe' | 'caution' | 'destructive'

/**
 * 判断命令是否为删除操作
 * （rm、rmdir、unlink、del、erase、remove-item、find -delete、git clean）
 */
export function isDeleteCommand(command: string): boolean {
  return (
    DELETE_COMMAND_RE.test(command) ||
    FIND_DELETE_COMMAND_RE.test(command) ||
    GIT_CLEAN_COMMAND_RE.test(command) ||
    OSASCRIPT_DELETE_RE.test(command)
  )
}

/**
 * 返回命令的危险等级和简短原因。
 * 用于 permission 弹窗中展示分级警告。
 */
export function getCommandDangerLevel(command: string): {
  level: DangerLevel
  reason: string
} {
  // destructive 级别 — 高风险，难以恢复
  if (RM_RECURSIVE_RE.test(command)) {
    return { level: 'destructive', reason: 'recursive-delete' }
  }
  if (GIT_PUSH_FORCE_RE.test(command)) {
    return { level: 'destructive', reason: 'git-force-push' }
  }
  if (GIT_RESET_HARD_RE.test(command)) {
    return { level: 'destructive', reason: 'git-reset-hard' }
  }
  if (DD_COMMAND_RE.test(command)) {
    return { level: 'destructive', reason: 'disk-overwrite' }
  }
  if (MKFS_COMMAND_RE.test(command)) {
    return { level: 'destructive', reason: 'disk-format' }
  }

  // caution 级别 — 有潜在危害但可恢复
  if (isDeleteCommand(command)) {
    return { level: 'caution', reason: 'file-delete' }
  }
  if (GIT_PUSH_RE.test(command)) {
    return { level: 'caution', reason: 'git-push' }
  }
  if (KILL_COMMAND_RE.test(command)) {
    return { level: 'caution', reason: 'process-kill' }
  }
  if (CHMOD_COMMAND_RE.test(command)) {
    return { level: 'caution', reason: 'permission-change' }
  }

  return { level: 'safe', reason: '' }
}
