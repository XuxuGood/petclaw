# Feedback 架构设计

## 1. 模块定位

Feedback 是 Desktop 用户问题反馈链路，负责把用户描述、截图、联系邮箱和脱敏诊断信息提交到 PetClaw 后端，形成可跟进的反馈编号。

Feedback 不属于 Logging、Cowork、RuntimeGateway 或 Settings 任一业务域。它是横跨 Renderer、Preload、Main、Logging 和 `petclaw-api` 的产品闭环能力：

- Renderer 负责用户输入、截图预览、提交状态和本地化文案。
- Preload 只暴露受控 feedback API。
- Main 负责截图捕获、diagnostics bundle 生成、payload 校验和上传。
- `petclaw-api` 负责接收、存储、通知和返回反馈编号。

## 2. 目标与非目标

目标：

- 用户可以从已有“问题反馈”入口提交问题。
- 提交内容包含问题描述、可选联系邮箱、截图和可取消的脱敏诊断信息。
- 提交成功返回稳定反馈编号，方便后续沟通。
- 反馈链路失败时展示可恢复状态，允许重试。
- 所有日志、截图和诊断包上传都经过 main 受控路径。
- 随反馈提交的诊断日志必须具备人类可读 `message`，不能只有机器事件 key。

非目标：

- 不把“导出反馈包”作为主流程。
- 不提供公开日志查看器作为反馈前置步骤。
- 不让 renderer 读取日志目录或任意本地文件。
- 不在普通日志中记录用户反馈正文、截图内容或诊断包内容。

## 3. 总体架构

```text
FeedbackDialog
  -> window.api.feedback.captureWindow()
  -> window.api.feedback.getDiagnosticsSummary()
  -> window.api.feedback.submit(payload)
  -> feedback:* IPC
  -> FeedbackService
       -> BrowserWindow.capturePage()
       -> DiagnosticsBundle.export({ timeRangeHours: 24 })
       -> FeedbackClient.submit()
  -> POST /v1/feedback
  -> petclaw-api
       -> validate
       -> store metadata/screenshots/diagnostics
       -> notify team
       -> return feedbackId
```

关键边界：

- Renderer 只持有用户输入和图片预览，不持有日志文件路径。
- Main 是本地系统能力的唯一执行方。
- API 是反馈接收事实源；Desktop 不直接依赖 API 实现。
- 通知渠道通过后端 `FeedbackNotifier` 扩展，不影响 Desktop 协议。

## 4. Renderer 设计

反馈弹窗由已有“问题反馈”按钮打开。弹窗必须是可用产品界面，不做空按钮或假提交。

布局：

```text
问题反馈

[问题描述 *]
请描述遇到的问题、期望结果和实际结果。

[截图]
[捕获当前窗口] [添加图片]
截图预览列表，可删除。

[诊断信息]
[x] 包含最近 24 小时脱敏诊断信息
    包含 main / renderer / cowork / gateway / runtime 状态与日志
    不包含 API key、token、memory 正文、完整聊天内容
    [查看摘要]

[联系邮箱]
可选，用于我们跟进问题。

[取消] [提交反馈]
```

状态：

- 初始：问题描述为空，提交按钮 disabled。
- 截图中：捕获按钮 pending，输入区可继续编辑。
- 提交中：主按钮 pending，取消按钮保留但需防止重复提交。
- 成功：显示 `feedbackId` 和简短后续说明。
- 失败：显示本地化错误，提供重试；不默认导出反馈包。

交互规则：

- 截图必须显示预览，用户可以删除。
- 默认勾选诊断信息，但用户可以取消。
- 联系邮箱可选；格式非法时阻止提交。
- 所有用户可见文案、错误、aria-label、placeholder 走 i18n。

## 5. Preload 与 IPC

Preload 暴露：

```typescript
window.api.feedback.captureWindow()
window.api.feedback.getDiagnosticsSummary()
window.api.feedback.submit(payload)
```

IPC channel：

```text
feedback:capture-window
feedback:diagnostics-summary
feedback:submit
```

注册阶段：

- `feedback:capture-window` 和 `feedback:submit` 属于 Phase B。它们依赖 BrowserWindow、Logging 和网络上传能力，必须在 boot 成功后注册。
- 如果 BootCheck 失败，用户仍使用现有 logging diagnostics 入口，不通过 feedback 提交。

规则：

- IPC 必须通过 `safeHandle` 注册。
- `feedback:submit` 不接受 renderer 传入任意本地路径。
- renderer 上传的手动图片只能是受限的内存 payload，main 负责大小和 MIME 校验。
- main 返回结构化结果，不把后端原始错误透传给 UI。

## 6. Main FeedbackService

`FeedbackService` 负责把 renderer 请求转换为后端可接收的反馈 payload。

职责：

- 校验问题描述长度、邮箱格式、截图数量和总大小。
- 调用当前窗口截图能力并生成 PNG。
- 调用 diagnostics bundle 生成最近 24 小时脱敏诊断包。
- 组装 multipart 请求。
- 调用 `FeedbackClient` 上传。
- 记录结构化日志。

