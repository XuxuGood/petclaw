# Desktop 架构设计入口

本目录保存 `petclaw-desktop` 的架构事实源。文件按职责分层，不按代码目录镜像。

## 阅读路径

| 场景 | 阅读入口 |
|---|---|
| 了解 desktop 整体边界 | `overview/Desktop架构设计.md` |
| 修改 renderer、preload、IPC、SQLite 或 i18n | `foundation/` |
| 修改 OpenClaw runtime、ConfigSync、系统集成或打包 | `runtime/` |
| 修改 Cowork、IM、Cron、Skills、Models、MCP、Memory、Directory 或 Pet 事件 | `domains/` |
| 修改像素级视觉、组件和页面布局 | `ui/` |

## 目录职责

```text
desktop/
  overview/      desktop 总览、进程边界、启动流和模块地图
  foundation/    所有功能共享的 renderer/preload/IPC/data/i18n 基础层
  runtime/       OpenClaw runtime、配置同步、系统集成、打包发布
  domains/       具体业务功能域的端到端架构设计
  ui/            Desktop 视觉、组件和页面布局规范
```

## 分层规则

- `overview/` 只做地图，不承载模块细节。
- `foundation/` 不写具体业务语义，只描述所有功能共享的宿主边界。
- `runtime/` 描述本地 runtime 生命周期、系统能力和工程发布能力。
- `domains/` 每份文档必须讲清楚端到端数据流、Renderer 布局、状态机、错误态和测试策略。
- `ui/` 只记录像素级视觉、组件和页面布局规范；参考图可放在本地 `docs/设计参考/`，但不提交。
