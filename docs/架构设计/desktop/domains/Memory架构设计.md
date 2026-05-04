# Memory 架构设计

## 1. 模块定位

Memory 模块负责 PetClaw 与 OpenClaw runtime 的记忆文件、检索配置和记忆能力开关。

## 2. 核心概念

- memorySearch：runtime 记忆检索配置。
- memory files：runtime 或 workspace 下的记忆文件。
- grounded short-term / dream diary：OpenClaw 侧记忆能力类型。
- `agents.defaults.memorySearch`：全局默认记忆检索配置。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ Renderer                                                           │
│ Memory settings: enable, status, rebuild/reset actions              │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ memory/doctor IPC
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Main Process                                                        │
│  Memory config manager                                              │
│  └── ConfigSync agents.defaults.memorySearch                        │
│                                                                    │
│  Gateway doctor.memory.* proxy                                      │
└──────────────┬───────────────────────────────┬─────────────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────┐   ┌───────────────────────────────┐
│ openclaw.json                │   │ OpenClaw Gateway               │
│ memorySearch config          │   │ doctor.memory.* RPC            │
└──────────────┬───────────────┘   └───────────────┬───────────────┘
               │                                   │
               ▼                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│ OpenClaw Runtime                                                    │
│ memory files / index / session context injection                    │
└────────────────────────────────────────────────────────────────────┘
```

关键文件：

| 层 | 文件 |
|---|---|
| Memory manager | `petclaw-desktop/src/main/memory/memory-manager.ts` |
| Memory search config | `petclaw-desktop/src/main/memory/memory-search-config-store.ts` |
| IPC | `petclaw-desktop/src/main/ipc/memory-ipc.ts` |
| Renderer settings | `petclaw-desktop/src/renderer/src/views/settings/MemorySettings.tsx` |

## 4. 端到端数据流

用户启用或调整记忆能力；main 保存配置；ConfigSync 写入 runtime 的 memorySearch 配置；runtime 执行 Cowork 时按配置检索；诊断或重建通过 Gateway doctor.memory.* RPC 返回状态给 UI。

配置流：

```text
Settings memory UI
→ memorySearch config store
→ ConfigSync agents.defaults.memorySearch
→ openclaw.json
→ runtime session memory/search
```

诊断流：

```text
renderer
→ preload memory/doctor API
→ Gateway doctor.memory.*
→ runtime 返回状态
→ UI 展示 ready/indexing/error
```

## 5. 状态机与生命周期

```text
disabled
→ enabled
→ indexing
→ ready
→ degraded | error
```

## 6. 数据模型

Memory 使用配置、文件和 runtime 状态三类数据。配置由 PetClaw 管理；具体记忆索引和内容由 runtime 管理。

当前阶段不做目录级 memorySearch override。未来如果支持目录级记忆策略，应从 `directories` 增加 override 字段，并输出到 `agents.list[i].memorySearch`。

## 7. IPC / Preload 契约

memory API 应提供状态查询、启停、重建/重置等受控能力。危险操作必须明确提示影响范围。

可能的 Gateway RPC：

- `doctor.memory.status`
- `doctor.memory.dreamDiary`
- `doctor.memory.backfillDreamDiary`
- `doctor.memory.resetDreamDiary`
- `doctor.memory.resetGroundedShortTerm`

## 8. Renderer 布局、状态与交互

设置页展示记忆开关、索引状态、重建入口和错误详情。索引中展示 progress 或 pending，不能让用户误判为空。

页面入口与源码：

| 区域 | 源码 |
|---|---|
| Settings 容器 | `petclaw-desktop/src/renderer/src/views/settings/SettingsPage.tsx` |
| Memory 页面 | `petclaw-desktop/src/renderer/src/views/settings/MemorySettings.tsx` |
| Memory IPC | `petclaw-desktop/src/main/ipc/memory-ipc.ts` |

Memory 设置结构：

```text
┌────────────────────────────────────────────────────────────────────┐
│  记忆                                                               │
│  管理 memorySearch、索引状态和 runtime 记忆维护操作                  │
│                                                                    │
│  记忆检索                                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 启用 memorySearch                                [ 开关 ]    │  │
│  │ 允许会话从 runtime memory index 检索上下文                    │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │ 检索范围                                          [默认 ∨]    │  │
│  │ 当前版本使用 agents.defaults.memorySearch                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  索引状态                                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 状态：indexing / ready / error                               │  │
│  │ 最近索引：2026-05-04 10:24                                   │  │
│  │ 错误摘要：无                                                  │  │
│  │                                              [重建索引]       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  维护操作                                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Dream Diary                                      [重置...]    │  │
│  │ Grounded Short-term                             [重置...]    │  │
│  │ Backfill Dream Diary                            [开始]       │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

状态来源：

| 状态 | 所有者 | 说明 |
|---|---|---|
| memorySearch enabled | Memory config store | 保存后触发 ConfigSync |
| runtime memory status | Gateway doctor.memory.* | ready/indexing/error |
| maintenance pending | `MemorySettings` 本地 state | 按操作按钮分桶 |
| destructive confirm | `MemorySettings` 本地 state | reset 前必须确认 |

交互状态：

- runtime 未就绪：允许编辑开关，禁用重建/重置/backfill。
- indexing：显示进度或 pending，不展示为空态。
- reset 类操作：二次确认并说明影响范围。
- 读取失败：保留上一次 snapshot，同时显示错误和重试入口。
- 记忆正文不在普通错误提示或日志预览中展示。
```

## 9. Runtime / Gateway 集成

Memory 依赖 ConfigSync 和 Gateway doctor.memory.*。runtime 不可用时只能展示本地配置，不能执行重建。

runtime 未就绪时：

- 允许编辑本地配置。
- 禁止 reset/backfill/rebuild。
- 状态显示为 waiting runtime，而不是 error。

## 10. 错误态、安全和权限

记忆可能包含用户敏感上下文。导出、重置、删除类操作需要明确确认；日志不输出记忆正文。

用户显式要求“记住”类行为时，runtime/agent 写入记忆后再回复成功；PetClaw 不在主进程伪造记忆写入结果。

## 11. 与其它模块的关系

Cowork 消费记忆检索结果，ConfigSync 写入配置，RuntimeGateway 提供状态。

## 12. 测试策略

- memorySearch 配置输出测试。
- runtime 不可用降级测试。
- 重置确认和错误态测试。
- 日志不泄漏内容检查。
