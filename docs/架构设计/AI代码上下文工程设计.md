# PetClaw AI 代码上下文工程设计

## 1. 背景

PetClaw 的开发协作中，AI 经常需要先理解代码上下游关系，再决定应该读哪些文件、修改哪些位置、运行哪些验证。最初的问题是：每次改代码时，AI 都要重新用全文搜索分析调用关系，token 成本高，也容易遗漏关键链路。

AI 代码上下文工程解决的是这个开发基础设施问题：

- 让代码图谱和符号上下文成为仓库内置能力。
- 让开发者只在首次接入时初始化一次工具链。
- 让 Git hook 自动维护索引和提交前影响分析。
- 让 AI 在写文件前自动准备上下文，不把命令负担转给用户。
- 让不同 AI 客户端优先共享项目级 `.mcp.json`，并在不支持项目级配置时使用模板 fallback。

本文只描述 AI 自动化上下文系统本身，不复写 PetClaw 的业务开发规则。IPC、ConfigSync、SQLite、i18n、Openclaw Runtime 等业务链路规则仍以 `AGENTS.md`、`CLAUDE.md` 和 `docs/架构设计/PetClaw总体架构设计.md` 为准。

## 2. 设计目标

### 2.1 人工介入最小化

正常开发者只需要在首次拉取项目或新机器接入时运行一次：

```bash
pnpm ai:setup -- --client codex
```

`ai:setup` 会组合工具安装、项目级 MCP 配置生成、客户端接入和状态检查。之后日常切分支、merge、rebase、提交、AI 改代码前上下文准备，都由 Husky 或 AI 自动触发。

### 2.2 AI 自动准备上下文

AI 接到代码改动任务后，应自动从任务描述、文件路径、symbol、模块名、错误信息中推断 `target`，并在写文件前运行：

```bash
pnpm ai:prepare-change -- --target <target>
```

AI 不应要求用户手动运行该命令。只有无法可靠推断 target，或工具链无法降级时，才向用户提一个明确问题。

### 2.3 统一多客户端接入

Codex、Claude Code、Qoder、Cursor、Windsurf、Cline、Roo、Continue、Zed 等 AI 客户端优先使用仓库根目录 `.mcp.json` 接入同一套 GitNexus / Serena 工具链；客户端不支持项目级配置时，再使用 `.petclaw/ai-tools/` 下的模板导入。

### 2.4 可降级、不阻塞

GitNexus 或 Serena 缺失时，自动化脚本默认提示并跳过，不阻断日常开发。严格阻断只通过显式环境变量开启。

## 3. 总体架构

```text
开发者首次初始化
  ↓
pnpm ai:setup -- --client <client>
  ↓
GitNexus / Serena / .mcp.json / MCP 模板可用
  ↓
AI 客户端接入 MCP（可自动安装则安装，不可安全安装则降级 guide）
  ↓
AI 改代码前自动运行 prepare-change
  ↓
Husky 在 Git 操作中自动维护索引和影响分析
```

核心组件：

| 组件 | 作用 |
|---|---|
| GitNexus | 代码图谱、上下文查询、影响分析 |
| Serena | 符号级导航和精确定位 |
| `scripts/ai` | 项目级命令封装 |
| Husky hooks | 自动刷新索引和提交前分析 |
| `.mcp.json` | 项目级 MCP 配置，供支持项目级配置的客户端直接使用 |
| `.petclaw/ai-tools` | 多客户端 MCP 配置模板，作为 fallback 和导入示例 |
| `AGENTS.md` / `CLAUDE.md` | AI 执行规则入口 |

## 4. 开发者体验

### 4.1 首次接入

开发者完成依赖安装后运行：

```bash
pnpm ai:setup -- --client codex
```

该命令负责：

- 安装或复用 GitNexus。
- 安装或复用 Serena。
- 初始化 Serena 项目配置。
- 初始化或刷新 GitNexus 索引。
- 写入项目级 `.mcp.json`。
- 生成所有 MCP 客户端模板。
- 尝试自动接入指定 AI 客户端。
- 无法安全自动写入客户端配置时，降级输出最短接入说明。

