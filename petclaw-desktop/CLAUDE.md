# petclaw-desktop/CLAUDE.md

## 项目概述
Electron + React + TypeScript 桌面宠物应用。透明窗口，猫咪动画，AI 聊天，工具监控。

## 进程隔离（最重要）
- `src/main/` — Node.js 主进程，可用所有 Node API
- `src/preload/` — 桥接层，只能用 contextBridge 暴露 API
- `src/renderer/` — 浏览器渲染进程，禁止引用 Node.js 模块

## IPC 规范
- channel 名格式：`模块:动作`（如 `chat:send`、`window:move`）
- 渲染→主（单向）：`ipcRenderer.send()` → `ipcMain.on()`
- 渲染→主（双向）：`ipcRenderer.invoke()` → `ipcMain.handle()`
- 主→渲染：`mainWindow.webContents.send()`

## 安全约束
- `nodeIntegration: false` — 永不开启
- `contextIsolation: true` — 永不关闭
- `sandbox: false` — 仅因 better-sqlite3，后续迁移后恢复

## 常用命令
- `pnpm dev` — 开发模式
- `pnpm test` — 运行测试
- `pnpm lint` — ESLint
- `pnpm typecheck` — 类型检查
- `pnpm build` — 生产构建

## 禁止事项
- 不能在 renderer 中 require('electron') 或任何 Node 模块
- 不能修改 webPreferences.nodeIntegration 或 contextIsolation
- Git commit 必须遵循 Conventional Commits
