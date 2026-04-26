import React from 'react'
import ReactDOM from 'react-dom/client'

import { App } from './App'
import { i18nService } from './i18n'
import './index.css'

// 从主进程读取用户语言偏好，在渲染前初始化 i18n
window.api.getLanguage().then((locale) => {
  i18nService.init(locale as 'zh' | 'en')
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
