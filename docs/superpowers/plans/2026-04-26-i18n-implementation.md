# PetClaw i18n 国际化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 PetClaw 桌面端引入中英双语国际化支持，翻译资源放在 monorepo 共享包 `petclaw-shared` 中。

**Architecture:** 自研轻量 i18n 方案（对标 LobsterAI），翻译内联在 TS 对象中。主进程和渲染进程各一个 i18n runtime，通过 IPC 同步语言设置。翻译资源放在 `petclaw-shared` 共享包，desktop 通过 pnpm workspace 引用。

**Tech Stack:** TypeScript, React (useReducer + useEffect), pnpm workspace, electron-vite, SQLite (app_config KV)

**Spec:** `docs/superpowers/specs/2026-04-26-i18n-design.md`

---

## 文件结构

| 操作 | 文件 | 职责 |
|---|---|---|
| Create | `petclaw-shared/package.json` | 共享包配置 |
| Create | `petclaw-shared/tsconfig.json` | TypeScript 配置 |
| Create | `petclaw-shared/src/i18n/types.ts` | Locale 类型定义 |
| Create | `petclaw-shared/src/i18n/locales/zh.ts` | 中文翻译 |
| Create | `petclaw-shared/src/i18n/locales/en.ts` | 英文翻译 |
| Create | `petclaw-shared/src/i18n/index.ts` | 统一导出 |
| Create | `petclaw-desktop/src/main/i18n.ts` | 主进程 i18n 服务 |
| Create | `petclaw-desktop/src/renderer/src/i18n.ts` | 渲染进程 i18n 服务 + useI18n hook |
| Modify | `petclaw-desktop/package.json` | 添加 @petclaw/shared 依赖 |
| Modify | `petclaw-desktop/electron.vite.config.ts` | 排除共享包外部化 |
| Modify | `petclaw-desktop/tsconfig.node.json` | 添加共享包路径 |
| Modify | `petclaw-desktop/tsconfig.web.json` | 添加共享包路径 |
| Modify | `petclaw-desktop/src/main/index.ts` | 初始化 i18n |
| Modify | `petclaw-desktop/src/main/ipc/boot-ipc.ts` | 添加 i18n IPC handler |
| Modify | `petclaw-desktop/src/preload/index.ts` | 暴露 i18n API |
| Modify | `petclaw-desktop/src/preload/index.d.ts` | i18n API 类型 |
| Modify | `petclaw-desktop/src/main/system/tray.ts` | Tray 菜单 i18n |
| Modify | `petclaw-desktop/src/main/ipc/window-ipc.ts` | Pet 右键菜单 i18n |
| Modify | `petclaw-desktop/src/main/bootcheck.ts` | Boot 步骤 i18n |
| Modify | `petclaw-desktop/src/main/ai/cowork-session-manager.ts` | 错误提示 i18n |
| Modify | 32 个 renderer .tsx 文件 | UI 文本 i18n（详见 Task 6-9） |
| Create | `petclaw-shared/tests/i18n/locale-completeness.test.ts` | 翻译完整性测试 |
| Create | `petclaw-desktop/tests/main/i18n.test.ts` | 主进程 i18n 测试 |
| Create | `petclaw-desktop/tests/renderer/i18n.test.ts` | 渲染进程 i18n 测试 |

---

## Task 1: 创建 petclaw-shared 共享包

**Files:**
- Create: `petclaw-shared/package.json`
- Create: `petclaw-shared/tsconfig.json`
- Create: `petclaw-shared/src/i18n/types.ts`
- Create: `petclaw-shared/src/i18n/locales/zh.ts`
- Create: `petclaw-shared/src/i18n/locales/en.ts`
- Create: `petclaw-shared/src/i18n/index.ts`
- Create: `petclaw-shared/tests/i18n/locale-completeness.test.ts`
- Modify: `petclaw-desktop/package.json`
- Modify: `petclaw-desktop/electron.vite.config.ts`
- Modify: `petclaw-desktop/tsconfig.node.json`
- Modify: `petclaw-desktop/tsconfig.web.json`

### Step 1: 创建 petclaw-shared 包结构

- [ ] **1.1 创建 `petclaw-shared/package.json`**

```json
{
  "name": "@petclaw/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./i18n": "./src/i18n/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **1.2 创建 `petclaw-shared/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **1.3 创建 `petclaw-shared/src/i18n/types.ts`**

