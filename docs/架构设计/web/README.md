# Web 架构边界

`petclaw-web` 是 workspace 预留包。当前没有实现细节时，本目录只记录边界，不编写虚假的架构事实。

未来 Web 包应遵守：

- 可依赖 `petclaw-shared` 的共享类型、i18n 和协议类型。
- 不直接依赖 `petclaw-desktop` 的 Electron IPC、SQLite、本地 runtime 管理或系统能力。
- 如需访问服务端能力，通过 HTTP/RPC 协议访问 `petclaw-api`。
- 如需复用视觉规范，读取 `docs/架构设计/desktop/ui/Desktop视觉规范.md`、`docs/架构设计/desktop/ui/Desktop组件规范.md` 和 `docs/架构设计/desktop/ui/Desktop页面布局规范.md`，不要把本地 `docs/设计参考/references/` 当事实源。
