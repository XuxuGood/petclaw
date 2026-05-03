import type { ReactNode } from 'react'

interface WorkspaceHeaderProps {
  title?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  centerTitle?: boolean
  className?: string
  titleClassName?: string
}

export function WorkspaceHeader({
  title,
  leading,
  trailing,
  centerTitle = false,
  className = '',
  titleClassName = ''
}: WorkspaceHeaderProps) {
  const titleClassNames = [
    'workspace-header-title',
    centerTitle ? 'workspace-header-title-centered' : '',
    titleClassName
  ]
    .filter(Boolean)
    .join(' ')

  return (
    // 是否作为窗口拖拽区由具体 header class 在 CSS 中决定；这里不内联 drag 行为，
    // 避免折叠侧栏等响应式场景把错误的拖拽命中区固化到共享组件上。
    <div className={`workspace-panel-header ${className}`}>
      <div className={titleClassNames}>
        {leading}
        {title}
      </div>
      {trailing && <div className="workspace-header-actions">{trailing}</div>}
    </div>
  )
}