底层初始化命令仍可单独使用：

```bash
pnpm ai:bootstrap -- --install --write-mcp
```

`ai:bootstrap` 只负责工具链和仓库内 MCP 配置，不写用户全局客户端配置。

### 4.2 日常开发

开发者日常不需要手动运行：

```bash
pnpm ai:index
pnpm ai:impact
pnpm ai:prepare-change -- --target <target>
```

这些命令分别由 Husky 或 AI 自动调用：

| 命令 | 自动触发方 |
|---|---|
| `pnpm ai:index` | Husky post hooks 间接触发 |
| `pnpm ai:impact` | Husky pre-commit 间接触发 |
| `pnpm ai:prepare-change -- --target <target>` | AI 在写文件前自动触发 |

### 4.3 故障排查

工具链异常时运行：

```bash
pnpm ai:tools:check
```

该命令只读，不安装、不写文件，用于检查 Node.js、Git、pnpm、uv、GitNexus、Serena、项目级 `.mcp.json` 和 MCP 模板目录状态。

## 5. AI 执行模型

AI 在代码改动任务中的自动化流程：

```text
收到用户任务
  ↓
从任务、文件、symbol、模块名、错误信息中推断 target
  ↓
运行 pnpm ai:prepare-change -- --target <target>
  ↓
读取代码图谱、影响面、符号上下文和核对清单
  ↓
决定还需要读取哪些文件
  ↓
列出拟修改文件、修改原因和预期影响
  ↓
按用户授权边界写文件
  ↓
运行针对性验证
```

AI 执行规则：

- 能推断 target 时，不询问用户。
- 写文件前必须运行 `prepare-change`。
- `prepare-change` 降级时，仍需用输出的核对清单完成上下文理解。
- 不把 `npx gitnexus analyze` 当作默认入口。
- 不把工具链操作转嫁给用户。
- 无法运行验证时，必须说明环境原因。

## 6. 命令设计

### 6.1 `pnpm ai:setup`

入口：

```bash
pnpm ai:setup -- --client codex
pnpm ai:setup -- --client codex --dry-run
pnpm ai:setup -- --client claude-code
```

职责：

- 调用 bootstrap 安装或复用 GitNexus / Serena。
- 写入项目级 `.mcp.json`。
- 生成所有 MCP 客户端模板。
- 调用 `ai:mcp:install` 尝试自动接入指定客户端。
- 调用 `ai:tools:check` 输出最终状态。
- 对无法安全自动写入的客户端，自动降级到 `ai:mcp:guide`。

这是开发者首次接入时的推荐入口。正常日常开发不需要重复执行。

### 6.2 `pnpm ai:bootstrap`

入口：

```bash
pnpm ai:bootstrap -- --install --write-mcp
```

职责：

- 检查 GitNexus 是否可用。
- 检查 Serena 是否可用。
- 在 `--install` 模式下安装缺失工具。
- 初始化 Serena 项目配置。
- 初始化或刷新 GitNexus 索引。
- 在 `--write-mcp` 模式下生成 MCP 模板。

安全策略：

- 没有 `--install` 时不安装外部工具。
- GitNexus 通过 `npm install --global gitnexus` 安装。
- Serena 通过 `uv tool install -p 3.13 serena-agent@latest --prerelease=allow` 安装。
- 缺少 `uv` 时只提示，不自动执行远程安装脚本。
- 可以通过 `--skip-index` 跳过初始索引。
- 可以通过 `--skip-serena-init` 跳过 Serena 项目初始化。

### 6.3 `pnpm ai:tools:check`

入口：

```bash
pnpm ai:tools:check
```

职责：

- 检查 Node.js。
- 检查 Git。
- 检查 pnpm。
- 检查 uv。
- 检查 GitNexus。
- 检查 Serena。
- 显示已监听的 Serena Dashboard 地址；未监听时提示默认地址。
- 检查项目级 `.mcp.json`。
- 检查 MCP 模板目录。

