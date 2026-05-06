# PetClaw Feedback 架构设计

## 背景

PetClaw Desktop 已有“问题反馈”入口，但没有后端反馈接收能力。只做“导出反馈包”不能形成用户反馈闭环，因为用户导出后仍不知道如何交给团队。产品需要一个真正可提交的问题反馈链路，把用户描述、截图、联系邮箱和脱敏诊断包提交到 PetClaw 后端，并返回反馈编号。

## 目标

- 用户可以从现有反馈入口打开反馈弹窗并提交问题。
- 反馈包含问题描述、可选联系邮箱、用户确认的截图和可取消的脱敏诊断信息。
- Desktop main process 负责截图捕获、diagnostics bundle 生成、payload 校验和上传。
- `petclaw-api` 接收反馈，保存附件，通知内部团队，返回 `feedbackId`。
- 通知机制可扩展，第一版可用飞书 webhook，后续支持邮箱、Slack、GitHub Issues 或工单系统。

## 非目标

- 不把“导出反馈包”作为 P0 主流程。
- 不实现公开日志查看器作为反馈前置能力。
- 不让 renderer 读取日志目录或任意本地文件。
- 不在普通日志中记录用户反馈正文、截图内容、邮箱原文或诊断包内容。

## 推荐方案

采用 Desktop + API 闭环提交架构：

```text
Renderer FeedbackDialog
  -> preload feedback API
  -> main FeedbackService
  -> diagnostics bundle / screenshot capture
  -> POST /v1/feedback
  -> petclaw-api storage + notifier
  -> feedbackId
```

选择理由：

- 用户体验完整，提交后能拿到反馈编号。
- 日志和截图都通过 main 受控能力处理，符合 Electron 安全边界。
- API 和 Desktop 通过 HTTP 契约解耦。
- 通知渠道在 API 侧扩展，不影响 Desktop 发布节奏。

## Desktop 设计

Renderer 新增 `FeedbackDialog`，由已有“问题反馈”按钮打开。弹窗包含：

- 问题描述，必填。
- 截图区，支持捕获当前窗口、添加图片、预览和删除。
- 诊断信息勾选，默认包含最近 24 小时脱敏诊断信息。
- 联系邮箱，可选。
- 提交中、成功、失败和重试状态。

Preload 暴露：

```typescript
window.api.feedback.captureWindow()
window.api.feedback.getDiagnosticsSummary()
window.api.feedback.submit(payload)
```

Main 新增 `FeedbackService`：

- 校验 renderer payload。
- 捕获当前窗口截图。
- 调用 diagnostics bundle 生成最近 24 小时诊断包。
- 限制图片数量、类型和大小。
- 组装 multipart 请求并调用 API。
- 记录结构化摘要日志，避免泄漏正文和附件内容。

## API 设计

`petclaw-api` 新增：

```http
POST /v1/feedback
Content-Type: multipart/form-data
```

请求 parts：

- `metadata`: JSON。
- `screenshots[]`: PNG/JPEG。
- `diagnostics`: ZIP，可选。

成功响应：

```json
{
  "feedbackId": "PC-20260506-000123"
}
```

API 内部包含：

- `FeedbackStorage`：保存 metadata、截图和 diagnostics zip。
- `FeedbackNotifier`：通知内部团队。
- `FeedbackIdGenerator`：生成稳定反馈编号。

通知扩展：

- `FeishuNotifier`
- `EmailNotifier`
- `SlackNotifier`
- `GitHubIssueNotifier`
- `CompositeNotifier`
- `NoopNotifier`，仅测试和本地使用。

## 安全边界

- Renderer 不读日志、不传本地路径。
- Main 不信任 renderer payload。
- API 不信任 Desktop payload，必须校验 metadata、MIME、文件头、大小和速率。
- diagnostics bundle 继续由 Desktop logging 模块二次脱敏。
- API 日志不输出正文、邮箱、截图内容、附件内容或存储密钥。
- 对象存储默认私有。
- 通知只发送摘要和存储位置，不直接推送完整附件内容。

## 错误处理

Desktop：

- 描述为空时禁用提交。
- 截图失败允许继续无截图提交。
- diagnostics 生成失败允许用户取消诊断后提交。
- 网络/API 失败展示本地化错误并允许重试。
- 成功显示反馈编号。

API：

- metadata 非法返回 `invalid_metadata`。
- 附件非法返回 `invalid_attachment`。
- 请求过大返回 `payload_too_large`。
- 限流返回 `rate_limited`。
- 存储失败返回 `storage_failed`。
- notifier 失败不使请求失败，反馈保存后仍返回成功，并记录通知失败摘要。

## 测试

Desktop：

- FeedbackDialog 表单校验、截图预览删除、提交状态。
- preload/IPC 契约。
- FeedbackService payload 校验、diagnostics 调用、上传失败处理。
- 日志不泄漏反馈正文和附件内容。

API：

- multipart schema 校验。
- 文件类型和大小限制。
- storage 写入。
- notifier 成功和失败。
- rate limit。
- 错误响应不泄漏内部路径和 secret。

## 文档落点

本设计同步到长期架构事实源：

- `docs/架构设计/desktop/foundation/Feedback架构设计.md`
- `docs/架构设计/api/Feedback API架构设计.md`
- `docs/架构设计/desktop/foundation/IPCChannel契约.md`
- `docs/架构设计/desktop/foundation/IPCPreload架构设计.md`
- `docs/架构设计/desktop/foundation/Logging架构设计.md`
