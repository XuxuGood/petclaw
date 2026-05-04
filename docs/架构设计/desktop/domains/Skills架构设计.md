# Skills 架构设计

## 1. 模块定位

Skills 模块负责 skill 的发现、安装、更新、作用域和 runtime 同步。

## 2. 核心概念

- 全局 skill：对多个 workspace 可用。
- workspace skill：某个工作区可用。
- session skill：本轮 Cowork 选择的临时能力。
- `skills.load.extraDirs`：OpenClaw runtime 扫描 PetClaw skill 目录的配置入口。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ Renderer                                                           │
│  SkillsPage: install / enable / detail / requirements               │
│  ChatInputBox: selectedSkills for current turn                      │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ skill:* IPC
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Main Process                                                        │
│  SkillManager                                                       │
│  ├── scan SKILL.md                                                  │
│  ├── install / uninstall / enable                                   │
│  └── toOpenclawConfig                                               │
│                                                                    │
│  Skill dirs                                                         │
│  ├── Resources/SKILLs                                               │
│  └── {userData}/SKILLs                                              │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ ConfigSync skills.load.extraDirs
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ OpenClaw Runtime                                                    │
│  scans SKILL.md; Cowork sends selected skillIds                      │
└────────────────────────────────────────────────────────────────────┘
```

关键文件：

| 层 | 文件 |
|---|---|
| Skill manager | `petclaw-desktop/src/main/skills/skill-manager.ts` |
| IPC | `petclaw-desktop/src/main/ipc/skills-ipc.ts` |
| Renderer page | `petclaw-desktop/src/renderer/src/views/skills/SkillsPage.tsx` |
| Skill selector | `petclaw-desktop/src/renderer/src/views/skills/SkillSelector.tsx` |
| Directory skill selector | `petclaw-desktop/src/renderer/src/components/DirectorySkillSelector.tsx` |
| Chat input | `petclaw-desktop/src/renderer/src/views/chat/ChatInputBox.tsx` |

## 4. 端到端数据流

用户在 Skills 页面搜索/安装 skill；main 校验来源和写入本地 skill 目录；ConfigSync 将可用 skill 同步给 runtime；ChatInputBox 可选择本轮 skill；Cowork 发送时把 skill 上下文传入 session。

Skills 不通过 main workspace `AGENTS.md` 告知 runtime。runtime 原生扫描 `SKILL.md`，PetClaw 只负责：

```text
Resources/SKILLs 或 userData/SKILLs
→ ConfigSync skills.load.extraDirs
→ OpenClaw runtime 扫描
→ ChatInputBox 本轮选择 skillIds
→ Cowork outbound prompt 或 session options 带上 skillIds
```

## 5. 状态机与生命周期

```text
available
→ installing
→ installed
→ enabled | disabled
→ updating
→ failed
→ removed
```

## 6. 数据模型

Skill 信息来自本地目录、runtime 状态和用户选择。持久化层应记录安装状态、作用域和来源，不记录临时 session 选择。

目录职责：

| 目录 | 说明 |
|---|---|
| `Resources/petmind/skills/` | OpenClaw runtime 内置 skills，PetClaw 不复制 |
| `Resources/SKILLs/` | PetClaw 定制 skill 模板，只读 |
| `{userData}/SKILLs/` | 同步后的 PetClaw 定制 skills 和用户自定义 skills |

## 7. IPC / Preload 契约

skills API 应区分搜索、详情、安装、更新、启用、删除和 bins 查询。安装类操作必须返回明确状态和错误。

SkillManager 接口边界：

```typescript
interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
  isBuiltIn: boolean
  skillPath: string
  source: 'official' | 'custom'
  requires?: { bins?: string[]; env?: string[]; config?: string[] }
}
```

三级作用域：

| 级别 | 存储 | 效果 |
|---|---|---|
| 全局 | `openclaw.json skills.entries` | enabled=true 才可用 |
| 目录 | `directories.skill_ids` | 该目录 agent skill 白名单 |
| 会话 | ChatInputBox `selectedSkills` | 本轮发送附带 `skillIds` |

## 8. Renderer 布局、状态与交互

Skills 页面包含列表、详情、安装/更新操作和错误状态。Chat 输入框的 skill 选择器只显示当前上下文可用项。

页面入口与源码：

| 区域 | 源码 |
|---|---|
| Skills 页面 | `petclaw-desktop/src/renderer/src/views/skills/SkillsPage.tsx` |
| Skill 选择器 | `petclaw-desktop/src/renderer/src/views/skills/SkillSelector.tsx` |
| Chat 输入框菜单 | `petclaw-desktop/src/renderer/src/views/chat/ChatInputBox.tsx` |
| 目录 skill 白名单 | `petclaw-desktop/src/renderer/src/components/DirectorySkillSelector.tsx` |
| 目录配置弹窗 | `petclaw-desktop/src/renderer/src/components/DirectoryConfigDialog.tsx` |

Skills 管理页布局：

```text
AppShell
├── AppTopBar
│   ├── Skills search
│   └── Refresh
└── MainPane / SkillsPage
    ├── SkillList
    │   ├── name
    │   ├── source built-in/custom
    │   ├── enabled status
    │   ├── scope
    │   └── missing requirement badge
    ├── SkillDetail
    │   ├── name / description
    │   ├── source path
    │   ├── required bins/env/config
    │   ├── enable / disable
    │   ├── update / uninstall if supported
    │   └── error detail
    └── Empty / Error state