该命令用于排障，不是日常开发前置步骤。

### 6.4 `pnpm ai:index`

入口：

```bash
pnpm ai:index
```

职责：

- 检查 GitNexus 索引状态。
- 索引 stale 时运行 analyze。
- 支持 `--force` 强制重建。
- 支持 `--embeddings` 或 `PETCLAW_GITNEXUS_EMBEDDINGS=1`。

该命令主要由 Husky post hooks 间接触发。

### 6.5 `pnpm ai:impact`

入口：

```bash
pnpm ai:impact
```

职责：

- 检查暂存区是否有变更。
- 有变更时运行 GitNexus `detect_changes --scope staged`。
- 输出提交前影响分析。

该命令只分析暂存区，不分析未暂存草稿。它主要由 `.husky/pre-commit` 触发。

AI 使用 GitNexus MCP 时也必须遵守同一边界：脏工作区内不要默认调用 `detect_changes({ scope: "all" })`。`scope: "all"` 会把用户未暂存草稿、未跟踪文件和其它任务改动全部纳入分析，容易产生超大输出、`critical` 风险和 hook 输出管道失败。

如果 `detect_changes` 遇到 `.gitnexus/lbug` 锁、`~/.gitnexus/registry.json` 权限、沙箱 `EPERM/EACCES` 或数据库 busy/locked，脚本必须明确提示这是工具链环境异常。默认宽松模式下不阻断提交；`PETCLAW_AI_IMPACT_STRICT=1` 严格模式下才阻断。

### 6.6 `pnpm ai:prepare-change`

入口：

```bash
pnpm ai:prepare-change -- --target <target>
```

职责：

- 检查 GitNexus 索引是否 stale。
- 优先复用 `gitnexus list` 中与当前仓库路径匹配的既有 alias。
- 当前路径未注册时，生成当前仓库唯一 GitNexus repo alias，避免多个同名仓库共享默认索引。
- 当前 alias 未注册时，先用 `gitnexus analyze --name <alias>` 建立本仓库索引。
- stale 时尝试刷新索引。
- 如果 `gitnexus list/status/analyze/context/impact` 遇到本地索引锁、registry 权限或沙箱权限异常，立即停止继续抢锁，明确提示工具链环境异常，并自动降级到本地使用面扫描。
- 用 `gitnexus context -r <alias>` 获取 target 的 context。
- 用 `gitnexus impact -r <alias>` 获取 target 的 impact。
- 当 target 不是代码 symbol（例如 CSS 变量、设计 token、Tailwind token、IPC channel、配置 key、i18n key、数据库字段）导致 GitNexus 返回 `UNKNOWN` / `not_found` 时，自动使用 `rg` 分组扫描全仓、前端、样式、主进程、preload、共享层、测试和文档引用面。
- 输出 PetClaw 改动前核对清单。
- 提醒工作区已有未提交变更。

`target` 可以是文件路径、symbol、模块名、错误信息中的关键对象、IPC channel、配置 key 或其它任务目标。

该命令主要由 AI 自动调用。人工只在排障或复现 AI 上下文准备过程时手动运行。

### 6.7 `pnpm ai:mcp:write`

入口：

```bash
pnpm ai:mcp:write -- --client codex
pnpm ai:mcp:write -- --client all
```

职责：

- 写入项目级 `.mcp.json`。
- 生成指定客户端 MCP 模板。
- 重新生成全部 MCP 模板。
- 让多客户端配置与仓库脚本保持一致。

支持客户端：

```text
all
codex
claude-code
claude-desktop
qoder
cursor
windsurf
continue
cline
roo
zed
```

### 6.8 `pnpm ai:mcp:install`

入口：

```bash
pnpm ai:mcp:install -- --client codex
pnpm ai:mcp:install -- --client cursor --dry-run
pnpm ai:mcp:install -- --client claude-desktop
```

职责：

