# PetClaw 日志系统设计

> 日期: 2026-04-26
> 状态: 待实现
> 参考: LobsterAI `src/main/logger.ts`

## 1. 目标

为 PetClaw 主进程建立统一的日志系统，实现：

- 拦截所有 `console.*` 调用，自动写入日志文件
- 每日轮转，按日期命名
- 自动清理过期日志
- 提供日志文件路径查询 API，供将来日志导出使用

## 2. 方案

**直接移植 LobsterAI 模式**：创建 `src/main/logger.ts`，基于 `electron-log`（已在 `package.json` 中），拦截 `console.*` 写入文件。现有代码零改动。

## 3. 模块设计

### 3.1 文件位置

`petclaw-desktop/src/main/logger.ts`

### 3.2 公开 API

```typescript
/** 初始化日志系统，拦截 console.*，必须在主进程最早调用 */
export function initLogger(): void

/** 返回当天日志文件路径 */
export function getLogFilePath(): string

/** 返回 7 天内所有日志文件条目（archiveName + filePath），按文件名排序 */
export function getRecentMainLogEntries(): Array<{ archiveName: string; filePath: string }>

/** electron-log 实例，直接使用场景极少 */
export { log }
```

### 3.3 配置常量

| 参数 | 值 | 说明 |
|------|-----|------|
| `LOG_RETENTION_DAYS` | 7 | 日志保留天数 |
| `LOG_MAX_SIZE` | 80 MB | 单文件上限，超过后 electron-log 自动轮转为 `.old.log` |
| 文件级别 | `debug` | 全量记录到文件 |
| 文件格式 | `[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}` | 带毫秒时间戳 |

### 3.4 日志文件位置

使用 electron-log 的平台默认路径（`vars.libraryDefaultDir`），只覆盖文件名格式：

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Logs/PetClaw/main-YYYY-MM-DD.log` |
| Windows | `%USERPROFILE%\AppData\Roaming\PetClaw\logs\main-YYYY-MM-DD.log` |
| Linux | `~/.config/PetClaw/logs/main-YYYY-MM-DD.log` |

macOS 使用系统标准日志目录 `~/Library/Logs/`（Console.app 可索引），Windows/Linux 使用应用数据子目录。

与运行时数据目录（`{userData}`）分离：日志是诊断产物，运行时数据（DB、引擎状态、配置）在 `app.getPath('userData')`。

## 4. 实现细节

### 4.1 console 拦截机制

```
initLogger() 执行流程：
1. 配置 electron-log file transport（resolvePathFn、level、maxSize、format）
2. 保存原始 console.log/error/warn/info/debug 引用
3. 替换 console.* 方法：先调原始方法（控制台输出），再调 electron-log 对应方法（文件写入）
4. 禁用 electron-log console transport（避免重复输出）
5. 调用 pruneOldLogs() 清理过期日志
6. 写入启动标记
```

### 4.2 日志清理（pruneOldLogs）

启动时扫描日志目录，删除满足以下条件的文件：
- 文件名匹配 `main-YYYY-MM-DD(.old)?.log`
- 文件 mtime 超过 7 天（`LOG_RETENTION_DAYS`）

非匹配文件（如 `startup-diagnostics.log`、其他引擎日志）不受影响。

### 4.3 调用时机

在 `src/main/index.ts` 中，`app.whenReady()` 之前最早调用 `initLogger()`，确保所有后续 `console.*` 输出都被捕获。

## 5. 日志规范

遵循 `CLAUDE.md` / `AGENTS.md` 和 LobsterAI CLAUDE.md 的日志规范：

### 5.1 级别语义

| 级别 | API | 使用场景 |
|------|-----|----------|
| Error | `console.error` | 不可恢复失败——捕获异常、不变式违反、数据损坏 |
| Warn | `console.warn` | 意外但可恢复——缺少可选配置、降级服务、超时 |
| Info | `console.log` | 关键生命周期事件——服务启停、连接建立/断开、会话创建/销毁、配置变更 |
| Debug | `console.debug` | 开发调试细节——中间状态、请求/响应载荷、循环迭代 |

### 5.2 消息格式

- 每条消息以 `[ModuleName]` 标签开头
- 使用自然英语描述事件，不是变量 dump
- 错误日志必须附带 error 对象
- 不在热循环/轮询回调中使用 info 级别
- 不做函数入口日志
- 所有日志消息使用英文

## 6. 现有代码影响

- **零改动**：所有现有 `console.*` 调用自动被捕获写入文件
- **中文日志改英文**：将现有 ~30 处 `console.*` 中的中文消息改为英文，遵循 §5.2 消息格式规范

## 7. 测试策略

创建 `petclaw-desktop/tests/main/logger.test.ts`，参照 LobsterAI 的 `logger.test.ts`。

由于 `electron-log` 无法在测试环境（非 Electron 主进程）加载，采用**内联镜像逻辑**测试纯函数行为：

### 7.1 测试用例

**文件名正则匹配**：
- 正常日志 `main-YYYY-MM-DD.log` ✓
- `.old` 变体 `main-YYYY-MM-DD.old.log` ✓
- 不匹配：`main.log`、`cowork.log`、`renderer.log`、部分日期 ✗

**pruneOldLogs 边界行为**：
- 恰好在 7 天边界的文件（保留）
- 超过 7 天 1ms 的文件（删除）
- 当天文件（保留）
- 6 天前的文件（保留）
- 8 天前的文件（删除）
- `.old` 变体超期（删除）
- 非匹配文件永不删除

**getRecentMainLogEntries 过滤和排序**：
- 空目录返回空数组
- 只有非匹配文件返回空数组
- 当天文件包含
- 恰好 7 天边界的文件包含
- 超过 7 天的文件排除
- 结果按文件名字母序排列

## 8. 不在范围内

- Cowork 结构化日志（`coworkLogger`）——后续单独设计
- 渲染进程日志收集——后续按需设计
- 日志导出 UI（设置页面"导出日志"按钮）——后续按需设计
- 现有中文日志消息改英文——已纳入本次范围（§6）
