# ConfigSync 功能对比：LobsterAI vs PetClaw — 未完成项

**日期**: 2026-04-28
**状态**: 对比讨论中

---

## 背景

对比 LobsterAI `openclawConfigSync.ts`（2653 行）与 PetClaw `config-sync.ts`（454 行），逐项梳理功能差异。

P1（高优先级）项已全部完成，P2 项进行中。

---

## P1 已完成项（不再跟踪）

以下项目已在 `2026-04-28-openclaw-config-sync-redesign` spec 中设计并实施完毕：

- gateway baseline（auth/tailscale/mode）
- models provider env placeholder
- agents defaults（sandbox/timeout/workspace/model）
- tools deny + web search disabled
- browser enabled
- cron config
- plugins 保留策略 + merge
- IM channels/bindings/plugins/secrets
- exec-approvals.json
- AGENTS.md managed sections
- memorySearch 全局预留
- commands ownerAllowFrom
- collectSecretEnvVars 汇总
- ConfigSyncResult needsGatewayRestart（bindings/secretEnvVars 变更检测）
- session config（dmScope/reset/maintenance）

---

## P2 未完成项

### P2-13: MCP Bridge ✏️ 设计完成，待实施

**LobsterAI**: `McpBridgeConfig` 回调注入 ConfigSync，写入 `mcp-bridge` + `ask-user-question` plugin config，含 callbackUrl/secret/tools。McpServerManager 管理 MCP SDK 连接生命周期。McpBridgeServer 提供 HTTP callback（/mcp/execute, /askuser）。

**PetClaw 现状**: `McpManager.toOpenclawConfig()` 输出旧格式（直接传 servers 连接信息给插件），无 HTTP callback server，无 MCP SDK 连接管理。

**差异**: 完整缺失。

**状态**: Spec 已写 `docs/superpowers/specs/2026-04-28-mcp-bridge-design.md`，待写 implementation plan 并实施。

---

### P2-15: DashScope URL Rewrite

**LobsterAI**: 
- `isDashScopeUrl()` 检测 DashScope URL
- DashScope Anthropic 格式自动降级为 OpenAI 格式（避免 HTTP 400）
- `rewriteDashScopeAnthropicToOpenAI()` URL 路径重写：
  - `dashscope.aliyuncs.com/apps/anthropic` → `dashscope.aliyuncs.com/compatible-mode/v1`
  - `coding.dashscope.aliyuncs.com/apps/anthropic` → `coding.dashscope.aliyuncs.com/v1`
- OpenClaw auto-inject `qwen-portal-auth` plugin 声明

**PetClaw 现状**: provider-registry 中 DashScope 默认 baseUrl 为 `https://dashscope.aliyuncs.com/compatible-mode/v1`，但无 API format 自动降级和 URL 重写逻辑。

**优先级**: 低。PetClaw 当前 DashScope provider 直接配置 OpenAI 格式 URL，用户不太可能手动配 Anthropic 格式的 DashScope URL。如果后续有用户反馈再加。

**建议**: 暂不实施。记录为已知差异。

---

### P2-16: Provider contextWindow/maxTokens 写入 OpenClaw config

**LobsterAI**: `getAllServerModelMetadata()` 将 contextWindow/maxTokens/cost 等元数据写入 `models.providers[x].models[i]`。OpenClaw runtime 据此控制 token 上限和上下文窗口。

**PetClaw 现状**: `provider-registry.ts` 有 contextWindow/maxTokens 字段定义，`ModelRegistry.toOpenclawConfig()` 输出 models 时只写 `id/name/input/reasoning`，**没有**写 contextWindow/maxTokens。

**差异**: PetClaw 的 OpenClaw runtime 不知道模型的 context 限制和 max output tokens。

**优先级**: 中。影响长对话截断和 token 用量控制。

**建议**: 在 `ModelRegistry.toOpenclawConfig()` 中将 contextWindow/maxTokens 写入 `models.providers[x].models[i]`。改动很小（几行代码），可以快速完成。

---

### P2-17: Skill Entry Overrides (MANAGED_SKILL_ENTRY_OVERRIDES)

**LobsterAI**: 
```ts
const MANAGED_SKILL_ENTRY_OVERRIDES = {
  'qqbot-cron': { enabled: false },
  'feishu-cron-reminder': { enabled: false },
  'mcporter': { enabled: false },
}
```
在 `skills.entries` 中覆盖特定 skill 的 enabled 状态，并在 AGENTS.md prompt 过滤中排除被禁用的 skill 内容。

**PetClaw 现状**: `SkillManager.toOpenclawConfig()` 输出 skills config，没有 managed skill entry overrides。

**差异**: PetClaw 没有禁用特定内置 skill 的机制。

**优先级**: 低。PetClaw 目前没有 QQ/飞书等特定平台的 cron skill，也自建了 MCP Bridge 所以不需要禁用 mcporter。只有在引入第三方 skill 生态并出现冲突时才需要。

**建议**: 暂不实施。等出现实际需要禁用的 skill 时再加。预留 `MANAGED_SKILL_ENTRY_OVERRIDES` 常量位置即可。

---

### P2-18: agentsMdWarning Graceful Degradation

**LobsterAI**: `syncAgentsMd()` 返回 `string | undefined`，写入失败时返回 warning 消息而非抛异常。`OpenClawConfigSyncResult.agentsMdWarning` 字段传递给 caller，最终在 UI 中提示用户。

**PetClaw 现状**: `syncAgentsMd()` 返回 `boolean`（是否变更）。AGENTS.md 写入失败会被外层 try-catch 兜底，整个 sync 返回 `ok: false`。

**差异**: PetClaw 把 AGENTS.md 写入失败当作整体 sync 失败，而非优雅降级（只报 warning 但其他配置仍然正常写入）。

**优先级**: 低。实际场景中 AGENTS.md 写入极少失败（目录由 PetClaw 创建和管理）。

**建议**: 暂不实施。当前 try-catch 兜底已足够。如果未来出现 workspace 目录权限问题导致频繁失败，再改为优雅降级。

---

## 汇总

| 项目 | 状态 | 优先级 | 建议 |
|------|------|--------|------|
| P2-13: MCP Bridge | ✏️ spec 完成，待实施 | 高 | 立即实施 |
| P2-15: DashScope URL Rewrite | ❌ 未开始 | 低 | 暂不实施 |
| P2-16: contextWindow/maxTokens | ❌ 未开始 | 中 | 快速完成（几行代码） |
| P2-17: Skill Entry Overrides | ❌ 未开始 | 低 | 暂不实施 |
| P2-18: agentsMdWarning | ❌ 未开始 | 低 | 暂不实施 |