- 确保项目级 `.mcp.json` 存在。
- 确保指定客户端模板存在。
- 自动备份客户端已有 MCP 配置。
- 只合并 PetClaw 管理的 `gitnexus` / `serena` 两个 server。
- 不删除、不覆盖用户已有其他 MCP server。
- 支持 `--dry-run` 预览写入内容。
- 支持 `--config <path>` 为 Qoder 等路径不稳定客户端显式指定配置文件。
- 客户端无法安全自动写入时，自动降级到 `ai:mcp:guide`。

### 6.9 `pnpm ai:mcp:guide`

入口：

```bash
pnpm ai:mcp:guide -- --client claude-code
```

职责：

- 确保项目级 `.mcp.json` 存在。
- 确保指定客户端模板存在。
- 输出该客户端的接入说明。
- 不写用户全局 IDE / Agent 配置。

## 7. Husky 自动化

PetClaw 复用现有 Husky，不引入 lefthook。

| Hook | 命令 | 目的 |
|---|---|---|
| `.husky/post-checkout` | `node scripts/ai/gitnexus-refresh.cjs --reason post-checkout` | 切分支后检查索引 |
| `.husky/post-merge` | `node scripts/ai/gitnexus-refresh.cjs --reason post-merge` | merge / pull 后检查索引 |
| `.husky/post-rewrite` | `node scripts/ai/gitnexus-refresh.cjs --reason post-rewrite` | rebase / amend 后检查索引 |
| `.husky/pre-commit` | `pnpm exec lint-staged` + `node scripts/ai/gitnexus-impact.cjs` | 提交前格式修复和影响分析 |
| `.husky/commit-msg` | `pnpm exec commitlint --edit "$1"` | 校验提交信息 |

Hook 约束：

- 不安装外部工具。
- 不修改未暂存草稿。
- 默认宽松降级。
- 严格模式只由 `PETCLAW_AI_IMPACT_STRICT=1` 开启。

## 8. 脚本结构

| 文件 | 作用 |
|---|---|
| `scripts/ai/gitnexus-utils.cjs` | 共享路径、日志、命令探测、GitNexus 命令解析和 Git 状态检查 |
| `scripts/ai/gitnexus-refresh.cjs` | 检查并按需刷新 GitNexus 索引 |
| `scripts/ai/gitnexus-impact.cjs` | 分析暂存区变更影响 |
| `scripts/ai/prepare-change.cjs` | AI 改动前上下文准备 |
| `scripts/ai/serena-dashboard.cjs` | 查询当前可访问的 Serena Dashboard 地址 |
| `scripts/ai/check-ai-tools.cjs` | 工具链只读检查 |
| `scripts/ai/bootstrap-tools.cjs` | 工具链初始化 |
| `scripts/ai/write-mcp-config.cjs` | MCP 模板生成 |
| `scripts/ai/mcp-client-registry.cjs` | MCP 客户端能力、路径和模板注册表 |
| `scripts/ai/install-mcp-config.cjs` | 自动备份并合并客户端 MCP 配置 |
| `scripts/ai/guide-mcp-config.cjs` | 准备项目级 MCP 配置并输出客户端接入说明 |
| `scripts/ai/setup-ai-context.cjs` | 首次接入的一键初始化入口 |

脚本约束：

- 所有安装行为必须显式传入 `--install`。
- 所有 GitNexus 调用必须支持缺失降级。
- 所有 GitNexus 调用必须识别索引锁、registry 权限、沙箱 `EPERM/EACCES` 和数据库 busy/locked；这些情况属于工具链环境异常，不得误判为业务代码风险。
- GitNexus 调用必须先按当前仓库路径复用既有 alias；新仓库才生成唯一 alias。
- GitNexus `analyze` 使用 `--name`，查询/影响分析使用 `-r`。
- 项目级 MCP 配置只写入仓库根目录 `.mcp.json`。
- 客户端模板只写入仓库内 `.petclaw/ai-tools/`。
- 只有 `ai:mcp:install` 会尝试写用户全局 IDE / Agent 配置。
- `ai:mcp:install` 写入前必须备份，并且只管理 PetClaw 的 `gitnexus` / `serena` server。
- 未知或不稳定客户端路径必须降级到 `ai:mcp:guide`，不得猜路径硬写。
- 脚本注释必须说明目的和原因。

