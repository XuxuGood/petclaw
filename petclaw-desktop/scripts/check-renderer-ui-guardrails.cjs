#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const RENDERER_ROOT = path.join(ROOT, 'src', 'renderer', 'src')

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])

const EXEMPT_FILES = new Map([
  [
    path.join('views', 'im', 'im-platform-icons.tsx'),
    'IM 平台图标需要使用官方品牌色，不能抽成产品语义 token。'
  ],
  [
    path.join('views', 'boot', 'BootCheckPanel.tsx'),
    'BootCheck 启动插画是独立视觉锚点，允许少量内联 SVG 色值和渐变。'
  ]
])

const RULES = [
  {
    id: 'no-hardcoded-hex',
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
    message: 'renderer 组件禁止硬编码 hex 色值；先复用 index.css token，确需例外请加入本脚本白名单并说明原因。'
  },
  {
    id: 'no-local-gradient-utilities',
    pattern: /\b(bg-gradient-to-[a-z-]+|from-[a-z]+-\d+|via-[a-z]+-\d+|to-[a-z]+-\d+)\b/g,
    message: 'renderer 组件禁止临时 Tailwind 渐变；主工作台不做装饰性渐变，确需例外请走共享 token/class。'
  },
  {
    id: 'no-arbitrary-high-z-index',
    pattern: /\bz-\[(\d{3,})\]/g,
    message: 'renderer 组件禁止随机大 z-index；使用 Desktop 页面布局规范里的层级范围。'
  }
]

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(fullPath))
      continue
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }

  return files
}

function getLineNumber(source, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1
  }
  return line
}

const violations = []

for (const filePath of walk(RENDERER_ROOT)) {
  const relativePath = path.relative(RENDERER_ROOT, filePath)
  const exemptionReason = EXEMPT_FILES.get(relativePath)
  const source = fs.readFileSync(filePath, 'utf8')

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    let match = rule.pattern.exec(source)
    while (match) {
      if (!exemptionReason) {
        violations.push({
          file: path.relative(ROOT, filePath),
          line: getLineNumber(source, match.index),
          rule: rule.id,
          match: match[0],
          message: rule.message
        })
      }
      match = rule.pattern.exec(source)
    }
  }
}

if (violations.length > 0) {
  console.error('\nRenderer UI guardrails failed:\n')
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}  ${violation.rule}  ${violation.match}`)
    console.error(`  ${violation.message}`)
  }
  console.error('\nAllowed existing exceptions:')
  for (const [file, reason] of EXEMPT_FILES.entries()) {
    console.error(`- src/renderer/src/${file}: ${reason}`)
  }
  process.exit(1)
}

console.log('Renderer UI guardrails passed.')
