import type { ReactNode } from 'react'
import { PanelLeftOpen, Plus } from 'lucide-react'

/**
 * 统一顶栏组件：贯穿工作区的 grid。
 *
 * 架构约束（DOM 稳定性原则）：
 *   无论侧栏展开还是折叠，AppTopBar 始终渲染同一份 4-zone DOM 结构
 *   [traffic-safe] [left-controls] [center] [right]。
 *   展开态下通过 CSS 让前两个 zone 隐藏（display:none），grid 自然退化为两列。
 *   为什么必须这样做：之前根据 sidebarOpen 返回两份不同 JSX 会让 React 在折叠切换那
 *   一帧卸载整棵 rightSlot 子树再重挂，按钮（问题反馈等）会出现一帧裸状态 + 位置跳变，
 *   用户视觉上就是"闪一下 + 边框跳跃"。统一 DOM 后 centerSlot / rightSlot 在 React 层
 *   永远不卸载，再叠加 .app-topbar 的 left 过渡，折叠/展开动画与侧栏 width 完全同步。
 *
 * 布局模式：
 *   - 侧栏展开：顶栏左边右移到侧栏之后，grid 视觉上退化为 [1fr center] [auto right]
 *   - 侧栏折叠：四段 [traffic-safe] [controls] [1fr center] [auto right]
 *
 * 各 view 通过 centerSlot / rightSlot 注入自己的内容。
 *
 * 窗口拖拽策略：主窗口是 frame:false + transparent:true + vibrancy 的无边框透明窗口，macOS 并不会
 * 暴露原生可拖拽的 titlebar，必须在 .app-topbar 上显式设 -webkit-app-region: drag。
 * index.css 中对顶栏内部的 button/input/a/[contenteditable]/[role="button"] 等交互元素
 * 统一应用 no-drag，新增交互控件时若不是这些语义元素，需显式添加 role="button" 或 .no-drag 类。
 */

interface AppTopBarProps {
  sidebarOpen: boolean
  /** 任务监控面板是否打开：只要是 true，顶栏右边界向内退让，避免与监控面板横向重叠 */
  monitorOpen?: boolean
  /** 各 view 提供的居中内容（如可编辑标题、搜索框） */
  centerSlot?: ReactNode
  /** 各 view 提供的右侧工具按钮 */
  rightSlot?: ReactNode
  onOpenSidebar: () => void
  onNewTask: () => void
  openSidebarLabel: string
  newTaskLabel: string
}

export function AppTopBar({
  sidebarOpen,
  monitorOpen = false,
  centerSlot,
  rightSlot,
  onOpenSidebar,
  onNewTask,
  openSidebarLabel,
  newTaskLabel
}: AppTopBarProps) {
  // 监控面板打开时统一追加 monitor-open 类，让顶栏右边界避开面板宽度
  const monitorClass = monitorOpen ? ' app-topbar-monitor-open' : ''
  const layoutClass = sidebarOpen ? 'app-topbar-sidebar-open' : 'app-topbar-sidebar-collapsed'

  // 展开态下前两个 zone 被 CSS 以 display:none 剔除出 grid 流，
  // 这里同步把内部按钮的 tabIndex 设为 -1 并标记 aria-hidden，
  // 避免键盘焦点漫游到一个视觉上不存在的控件上（WCAG 焦点顺序）。
  const leftZonesHidden = sidebarOpen

  return (
    <div className={`app-topbar ${layoutClass}${monitorClass}`}>
      {/* 左段：红绿灯安全区，仅占位；展开态被 CSS 隐藏 */}
      <div className="topbar-zone topbar-left-safe" aria-hidden={leftZonesHidden} />

      {/* 控件段：展开侧栏 + 新建任务；展开态被 CSS 隐藏 */}
      <div className="topbar-zone topbar-left-controls" aria-hidden={leftZonesHidden}>
        <button
          type="button"
          onClick={onOpenSidebar}
          className="panel-toggle ui-focus"
          aria-label={openSidebarLabel}
          title={openSidebarLabel}
          tabIndex={leftZonesHidden ? -1 : 0}
        >
          <PanelLeftOpen size={15} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={onNewTask}
          className="panel-toggle ui-focus"
          aria-label={newTaskLabel}
          title={newTaskLabel}
          tabIndex={leftZonesHidden ? -1 : 0}
        >
          <Plus size={17} strokeWidth={1.9} />
        </button>
      </div>

      {/* 中段：view 提供的居中内容（DOM 稳定，状态切换不重建） */}
      <div className="topbar-zone topbar-center">{centerSlot}</div>

      {/* 右段：view 提供的工具按钮（DOM 稳定，状态切换不重建，避免闪烁） */}
      <div className="topbar-zone topbar-right">{rightSlot}</div>
    </div>
  )
}
