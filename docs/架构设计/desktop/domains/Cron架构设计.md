# Cron 架构设计

## 1. 模块定位

Cron 模块负责定时任务定义、元数据、运行状态、运行历史和手动触发。

## 2. 核心概念

- scheduled task：用户创建的任务定义。
- run：一次实际执行记录。
- metadata：PetClaw 对 OpenClaw cron 的本地补充信息。
- agentId：任务绑定的目录 agent，来自 directory_path 派生。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ Renderer                                                           │
│ CronPage：任务列表 / 编辑表单 / 运行历史 / 手动运行                 │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ window.api.scheduler
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Main Process                                                        │
│  SchedulerManager                                                   │
│  ├── proxy cron.* RPC                                               │
│  ├── merge scheduled_task_meta                                      │
│  └── emit task events                                               │
│                                                                    │
│  scheduled_task_meta                                                │
│  └── task_id / directory_path / agent_id / origin / binding          │
└──────────────┬───────────────────────────────┬─────────────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────┐   ┌───────────────────────────────┐
│ OpenClaw Gateway             │   │ Cowork / IM / PetEventBridge   │
│ cron.create/list/update/run  │   │ 执行任务、推送结果、宠物状态     │
└──────────────────────────────┘   └───────────────────────────────┘
```

关键文件：

| 层 | 文件 |
|---|---|
| Scheduler service | `petclaw-desktop/src/main/scheduler/cron-job-service.ts` |
| Types | `petclaw-desktop/src/main/scheduler/types.ts` |
| Meta store | `petclaw-desktop/src/main/data/scheduled-task-meta-store.ts` |
| IPC | `petclaw-desktop/src/main/ipc/scheduler-ipc.ts` |
| Renderer page | `petclaw-desktop/src/renderer/src/views/cron/CronPage.tsx` |
| Edit dialog | `petclaw-desktop/src/renderer/src/views/cron/CronEditDialog.tsx` |

任务执行时序图：

```text
OpenClaw Cron       SchedulerManager       Cowork          IM(optional)       Pet
      │                    │                 │                 │             │
      │ task fired          │                 │                 │             │
      │───────────────────▶│ 查 meta          │                 │             │
      │                    │ 建/发 session    │                 │             │
      │                    │────────────────▶│                 │             │
      │                    │                 │ running         │             │
      │                    │────────────────────────────────────────────────▶│
      │                    │                 │ result          │             │
      │                    │◀────────────────│                 │             │
      │                    │ optional push    │                 │             │
      │                    │──────────────────────────────────▶│             │
