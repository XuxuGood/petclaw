# API 架构边界

`petclaw-api` 是 workspace 预留包。当前没有实现细节时，本目录只记录边界，不编写虚假的架构事实。

未来 API 包应遵守：

- 可依赖 `petclaw-shared` 的共享类型和协议类型。
- 不直接依赖 `petclaw-desktop` 或 `petclaw-web` 实现。
- 对 desktop/web 暴露能力时使用显式 HTTP/RPC 契约。
- 鉴权、数据所有权、同步策略和权限边界必须在本目录补充架构文档后再实现。
