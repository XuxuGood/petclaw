import { useState } from 'react'

import { useI18n } from '../../i18n'

/**
 * 上下文用量内联圆环指示器。
 *
 * 设计原则「隐形设计」：平时零存在感，只在真正需要关注时才出现。
 *  - 使用率 < 60%：不渲染（返回 null），不占据任何像素
 *  - 60–80%：灰色圆环 + 百分比，hover 弹出详情 popover
 *  - 80–95%：琥珀警示色
 *  - ≥ 95%：红色并做脉动动画，popover 默认打开提醒用户
 *
 * 精确 token 计数依赖 runtime 未来暴露的 usage 字段；当前通过 used/total props 由调用方传入，
 * 便于在 runtime 数据就绪前先用粗估值（字符数 / 2）驱动视觉。
 */

const WARN_THRESHOLD = 0.6
const DANGER_THRESHOLD = 0.8
const CRITICAL_THRESHOLD = 0.95

type UsageLevel = 'ok' | 'warn' | 'danger' | 'critical'

function getLevel(pct: number): UsageLevel {
  if (pct >= CRITICAL_THRESHOLD) return 'critical'
  if (pct >= DANGER_THRESHOLD) return 'danger'
  if (pct >= WARN_THRESHOLD) return 'warn'
  return 'ok'
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

interface Props {
  used: number
  total: number
}

export function ContextUsageIndicator({ used, total }: Props) {
  const { t } = useI18n()
  // popover 展开态：hover 进入 wrap 容器时为 true，离开时为 false；critical 级别默认保持展开
  const [hovering, setHovering] = useState(false)

  // 防御：total 非正数直接不渲染，避免除零
  if (!total || total <= 0) return null

  const pct = Math.min(Math.max(used / total, 0), 1)

  // 低于警戒阈值：完全不渲染，释放视觉焦点给对话本身
  if (pct < WARN_THRESHOLD) return null

  const level = getLevel(pct)
  const open = hovering || level === 'critical'

  // SVG 圆环：半径 7，周长 2πr ≈ 43.98；rotate(-90) 让进度从 12 点钟方向开始填充
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - pct)
  const percentText = `${Math.round(pct * 100)}%`

  return (
    <div
      className="ctx-indicator-wrap"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <button
        type="button"
        className={`ctx-indicator ctx-indicator--${level} ui-focus`}
        aria-label={`${t('contextUsage.label')} ${percentText}`}
        title={t('contextUsage.label')}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 18 18"
          className={level === 'critical' ? 'ctx-ring ctx-ring--pulse' : 'ctx-ring'}
        >
          <circle
            cx="9"
            cy="9"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.18"
            strokeWidth="2"
          />
          <circle
            cx="9"
            cy="9"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 9 9)"
            style={{ transition: 'stroke-dashoffset 240ms ease' }}
          />
        </svg>
        <span className="ctx-indicator-pct">{percentText}</span>
      </button>

      {open && (
        <div className="ctx-indicator-popover" role="tooltip">
          <div className="ctx-popover-head">
            <span className="ctx-popover-title">{t('contextUsage.label')}</span>
            <span className={`ctx-popover-pct ctx-popover-pct--${level}`}>{percentText}</span>
          </div>
          <div className="ctx-popover-detail">
            {t('contextUsage.detail', {
              used: formatTokens(used),
              total: formatTokens(total)
            })}
          </div>
          {level !== 'ok' && (
            <div className={`ctx-popover-hint ctx-popover-hint--${level}`}>
              {level === 'critical' ? t('contextUsage.danger') : t('contextUsage.warn')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
