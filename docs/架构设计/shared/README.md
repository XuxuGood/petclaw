# Shared 架构设计

`petclaw-shared` 是 monorepo 内唯一公共底座，面向 `petclaw-desktop`、`petclaw-web` 和 `petclaw-api` 提供稳定共享契约。

## 职责

- i18n 资源、类型和 helper。
- 跨包共享的 TypeScript 类型。
- 协议类型、常量和纯函数。
- 不依赖运行时环境的轻量工具。

## 禁止边界

- 禁止依赖 `petclaw-desktop`、`petclaw-web` 或 `petclaw-api`。
- 禁止放 Electron、Node 主进程、浏览器 DOM、SQLite、Gateway client 等具体实现。
- 禁止放只服务单一业务页面的状态或 UI 逻辑。

## 依赖方向

```text
petclaw-shared
  ↑
  ├── petclaw-desktop
  ├── petclaw-web
  └── petclaw-api
```

如果某个类型只由 desktop 内部使用，应留在 `petclaw-desktop`；只有跨包复用且稳定的契约才进入 shared。

## i18n 边界

i18n 资源放在 `petclaw-shared/src/i18n/`，供 desktop、web、api 复用：

```text
petclaw-shared/src/i18n/
  types.ts
  locales/
    zh.ts
    en.ts
  index.ts
```

shared 只提供资源、Locale 类型和纯 helper。主进程 `t()`、renderer `useI18n()`、语言持久化、系统菜单刷新等运行时能力属于 `petclaw-desktop`，详见 `../desktop/foundation/I18n架构设计.md`。
