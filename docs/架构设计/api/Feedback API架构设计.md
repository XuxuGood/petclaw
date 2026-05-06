# Feedback API 架构设计

## 1. 模块定位

Feedback API 是 `petclaw-api` 的用户反馈接收服务。它接收 PetClaw Desktop 提交的问题描述、截图和脱敏诊断包，生成反馈编号，保存附件，并通知内部处理渠道。

API 不直接依赖 `petclaw-desktop` 实现。Desktop 与 API 之间只通过 HTTP 契约通信。

## 2. 目标与非目标

目标：

- 提供稳定的 `POST /v1/feedback` 接口。
- 校验 metadata、截图、diagnostics zip 的类型和大小。
- 按 `feedbackId` 保存结构化反馈包。
- 通过可扩展 notifier 通知内部团队。
- 返回可给用户展示的反馈编号。

非目标：

- 不在第一版实现完整工单后台。
- 不在 API 日志中输出反馈正文、邮箱、截图内容或诊断包内容。
- 不解析 diagnostics zip 内部日志内容做在线搜索。
- 不在 API 侧补写或推断 Desktop 日志的人类可读 message。
- 不要求 Desktop 直接知道存储或通知实现细节。

## 3. 总体架构

```text
POST /v1/feedback
  -> request size guard
  -> multipart parser
  -> metadata validator
  -> attachment validator
  -> FeedbackIdGenerator
  -> FeedbackStorage
       -> metadata.json
       -> screenshots/*
       -> diagnostics.zip
  -> FeedbackNotifier
       -> Feishu / Email / Slack / Issue tracker
  -> response { feedbackId }
```

建议服务内部分层：

```text
routes/feedback.ts
services/feedback-service.ts
services/feedback-storage.ts
services/feedback-notifier.ts
services/notifiers/feishu-notifier.ts
services/notifiers/email-notifier.ts
```

## 4. HTTP 契约

```http
POST /v1/feedback
Content-Type: multipart/form-data
```

Parts：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `metadata` | `application/json` | 是 | 反馈元数据 |
| `screenshots[]` | `image/png` / `image/jpeg` | 否 | 用户确认的截图 |
| `diagnostics` | `application/zip` | 否 | Desktop 生成的脱敏诊断包 |

`metadata`：

```json
{
  "description": "string",
  "contactEmail": "string | null",
  "appVersion": "0.1.0",
  "platform": "darwin",
  "arch": "arm64",
  "locale": "zh",
  "includeDiagnostics": true,
  "createdAt": "2026-05-06T10:00:00.000Z"
}
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
    "code": "invalid_metadata",
    "message": "Feedback metadata is invalid"
  }
}
```

错误响应不包含内部路径、bucket 名称、webhook URL 或 stack。

## 5. 校验规则

Metadata：

- `description` 必填，trim 后 10 到 5000 字符。
- `contactEmail` 可空；非空时必须符合邮箱格式，最多 254 字符。
- `appVersion`、`platform`、`arch`、`locale` 必填并限制长度。
- `createdAt` 必须是 ISO timestamp。
- `includeDiagnostics` 必须是 boolean。

附件：

- 截图最多 5 张。
- 单张截图最多 5 MB。
- diagnostics 最多 50 MB。
- 请求总大小最多 75 MB。
- 只接受 `image/png`、`image/jpeg` 和 `application/zip`。
- 服务端不能只信任 MIME header；必须检查文件头。

速率限制：

- 按 IP、安装 ID 或客户端匿名 ID 限速。
- 同一来源短时间内多次失败要返回 `rate_limited`。
- rate limit 结果不泄漏策略细节。

## 6. 存储设计

存储抽象：

```text
FeedbackStorage.save(feedbackPackage)
```

第一版推荐使用 S3-compatible 对象存储，例如 Cloudflare R2、AWS S3 或 MinIO。

对象路径：

```text
feedback/
  2026/05/06/
    PC-20260506-000123/
      metadata.json
      screenshots/
        screenshot-1.png
      diagnostics/
        petclaw-diagnostics.zip
```

`metadata.json` 保存：

- 用户提交的 metadata。
- 服务端生成的 `feedbackId`。
- 附件文件名、大小、content type、hash。
- 接收时间、客户端 IP hash、user agent 摘要。
- notifier 结果摘要。

不得保存：

- webhook secret。
- 对象存储密钥。
- 服务端内部错误 stack。

## 7. 通知设计

通知通过 `FeedbackNotifier` 扩展：

```text
FeedbackNotifier.notify(feedbackSummary)
```

第一版可启用飞书 webhook。后续可扩展：

- `EmailNotifier`
- `SlackNotifier`
- `GitHubIssueNotifier`
- `TicketSystemNotifier`
- `CompositeNotifier`

通知内容只包含摘要：

```text
New PetClaw feedback
ID: PC-20260506-000123
Platform: darwin-arm64
Version: 0.1.0
Locale: zh
Screenshots: 2
Diagnostics: included
Contact: present
Storage: feedback/2026/05/06/PC-...
```

诊断日志的人类可读性由 Desktop Logging 负责。API 可以在通知中标记 diagnostics 是否存在、大小和日志源摘要，但不解压 diagnostics zip、不重写日志 message、不把日志原文推送到通知渠道。

通知不得直接包含：

- 完整问题描述。
- 邮箱原文，除非通知渠道是受控内部渠道并且产品明确允许。
- 截图或 diagnostics 附件正文。
- signed URL 长期链接。

如果 notifier 失败：

- 反馈仍然保存。
- API 返回成功，但 metadata 标记 `notification.status = "failed"`。
- 服务端记录脱敏错误摘要，便于后台补偿。

## 8. 安全与隐私

- API 必须启用 HTTPS。
- 请求体大小在 multipart 解析前限制。
- webhook、对象存储密钥只来自服务端环境变量。
- 不把用户反馈正文写入普通日志。
- 不把附件内容写入普通日志。
- diagnostics zip 不在线解压处理，避免 zip bomb 风险；如未来需要解压，必须增加压缩包安全扫描和展开大小限制。
- 对象存储默认私有，不公开暴露。

## 9. 错误码

| code | HTTP | 含义 |
|---|---:|---|
| `invalid_metadata` | 400 | metadata 缺失或格式非法 |
| `invalid_attachment` | 400 | 附件类型或结构非法 |
| `payload_too_large` | 413 | 请求超过大小限制 |
| `rate_limited` | 429 | 来源触发限流 |
| `storage_failed` | 500 | 存储失败 |
| `internal_error` | 500 | 未分类服务端错误 |

Notifier 失败不返回 `500`，因为用户反馈已经成功落库。

## 10. 测试策略

- metadata schema 校验。
- multipart 缺字段、错字段、超长字段。
- 文件类型伪造。
- 单文件和总请求大小限制。
- storage 成功、失败、部分失败。
- notifier 成功、失败。
- rate limit。
- 错误响应不泄漏内部信息。

## 11. 部署与配置

必要环境变量：

```text
FEEDBACK_STORAGE_ENDPOINT
FEEDBACK_STORAGE_BUCKET
FEEDBACK_STORAGE_ACCESS_KEY_ID
FEEDBACK_STORAGE_SECRET_ACCESS_KEY
FEEDBACK_NOTIFIER_KIND
FEEDBACK_FEISHU_WEBHOOK_URL
FEEDBACK_EMAIL_SMTP_URL
```

`FEEDBACK_NOTIFIER_KIND` 支持：

```text
feishu
email
slack
github-issue
composite
noop
```

生产环境不能使用 `noop`。本地开发和测试可以使用 `noop` 或 in-memory fake。
