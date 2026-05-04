# PetClaw 架构设计文档

本目录是 PetClaw 当前架构事实源入口。代码仍是最终事实源；文档用于解释模块原理、边界、端到端数据流和修改时需要遵守的约束。

## 阅读路径

| 场景 | 阅读入口 |
|---|---|
| 了解整体系统 | `PetClaw架构总览.md` |
| 修改 desktop 功能 | `desktop/README.md`，再读对应分层和模块文档 |
| 修改 renderer/UI 状态 | `desktop/foundation/Renderer架构设计.md` 和对应功能模块文档 |
| 修改目录驱动 Agent | `desktop/domains/Directory架构设计.md` |
| 修改 IPC 或 preload | `desktop/foundation/IPCPreload架构设计.md` 和 `desktop/foundation/IPCChannel契约.md` |
| 修改 SQLite/store | `desktop/foundation/DataStorage架构设计.md` |
| 修改 i18n | `desktop/foundation/I18n架构设计.md` 和 `shared/README.md` |
| 修改 OpenClaw runtime 构建 | `engineering/OpenClawRuntime工程设计.md` |
| 修改 AI 开发工具链 | `engineering/AI代码上下文工程设计.md` |
| 修改 GitHub Actions | `engineering/CI-CD架构设计.md` |
| 查历史大文档 | `legacy/` |

## 目录职责

```text
docs/架构设计/
  PetClaw架构总览.md      系统地图，只讲包关系、模块关系和关键数据流摘要
  shared/                petclaw-shared 公共底座
  desktop/               petclaw-desktop 分层架构和功能模块设计
  web/                   petclaw-web 预留边界
  api/                   petclaw-api 预留边界
  engineering/           仓库级工程能力
  decisions/             架构决策记录
  legacy/                历史方案、旧大文档、问题清单
```

## 写作规则

- 总览文档只做地图，不承载模块详细设计。
- 功能模块文档必须讲清楚模块定位、核心概念、总体架构、端到端数据流、状态机、数据模型、IPC/Preload、Renderer 布局、Runtime/Gateway、错误态、安全边界和测试策略。
- `petclaw-shared` 是唯一公共底座；其它包之间默认不直接 import 彼此实现。
- Desktop 像素级视觉、组件和页面布局规范放在 `desktop/ui/Desktop视觉规范.md`、`desktop/ui/Desktop组件规范.md` 和 `desktop/ui/Desktop页面布局规范.md`。
- 外部产品截图和当前实现截图可放在本地 `docs/设计参考/`，该目录不提交，不能作为架构事实源。
