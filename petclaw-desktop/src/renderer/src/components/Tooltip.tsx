import { ReactElement, ReactNode } from 'react'
import * as RadixTooltip from '@radix-ui/react-tooltip'

interface TooltipProps {
  // 提示文案：为 undefined / 空串时直接透传 children，避免无意义的 Tooltip 包装
  content?: ReactNode
  children: ReactElement
  // 默认出现在目标上方；调用方可按需改为 bottom/left/right
  side?: 'top' | 'bottom' | 'left' | 'right'
  // 与目标的间距（px），默认 8
  sideOffset?: number
  // 覆盖默认 max-width 等时可传 className 到 Content
  contentClassName?: string
}

/**
 * 全局轻量 Tooltip 封装（基于 @radix-ui/react-tooltip）。
 *
 * 选型原因：Radix Tooltip 提供 a11y（aria-describedby、ESC 关闭、键盘聚焦触发）、
 * Portal 定位不受父容器 overflow 裁剪、与 TooltipProvider 统一管理延迟。
 * 样式走 CSS 类 .ui-tooltip / .ui-tooltip-arrow，集中在 index.css，便于跟随主题 token。
 *
 * 使用要求：应用入口需挂 <TooltipProvider delayDuration={...}>。
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  sideOffset = 8,
  contentClassName
}: TooltipProps) {
  // 无内容时不构建 Radix 层级，避免空提示占用无障碍树和触发事件
  if (content === undefined || content === null || content === '') {
    return children
  }

  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={sideOffset}
          className={`ui-tooltip${contentClassName ? ` ${contentClassName}` : ''}`}
        >
          {content}
          <RadixTooltip.Arrow className="ui-tooltip-arrow" width={10} height={5} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