建议限制：

- 描述长度：10 到 5000 字符。
- 联系邮箱：最多 254 字符，可为空。
- 截图数量：最多 5 张。
- 单张图片：最多 5 MB。
- diagnostics bundle：最多 50 MB。
- 总请求：最多 75 MB。

日志规则：

- 可以记录 `feedback.submit.started`、`feedback.submit.succeeded`、`feedback.submit.failed`。
- 字段只能包含 `feedbackId`、截图数量、是否包含诊断、payload 大小、失败类型等摘要。
- 不记录反馈正文、邮箱原文、截图内容、diagnostics zip 内容。

## 7. Diagnostics 集成

Feedback 使用 Logging 模块已有 diagnostics bundle 能力，但需要支持“反馈用最近 24 小时”这一固定策略。

反馈诊断包包含：

- main、renderer、cowork、gateway、runtime、mcp 等受控日志源。
- diagnostics manifest。
- 人类可读的英文 `message`、稳定 `event` 和结构化 `fields`。
- 脱敏后的错误摘要。
- 日志缺失或读取失败的 manifest warning。

反馈诊断包不包含：

- API key、token、cookie、authorization header。
- memory 正文。
- 完整聊天正文、prompt、tool 参数原文。
- 任意未经用户选择的本地文件。

日志可读性规则：

- Feedback 不要求用户阅读日志，但提交给团队的诊断日志必须便于人工排障。
- error/warn 级日志必须包含固定英文 `message`；例如 `Failed to generate session title`。
- 变量必须留在 `fields`，例如 `sessionId`、`modelId`、`elapsedMs`，不得拼进 `message`。
- 反馈摘要 UI 可以展示 `source`、`level`、`module`、`message`、`event` 和文件大小，不展示日志原文。

## 8. API 契约

Desktop 调用 `POST /v1/feedback`。详细服务端设计见 `docs/架构设计/api/Feedback API架构设计.md`。

请求使用 `multipart/form-data`：

```text
metadata: application/json
screenshots[]: image/png | image/jpeg
diagnostics?: application/zip
```

成功响应：

```json
{
  "feedbackId": "PC-20260506-000123"
}
```

失败响应：

```json
{
  "error": {
    "code": "payload_too_large",
    "message": "Feedback package is too large"
  }
}
```

Desktop 只展示本地化摘要，不展示服务端内部错误细节。

## 9. 通知扩展

通知能力在 API 侧实现，不在 Desktop 侧实现。Desktop 只关心是否提交成功和反馈编号。

服务端定义 `FeedbackNotifier`：

```text
FeedbackNotifier.notify(feedback)
```

第一版可以接飞书 webhook；后续可扩展：

- Email notifier。
- Slack notifier。
- GitHub Issues notifier。
- 工单系统 notifier。
- 多渠道 fan-out notifier。

扩展通知渠道不得改变 Desktop IPC、preload API 或 `/v1/feedback` 请求结构。

## 10. 安全与隐私

- 用户必须能看到并删除截图。
- 默认包含诊断信息，但必须允许取消。
- 提交前说明诊断信息不包含密钥、token、memory 正文和完整聊天内容。
- Main 不信任 renderer payload。
- API 不信任 Desktop payload，只按文件类型、大小、速率和认证策略校验。
- 后端日志不记录正文、邮箱、截图内容和附件内容。
- 上传失败不影响主业务流程。

## 11. 错误态

| 场景 | UI 行为 | 日志行为 |
|---|---|---|
| 描述为空 | 提交按钮 disabled | 不记录 |
| 截图捕获失败 | 展示可重试错误，可继续无截图提交 | `feedback.screenshot.failed` |
| diagnostics 生成失败 | 展示诊断不可用，可取消诊断后提交 | `feedback.diagnostics.failed` |
| 网络失败 | 展示提交失败和重试 | `feedback.submit.failed` |
| API 返回 4xx | 展示可理解错误 | `feedback.submit.rejected` |
| API 返回 5xx | 展示稍后重试 | `feedback.submit.failed` |

## 12. 测试策略

Desktop：

- `FeedbackDialog` 表单校验、截图预览删除、诊断勾选、提交状态。
- preload API 和 IPC channel 契约。
- `FeedbackService` payload 校验、截图限制、diagnostics 失败降级、上传失败处理。
- 日志脱敏和“不记录反馈正文/附件内容”测试。

API：

- multipart metadata 校验。
- 文件类型、文件大小和总请求大小限制。
- storage 写入。
- notifier 调用和失败降级。
- rate limit。
- 错误响应不泄漏内部路径和 secret。

## 13. 文档同步

修改 Feedback 相关实现时必须同步：

- `docs/架构设计/desktop/foundation/Feedback架构设计.md`
- `docs/架构设计/api/Feedback API架构设计.md`
- `docs/架构设计/desktop/foundation/IPCChannel契约.md`
- `docs/架构设计/desktop/foundation/IPCPreload架构设计.md`
- `docs/架构设计/desktop/foundation/Logging架构设计.md`
