// 目录列表管理界面
// 目录不能手动创建（自动注册），只能编辑配置
import { useState, useEffect, useCallback } from 'react'

import { Settings2, FolderOpen } from 'lucide-react'

import { DirectoryConfigDialog } from '../../components/DirectoryConfigDialog'

interface DirectoryInfo {
  agentId: string
  path: string
  name: string | null
  modelOverride: string
  skillIds: string[]
}

export function DirectorySettings() {
  const [directories, setDirectories] = useState<DirectoryInfo[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const loadDirectories = useCallback(() => {
    window.api.directories.list().then((list: unknown) => {
      setDirectories(list as DirectoryInfo[])
    })
  }, [])

  useEffect(() => {
    loadDirectories()
  }, [loadDirectories])

  const handleEdit = (agentId: string) => {
    setEditingId(agentId)
    setDialogOpen(true)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-bold text-text-primary mb-1">工作目录</h1>
          <p className="text-[13px] text-text-tertiary">已注册的工作目录会在首次使用时自动添加</p>
        </div>
      </div>

      {directories.length === 0 ? (
        <div className="text-center py-12">
          <FolderOpen size={32} className="text-text-tertiary mx-auto mb-3" />
          <p className="text-[13px] text-text-tertiary">暂无已注册目录</p>
          <p className="text-[12px] text-text-tertiary mt-1">
            开始对话时选择工作目录，将自动注册到此列表
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {directories.map((dir) => (
            <button
              key={dir.agentId}
              onClick={() => handleEdit(dir.agentId)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-[14px] bg-bg-card border border-border hover:bg-bg-hover transition-colors text-left"
            >
              <FolderOpen size={18} className="text-text-tertiary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium text-text-primary">
                  {dir.name || dir.path.split('/').pop()}
                </div>
                <div className="text-[12px] text-text-tertiary truncate mt-0.5">{dir.path}</div>
              </div>
              {dir.modelOverride && (
                <span className="text-[11px] text-text-tertiary bg-bg-hover px-1.5 py-0.5 rounded shrink-0">
                  {dir.modelOverride}
                </span>
              )}
              <Settings2 size={14} className="text-text-tertiary shrink-0" />
            </button>
          ))}
        </div>
      )}

      <DirectoryConfigDialog
        isOpen={dialogOpen}
        directoryAgentId={editingId}
        onClose={() => setDialogOpen(false)}
        onSaved={loadDirectories}
      />
    </div>
  )
}
