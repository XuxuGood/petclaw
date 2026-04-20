# petclaw-desktop — AI 编码指南

**完整架构文档见根目录 `.ai/README.md` 第 10 节。**

## 红线（绝对禁止）
- renderer/ 中 `require('electron')` 或任何 Node 模块
- 修改 `nodeIntegration`（必须 false）或 `contextIsolation`（必须 true）
- 新增 IPC channel 不同步更新 `ipc.ts` + `preload/index.ts` + `preload/index.d.ts`

## 快捷命令
```bash
pnpm dev           # 开发模式
pnpm test          # 单元测试
pnpm lint          # ESLint
pnpm typecheck     # 类型检查
pnpm build         # 生产构建
pnpm package       # 打包
```