## 9. MCP 配置

项目级配置：

```text
.mcp.json
```

`.mcp.json` 是默认自动化入口。支持项目级 MCP 配置的客户端应优先读取它，避免开发者复制模板。

模板目录：

```text
.petclaw/ai-tools/
```

模板列表：

| 客户端 | 文件 |
|---|---|
| Codex | `mcp.codex.example.toml` |
| Claude Code | `mcp.claude-code.example.json` |
| Claude Desktop | `mcp.claude-desktop.example.json` |
| Qoder | `mcp.qoder.example.json` |
| Cursor | `mcp.cursor.example.json` |
| Windsurf | `mcp.windsurf.example.json` |
| Continue | `mcp.continue.example.yaml` |
| Cline | `mcp.cline.example.json` |
| Roo Code | `mcp.roo.example.json` |
| Zed | `mcp.zed.example.json` |

项目级配置和模板默认接入：

- GitNexus MCP server。
- Serena MCP server。

通用 JSON 模板：

```json
{
  "mcpServers": {
    "gitnexus": {
      "command": "gitnexus",
      "args": ["mcp"]
    },
    "serena": {
      "command": "serena",
      "args": ["start-mcp-server", "--project-from-cwd", "--open-web-dashboard=false"]
    }
  }
}
```

Codex 的 TOML 模板在 Serena 上额外加入：

- `startup_timeout_sec = 15`，避免首次启动 Serena 慢时被 Codex 过早判定失败。
- `--open-web-dashboard=false`，避免 MCP server 启动时自动弹出 `127.0.0.1:<port>/dashboard/index.html`。
- `--context=codex`，让 Serena 使用 Codex 适配上下文。

`.petclaw/ai-tools/` 下的模板只作为 fallback 和示例写入仓库。真正写用户客户端配置只由 `pnpm ai:mcp:install` 执行，并且必须先备份、再安全合并。

## 10. 客户端接入

### 10.1 Codex

```bash
pnpm ai:mcp:install -- --client codex
```

脚本会备份并更新 `~/.codex/config.toml` 中的 PetClaw MCP 托管区块。需要预览时使用：

```bash
pnpm ai:mcp:install -- --client codex --dry-run
```

### 10.2 Claude Code

```bash
pnpm ai:mcp:install -- --client claude-code
```

Claude Code 优先使用仓库根目录 `.mcp.json`，通常不需要写全局配置。`install` 会确认项目级配置已生成；如果当前版本需要手动导入，再运行：

```bash
pnpm ai:mcp:guide -- --client claude-code
```

### 10.3 Qoder

```bash
pnpm ai:setup -- --client qoder
```

接入流程：

1. 如果 Qoder 支持项目级 `.mcp.json`，直接使用仓库根目录配置。
2. 如果 Qoder 只能通过 UI 导入 MCP JSON，运行 `pnpm ai:mcp:guide -- --client qoder`，粘贴 `.petclaw/ai-tools/mcp.qoder.example.json`。
3. 如果能确认 Qoder 本机 MCP 配置路径，运行 `pnpm ai:mcp:install -- --client qoder --config <path>` 自动备份并合并配置。
4. 确认 Qoder 使用 Agent mode。
5. 要求 Qoder 遵守 `AGENTS.md` 中的 AI 代码上下文执行规则。

### 10.4 其它客户端

Cursor、Claude Desktop、Zed 等已知配置路径的客户端可以使用：

```bash
pnpm ai:mcp:install -- --client cursor
pnpm ai:mcp:install -- --client claude-desktop
pnpm ai:mcp:install -- --client zed
```

Windsurf、Cline、Roo、Continue 等路径不稳定或版本差异较大的客户端，优先使用项目级 `.mcp.json`；不支持项目级配置时，运行 `pnpm ai:mcp:guide -- --client <client>` 使用对应模板。

如果客户端无法直接接入 MCP，仍可通过 CLI fallback：

