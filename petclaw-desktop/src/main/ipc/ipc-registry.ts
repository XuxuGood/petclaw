// 防重复注册守卫 + channel 审计工具。
// 所有 IPC 注册必须通过 safeHandle / safeOn，禁止直接调用 ipcMain.handle/on。
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron'

import { getLogger } from '../logging/facade'

const registered = new Set<string>()
const logger = getLogger('IPCRegistry')

// handle 模式（invoke/handle 请求-响应），重复注册时跳过并告警
// 使用与 ipcMain.handle 相同的宽松签名，允许各 handler 自行声明具体参数类型
export function safeHandle(
  channel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => any
): void {
  if (registered.has(channel)) {
    logger.warn('channel.duplicate.skipped', 'Duplicate IPC handler registration skipped', {
      channel,
      mode: 'handle'
    })
    return
  }
  registered.add(channel)
  ipcMain.handle(channel, handler)
}

// on 模式（send/on 单向），重复注册时跳过并告警
export function safeOn(
  channel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listener: (event: IpcMainEvent, ...args: any[]) => void
): void {
  if (registered.has(channel)) {
    logger.warn('channel.duplicate.skipped', 'Duplicate IPC listener registration skipped', {
      channel,
      mode: 'on'
    })
    return
  }
  registered.add(channel)
  ipcMain.on(channel, listener)
}

// 调试用：返回所有已注册 channel 列表
export function getRegisteredChannels(): string[] {
  return [...registered].sort()
}
