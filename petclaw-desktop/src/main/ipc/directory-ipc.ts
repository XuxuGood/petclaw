// directory-ipc.ts: 目录配置 IPC 处理层
import { readFileSync, statSync } from 'fs'
import { extname } from 'path'

import { BrowserWindow, dialog } from 'electron'

import { safeHandle } from './ipc-registry'
import type { DirectoryManager } from '../ai/directory-manager'

// 聊天附件选择模式：
// - 'auto'：macOS 原生对话框混选文件+目录；非 macOS 不支持混选，回退仅选文件
// - 'file' / 'directory'：强制单一类型（非 macOS 平台走分拆的两次弹窗流程会用到）
type SelectAttachmentsMode = 'auto' | 'file' | 'directory'

// 附件选择返回结构：kind='image' 时额外携带 base64Data+mimeType 以供渲染端直接预览；
// 其他文件/目录只返 path+kind。图片大于 IMAGE_INLINE_LIMIT 时退化为普通文件（不内联 base64）。
export interface SelectAttachmentResult {
  path: string
  kind: 'file' | 'directory' | 'image'
  mimeType?: string
  base64Data?: string
}

// 图片内联预览的单文件上限：5MB。大于此值时退化为 'file' kind，避免 base64 消息过大令 renderer 卡顿
const IMAGE_INLINE_LIMIT = 5 * 1024 * 1024

// 已知常用图片扩展名到 MIME 映射；svg 走 image/svg+xml 以便 browser 端直接当图片渲染
const IMAGE_EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
}

// 根据路径判断图片扩展名。注意大小写都要兼容（.PNG / .Jpg 等 Finder 常见写法）
function detectImageMime(p: string): string | null {
  const ext = extname(p).toLowerCase()
  return IMAGE_EXT_MIME[ext] ?? null
}

export interface DirectoryIpcDeps {
  directoryManager: DirectoryManager
}

export function registerDirectoryIpcHandlers(deps: DirectoryIpcDeps): void {
  const { directoryManager } = deps

  safeHandle('directory:list', async () => directoryManager.list())

  safeHandle('directory:get', async (_event, agentId: string) => directoryManager.get(agentId))

  safeHandle('directory:get-by-path', async (_event, directoryPath: string) =>
    directoryManager.getByPath(directoryPath)
  )

  safeHandle('directory:update-name', async (_event, agentId: string, name: string) =>
    directoryManager.updateName(agentId, name)
  )

  safeHandle('directory:update-model', async (_event, agentId: string, model: string) =>
    directoryManager.updateModelOverride(agentId, model)
  )

  safeHandle('directory:update-skills', async (_event, agentId: string, skillIds: string[]) =>
    directoryManager.updateSkillIds(agentId, skillIds)
  )

  // 打开系统原生目录选择对话框，返回选中目录的绝对路径或 null（用户取消）。
  // 用 BrowserWindow.fromWebContents 以事件发起方为 parent，确保 dialog 是模态窗口的子 sheet（mac）。
  safeHandle('dialog:select-directory', async (event, options?: { defaultPath?: string }) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          properties: ['openDirectory', 'createDirectory'],
          defaultPath: options?.defaultPath
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          defaultPath: options?.defaultPath
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // 聊天引用附件对话框：统一入口，同时支持选文件和目录。
  // macOS 原生支持 openFile + openDirectory 混选，一次弹窗即可；
  // Windows/Linux 不支持混选，调用方需显式传 mode 分别弹两次对话框。
  // 参考：Electron dialog.showOpenDialog properties 在非 macOS 平台不能同时设置 openFile 与 openDirectory。
  // 返回值：Array<{ path, kind }>；用户取消或未选中返回空数组（而不是 null，便于渲染端无脑合并）。
  safeHandle(
    'dialog:select-attachments',
    async (
      event,
      options?: { defaultPath?: string; mode?: SelectAttachmentsMode }
    ): Promise<SelectAttachmentResult[]> => {
      const mode: SelectAttachmentsMode = options?.mode ?? 'auto'
      const parent = BrowserWindow.fromWebContents(event.sender)
      const isMac = process.platform === 'darwin'
      // mode=auto 且 macOS 才能混选；其它情况强制落到 file（可显式通过 mode 进入 directory 分支）
      const effective: 'mixed' | 'file' | 'directory' =
        mode === 'directory' ? 'directory' : isMac && mode === 'auto' ? 'mixed' : 'file'

      const properties: Array<
        'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory'
      > =
        effective === 'mixed'
          ? ['openFile', 'openDirectory', 'multiSelections']
          : effective === 'directory'
            ? ['openDirectory', 'multiSelections', 'createDirectory']
            : ['openFile', 'multiSelections']

      const dialogOptions = {
        properties,
        defaultPath: options?.defaultPath
      }
      const result = parent
        ? await dialog.showOpenDialog(parent, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (result.canceled || result.filePaths.length === 0) return []

      // 用 fs.statSync 判定每条路径的 kind；断链 symlink 等 stat 失败条目直接跳过，
      // 避免把 AI 引导到不可读的路径上。
      // 图片文件在此提前读取 base64，后续与拖放/粘贴的图片共用渲染链路（chip 缩略图预览）。
      return result.filePaths.flatMap((p): SelectAttachmentResult[] => {
        try {
          const stat = statSync(p)
          if (stat.isDirectory()) {
            return [{ path: p, kind: 'directory' }]
          }
          // 图片文件且在内联预览上限内：读文件转 base64；超限/非图片或读取失败都退化为普通 'file'
          const mimeType = detectImageMime(p)
          if (mimeType && stat.size <= IMAGE_INLINE_LIMIT) {
            try {
              const buf = readFileSync(p)
              return [
                {
                  path: p,
                  kind: 'image',
                  mimeType,
                  base64Data: buf.toString('base64')
                }
              ]
            } catch {
              // 权限/IO 异常时不阻断，正常入库成 file chip
              return [{ path: p, kind: 'file' }]
            }
          }
          return [{ path: p, kind: 'file' }]
        } catch {
          return []
        }
      })
    }
  )
}