```

## 4. 端到端数据流

用户创建或编辑任务；main 持久化元数据并调用 Gateway `cron.add/update/remove/run`；runtime 触发任务后返回运行事件；main 更新运行历史和任务状态；renderer 刷新列表、详情和历史；PetEventBridge 映射任务活动。

当前 CRUD 委托给 OpenClaw `cron.*` RPC，PetClaw 保存附加元数据：

```text
CronPage create
→ preload cron API
→ SchedulerManager.create({ cron, prompt, agentId, directoryPath, origin })
→ Gateway cron.create
→ 返回 task_id
→ scheduled_task_meta 写入 directory_path / agent_id / origin / binding
→ list 合并 Gateway RPC 结果和本地 meta
```

## 5. 状态机与生命周期

```text
draft
→ saved
→ enabled
→ scheduled
→ running
→ succeeded | failed | skipped
→ disabled | removed
```

## 6. 数据模型

Cron 数据分为 runtime cron 定义和 PetClaw 本地元数据。两者必须通过稳定 task id 关联，避免只依赖显示名称。

元数据表：

```sql
CREATE TABLE IF NOT EXISTS scheduled_task_meta (
  task_id TEXT PRIMARY KEY,
  directory_path TEXT,
  agent_id TEXT,
  origin TEXT,
  binding TEXT
);
```

## 7. IPC / Preload 契约

提供 list、create、update、remove、run、runs 等能力。长任务需要返回运行 ID 或状态，renderer 不能只靠按钮状态推断成功。

Gateway RPC 对应关系：

| 操作 | RPC |
|---|---|
| 创建 | `cron.create` |
| 列表 | `cron.list` |
| 更新 | `cron.update` |
| 删除 | `cron.delete` |
| 执行历史 | `cron.history` |

## 8. Renderer 布局、状态与交互

Cron 页面包含任务列表、创建/编辑表单、详情面板和运行历史。任务 disabled 时手动运行按钮不可用；保存失败显示在表单顶部，不关闭面板。

页面入口与源码：

| 区域 | 源码 |
|---|---|
| Cron 页面 | `petclaw-desktop/src/renderer/src/views/cron/CronPage.tsx` |
| 编辑弹窗 | `petclaw-desktop/src/renderer/src/views/cron/CronEditDialog.tsx` |
| 顶栏控制 | `petclaw-desktop/src/renderer/src/App.tsx` |
| IPC channel 常量 | `petclaw-desktop/src/main/scheduler/types.ts` |

页面布局：

```text
AppShell
├── AppTopBar
│   ├── Cron search
│   ├── Refresh
│   └── Create task
└── MainPane / CronPage
    ├── SegmentedTabs
    │   ├── Tasks
    │   └── Runs
    ├── Tasks View
    │   ├── task list
    │   │   ├── name
    │   │   ├── enabled status
    │   │   ├── schedule summary
    │   │   ├── next run
    │   │   └── last result
    │   └── task actions
    │       ├── enable / disable
    │       ├── run manually
    │       ├── edit
    │       └── delete
    ├── Runs View
    │   ├── run list
    │   ├── task name
    │   ├── trigger source
    │   ├── duration
    │   ├── output summary
    │   └── error detail
    └── CronEditDialog
```

编辑弹窗布局：

```text
CronEditDialog
├── Header
│   ├── create/edit title
│   └── close
├── Form
│   ├── task name
│   ├── frequency selector
│   │   ├── preset frequencies
│   │   └── custom cron expression
│   ├── prompt / instruction
│   ├── directory selector
│   ├── model context if available
│   ├── missed job behavior
│   └── optional output/notification settings
└── Footer
    ├── cancel
    └── save
```

状态来源：

| 状态 | 所有者 | 说明 |
|---|---|---|
| Cron search | `App.tsx` | 顶栏搜索，传给 `CronPage` |
| create signal | `App.tsx` | 顶栏创建按钮触发弹窗 |
| refresh signal | `App.tsx` | 顶栏刷新触发列表 reload |
| active tab | `CronPage` 本地 state | tasks/runs |
| task list | `CronPage` 本地 state | 来自 `scheduler:list` |
| run list | `CronPage` 本地 state | 来自 `scheduler:list-*runs` |
| edit draft | `CronEditDialog` 本地 state | 保存前不写主状态 |

交互状态：

- 列表 loading：保留页面骨架，不清空已存在任务。
- 空列表：展示创建入口。
- 编辑中：表单草稿独立于已保存任务。
- 保存失败：错误显示在表单顶部，并保留用户输入。
- 手动运行：按钮进入 pending，返回 runId 或错误。
- runtime 未就绪：本地列表可读，新增、编辑、手动运行 disabled。
- 删除任务：删除前确认，删除后清理选中和刷新列表。

## 9. Runtime / Gateway 集成

Cron 依赖 Gateway `cron.*` RPC。runtime 不可用时任务列表可读本地缓存，但新增、编辑、运行必须 disabled 或提示等待 runtime。

执行模式：

| 模式 | 说明 |
|---|---|
| isolated | 新建独立会话执行 |
| main | 注入已有会话或 main agent 上下文 |

## 10. 错误态、安全和权限

任务执行可能触发 tool 权限审批，审批上下文必须带 session/task 来源。失败运行写入历史，不能只做 toast。

## 11. 与其它模块的关系

Cron 可以触发 Cowork，会向 PetEventBridge 发送任务活动。ConfigSync 可参与任务配置同步。

## 12. 测试策略

- 任务 CRUD 测试。
- 手动运行和运行历史测试。
- runtime 不可用降级测试。
- 审批来源保留测试。