```typescript
export type Locale = 'zh' | 'en'

export const SUPPORTED_LOCALES: Locale[] = ['zh', 'en']

export const DEFAULT_LOCALE: Locale = 'zh'

// 从系统 locale 字符串推断 Locale（zh-CN/zh-TW → zh，其余 → en）
export function resolveLocale(systemLocale: string): Locale {
  if (systemLocale.startsWith('zh')) return 'zh'
  return 'en'
}

// 插值：将 {placeholder} 替换为 params 中的值
export function interpolate(template: string, params?: Record<string, string>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`)
}
```

- [ ] **1.4 创建 `petclaw-shared/src/i18n/locales/zh.ts`**

翻译 key 按模块分组，扁平 `Record<string, string>` 结构。以下为完整的中文翻译文件，覆盖 renderer UI + 主进程用户可见文本。

> 实现时需要逐个读取 renderer .tsx 文件，提取所有中文硬编码文本，确保无遗漏。以下列出主要 key，实现时根据实际组件内容补全。

```typescript
export const zh: Record<string, string> = {
  // ── common ──
  'common.confirm': '确认',
  'common.cancel': '取消',
  'common.save': '保存',
  'common.saving': '保存中...',
  'common.saved': '已保存',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.add': '添加',
  'common.close': '关闭',
  'common.loading': '加载中...',
  'common.search': '搜索',
  'common.back': '返回应用',
  'common.skip': '跳过',
  'common.submit': '提交',
  'common.resubmit': '重新提交',
  'common.retry': '重试',
  'common.nextStep': '下一步',
  'common.prevStep': '上一步',
  'common.startUsing': '开始使用',
  'common.comingSoon': '即将推出',
  'common.noData': '暂无数据',

  // ── welcome ──
  'welcome.morning': '早上好',
  'welcome.afternoon': '下午好',
  'welcome.evening': '晚上好',
  'welcome.tagline': '不止聊天，搞定一切',
  'welcome.subtitle': '本地运行，自主规划，安全可控的 AI 工作搭子',
  'welcome.card.fileOrganize.title': '文件整理',
  'welcome.card.fileOrganize.desc': '智能整理和管理本地文件',
  'welcome.card.fileOrganize.prompt': '帮我整理桌面文件，按类型分类到对应文件夹',
  'welcome.card.contentCreation.title': '内容创作',
  'welcome.card.contentCreation.desc': '创作演讲文稿和多种内容',
  'welcome.card.contentCreation.prompt': '帮我写一篇关于的文章',
  'welcome.card.docProcess.title': '文档处理',
  'welcome.card.docProcess.desc': '处理和分析文档数据内容',
  'welcome.card.docProcess.prompt': '帮我分析这份文档的关键信息',

  // ── sidebar ──
  'sidebar.newTask': '新建任务',
  'sidebar.skills': '技能',
  'sidebar.cron': '定时',
  'sidebar.imChannels': 'IM 频道',
  'sidebar.workDir': '工作目录',
  'sidebar.tasks': '任务',
  'sidebar.channels': '频道',
  'sidebar.noTasks': '暂无任务记录',
  'sidebar.defaultTitle': '新建任务',
  'sidebar.channelsComingSoon': '频道功能即将推出',

  // ── chat ──
  'chat.inputPlaceholder': '输入消息，Enter 发送，Shift+Enter 换行...',
  'chat.sendLabel': '发送消息',
  'chat.newConversation': '新对话',
  'chat.unknownError': '未知错误',
  'chat.errorPrefix': '\n[错误：{msg}]',
  'chat.editTitle': '编辑标题',
  'chat.confirmTitle': '确认标题',
  'chat.toggleMonitor': '切换任务监控面板',
  'chat.moreActions': '更多操作',

  // ── permission modal ──
  'permission.toolCall': '工具调用',
  'permission.needConfirm': '需要确认',
  'permission.dangerOp': '危险操作',
  'permission.userCancel': '用户取消',
  'permission.userDeny': '用户拒绝',
  'permission.toolName': '工具名称',
  'permission.params': '参数',
  'permission.deny': '拒绝',
  'permission.allow': '允许',

  // ── monitor ──
  'monitor.title': 'AI 工具监控',
  'monitor.noActive': '暂无活跃的 AI 工具',
  'monitor.hint': '当 Claude Code 等工具运行时，状态会在这里显示',

  // ── status bar ──
  'statusBar.freeUsage': '免费使用中',
  'statusBar.used': '已用',

  // ── settings ──
  'settings.general': '通用',
  'settings.preferences': '偏好设置',
  'settings.profile': '个人资料',
  'settings.about': '关于',
  'settings.aiConfig': 'AI 配置',
  'settings.engine': '引擎',
  'settings.models': '模型',
  'settings.directories': '工作目录',
  'settings.memory': '记忆',
  'settings.extensions': '扩展与集成',
  'settings.connectors': '连接器',
  'settings.mcp': 'MCP 服务',
  'settings.backToApp': '返回应用',

  // ── preferences ──
  'preferences.title': '偏好设置',
  'preferences.subtitle': '自定义应用外观和语言',
  'preferences.language': '语言',
  'preferences.languageZh': '中文（简体）',
  'preferences.languageEn': 'English',
  'preferences.theme': '主题',
  'preferences.themeSystem': '跟随系统',
  'preferences.themeLight': '浅色',
  'preferences.themeDark': '深色',
  'preferences.fontSize': '字体大小',
  'preferences.fontSmall': '小',
  'preferences.fontMedium': '中（默认）',
  'preferences.fontLarge': '大',

  // ── profile ──
  'profile.title': '个人资料',
  'profile.subtitle': '设置你的昵称和职业角色，帮助 AI 更好地了解你',
  'profile.nickname': '昵称',
  'profile.nicknamePlaceholder': '输入你的昵称',
  'profile.role': '职业角色',
  'profile.rolePlaceholder': '请选择',
  'profile.saved': '已保存 ✓',
  'profile.roles.engineer': '软件工程师',
  'profile.roles.pm': '产品经理',
  'profile.roles.designer': '设计师',
  'profile.roles.analyst': '数据分析师',
  'profile.roles.ops': '运营',
  'profile.roles.student': '学生',
  'profile.roles.other': '其他',

  // ── about ──
  'about.title': '关于 PetClaw',
  'about.subtitle': '版本信息与项目资源',
  'about.version': '版本号',
  'about.buildEnv': '构建环境',
  'about.github': 'GitHub 仓库',
  'about.feedback': '问题反馈',
  'about.license': '开源协议',

  // ── engine settings ──
  'engineSettings.title': 'Agent 引擎',
  'engineSettings.subtitle': '查看引擎运行状态和版本信息',
  'engineSettings.status': '运行状态',
  'engineSettings.loading': '加载中...',
  'engineSettings.running': '运行中',
  'engineSettings.notRunning': '未运行',
  'engineSettings.version': '引擎版本',
  'engineSettings.pid': '进程 ID',
  'engineSettings.uptime': '运行时长',
  'engineSettings.uptimeMinutes': '{minutes} 分钟',
  'engineSettings.hint': '引擎状态实时更新，如需重启请从系统托盘菜单操作',

  // ── model settings ──
  'modelSettings.title': '模型配置',
  'modelSettings.subtitle': '管理 AI 模型 Provider 和可用模型',
  'modelSettings.addModel': '添加模型',
  'modelSettings.modelId': '模型 ID',
  'modelSettings.displayName': '显示名称',
  'modelSettings.contextWindow': '上下文窗口',
  'modelSettings.maxOutputTokens': '最大输出 Token',
  'modelSettings.reasoningModel': '推理模型',
  'modelSettings.imageSupport': '支持图片',
  'modelSettings.addProvider': '添加自定义 Provider',
  'modelSettings.apiFormat': 'API 格式',
  'modelSettings.openaiCompat': 'OpenAI 兼容',
  'modelSettings.testing': '测试中...',
  'modelSettings.testConnection': '测试连接',
  'modelSettings.connected': '连接成功',
  'modelSettings.connectFailed': '连接失败',
  'modelSettings.availableModels': '可用模型',
  'modelSettings.noModels': '暂无模型，点击「添加模型」',
  'modelSettings.reasoning': '推理',
  'modelSettings.image': '图片',
  'modelSettings.noProvider': '暂无 Provider',
  'modelSettings.disabled': '已禁用',
  'modelSettings.connectedStatus': '已连接',
  'modelSettings.failed': '失败',
  'modelSettings.notTested': '未测试',
  'modelSettings.addCustom': '添加自定义',
  'modelSettings.selectProvider': '请从左侧选择一个 Provider',
  'modelSettings.presetProvider': '预设提供商',
  'modelSettings.customProvider': '自定义提供商',
  'modelSettings.apiKeyPlaceholder': '请输入 API Key',
  'modelSettings.standard': '标准',

  // ── directory settings ──
  'directorySettings.title': '工作目录',
  'directorySettings.subtitle': '已注册的工作目录会在首次使用时自动添加',
  'directorySettings.noDirectories': '暂无已注册目录',
  'directorySettings.hint': '开始对话时选择工作目录，将自动注册到此列表',

  // ── memory settings ──
  'memorySettings.title': '记忆管理',
  'memorySettings.subtitle': '查看和管理 AI 的记忆条目',

  // ── connector settings ──
  'connectorSettings.title': '连接器',
  'connectorSettings.subtitle': '管理外部服务连接器',

  // ── mcp settings ──
  'mcpSettings.title': 'MCP 服务',
  'mcpSettings.subtitle': '配置 Model Context Protocol 服务器',

  // ── onboarding ──
  'onboarding.setupTitle': '在您的电脑上设置 PetClaw',
  'onboarding.setupSubtitle': 'PetClaw 需要以下权限才能正常工作。您的数据仅在本地处理，我们不会存储任何内容。',
  'onboarding.accessibility': '允许 PetClaw 使用辅助功能',
  'onboarding.microphone': '允许 PetClaw 使用您的麦克风',
  'onboarding.recordingDone': '记录完成！已为您推荐了合适的技能，点击下一步查看吧~',
  'onboarding.aboutYou': '告诉我们关于您',
  'onboarding.aboutYouSubtitle': '帮助 PetClaw 为您打造个性化体验',
  'onboarding.nameQuestion': '怎么称呼您?',
  'onboarding.roleQuestion': '选择您的身份角色',
  'onboarding.skillsTitle': 'PetClaw 拥有的技能',
  'onboarding.skillsSubtitle': '我们为您默认安装好用且安全的 Skill',
  'onboarding.needsConfig': '需配置',
  'onboarding.voiceShortcut': '语音快捷键',
  'onboarding.voiceHint': '按下快捷键开始说话，再按一次确认发送。',
  'onboarding.keyboardShortcut': '键盘快捷键',
  'onboarding.voiceTestHint': '口述以测试您的麦克风',
  'onboarding.voiceTestDesc': '点击下方按钮或按快捷键开始说话，介绍一下自己，顺便给我取个名字吧。',
  'onboarding.recording': '正在录音...',
  'onboarding.clickToSpeak': '点击开始说话',
  'onboarding.quickTask.news.title': '帮我整理今日资讯',
  'onboarding.quickTask.news.desc': '搜集 AI、科技领域的最新动态，整理成简报',
  'onboarding.quickTask.news.message': '请帮我整理今日 AI 和科技领域的最新资讯，按重要性排序',
  'onboarding.quickTask.email.title': '帮我写一封邮件',
  'onboarding.quickTask.email.desc': '根据你的描述，生成一封专业的邮件',
  'onboarding.quickTask.email.message': '我需要写一封邮件',
  'onboarding.quickTask.code.title': '整理代码仓库',
  'onboarding.quickTask.code.desc': '分析项目结构，生成文档和改进建议',
  'onboarding.quickTask.code.message': '帮我分析当前项目结构，列出改进建议',
  'onboarding.quickTask.plan.title': '创建每日工作计划',
  'onboarding.quickTask.plan.desc': '根据待办事项，制定今日工作安排',
  'onboarding.quickTask.plan.message': '帮我制定今天的工作计划',
  'onboarding.tryTitle': '试试让 PetClaw 帮你做点什么',
  'onboarding.trySubtitle': '选择一个快捷任务开始，或者跳过直接开始使用',

  // ── bootcheck ──
  'boot.stepEnv': '准备环境',
  'boot.stepEngine': '启动引擎',
  'boot.stepConnect': '连接服务',
  'boot.hintEnv': '~1秒',
  'boot.hintEngine': '~10秒',
  'boot.hintConnect': '~5秒',
  'boot.setupComplete': '设置完成！',
  'boot.starting': '正在启动 PetClaw...',
  'boot.gatewayFailed': 'Gateway 启动失败',
  'boot.gatewayIncomplete': 'Gateway 连接信息不完整',

  // ── tray ──
  'tray.togglePet': '显示/隐藏宠物',
  'tray.openChat': '打开聊天',
  'tray.monitor': 'AI 工具监控',
  'tray.quit': '退出 PetClaw',

  // ── pet context menu ──
  'pet.resume': '继续',
  'pet.pause': '停一下',
  'pet.quit': '退出',

  // ── pet settings (SettingsView.tsx) ──
  'petSettings.title': '设置',
  'petSettings.wsAddress': 'WebSocket 地址',
  'petSettings.shortcuts': '快捷键',
  'petSettings.togglePet': '显示/隐藏宠物',
  'petSettings.toggleChat': '打开/关闭聊天',
  'petSettings.aboutLabel': '关于',
  'petSettings.aboutDesc': 'AI 桌面宠物助手',

  // ── cron ──
  'cron.myTasks': '我的定时任务',
  'cron.runHistory': '执行记录',
  'cron.createdVia': '通过 PetClaw 创建',
  'cron.newTask': '新建定时任务',
  'cron.title': '定时任务',
  'cron.subtitle': '设置自动化任务，让 PetClaw 按计划帮你完成重复性工作',
  'cron.sleepWarning': '定时任务仅在电脑保持唤醒时运行',
  'cron.noTasks': '还没有定时任务',
  'cron.noTasksHint': '创建你的第一个定时任务，让 PetClaw 自动帮你完成',
  'cron.execute': '手动执行',
  'cron.byDay': '按天',
  'cron.byWeek': '按周',
  'cron.byMonth': '按月',
  'cron.noHistory': '暂无执行记录',
  'cron.noHistoryHint': '当定时任务开始执行后，记录将显示在这里',
  'cron.statusSuccess': '成功',
  'cron.statusFailed': '失败',
  'cron.statusRunning': '运行中',
  'cron.statusSkipped': '跳过',
  'cron.daily': '每天 {time}',
  'cron.weekdays': '工作日 {time}',
  'cron.weekends': '周末 {time}',
  'cron.weeklyOne': '每周{day} {time}',
  'cron.weeklyMulti': '每周{days} {time}',
  'cron.dayNames': '日,一,二,三,四,五,六',

  // ── cron edit dialog ──
  'cronEdit.createTitle': '新建定时任务',
  'cronEdit.editTitle': '编辑任务',
  'cronEdit.subtitle': '按计划自动执行任务，也可随时手动触发。在任意对话中描述你想定期做的事，即可快速创建',
  'cronEdit.taskName': '任务名称',
  'cronEdit.taskNamePlaceholder': '描述你的任务',
  'cronEdit.schedule': '计划时间',
  'cronEdit.daily': '每天',
  'cronEdit.weekly': '每周',
  'cronEdit.monthly': '每月',
  'cronEdit.customCron': '自定义 Cron',
  'cronEdit.promptPlaceholder': '让 PetClaw 帮你做什么...',
  'cronEdit.selectDir': '选择工作目录',
  'cronEdit.standard': '标准',
  'cronEdit.weekdayLabels': '一,二,三,四,五,六,日',

  // ── im channels ──
  'im.title': 'IM 频道',
  'im.subtitle': '配置 IM 频道，让 PetClaw 接收来自钉钉、飞书等平台的消息。',
  'im.localOnly': '频道配置信息仅存储在本地，不会上传到云端。',
  'im.fullDiskHint': '建议授予「完全磁盘访问权限」，可避免系统使用过程中反复弹出文件访问确认，体验更流畅。',
  'im.goSettings': '前往设置',
  'im.connected': '已连接',
  'im.configure': '配置',
  'im.configManage': '配置/管理',
  'im.dingtalk': '钉钉',
  'im.dingtalkDesc': '通过钉钉机器人接收用户消息',
  'im.feishu': '飞书',
  'im.feishuDesc': '通过飞书机器人接收用户消息',
  'im.wechat': '微信',
  'im.wechatDesc': '通过微信接收用户消息',
  'im.wecom': '企业微信',
  'im.wecomDesc': '通过企业微信机器人接收用户消息',

  // ── im config dialog ──
  'imConfig.title': 'IM 机器人',
  'imConfig.scanToCreate': '扫码创建机器人',
  'imConfig.notConnected': '未连接',
  'imConfig.manualConfig': '手动填写配置',
  'imConfig.feishuAppId': '输入飞书 App ID',
  'imConfig.feishuAppSecret': '输入飞书 App Secret',
  'imConfig.dingtalkAppKey': '输入钉钉 App Key',
  'imConfig.wechatAccountId': '输入微信 Account ID',
  'imConfig.wecomCorpId': '输入企业微信 Corp ID',

  // ── skills ──
  'skills.title': '技能管理',
  'skills.subtitle': '管理和配置可用的技能',
  'skills.searchPlaceholder': '搜索技能...',
  'skills.noMatch': '没有匹配的技能',
  'skills.noSkills': '暂无技能',
  'skills.selectTitle': '选择技能',
  'skills.clearAll': '全部清除',
  'skills.searchSkill': '搜索技能',
  'skills.noInstalled': '暂无已安装技能',
  'skills.manage': '管理技能',

  // ── task monitor panel ──
  'taskMonitor.todoTasks': '待办任务',
  'taskMonitor.noTodo': '暂无待办任务',
  'taskMonitor.artifacts': '产物',
  'taskMonitor.noArtifacts': '暂无产物',
  'taskMonitor.skillsAndMcp': '技能与 MCP',
  'taskMonitor.noSkills': '暂无启用的技能',

  // ── connector popup ──
  'connectorPopup.mcpServers': 'MCP 服务器',
  'connectorPopup.noMcp': '暂未配置 MCP 服务器',

  // ── cwd selector ──
  'cwdSelector.title': '工作目录',
  'cwdSelector.addFolder': '添加文件夹',
  'cwdSelector.recent': '最近使用',
  'cwdSelector.noRecent': '暂无最近目录',
  'cwdSelector.promptPath': '请输入工作目录路径：',

  // ── directory config dialog ──
  'dirConfig.basicInfo': '基础信息',
  'dirConfig.skills': '技能',
  'dirConfig.alias': '目录别名',
  'dirConfig.aliasHint': '留空则显示目录名',
  'dirConfig.modelOverride': '模型覆盖',
  'dirConfig.modelOverridePlaceholder': '留空则使用全局默认模型',
  'dirConfig.modelOverrideHint': '仅 OpenClaw 引擎使用此设置',
  'dirConfig.selectedSkills': '已选 {count} 个技能',

  // ── model selector ──
  'modelSelector.default': '默认模型',
  'modelSelector.noModels': '暂无可用模型',

  // ── errors (主进程) ──
  'error.dirNotFound': '工作目录不存在：{path}',
  'error.dirDeleted': '该会话的工作目录已不存在：{path}，请创建新会话选择新路径',
}
```

- [ ] **1.5 创建 `petclaw-shared/src/i18n/locales/en.ts`**

所有 key 与 zh.ts 一一对应，value 为英文。

```typescript
export const en: Record<string, string> = {
  // ── common ──
  'common.confirm': 'Confirm',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.saving': 'Saving...',
  'common.saved': 'Saved',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.close': 'Close',
  'common.loading': 'Loading...',
  'common.search': 'Search',
  'common.back': 'Back',
  'common.skip': 'Skip',
  'common.submit': 'Submit',
  'common.resubmit': 'Resubmit',
  'common.retry': 'Retry',
  'common.nextStep': 'Next',
  'common.prevStep': 'Previous',
  'common.startUsing': 'Get Started',
  'common.comingSoon': 'Coming Soon',
  'common.noData': 'No data',

  // ── welcome ──
  'welcome.morning': 'Good Morning',
  'welcome.afternoon': 'Good Afternoon',
  'welcome.evening': 'Good Evening',
  'welcome.tagline': 'Beyond Chat, Get Things Done',
  'welcome.subtitle': 'Run locally, plan autonomously, your secure AI work companion',
  'welcome.card.fileOrganize.title': 'File Organizer',
  'welcome.card.fileOrganize.desc': 'Intelligently organize and manage local files',
  'welcome.card.fileOrganize.prompt': 'Help me organize my desktop files by type into corresponding folders',
  'welcome.card.contentCreation.title': 'Content Creation',
  'welcome.card.contentCreation.desc': 'Create presentations and various content',
  'welcome.card.contentCreation.prompt': 'Help me write an article about',
  'welcome.card.docProcess.title': 'Document Processing',
  'welcome.card.docProcess.desc': 'Process and analyze document content',
  'welcome.card.docProcess.prompt': 'Help me analyze the key information in this document',

  // ── sidebar ──
  'sidebar.newTask': 'New Task',
  'sidebar.skills': 'Skills',
  'sidebar.cron': 'Cron',
  'sidebar.imChannels': 'IM Channels',
  'sidebar.workDir': 'Workspace',
  'sidebar.tasks': 'Tasks',
  'sidebar.channels': 'Channels',
  'sidebar.noTasks': 'No tasks yet',
  'sidebar.defaultTitle': 'New Task',
  'sidebar.channelsComingSoon': 'Channels coming soon',

  // ── chat ──
  'chat.inputPlaceholder': 'Type a message, Enter to send, Shift+Enter for new line...',
  'chat.sendLabel': 'Send message',
  'chat.newConversation': 'New Conversation',
  'chat.unknownError': 'Unknown error',
  'chat.errorPrefix': '\n[Error: {msg}]',
  'chat.editTitle': 'Edit title',
  'chat.confirmTitle': 'Confirm title',
  'chat.toggleMonitor': 'Toggle task monitor panel',
  'chat.moreActions': 'More actions',

  // ── permission modal ──
  'permission.toolCall': 'Tool Call',
  'permission.needConfirm': 'Needs Confirmation',
  'permission.dangerOp': 'Dangerous Operation',
  'permission.userCancel': 'User cancelled',
  'permission.userDeny': 'User denied',
  'permission.toolName': 'Tool Name',
  'permission.params': 'Parameters',
  'permission.deny': 'Deny',
  'permission.allow': 'Allow',

  // ── monitor ──
  'monitor.title': 'AI Tool Monitor',
  'monitor.noActive': 'No active AI tools',
  'monitor.hint': 'When tools like Claude Code are running, their status will show here',

  // ── status bar ──
  'statusBar.freeUsage': 'Free plan',
  'statusBar.used': 'used',

  // ── settings ──
  'settings.general': 'General',
  'settings.preferences': 'Preferences',
  'settings.profile': 'Profile',
  'settings.about': 'About',
  'settings.aiConfig': 'AI Config',
  'settings.engine': 'Engine',
  'settings.models': 'Models',
  'settings.directories': 'Directories',
  'settings.memory': 'Memory',
  'settings.extensions': 'Extensions & Integrations',
  'settings.connectors': 'Connectors',
  'settings.mcp': 'MCP Services',
  'settings.backToApp': 'Back to App',

  // ── preferences ──
  'preferences.title': 'Preferences',
  'preferences.subtitle': 'Customize appearance and language',
  'preferences.language': 'Language',
  'preferences.languageZh': '中文（简体）',
  'preferences.languageEn': 'English',
  'preferences.theme': 'Theme',
  'preferences.themeSystem': 'System',
  'preferences.themeLight': 'Light',
  'preferences.themeDark': 'Dark',
  'preferences.fontSize': 'Font Size',
  'preferences.fontSmall': 'Small',
  'preferences.fontMedium': 'Medium (Default)',
  'preferences.fontLarge': 'Large',

  // ── profile ──
  'profile.title': 'Profile',
  'profile.subtitle': 'Set your nickname and role to help AI understand you better',
  'profile.nickname': 'Nickname',
  'profile.nicknamePlaceholder': 'Enter your nickname',
  'profile.role': 'Role',
  'profile.rolePlaceholder': 'Select',
  'profile.saved': 'Saved ✓',
  'profile.roles.engineer': 'Software Engineer',
  'profile.roles.pm': 'Product Manager',
  'profile.roles.designer': 'Designer',
  'profile.roles.analyst': 'Data Analyst',
  'profile.roles.ops': 'Operations',
  'profile.roles.student': 'Student',
  'profile.roles.other': 'Other',

  // ── about ──
  'about.title': 'About PetClaw',
  'about.subtitle': 'Version info and project resources',
  'about.version': 'Version',
  'about.buildEnv': 'Build Environment',
  'about.github': 'GitHub Repository',
  'about.feedback': 'Report Issues',
  'about.license': 'License',

  // ── engine settings ──
  'engineSettings.title': 'Agent Engine',
  'engineSettings.subtitle': 'View engine status and version info',
  'engineSettings.status': 'Status',
  'engineSettings.loading': 'Loading...',
  'engineSettings.running': 'Running',
  'engineSettings.notRunning': 'Stopped',
  'engineSettings.version': 'Engine Version',
  'engineSettings.pid': 'Process ID',
  'engineSettings.uptime': 'Uptime',
  'engineSettings.uptimeMinutes': '{minutes} min',
  'engineSettings.hint': 'Engine status updates in real-time. Restart from system tray menu.',

  // ── model settings ──
  'modelSettings.title': 'Model Configuration',
  'modelSettings.subtitle': 'Manage AI model providers and available models',
  'modelSettings.addModel': 'Add Model',
  'modelSettings.modelId': 'Model ID',
  'modelSettings.displayName': 'Display Name',
  'modelSettings.contextWindow': 'Context Window',
  'modelSettings.maxOutputTokens': 'Max Output Tokens',
  'modelSettings.reasoningModel': 'Reasoning Model',
  'modelSettings.imageSupport': 'Image Support',
  'modelSettings.addProvider': 'Add Custom Provider',
  'modelSettings.apiFormat': 'API Format',
  'modelSettings.openaiCompat': 'OpenAI Compatible',
  'modelSettings.testing': 'Testing...',
  'modelSettings.testConnection': 'Test Connection',
  'modelSettings.connected': 'Connected',
  'modelSettings.connectFailed': 'Connection Failed',
  'modelSettings.availableModels': 'Available Models',
  'modelSettings.noModels': 'No models. Click "Add Model"',
  'modelSettings.reasoning': 'Reasoning',
  'modelSettings.image': 'Image',
  'modelSettings.noProvider': 'No providers',
  'modelSettings.disabled': 'Disabled',
  'modelSettings.connectedStatus': 'Connected',
  'modelSettings.failed': 'Failed',
  'modelSettings.notTested': 'Not Tested',
  'modelSettings.addCustom': 'Add Custom',
  'modelSettings.selectProvider': 'Select a provider from the left',
  'modelSettings.presetProvider': 'Preset Provider',
  'modelSettings.customProvider': 'Custom Provider',
  'modelSettings.apiKeyPlaceholder': 'Enter API Key',
  'modelSettings.standard': 'Standard',

  // ── directory settings ──
  'directorySettings.title': 'Directories',
  'directorySettings.subtitle': 'Registered directories are added automatically on first use',
  'directorySettings.noDirectories': 'No registered directories',
  'directorySettings.hint': 'Select a directory when starting a conversation to auto-register',

  // ── memory settings ──
  'memorySettings.title': 'Memory',
  'memorySettings.subtitle': 'View and manage AI memory entries',

  // ── connector settings ──
  'connectorSettings.title': 'Connectors',
  'connectorSettings.subtitle': 'Manage external service connectors',

  // ── mcp settings ──
  'mcpSettings.title': 'MCP Services',
  'mcpSettings.subtitle': 'Configure Model Context Protocol servers',

  // ── onboarding ──
  'onboarding.setupTitle': 'Set up PetClaw on your computer',
  'onboarding.setupSubtitle': 'PetClaw needs these permissions to work properly. Your data is processed locally only — we never store anything.',
  'onboarding.accessibility': 'Allow PetClaw to use accessibility features',
  'onboarding.microphone': 'Allow PetClaw to use your microphone',
  'onboarding.recordingDone': 'Recording complete! We\'ve recommended skills for you. Click next to see them~',
  'onboarding.aboutYou': 'Tell us about yourself',
  'onboarding.aboutYouSubtitle': 'Help PetClaw create a personalized experience for you',
  'onboarding.nameQuestion': 'What should we call you?',
  'onboarding.roleQuestion': 'Select your role',
  'onboarding.skillsTitle': 'PetClaw Skills',
  'onboarding.skillsSubtitle': 'We\'ve pre-installed useful and safe skills for you',
  'onboarding.needsConfig': 'Config needed',
  'onboarding.voiceShortcut': 'Voice Shortcut',
  'onboarding.voiceHint': 'Press the shortcut to start speaking, press again to confirm.',
  'onboarding.keyboardShortcut': 'Keyboard Shortcut',
  'onboarding.voiceTestHint': 'Speak to test your microphone',
  'onboarding.voiceTestDesc': 'Click the button below or press the shortcut to start speaking. Introduce yourself and give me a name!',
  'onboarding.recording': 'Recording...',
  'onboarding.clickToSpeak': 'Click to speak',
  'onboarding.quickTask.news.title': 'Summarize today\'s news',
  'onboarding.quickTask.news.desc': 'Collect the latest AI and tech news, compile into a briefing',
  'onboarding.quickTask.news.message': 'Please compile today\'s AI and tech news, sorted by importance',
  'onboarding.quickTask.email.title': 'Write an email',
  'onboarding.quickTask.email.desc': 'Generate a professional email from your description',
  'onboarding.quickTask.email.message': 'I need to write an email',
  'onboarding.quickTask.code.title': 'Organize code repo',
  'onboarding.quickTask.code.desc': 'Analyze project structure, generate docs and suggestions',
  'onboarding.quickTask.code.message': 'Help me analyze the current project structure and list improvement suggestions',
  'onboarding.quickTask.plan.title': 'Create daily work plan',
  'onboarding.quickTask.plan.desc': 'Create a work schedule based on your to-dos',
  'onboarding.quickTask.plan.message': 'Help me create today\'s work plan',
  'onboarding.tryTitle': 'Try asking PetClaw to help you',
  'onboarding.trySubtitle': 'Choose a quick task to start, or skip to begin using',

  // ── bootcheck ──
  'boot.stepEnv': 'Preparing environment',
  'boot.stepEngine': 'Starting engine',
  'boot.stepConnect': 'Connecting services',
  'boot.hintEnv': '~1s',
  'boot.hintEngine': '~10s',
  'boot.hintConnect': '~5s',
  'boot.setupComplete': 'Setup complete!',
  'boot.starting': 'Starting PetClaw...',
  'boot.gatewayFailed': 'Gateway failed to start',
  'boot.gatewayIncomplete': 'Gateway connection info incomplete',

  // ── tray ──
  'tray.togglePet': 'Show/Hide Pet',
  'tray.openChat': 'Open Chat',
  'tray.monitor': 'AI Tool Monitor',
  'tray.quit': 'Quit PetClaw',

  // ── pet context menu ──
  'pet.resume': 'Resume',
  'pet.pause': 'Pause',
  'pet.quit': 'Quit',

  // ── pet settings ──
  'petSettings.title': 'Settings',
  'petSettings.wsAddress': 'WebSocket Address',
  'petSettings.shortcuts': 'Shortcuts',
  'petSettings.togglePet': 'Show/Hide Pet',
  'petSettings.toggleChat': 'Open/Close Chat',
  'petSettings.aboutLabel': 'About',
  'petSettings.aboutDesc': 'AI Desktop Pet Assistant',

  // ── cron ──
  'cron.myTasks': 'My Scheduled Tasks',
  'cron.runHistory': 'Run History',
  'cron.createdVia': 'Created via PetClaw',
  'cron.newTask': 'New Scheduled Task',
  'cron.title': 'Scheduled Tasks',
  'cron.subtitle': 'Set up automated tasks so PetClaw can handle repetitive work on schedule',
  'cron.sleepWarning': 'Scheduled tasks only run while your computer is awake',
  'cron.noTasks': 'No scheduled tasks yet',
  'cron.noTasksHint': 'Create your first scheduled task and let PetClaw handle it for you',
  'cron.execute': 'Run Now',
  'cron.byDay': 'By Day',
  'cron.byWeek': 'By Week',
  'cron.byMonth': 'By Month',
  'cron.noHistory': 'No run history',
  'cron.noHistoryHint': 'Run history will appear here once a scheduled task starts',
  'cron.statusSuccess': 'Success',
  'cron.statusFailed': 'Failed',
  'cron.statusRunning': 'Running',
  'cron.statusSkipped': 'Skipped',
  'cron.daily': 'Daily at {time}',
  'cron.weekdays': 'Weekdays at {time}',
  'cron.weekends': 'Weekends at {time}',
  'cron.weeklyOne': 'Every {day} at {time}',
  'cron.weeklyMulti': 'Every {days} at {time}',
  'cron.dayNames': 'Sun,Mon,Tue,Wed,Thu,Fri,Sat',

  // ── cron edit dialog ──
  'cronEdit.createTitle': 'New Scheduled Task',
  'cronEdit.editTitle': 'Edit Task',
  'cronEdit.subtitle': 'Execute tasks on a schedule, or trigger manually anytime. Describe what you want done regularly in any conversation to quickly create one.',
  'cronEdit.taskName': 'Task Name',
  'cronEdit.taskNamePlaceholder': 'Describe your task',
  'cronEdit.schedule': 'Schedule',
  'cronEdit.daily': 'Daily',
  'cronEdit.weekly': 'Weekly',
  'cronEdit.monthly': 'Monthly',
  'cronEdit.customCron': 'Custom Cron',
  'cronEdit.promptPlaceholder': 'What should PetClaw do...',
  'cronEdit.selectDir': 'Select directory',
  'cronEdit.standard': 'Standard',
  'cronEdit.weekdayLabels': 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',

  // ── im channels ──
  'im.title': 'IM Channels',
  'im.subtitle': 'Configure IM channels to let PetClaw receive messages from DingTalk, Feishu, and more.',
  'im.localOnly': 'Channel configurations are stored locally only — never uploaded to the cloud.',
  'im.fullDiskHint': 'We recommend granting "Full Disk Access" to avoid repeated file access prompts during use.',
  'im.goSettings': 'Open Settings',
  'im.connected': 'Connected',
  'im.configure': 'Configure',
  'im.configManage': 'Configure/Manage',
  'im.dingtalk': 'DingTalk',
  'im.dingtalkDesc': 'Receive messages via DingTalk bot',
  'im.feishu': 'Feishu',
  'im.feishuDesc': 'Receive messages via Feishu bot',
  'im.wechat': 'WeChat',
  'im.wechatDesc': 'Receive messages via WeChat',
  'im.wecom': 'WeCom',
  'im.wecomDesc': 'Receive messages via WeCom bot',

  // ── im config dialog ──
  'imConfig.title': 'IM Bot',
  'imConfig.scanToCreate': 'Scan to create bot',
  'imConfig.notConnected': 'Not connected',
  'imConfig.manualConfig': 'Manual configuration',
  'imConfig.feishuAppId': 'Enter Feishu App ID',
  'imConfig.feishuAppSecret': 'Enter Feishu App Secret',
  'imConfig.dingtalkAppKey': 'Enter DingTalk App Key',
  'imConfig.wechatAccountId': 'Enter WeChat Account ID',
  'imConfig.wecomCorpId': 'Enter WeCom Corp ID',

  // ── skills ──
  'skills.title': 'Skill Management',
  'skills.subtitle': 'Manage and configure available skills',
  'skills.searchPlaceholder': 'Search skills...',
  'skills.noMatch': 'No matching skills',
  'skills.noSkills': 'No skills',
  'skills.selectTitle': 'Select Skills',
  'skills.clearAll': 'Clear All',
  'skills.searchSkill': 'Search skills',
  'skills.noInstalled': 'No installed skills',
  'skills.manage': 'Manage Skills',

  // ── task monitor panel ──
  'taskMonitor.todoTasks': 'To-do Tasks',
  'taskMonitor.noTodo': 'No to-do tasks',
  'taskMonitor.artifacts': 'Artifacts',
  'taskMonitor.noArtifacts': 'No artifacts',
  'taskMonitor.skillsAndMcp': 'Skills & MCP',
  'taskMonitor.noSkills': 'No enabled skills',

  // ── connector popup ──
  'connectorPopup.mcpServers': 'MCP Servers',
  'connectorPopup.noMcp': 'No MCP servers configured',

  // ── cwd selector ──
  'cwdSelector.title': 'Directory',
  'cwdSelector.addFolder': 'Add Folder',
  'cwdSelector.recent': 'Recent',
  'cwdSelector.noRecent': 'No recent directories',
  'cwdSelector.promptPath': 'Enter directory path:',

  // ── directory config dialog ──
  'dirConfig.basicInfo': 'Basic Info',
  'dirConfig.skills': 'Skills',
  'dirConfig.alias': 'Directory Alias',
  'dirConfig.aliasHint': 'Leave empty to show directory name',
  'dirConfig.modelOverride': 'Model Override',
  'dirConfig.modelOverridePlaceholder': 'Leave empty to use global default model',
  'dirConfig.modelOverrideHint': 'Only used by OpenClaw engine',
  'dirConfig.selectedSkills': '{count} skills selected',

  // ── model selector ──
  'modelSelector.default': 'Default Model',
  'modelSelector.noModels': 'No models available',

  // ── errors ──
  'error.dirNotFound': 'Working directory not found: {path}',
  'error.dirDeleted': 'Working directory no longer exists: {path}. Please create a new session with a different path.',
}
```

- [ ] **1.6 创建 `petclaw-shared/src/i18n/index.ts`**

```typescript
export { zh } from './locales/zh'
export { en } from './locales/en'
export { interpolate, resolveLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } from './types'
export type { Locale } from './types'
```

### Step 2: 翻译完整性测试

- [ ] **2.1 创建 `petclaw-shared/tests/i18n/locale-completeness.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { zh } from '../../src/i18n/locales/zh'
import { en } from '../../src/i18n/locales/en'

