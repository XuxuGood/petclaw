// IM 平台品牌图标 — 彩色圆底 + 白色 SVG logo
// 每个组件渲染为 size×size 圆形（默认 40px），与设计稿对齐

interface IconProps {
  size?: number
}

/** 钉钉 — 闪电纸飞机 */
export function DingTalkIcon({ size = 40 }: IconProps) {
  const r = size / 2
  const s = size * 0.45
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <circle cx={r} cy={r} r={r} fill="#3296FA" />
      <g transform={`translate(${(size - s) / 2}, ${(size - s) / 2}) scale(${s / 24})`}>
        <path
          d="M20.2 7.8L8.6 12.7c-.4.2-.4.7 0 .8l2.8 1.2 1.2 3.8c.1.4.6.5.9.3l1.8-1.7 3.2 2.4c.4.3.9.1 1-.3l2.5-10.6c.1-.5-.4-.9-.8-.8zM12.4 14.4l5.4-3.8-4.2 4.4-.3 1.9-1-2.5z"
          fill="white"
        />
      </g>
    </svg>
  )
}

/** 飞书 — 蓝色小鸟 */
export function FeishuIcon({ size = 40 }: IconProps) {
  const r = size / 2
  const s = size * 0.5
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <circle cx={r} cy={r} r={r} fill="#3370FF" />
      <g transform={`translate(${(size - s) / 2}, ${(size - s) / 2}) scale(${s / 24})`}>
        <path
          d="M6.1 8.5c.3-1.1 1.3-1.9 2.5-1.9.4 0 .7.1 1 .2l6.7 3.4c.8.4 1.3 1.2 1.3 2.1v4.2c0 1-.6 1.8-1.5 2.1L9.4 21c-.3.1-.6.1-.9 0-.5-.2-.8-.7-.8-1.2v-3.6l-2.1-5.3c-.2-.5-.1-1 .1-1.5z"
          fill="white"
          opacity="0.85"
        />
        <path
          d="M10.8 4c.9-.5 2-.3 2.7.4l5.8 5.5c.7.7.8 1.7.3 2.5l-3.9 5.8c-.3.4-.7.5-1.1.4-.4-.2-.7-.6-.7-1.1V12c0-.7-.4-1.4-1-1.7L7.4 7.4c-.4-.2-.5-.6-.4-1 .2-.4.5-.7.9-.8L10.8 4z"
          fill="white"
        />
      </g>
    </svg>
  )
}

/** 微信 — 双气泡 */
export function WeChatIcon({ size = 40 }: IconProps) {
  const r = size / 2
  const s = size * 0.5
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <circle cx={r} cy={r} r={r} fill="#07C160" />
      <g transform={`translate(${(size - s) / 2}, ${(size - s) / 2}) scale(${s / 24})`}>
        <path
          d="M9.5 4C5.9 4 3 6.5 3 9.5c0 1.7.9 3.2 2.3 4.2L4.8 16l2.5-1.3c.7.2 1.4.3 2.2.3.3 0 .7 0 1-.1-.2-.6-.3-1.2-.3-1.9 0-3.3 3-6 6.8-6 .3 0 .7 0 1 .1C17.2 5 13.7 4 9.5 4z"
          fill="white"
        />
        <circle cx="7.5" cy="8.5" r="0.9" fill="#07C160" />
        <circle cx="11.5" cy="8.5" r="0.9" fill="#07C160" />
        <path
          d="M17 9c-3.3 0-6 2.2-6 5s2.7 5 6 5c.7 0 1.3-.1 1.9-.3l2.1 1.1-.4-1.9C21.6 17.1 23 15.7 23 14c0-2.8-2.7-5-6-5z"
          fill="white"
          opacity="0.85"
        />
        <circle cx="15" cy="13.5" r="0.8" fill="#07C160" />
        <circle cx="19" cy="13.5" r="0.8" fill="#07C160" />
      </g>
    </svg>
  )
}

/** 企业微信 — 对话气泡+人形 */
export function WeComIcon({ size = 40 }: IconProps) {
  const r = size / 2
  const s = size * 0.5
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <circle cx={r} cy={r} r={r} fill="#2B7CE9" />
      <g transform={`translate(${(size - s) / 2}, ${(size - s) / 2}) scale(${s / 24})`}>
        {/* 左侧气泡 */}
        <path
          d="M10 4C6 4 3 6.5 3 9.7c0 1.8 1 3.4 2.5 4.5l-.6 2 2.3-1.2c.9.2 1.8.4 2.8.4 4 0 7-2.5 7-5.7S14 4 10 4z"
          fill="white"
        />
        {/* 左气泡眼睛 */}
        <circle cx="7.8" cy="9" r="0.9" fill="#2B7CE9" />
        <circle cx="12.2" cy="9" r="0.9" fill="#2B7CE9" />
        {/* 右侧小气泡 */}
        <path
          d="M19 11c-2.2 0-4 1.5-4 3.3 0 1.8 1.8 3.3 4 3.3.5 0 1-.1 1.4-.2l1.6.8-.3-1.3c.8-.7 1.3-1.6 1.3-2.6 0-1.8-1.8-3.3-4-3.3z"
          fill="white"
          opacity="0.85"
        />
      </g>
    </svg>
  )
}
