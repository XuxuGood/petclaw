import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip'

import { App } from './App'
import { i18nService } from './i18n'
import './index.css'

// 从主进程读取用户语言偏好，在渲染前初始化 i18n
window.api.getLanguage().then((locale) => {
  i18nService.init(locale as 'zh' | 'en')
})

// 全局 TooltipProvider：
// - delayDuration: 鼠标停留 300ms 后出现，兼顾响应速度与防误触
// - skipDelayDuration: 300ms 内从一个 tooltip 切到另一个直接显示，不再等待
// 组件内按需使用 <Tooltip>（见 components/Tooltip.tsx），未挂载 Provider 则 Radix 会报错。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={300} skipDelayDuration={300}>
      <App />
    </TooltipProvider>
  </React.StrictMode>
)