describe('i18n locale completeness', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()

  it('zh and en have the same keys', () => {
    expect(zhKeys).toEqual(enKeys)
  })

  it('no empty values in zh', () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value.trim(), `zh key "${key}" is empty`).not.toBe('')
    }
  })

  it('no empty values in en', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `en key "${key}" is empty`).not.toBe('')
    }
  })

  it('interpolation placeholders match between locales', () => {
    const placeholderRegex = /\{(\w+)\}/g
    for (const key of zhKeys) {
      const zhPlaceholders = [...zh[key].matchAll(placeholderRegex)].map((m) => m[1]).sort()
      const enPlaceholders = [...en[key].matchAll(placeholderRegex)].map((m) => m[1]).sort()
      expect(enPlaceholders, `Placeholder mismatch for key "${key}"`).toEqual(zhPlaceholders)
    }
  })
})
```

- [ ] **2.2 运行测试**

```bash
cd petclaw-shared && npx vitest run
```

Expected: 4 tests PASS

### Step 3: 集成 petclaw-shared 到 desktop

- [ ] **3.1 修改 `petclaw-desktop/package.json`：添加依赖**

在 `dependencies` 中添加：

```json
"@petclaw/shared": "workspace:*"
```

- [ ] **3.2 修改 `petclaw-desktop/electron.vite.config.ts`：排除共享包外部化**

`externalizeDepsPlugin()` 默认会把所有 node_modules 依赖外部化。`@petclaw/shared` 是纯 TS 数据包，需要被 bundler 内联编译。

将 main 和 preload 的 `externalizeDepsPlugin()` 改为 `externalizeDepsPlugin({ exclude: ['@petclaw/shared'] })`：

```typescript
main: {
  plugins: [externalizeDepsPlugin({ exclude: ['@petclaw/shared'] })],
  // ...
},
preload: {
  plugins: [externalizeDepsPlugin({ exclude: ['@petclaw/shared'] })]
},
```

- [ ] **3.3 安装依赖**

```bash
cd /path/to/petclaw && pnpm install
```

- [ ] **3.4 验证导入可用**

在 desktop 中临时测试导入：

```bash
cd petclaw-desktop && npx tsc --noEmit -p tsconfig.node.json
```

Expected: 0 errors（如果 TypeScript 能解析 `@petclaw/shared/i18n`）

- [ ] **3.5 Commit**

```bash
git add petclaw-shared/ petclaw-desktop/package.json petclaw-desktop/electron.vite.config.ts pnpm-lock.yaml
git commit -m "feat(shared): create petclaw-shared package with i18n locale files"
```

---

## Task 2: 主进程 i18n 服务

**Files:**
- Create: `petclaw-desktop/src/main/i18n.ts`
- Create: `petclaw-desktop/tests/main/i18n.test.ts`

- [ ] **Step 1: 编写测试**

创建 `petclaw-desktop/tests/main/i18n.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