```

Skills 页面修改的是全局 skill enable 状态，不代表当前对话已经选择该 skill。

ChatInputBox skill 子菜单：

```text
+ 菜单
├─ 技能
│  ├─ selected skill chips
│  ├─ 自定义技能
│  │  └─ enabled skills only
│  ├─ 内置技能
│  │  └─ enabled skills only
│  └─ 管理技能：跳转 SkillsPage
├─ 连接器
└─ 添加文件
```

目录级 Skill 白名单布局：

```text
DirectoryConfigDialog
├── directory identity
├── model override
└── DirectorySkillSelector
    ├── search
    ├── selected count
    ├── skill checkbox list
    └── save
```

目录级白名单限制该目录 agent 可用 skill 范围。它不等同于 ChatInputBox 的本轮选择，也不直接启用全局 skill。

状态来源：

| 状态 | 所有者 | 说明 |
|---|---|---|
| skills list | `SkillsPage` / selector 本地 state | 来自 `skills:list` |
| topbar search | `App.tsx` | 传给 `SkillsPage` |
| refresh signal | `App.tsx` | 顶栏刷新 |
| global enabled | Skills main store | `skills:set-enabled` |
| selectedSkills | `ChatInputBox` 本地 state | 本轮发送后清空 |
| directory skillIds | `DirectoryConfigDialog` | 保存到 `directory:update-skills` |

交互状态：

| 状态 | UI 行为 |
|---|---|
| loading | 列表骨架，不清空已有搜索输入 |
| no skills | 显示空态和安装/刷新入口 |
| no search match | 显示无匹配，不改变真实列表 |
| enable failed | 回滚 optimistic 状态或展示错误 |
| missing requirement | skill 可展示但不可启用或显示警告 |
| runtime 未就绪 | 可管理本地 enable 状态，但提示 runtime 需同步 |
| Chat selected disabled later | 发送前重新过滤或提示 skill 不可用 |

## 9. Runtime / Gateway 集成

Skill 状态与 Gateway `skills.*` 能力相关。runtime 不可用时可以展示本地已安装列表，但安装/更新需降级提示。

ConfigSync 输出必须保留已有 runtime skill 配置，并追加 PetClaw extraDirs。全局 skill enable/disable 通常不需要 Gateway 重启，但需要 config bump 或热同步。

## 10. 错误态、安全和权限

Skill 来源需要校验。安装失败不能留下半安装状态；执行中涉及工具权限时仍走 Cowork 审批队列。

安全边界：

- 安装来源需要确认。
- skill bin 或脚本执行仍受 runtime 工具权限和 Cowork 审批保护。
- skill prompt 不写入全局 AGENTS.md，避免未选 skill 污染所有会话。

## 11. 与其它模块的关系

Skills 被 Cowork 使用，由 ConfigSync 同步给 runtime，可能依赖 MCP 或本地 bin。

## 12. 测试策略

- skill 作用域测试。
- 安装/更新失败回滚测试。
- Chat 选择器可用项测试。
- ConfigSync 集成测试。
