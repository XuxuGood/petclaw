// skills-ipc.ts: Skill 列表查询和启用/禁用状态管理的 IPC 处理层
// Skill 目录扫描在主进程启动时完成，IPC 层只做读取和状态修改，不触发重新扫描
import { safeHandle } from './ipc-registry'
import type { SkillManager } from '../skills/skill-manager'

export interface SkillsIpcDeps {
  skillManager: SkillManager
}

export function registerSkillsIpcHandlers(deps: SkillsIpcDeps): void {
  const { skillManager } = deps

  // 返回所有已扫描的 Skill 列表（含启用状态）
  safeHandle('skills:list', async () => skillManager.list())

  // 设置 Skill 启用/禁用，持久化到 kv 表并触发 change 事件刷新 openclaw 配置
  safeHandle('skills:set-enabled', async (_event, id: string, enabled: boolean) => {
    skillManager.setEnabled(id, enabled)
  })
}