import { initDatabase, kvGet } from '../../src/main/data/db'
import { initI18n, t, setLanguage, getLanguage } from '../../src/main/i18n'

describe('main process i18n', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
  })

  it('initI18n defaults to zh when no stored language and system locale is zh', () => {
    initI18n(db, 'zh-CN')
    expect(getLanguage()).toBe('zh')
  })

  it('initI18n defaults to en for non-zh system locale', () => {
    initI18n(db, 'en-US')
    expect(getLanguage()).toBe('en')
  })

  it('initI18n reads stored language from app_config', () => {
    // 预先写入 language
    db.prepare('INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)').run(
      'language',
      'en',
      Date.now()
    )
    initI18n(db, 'zh-CN')
    expect(getLanguage()).toBe('en')
  })

  it('t() returns translated text for current locale', () => {
    initI18n(db, 'zh-CN')
    expect(t('common.confirm')).toBe('确认')

    setLanguage('en')
    expect(t('common.confirm')).toBe('Confirm')
  })

  it('t() supports interpolation', () => {
    initI18n(db, 'zh-CN')
    expect(t('error.dirNotFound', { path: '/test' })).toBe('工作目录不存在：/test')
  })

  it('t() returns key when key not found', () => {
    initI18n(db, 'zh-CN')
    expect(t('nonexistent.key')).toBe('nonexistent.key')
  })

  it('setLanguage persists to app_config', () => {
    initI18n(db, 'zh-CN')
    setLanguage('en')
    expect(kvGet(db, 'language')).toBe('en')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd petclaw-desktop && npx vitest run tests/main/i18n.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/main/i18n.ts`**

```typescript
import { zh, en, interpolate, resolveLocale } from '@petclaw/shared/i18n'
import type { Locale } from '@petclaw/shared/i18n'
import type Database from 'better-sqlite3'

import { kvGet, kvSet } from './data/db'

const locales: Record<Locale, Record<string, string>> = { zh, en }

let currentLocale: Locale = 'zh'
let dbRef: Database.Database | null = null

// 启动时调用：从 app_config 读取语言，或根据系统 locale 推断
export function initI18n(db: Database.Database, systemLocale?: string): void {
  dbRef = db
  const stored = kvGet(db, 'language')
  if (stored === 'zh' || stored === 'en') {
    currentLocale = stored
  } else {
    currentLocale = resolveLocale(systemLocale ?? 'en')
    kvSet(db, 'language', currentLocale)
  }
}

export function t(key: string, params?: Record<string, string>): string {
  const template = locales[currentLocale]?.[key]
  if (!template) return key
  return interpolate(template, params)
}

export function setLanguage(locale: Locale): void {
  currentLocale = locale
  if (dbRef) {
    kvSet(dbRef, 'language', locale)
  }
}

export function getLanguage(): Locale {
  return currentLocale
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd petclaw-desktop && npx vitest run tests/main/i18n.test.ts
```

Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/main/i18n.ts petclaw-desktop/tests/main/i18n.test.ts
git commit -m "feat(desktop): add main process i18n service"
```

---

## Task 3: 渲染进程 i18n 服务 + useI18n Hook

**Files:**
- Create: `petclaw-desktop/src/renderer/src/i18n.ts`
- Create: `petclaw-desktop/tests/renderer/i18n.test.ts`

- [ ] **Step 1: 编写测试**

创建 `petclaw-desktop/tests/renderer/i18n.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'

import { zh, en } from '@petclaw/shared/i18n'
import { i18nService } from '../../src/renderer/src/i18n'

describe('renderer i18n service', () => {
  beforeEach(() => {
    i18nService.init('zh')
  })

  it('t() returns zh text by default', () => {
    expect(i18nService.t('common.confirm')).toBe('确认')
  })

  it('setLanguage switches to en', () => {
    i18nService.setLanguage('en')
    expect(i18nService.t('common.confirm')).toBe('Confirm')
  })

  it('t() supports interpolation', () => {
    expect(i18nService.t('error.dirNotFound', { path: '/test' })).toBe('工作目录不存在：/test')
  })

  it('t() returns key for missing keys', () => {
    expect(i18nService.t('nonexistent')).toBe('nonexistent')
  })

  it('getLanguage returns current locale', () => {
    expect(i18nService.getLanguage()).toBe('zh')
    i18nService.setLanguage('en')
    expect(i18nService.getLanguage()).toBe('en')
  })

  it('subscribe notifies on language change', () => {
    let called = false
    const unsubscribe = i18nService.subscribe(() => {
      called = true
    })
    i18nService.setLanguage('en')
    expect(called).toBe(true)
    unsubscribe()
  })

  it('unsubscribe stops notifications', () => {
    let count = 0
    const unsubscribe = i18nService.subscribe(() => {
      count++
    })
    i18nService.setLanguage('en')
    expect(count).toBe(1)
    unsubscribe()
    i18nService.setLanguage('zh')
    expect(count).toBe(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd petclaw-desktop && npx vitest run tests/renderer/i18n.test.ts
```

- [ ] **Step 3: 实现 `src/renderer/src/i18n.ts`**

```typescript
import { useEffect, useReducer } from 'react'
import { zh, en, interpolate } from '@petclaw/shared/i18n'
import type { Locale } from '@petclaw/shared/i18n'

const locales: Record<Locale, Record<string, string>> = { zh, en }

class I18nService {
  private locale: Locale = 'zh'
  private listeners = new Set<() => void>()

  init(locale: Locale): void {
    this.locale = locale
  }

  t(key: string, params?: Record<string, string>): string {
    const template = locales[this.locale]?.[key]
    if (!template) return key
    return interpolate(template, params)
  }

  setLanguage(locale: Locale): void {
    if (this.locale === locale) return
    this.locale = locale
    // 通知主进程持久化
    window.api?.setLanguage?.(locale)
    // 通知所有订阅者
    for (const listener of this.listeners) {
      listener()
    }
  }

  getLanguage(): Locale {
    return this.locale
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const i18nService = new I18nService()

// React Hook：订阅语言变更，自动触发 re-render
export function useI18n() {
  const [, forceUpdate] = useReducer((c: number) => c + 1, 0)

  useEffect(() => {
    return i18nService.subscribe(forceUpdate)
  }, [])

  return {
    t: i18nService.t.bind(i18nService),
    language: i18nService.getLanguage()
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd petclaw-desktop && npx vitest run tests/renderer/i18n.test.ts
```

Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/renderer/src/i18n.ts petclaw-desktop/tests/renderer/i18n.test.ts
git commit -m "feat(desktop): add renderer i18n service with useI18n hook"
```

---

## Task 4: IPC 集成 + 初始化

**Files:**
- Modify: `petclaw-desktop/src/main/index.ts`
- Modify: `petclaw-desktop/src/main/ipc/boot-ipc.ts`
- Modify: `petclaw-desktop/src/preload/index.ts`
- Modify: `petclaw-desktop/src/preload/index.d.ts`

- [ ] **Step 1: 修改 `src/main/index.ts`：初始化 i18n**

在 `app.whenReady()` 中，数据库初始化之后、窗口创建之前，添加 i18n 初始化：

```typescript
import { app } from 'electron'
import { initI18n } from './i18n'

// 在 initDatabase(db) 之后添加：
initI18n(db, app.getLocale())
```

- [ ] **Step 2: 修改 `src/main/ipc/boot-ipc.ts`：添加 i18n IPC handlers**

添加两个 IPC handler：

```typescript
import { getLanguage, setLanguage } from '../i18n'
import type { Locale } from '@petclaw/shared/i18n'

// 在 registerBootIpcHandlers 中注册：
ipcMain.handle('i18n:get-language', () => getLanguage())

ipcMain.handle('i18n:set-language', (_event, locale: string) => {
  if (locale === 'zh' || locale === 'en') {
    setLanguage(locale as Locale)
  }
})
```

- [ ] **Step 3: 修改 `src/preload/index.ts`：暴露 i18n API**

在 `contextBridge.exposeInMainWorld` 的 api 对象中添加：

```typescript
getLanguage: () => ipcRenderer.invoke('i18n:get-language'),
setLanguage: (locale: string) => ipcRenderer.invoke('i18n:set-language', locale),
```

- [ ] **Step 4: 修改 `src/preload/index.d.ts`：添加类型声明**

在 `ElectronAPI` 接口中添加：

```typescript
getLanguage: () => Promise<string>
setLanguage: (locale: string) => Promise<void>
```

- [ ] **Step 5: 修改渲染进程入口初始化 i18n**

在 `src/renderer/src/main.tsx`（或 `App.tsx`）的启动逻辑中，添加 i18n 初始化：

```typescript
import { i18nService } from './i18n'

// 在 React 渲染之前：
window.api.getLanguage().then((locale) => {
  i18nService.init(locale as 'zh' | 'en')
})
```

> 具体插入位置需读取 main.tsx/App.tsx 确认。如果是 async 初始化，可在 `useEffect` 中完成或在渲染前 await。

- [ ] **Step 6: 验证 typecheck**

```bash
cd petclaw-desktop && npm run typecheck
```

Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add petclaw-desktop/src/main/index.ts petclaw-desktop/src/main/ipc/boot-ipc.ts petclaw-desktop/src/preload/index.ts petclaw-desktop/src/preload/index.d.ts petclaw-desktop/src/renderer/src/main.tsx
git commit -m "feat(desktop): integrate i18n IPC channels and initialization"
```

---

## Task 5: 主进程文本 i18n 迁移

**Files:**
- Modify: `petclaw-desktop/src/main/system/tray.ts`
- Modify: `petclaw-desktop/src/main/ipc/window-ipc.ts`
- Modify: `petclaw-desktop/src/main/bootcheck.ts`
- Modify: `petclaw-desktop/src/main/ai/cowork-session-manager.ts`

- [ ] **Step 1: 迁移 `src/main/system/tray.ts`**

将 4 个硬编码菜单 label 替换为 `t()` 调用：

```typescript
import { t } from '../i18n'

// 替换：
label: '显示/隐藏宠物'  →  label: t('tray.togglePet')
label: '打开聊天'       →  label: t('tray.openChat')
label: 'AI 工具监控'    →  label: t('tray.monitor')
label: '退出 PetClaw'   →  label: t('tray.quit')
```

- [ ] **Step 2: 迁移 `src/main/ipc/window-ipc.ts`**

Pet 右键菜单：

```typescript
import { t } from '../i18n'

// 替换：
label: paused ? '继续' : '停一下'  →  label: paused ? t('pet.resume') : t('pet.pause')
label: '退出'                      →  label: t('pet.quit')
```

- [ ] **Step 3: 迁移 `src/main/bootcheck.ts`**

Boot 步骤标签和提示：

```typescript
import { t } from './i18n'

// createSteps() 中替换：
{ id: 'env', label: t('boot.stepEnv'), status: 'pending', hint: t('boot.hintEnv') },
{ id: 'engine', label: t('boot.stepEngine'), status: 'pending', hint: t('boot.hintEngine') },
{ id: 'connect', label: t('boot.stepConnect'), status: 'pending', hint: t('boot.hintConnect') },

// 错误提示替换：
throw new Error(status.message || t('boot.gatewayFailed'))
throw new Error(t('boot.gatewayIncomplete'))
```

- [ ] **Step 4: 迁移 `src/main/ai/cowork-session-manager.ts`**

```typescript
import { t } from '../i18n'

// createAndStart 中：
throw new Error(t('error.dirNotFound', { path: cwd }))

// continueSession 中：
throw new Error(t('error.dirDeleted', { path: session.directoryPath }))
```

- [ ] **Step 5: 验证**

```bash
cd petclaw-desktop && npm run typecheck && npx vitest run
```

Expected: typecheck 0 errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add petclaw-desktop/src/main/
git commit -m "feat(desktop): migrate main process texts to i18n"
```

---

## Task 6: Renderer 核心组件 i18n 迁移

**Files:**
- Modify: `src/renderer/src/components/WelcomePage.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/StatusBar.tsx`
- Modify: `src/renderer/src/views/chat/ChatHeader.tsx`
- Modify: `src/renderer/src/views/chat/ChatInputBox.tsx`
- Modify: `src/renderer/src/views/chat/ChatView.tsx`
- Modify: `src/renderer/src/views/chat/MonitorView.tsx`

每个组件的迁移模式相同：
1. `import { useI18n } from '@renderer/i18n'`（如果是函数组件）或 `import { i18nService } from '@renderer/i18n'`（如果在模块顶层）
2. 在组件内 `const { t } = useI18n()`
3. 将硬编码中文替换为 `t('key')`
4. 对于模块顶层的常量数组（如 `QUICK_CARDS`），需要移到组件内部或改用函数返回，因为 `t()` 需要在 React 组件上下文中调用

- [ ] **Step 1: 迁移 WelcomePage.tsx**

`QUICK_CARDS` 是模块顶层常量，需改为组件内部用 `t()` 构建：

```tsx
import { useI18n } from '../i18n'

export function WelcomePage({ onSendPrompt }: WelcomePageProps) {
  const { t } = useI18n()

  const greeting = getGreeting(t)  // 传入 t 函数

  const quickCards = [
    {
      icon: FolderOpen,
      title: t('welcome.card.fileOrganize.title'),
      desc: t('welcome.card.fileOrganize.desc'),
      prompt: t('welcome.card.fileOrganize.prompt')
    },
    // ...同理
  ]

  return (
    // ...
    <h2>
      {greeting}，{t('welcome.tagline')}
    </h2>
    <p>{t('welcome.subtitle')}</p>
    // ...
  )
}

function getGreeting(t: (key: string) => string): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return t('welcome.morning')
  if (hour >= 12 && hour < 18) return t('welcome.afternoon')
  return t('welcome.evening')
}
```

- [ ] **Step 2: 迁移 Sidebar.tsx**

```tsx
import { useI18n } from '../i18n'

// 组件内：
const { t } = useI18n()

// 替换所有硬编码：
<span>{t('sidebar.newTask')}</span>
<span>{t('sidebar.skills')}</span>
<span>{t('sidebar.cron')}</span>
<span>{t('sidebar.imChannels')}</span>
<span>{t('sidebar.workDir')}</span>
// 任务/频道 tab：
{t('sidebar.tasks')}
{t('sidebar.channels')}
// 空状态：
{t('sidebar.noTasks')}
// 会话标题 fallback：
{session.title || t('sidebar.defaultTitle')}
// 频道即将推出：
{t('sidebar.channelsComingSoon')}
```

- [ ] **Step 3: 迁移 Chat 相关组件**

ChatInputBox.tsx:
```tsx
const { t } = useI18n()
placeholder={t('chat.inputPlaceholder')}
aria-label={t('chat.sendLabel')}
```

ChatView.tsx:
```tsx
const { t } = useI18n()
useState(t('chat.newConversation'))  // 注意：需要在组件内使用
t('chat.unknownError')
t('chat.errorPrefix', { msg })
```

ChatHeader.tsx:
```tsx
const { t } = useI18n()
aria-label={editing ? t('chat.confirmTitle') : t('chat.editTitle')}
```

MonitorView.tsx:
```tsx
const { t } = useI18n()
{t('monitor.title')}
{t('monitor.noActive')}
{t('monitor.hint')}
```

StatusBar.tsx:
```tsx
const { t } = useI18n()
// 替换 "免费使用中" 文本
```

- [ ] **Step 4: 验证**

```bash
cd petclaw-desktop && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/renderer/src/
git commit -m "feat(desktop): migrate core renderer components to i18n"
```

---

## Task 7: Settings 页面 i18n 迁移

**Files:**
- Modify: `src/renderer/src/views/settings/SettingsPage.tsx`
- Modify: `src/renderer/src/views/settings/PreferenceSettings.tsx`
- Modify: `src/renderer/src/views/settings/ProfileSettings.tsx`
- Modify: `src/renderer/src/views/settings/AboutSettings.tsx`
- Modify: `src/renderer/src/views/settings/EngineSettings.tsx`
- Modify: `src/renderer/src/views/settings/ModelSettings.tsx`
- Modify: `src/renderer/src/views/settings/DirectorySettings.tsx`
- Modify: `src/renderer/src/views/settings/MemorySettings.tsx`
- Modify: `src/renderer/src/views/settings/ConnectorSettings.tsx`
- Modify: `src/renderer/src/views/settings/McpSettings.tsx`

同 Task 6 模式：每个组件 `const { t } = useI18n()` 后替换硬编码文本。

- [ ] **Step 1: 迁移 SettingsPage.tsx**

菜单项的 `label` 和分组 `label` 全部替换为 `t()` 调用。注意 `MENU_ITEMS` 是模块顶层常量，需改为组件内构建。

- [ ] **Step 2: 迁移 PreferenceSettings.tsx**

**关键**：`PreferenceSettings` 是语言切换的触发点。`handleChange('language', value)` 需要同时调用 `i18nService.setLanguage(value)`：

```tsx
import { useI18n } from '../../i18n'
import { i18nService } from '../../i18n'

export function PreferenceSettings() {
  const { t } = useI18n()

  const handleChange = (key: string, value: string) => {
    window.api.setSetting(key, value)
    if (key === 'language') {
      setLanguage(value)
      i18nService.setLanguage(value as 'zh' | 'en')
    }
    // ...
  }

  const languageOptions = [
    { value: 'zh', label: t('preferences.languageZh') },
    { value: 'en', label: t('preferences.languageEn') }
  ]
  // ...
}
```

- [ ] **Step 3: 迁移其余 Settings 子页面**

逐个组件替换。大部分是直接的文本替换，无特殊逻辑。

- [ ] **Step 4: 验证**

```bash
cd petclaw-desktop && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add petclaw-desktop/src/renderer/src/views/settings/
git commit -m "feat(desktop): migrate settings pages to i18n"
```

---

## Task 8: Onboarding + BootCheck i18n 迁移

**Files:**
- Modify: `src/renderer/src/views/onboarding/OnboardingPanel.tsx`
- Modify: `src/renderer/src/views/onboarding/BootCheckPanel.tsx`

- [ ] **Step 1: 迁移 OnboardingPanel.tsx**

这是最大的单个文件（~60 个中文字符串）。同样模式：`const { t } = useI18n()`，模块顶层常量移到组件内。

注意：快捷任务数组、角色选项等需要在组件内构建。

- [ ] **Step 2: 迁移 BootCheckPanel.tsx**

Boot 步骤的 label/hint 已在主进程侧通过 `t()` 翻译后推送，renderer 直接显示即可。仅需翻译 renderer 本地的 UI 文本（"设置完成！"、"正在启动"、"重试" 等）。

- [ ] **Step 3: 验证 + Commit**

```bash
cd petclaw-desktop && npm run typecheck
git add petclaw-desktop/src/renderer/src/views/onboarding/
git commit -m "feat(desktop): migrate onboarding and bootcheck to i18n"
```

---

## Task 9: Cron + IM + Skills + 剩余组件 i18n 迁移

**Files:**
- Modify: `src/renderer/src/views/cron/CronPage.tsx`
- Modify: `src/renderer/src/views/cron/CronEditDialog.tsx`
- Modify: `src/renderer/src/views/im/ImChannelsPage.tsx`
- Modify: `src/renderer/src/views/im/ImConfigDialog.tsx`
- Modify: `src/renderer/src/views/skills/SkillsPage.tsx`
- Modify: `src/renderer/src/views/skills/SkillSelector.tsx`
- Modify: `src/renderer/src/views/chat/CoworkPermissionModal.tsx`
- Modify: `src/renderer/src/components/TaskMonitorPanel.tsx`
- Modify: `src/renderer/src/components/ConnectorPopup.tsx`
- Modify: `src/renderer/src/components/CwdSelector.tsx`
- Modify: `src/renderer/src/components/DirectoryConfigDialog.tsx`
- Modify: `src/renderer/src/components/DirectorySkillSelector.tsx`
- Modify: `src/renderer/src/components/ModelSelector.tsx`
- Modify: `src/renderer/src/components/SettingsView.tsx`

- [ ] **Step 1: 迁移 Cron 页面**

CronPage.tsx 中的日期格式化函数需要特殊处理。`dayNames` 数组改为从 `t('cron.dayNames')` 拆分：

```typescript
const { t } = useI18n()
const dayNames = t('cron.dayNames').split(',')
// 使用 t('cron.daily', { time: timeStr }) 等插值格式
```

- [ ] **Step 2: 迁移 IM 页面**

ImChannelsPage.tsx 的平台列表目前硬编码在模块顶层，需移到组件内并用 `t()` 构建。

- [ ] **Step 3: 迁移 Skills 页面**

直接文本替换。

- [ ] **Step 4: 迁移 CoworkPermissionModal.tsx**

**注意**：该组件中有中文正则表达式（`/允许/`、`/取消/` 等）用于按钮样式判断。这些正则不是 UI 文本，但需要在多语言环境下扩展匹配逻辑。实现时需要评估是否替换为非正则方案（如按 behavior 类型判断样式）。

- [ ] **Step 5: 迁移剩余组件**

TaskMonitorPanel, ConnectorPopup, CwdSelector, DirectoryConfigDialog, DirectorySkillSelector, ModelSelector, SettingsView（Pet 窗口）— 逐个替换。

- [ ] **Step 6: 验证 + Commit**

```bash
cd petclaw-desktop && npm run typecheck
git add petclaw-desktop/src/renderer/src/
git commit -m "feat(desktop): migrate remaining renderer components to i18n"
```

---

## Task 10: 全量验证

**Files:** 无新文件

- [ ] **Step 1: TypeScript 全量检查**

```bash
cd petclaw-desktop && npm run typecheck
```

Expected: 0 errors

- [ ] **Step 2: 全量测试**

```bash
cd petclaw-desktop && npx vitest run
```

Expected: all tests pass

- [ ] **Step 3: 共享包测试**

```bash
cd petclaw-shared && npx vitest run
```

Expected: locale completeness tests pass

- [ ] **Step 4: 检查遗漏的硬编码中文**

在 renderer 组件中 grep 中文字符，排除注释和翻译文件：

```bash
grep -rn '[\u4e00-\u9fff]' petclaw-desktop/src/renderer/src/ --include='*.tsx' | grep -v '// ' | grep -v 'i18n'
```

Expected: 无遗漏（或仅剩品牌名 "PetClaw" 等不需翻译的内容）

- [ ] **Step 5: 同步文档**

更新 `.ai/README.md` 和 `docs/superpowers/specs/2026-04-22-petclaw-architecture-v3.md` 中的文件目录树和 i18n 相关章节。

- [ ] **Step 6: Final Commit**

```bash
git add .
git commit -m "feat(desktop): complete i18n internationalization support"
```

---

## 注意事项

1. **品牌名替换**：CronPage.tsx 和 CronEditDialog.tsx 中的 `QoderWork` 应统一替换为 `PetClaw`，在 i18n 迁移时一并完成
2. **CoworkPermissionModal 中文正则**：需要评估是否改为非文本匹配方案
3. **`window.prompt` 中文**：CwdSelector.tsx 和 CronEditDialog.tsx 使用系统原生 prompt 弹窗，i18n 时传入 `t()` 翻译后的文本
4. **翻译 key 可能需要补充**：实现时逐个读取组件，可能发现上述列表未覆盖的文本，需及时补充到 zh.ts 和 en.ts
5. **Pet 窗口独立渲染进程**：SettingsView.tsx 在 Pet 窗口中，也需要初始化 i18nService（通过 IPC 获取语言）