```bash
pnpm ai:prepare-change -- --target <target>
pnpm ai:index
pnpm ai:impact
```

这些命令主要给 AI 和脚本调用，人工只在排障时使用。

## 11. 环境变量

| 变量 | 作用 |
|---|---|
| `PETCLAW_AI_IMPACT_STRICT=1` | GitNexus 影响分析失败时阻断提交 |
| `PETCLAW_SKIP_GITNEXUS=1` | 跳过所有 GitNexus 调用 |
| `PETCLAW_GITNEXUS_CMD=/path/to/gitnexus` | 指定 GitNexus 命令路径 |
| `PETCLAW_GITNEXUS_REPO_NAME=petclaw-local` | 覆盖当前仓库 GitNexus repo alias |
| `PETCLAW_GITNEXUS_USE_NPX=1` | 允许通过 `npx --yes gitnexus` 临时运行 |
| `PETCLAW_GITNEXUS_EMBEDDINGS=1` | 索引刷新时附带 embeddings |
| `PETCLAW_QODER_MCP_CONFIG=/path/to/config.json` | 指定 Qoder MCP 配置路径，供 `ai:mcp:install -- --client qoder` 使用 |

默认策略：

- 本地不默认开启严格模式。
- CI 或发布前检查可以启用 `PETCLAW_AI_IMPACT_STRICT=1`。
- 只在临时排障时使用 `PETCLAW_SKIP_GITNEXUS=1`。
- 只有确认网络和 npx 可用时才使用 `PETCLAW_GITNEXUS_USE_NPX=1`。

## 12. 故障处理

### 12.1 GitNexus 不可用

```bash
pnpm ai:tools:check
pnpm ai:bootstrap -- --install
```

临时使用 npx：

```bash
PETCLAW_GITNEXUS_USE_NPX=1 pnpm ai:index
```

### 12.2 Serena 不可用

```bash
pnpm ai:tools:check
brew install uv
pnpm ai:bootstrap -- --install
```

查看当前 Serena Dashboard 地址：

```bash
pnpm ai:serena:dashboard
```

该命令只读，不打开浏览器。Serena 默认 dashboard 为 `http://127.0.0.1:24282/dashboard/`，多个实例运行时端口可能递增为 `24283`、`24284`。

### 12.3 提交被影响分析阻断

```bash
pnpm ai:impact
pnpm ai:tools:check
```

如需临时关闭严格模式，不设置 `PETCLAW_AI_IMPACT_STRICT` 后重新提交。

### 12.4 MCP 配置需要重建

```bash
pnpm ai:mcp:write -- --client all
```

## 13. 验证

修改 AI 代码上下文工程后，至少运行：

```bash
node --check scripts/ai/gitnexus-utils.cjs
node --check scripts/ai/gitnexus-refresh.cjs
node --check scripts/ai/gitnexus-impact.cjs
node --check scripts/ai/prepare-change.cjs
node --check scripts/ai/check-ai-tools.cjs
node --check scripts/ai/bootstrap-tools.cjs
node --check scripts/ai/write-mcp-config.cjs
node --check scripts/ai/mcp-client-registry.cjs
node --check scripts/ai/install-mcp-config.cjs
node --check scripts/ai/guide-mcp-config.cjs
node --check scripts/ai/setup-ai-context.cjs
node scripts/ai/check-ai-tools.cjs
node scripts/ai/bootstrap-tools.cjs --skip-index
node scripts/ai/write-mcp-config.cjs --client all
node scripts/ai/guide-mcp-config.cjs --client claude-code
node scripts/ai/install-mcp-config.cjs --client codex --dry-run
node scripts/ai/setup-ai-context.cjs --client codex --dry-run
git diff --check -- scripts/ai .husky .mcp.json .petclaw/ai-tools docs/架构设计/AI代码上下文工程设计.md
```

如果本地没有 pnpm、GitNexus、Serena 或 uv，验证输出允许显示缺失提示，但脚本必须正常退出。缺失提示是宽松降级的一部分，不视为业务失败。
