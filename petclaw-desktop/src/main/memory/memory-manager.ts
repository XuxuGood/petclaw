// src/main/memory/memory-manager.ts
// 纯文件驱动的记忆管理器，以 MEMORY.md 作为持久化载体
// 不依赖数据库，每个 workspace 目录下存一个 MEMORY.md 文件
import fs from 'fs'
import path from 'path'

import type { MemoryEntry } from '../ai/types'

export class MemoryManager {
  // 返回 workspace 对应的 MEMORY.md 路径
  private getMemoryPath(workspace: string): string {
    return path.join(workspace, 'MEMORY.md')
  }

  // 读取整个记忆文件内容；文件不存在时返回空字符串
  readMemory(workspace: string): string {
    const filePath = this.getMemoryPath(workspace)
    try {
      return fs.readFileSync(filePath, 'utf8')
    } catch {
      return ''
    }
  }

  // 追加一条记忆条目（以 Markdown 列表行形式写入）
  appendMemory(workspace: string, entry: string): void {
    const filePath = this.getMemoryPath(workspace)
    // 确保目录存在（首次写入时可能不存在）
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const existing = this.readMemory(workspace)
    // 若已有内容且末尾没换行，先补一个换行再追加
    const newLine = existing && !existing.endsWith('\n') ? '\n' : ''
    fs.appendFileSync(filePath, `${newLine}- ${entry}\n`)
  }

  // 删除包含指定文本的行
  removeMemory(workspace: string, entryText: string): void {
    const filePath = this.getMemoryPath(workspace)
    const content = this.readMemory(workspace)
    if (!content) return

    const lines = content.split('\n')
    const filtered = lines.filter(line => !line.includes(entryText))
    fs.writeFileSync(filePath, filtered.join('\n'))
  }

  // 按关键词搜索，返回所有匹配行（大小写不敏感）
  searchMemory(workspace: string, keyword: string): string[] {
    const content = this.readMemory(workspace)
    if (!content) return []
    return content
      .split('\n')
      .filter(line => line.trim() && line.toLowerCase().includes(keyword.toLowerCase()))
  }

  // 列出所有以 '- ' 开头的条目，附带行号（1-indexed）
  listEntries(workspace: string): MemoryEntry[] {
    const content = this.readMemory(workspace)
    if (!content) return []

    return content
      .split('\n')
      .map((line, idx) => ({ text: line, line: idx + 1 }))
      .filter(e => e.text.trim().startsWith('- '))
  }

  // 用新文本替换记忆文件中首个匹配的旧文本片段
  updateEntry(workspace: string, oldText: string, newText: string): void {
    const filePath = this.getMemoryPath(workspace)
    const content = this.readMemory(workspace)
    if (!content) return

    const updated = content.replace(oldText, newText)
    fs.writeFileSync(filePath, updated)
  }
}
