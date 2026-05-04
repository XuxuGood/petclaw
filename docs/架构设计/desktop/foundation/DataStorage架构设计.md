# DataStorage 架构设计

## 1. 模块定位

DataStorage 管理 desktop 本地 SQLite 表结构、store 层和数据所有权。它是 main process 内部事实源，不直接暴露给 renderer。

## 2. 核心概念

- SQLite schema：定义本地持久化结构。
- Store：每个业务域的持久化访问边界。
- Migration：表结构演进必须集中在数据库初始化逻辑中。
- Ownership：每张表只能有明确业务所有者。
- DTO：返回 renderer 的稳定数据结构，不能直接等同 SQLite row。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ Renderer                                                           │
│ Pages / Zustand stores consume stable DTOs                          │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ preload API
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Main Process                                                        │
│  Domain Services                                                    │
│  ├── validate input                                                 │
│  ├── coordinate transactions                                        │
│  ├── call ConfigSync/Gateway if needed                              │
│  └── return stable DTO                                              │
│                                                                    │
│  Domain Stores                                                      │
│  └── table ownership + SQL                                          │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ SQLite                                                             │
│ db.ts schema / indexes / migrations                                 │
└────────────────────────────────────────────────────────────────────┘
```

关键文件：

| 层 | 文件 |
|---|---|
| Schema | `petclaw-desktop/src/main/data/db.ts` |
| Cowork store | `petclaw-desktop/src/main/data/cowork-store.ts` |
| Cowork config | `petclaw-desktop/src/main/data/cowork-config-store.ts` |
| Directory store | `petclaw-desktop/src/main/data/directory-store.ts` |
| IM store | `petclaw-desktop/src/main/data/im-store.ts` |
| MCP store | `petclaw-desktop/src/main/data/mcp-store.ts` |
| Scheduler meta store | `petclaw-desktop/src/main/data/scheduled-task-meta-store.ts` |

Renderer 只能通过 IPC 访问数据，不能读写数据库。

## 4. 端到端数据流

业务服务收到 IPC 或 Gateway 事件后调用对应 store；store 校验输入并执行 SQLite 读写；服务将结果转成稳定 DTO；renderer 获取 DTO 并更新页面状态。

写入标准流：

```text
renderer form submit
→ preload API
→ main IPC handler
→ domain service validate
→ domain store write transaction
→ optional ConfigSync / Gateway side effect
→ DTO response
→ renderer refresh snapshot or merge result
```

## 5. 状态机与生命周期

```text
app boot
→ open database
→ ensure schema
→ initialize stores
→ domain services ready
→ app shutdown close database
```

## 6. 数据模型

表结构事实源是 `petclaw-desktop/src/main/data/db.ts`。新增或修改表结构时必须同步字段注释和针对性测试。

核心表所有权：

| 表 | 所有者 | 说明 |
|---|---|---|
| `directories` | Directory/ConfigSync | 目录驱动 agent 配置 |
| `cowork_sessions` / messages 相关表 | Cowork | 会话、消息和运行状态 |
| `app_config` / cowork config | CoworkConfig / Settings | 领域配置 |
| `mcp_servers` | MCP | MCP server 配置 |
| `im_instances` | IM | IM 实例和凭据 |
| `im_conversation_bindings` | IM | 对话级目录绑定 |
| `im_session_mappings` | IM/Cowork | IM 对话到 Cowork session 映射 |
| `scheduled_task_meta` | Cron | OpenClaw cron 的本地附加元数据 |
| model 相关表 | Models | provider 和模型配置 |

表名和字段以 `db.ts` 为最终事实源；本文只描述所有权。

## 7. IPC / Preload 契约

DataStorage 不直接定义用户 API；它通过业务模块的 IPC 契约间接暴露 DTO。禁止将 SQLite row 原样返回 renderer。

## 8. Renderer 布局、状态与交互

页面必须处理空数据、加载中、保存失败和删除失败。删除或更新当前查看对象时，UI 必须同步清理选中状态。

Renderer 不能把数据库字段名当 UI 状态名长期耦合。需要显示字段应通过 service DTO 明确命名。

## 9. Runtime / Gateway 集成

部分数据会参与 ConfigSync 或 Gateway 调用，例如目录、模型、MCP、IM、Cron、Cowork session。store 只负责数据，runtime 编排属于对应服务。

## 10. 错误态、安全和权限

敏感信息不得明文写入 runtime 配置。需要存储凭据时，业务模块必须定义加密、占位符或环境变量策略。

事务边界：

- 同一次用户保存涉及多张表时，应由 service 或 store 提供原子写入。
- 写库成功但 ConfigSync/Gateway 失败时，必须返回可恢复状态，并让 UI 能重试同步。

## 11. 与其它模块的关系

DataStorage 为 Cowork、IM、Cron、MCP、Models、Skills、ConfigSync 提供持久化底座，但不反向依赖这些模块。

## 12. 测试策略

- `db.ts` schema 测试。
- 各 store CRUD 测试。
- migration 回归测试。
- 数据所有权和删除级联风险检查。

索引事实源仍以 `db.ts` 为准，核心索引应覆盖：

```sql
CREATE INDEX idx_cowork_messages_session ON cowork_messages(session_id);
CREATE INDEX idx_cowork_sessions_directory ON cowork_sessions(directory_path);
CREATE INDEX idx_im_session_mappings_session ON im_session_mappings(session_id);
```
