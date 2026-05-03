import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { AppTopBar } from './AppTopBar'

const WORKSPACE_FULL_MIN_WIDTH = 1040
const WORKSPACE_SINGLE_MIN_WIDTH = 720

type WorkspaceLayoutMode = 'full' | 'compact' | 'single'

interface WorkspaceTopBarContext {
  layoutMode: WorkspaceLayoutMode
  leftOpen: boolean
  leftDrawerOpen: boolean
  rightOpen: boolean
  rightDrawerOpen: boolean
}

interface WorkspaceTopBarSlots {
  centerSlot?: ReactNode
  rightSlot?: ReactNode
}

/**
 * 工作台外层框架：负责侧栏 / 主画布 / 监控面板的三分栏布局。
 * 顶栏由 AppTopBar 统一渲染，各 view 通过 centerSlot / rightSlot 注入内容。
 */

interface WorkspaceFrameProps {
  leftOpen: boolean
  showRightPane: boolean
  rightOpen: boolean
  leftPane: ReactNode
  rightPane: ReactNode
  children: ReactNode
  /** 各 view 提供的顶栏居中 slot */
  centerSlot?: ReactNode
  /** 各 view 提供的顶栏右侧 slot */
  rightSlot?: ReactNode
  /** 需要依赖真实响应式布局态时，通过 render 回调注入顶栏内容。 */
  renderTopBarSlots?: (context: WorkspaceTopBarContext) => WorkspaceTopBarSlots
  onOpenLeft: () => void
  onCloseLeft: () => void
  onCloseRight?: () => void
  onNewTask: () => void
  openLeftLabel: string
  closeOverlayLabel: string
  newTaskLabel: string
}

export function WorkspaceFrame({
  leftOpen,
  showRightPane,
  rightOpen,
  leftPane,
  rightPane,
  children,
  centerSlot,
  rightSlot,
  renderTopBarSlots,
  onOpenLeft,
  onCloseLeft,
  onCloseRight,
  onNewTask,
  openLeftLabel,
  closeOverlayLabel,
  newTaskLabel
}: WorkspaceFrameProps) {
  // 工作台布局先测量容器宽度，再把用户期望状态折算成当前宽度下的有效占位状态：
  // full 保留三栏，compact 让右侧监控退出布局，single 只保留主对话区。
  const [frameWidth, setFrameWidth] = useState(0)
  const frameRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const updateFrameWidth = (): void => {
      setFrameWidth(frame.getBoundingClientRect().width)
    }

    updateFrameWidth()

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setFrameWidth(entry.contentRect.width)
    })

    resizeObserver.observe(frame)
    window.addEventListener('resize', updateFrameWidth)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateFrameWidth)
    }
  }, [])

  const layoutMode = useMemo<WorkspaceLayoutMode>(() => {
    if (frameWidth > 0 && frameWidth < WORKSPACE_SINGLE_MIN_WIDTH) return 'single'
    if (frameWidth > 0 && frameWidth < WORKSPACE_FULL_MIN_WIDTH) return 'compact'
    return 'full'
  }, [frameWidth])

  // 用户的开关状态只表达“意图”；真正占位要受当前容器宽度约束。
  // 窄宽度下优先保证对话区，右侧监控改为不占位，极窄时左栏也退出布局。
  const effectiveLeftOpen = leftOpen && layoutMode !== 'single'
  const drawerLeftOpen = leftOpen && layoutMode === 'single'
  const effectiveMonitorOpen = showRightPane && rightOpen && layoutMode === 'full'
  const drawerMonitorOpen = showRightPane && rightOpen && layoutMode !== 'full' && !drawerLeftOpen
  const layoutClass = `workspace-layout-${layoutMode}`
  const resolvedTopBarSlots = renderTopBarSlots?.({
    layoutMode,
    leftOpen: effectiveLeftOpen,
    leftDrawerOpen: drawerLeftOpen,
    rightOpen: effectiveMonitorOpen,
    rightDrawerOpen: drawerMonitorOpen
  }) ?? { centerSlot, rightSlot }

  return (
    <div className="app-shell">
      <div
        ref={frameRef}
        className={`workspace-window ${layoutClass} ${
          effectiveLeftOpen ? '' : 'workspace-left-collapsed'
        }`}
      >
        {/* 统一顶栏：贯穿整个窗口 */}
        <AppTopBar
          sidebarOpen={effectiveLeftOpen}
          monitorOpen={effectiveMonitorOpen}
          centerSlot={resolvedTopBarSlots.centerSlot}
          rightSlot={resolvedTopBarSlots.rightSlot}
          onOpenSidebar={onOpenLeft}
          onNewTask={onNewTask}
          openSidebarLabel={openLeftLabel}
          newTaskLabel={newTaskLabel}
        />

        {/* 左侧栏 */}
        <aside
          aria-hidden={!effectiveLeftOpen && !drawerLeftOpen}
          className={`workspace-sidebar-shell ${
            drawerLeftOpen
              ? 'workspace-sidebar-shell-drawer'
              : effectiveLeftOpen
                ? 'workspace-sidebar-shell-open'
                : 'workspace-sidebar-shell-collapsed'
          }`}
          style={{
            width: effectiveLeftOpen || drawerLeftOpen ? 'var(--size-sidebar)' : 0
          }}
        >
          {leftPane}
        </aside>

        {/* 中央主画布 */}
        <section className="workspace-center-column">
          <div className="workspace-main-surface">{children}</div>
        </section>

        {/* 右侧监控面板
            架构约束：面板与主画布的间距、以及折叠态的间距消除，统一由 CSS
            中 .workspace-monitor-shell / .workspace-monitor-shell-collapsed 控制
            （margin-inline-start），与 sidebar 的 open/collapsed 规则严格对称。 */}
        {showRightPane && (
          <aside
            aria-hidden={!effectiveMonitorOpen && !drawerMonitorOpen}
            className={`workspace-monitor-shell ${
              drawerMonitorOpen
                ? 'workspace-monitor-shell-drawer'
                : effectiveMonitorOpen
                  ? 'workspace-monitor-shell-open'
                  : 'workspace-monitor-shell-collapsed'
            }`}
            style={{
              width: effectiveMonitorOpen || drawerMonitorOpen ? 'var(--size-monitor-panel)' : 0
            }}
          >
            {(effectiveMonitorOpen || drawerMonitorOpen) && rightPane}
          </aside>
        )}

        {(drawerLeftOpen || drawerMonitorOpen) && (
          <button
            type="button"
            className="workspace-drawer-backdrop"
            aria-label={closeOverlayLabel}
            onClick={drawerLeftOpen ? onCloseLeft : onCloseRight}
          />
        )}
      </div>
    </div>
  )
}
