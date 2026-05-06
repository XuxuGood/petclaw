import fs from 'fs'
import path from 'path'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'

const SRC_ROOT = path.resolve(__dirname, '../../../src')
const CONSOLE_PATTERN = /\bconsole\.(log|warn|error|info|debug)\b/
const LOGGER_METHODS = new Set(['debug', 'info', 'warn', 'error'])
const LOGGER_EVENT_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/
const LOGGER_OUTCOMES = new Set([
  'available',
  'awaiting',
  'bundleFound',
  'bundleMissing',
  'cancelled',
  'changed',
  'cleaned',
  'completed',
  'created',
  'deferred',
  'disallowedHost',
  'discovered',
  'emptyBody',
  'error',
  'exceeded',
  'executing',
  'exited',
  'extracted',
  'failed',
  'gb18030Fallback',
  'generated',
  'handling',
  'healthChecked',
  'healthy',
  'immediate',
  'incomplete',
  'info',
  'injected',
  'invalidJson',
  'listening',
  'missing',
  'missingApiConfig',
  'missingMessageStart',
  'notAvailable',
  'overwritten',
  'poll',
  'prepared',
  'processExited',
  'progress',
  'reached',
  'ready',
  'received',
  'remapped',
  'requested',
  'resolved',
  'restored',
  'reused',
  'scheduled',
  'sending',
  'shutdownRequested',
  'skipped',
  'started',
  'stderr',
  'stdout',
  'succeeded',
  'synced',
  'timeout',
  'unavailable',
  'unhealthy',
  'used',
  'warn'
])
const LOGGER_WRAPPER_FILES = new Set(['main/logging/facade.ts'])

function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(entryPath)
    return /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : []
  })
}

function isLoggerReceiver(receiver: string): boolean {
  return receiver === 'logger' || receiver.endsWith('Logger') || receiver.endsWith('Logger()')
}

function isStringLiteral(node: ts.Expression | undefined): node is ts.StringLiteral {
  return Boolean(node && ts.isStringLiteral(node))
}

function assertLoggerEvent(
  relativePath: string,
  line: number,
  eventNode: ts.Expression | undefined,
  offenders: string[]
): void {
  if (!isStringLiteral(eventNode)) {
    offenders.push(`${relativePath}:${line} uses a non-literal logger event`)
    return
  }

  const event = eventNode.text
  const outcome = event.split('.').at(-1) ?? ''
  if (!LOGGER_EVENT_PATTERN.test(event) || !LOGGER_OUTCOMES.has(outcome)) {
    offenders.push(`${relativePath}:${line} uses invalid logger event "${event}"`)
  }
}

function collectLoggerEventOffenders(filePath: string): string[] {
  const relativePath = path.relative(SRC_ROOT, filePath)
  if (LOGGER_WRAPPER_FILES.has(relativePath)) return []

  const sourceText = fs.readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
  const offenders: string[] = []

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      LOGGER_METHODS.has(node.expression.name.text) &&
      isLoggerReceiver(node.expression.expression.getText(sourceFile))
    ) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
      assertLoggerEvent(relativePath, line, node.arguments[0], offenders)
      if (!isStringLiteral(node.arguments[1])) {
        offenders.push(`${relativePath}:${line} uses a non-literal logger message`)
      }
      const fieldsArg = node.arguments[2]
      const errorArg = node.arguments[3]
      if (fieldsArg && errorArg && ts.isIdentifier(fieldsArg) && fieldsArg.text === 'undefined') {
        offenders.push(`${relativePath}:${line} uses undefined as logger fields placeholder`)
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.getText(sourceFile).endsWith('.logging.report')
    ) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
      const payload = node.arguments[0]
      if (!payload || !ts.isObjectLiteralExpression(payload)) {
        offenders.push(`${relativePath}:${line} uses a non-literal renderer log report`)
      } else {
        const eventProperty = payload.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'event'
        )
        const messageProperty = payload.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'message'
        )
        assertLoggerEvent(relativePath, line, eventProperty?.initializer, offenders)
        if (!isStringLiteral(messageProperty?.initializer)) {
          offenders.push(`${relativePath}:${line} uses a non-literal renderer log message`)
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return offenders
}

describe('production source logging', () => {
  test('does not use console.* in desktop src', () => {
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((filePath) => CONSOLE_PATTERN.test(fs.readFileSync(filePath, 'utf8')))
      .map((filePath) => path.relative(SRC_ROOT, filePath))

    expect(offenders).toEqual([])
  })

  test('uses literal lowerCamelCase logger events with registered outcomes', () => {
    const offenders = collectSourceFiles(SRC_ROOT).flatMap(collectLoggerEventOffenders)

    expect(offenders).toEqual([])
  })

  test('does not keep the legacy cowork logger wrapper', () => {
    const offenders = collectSourceFiles(SRC_ROOT).flatMap((filePath) => {
      const sourceText = fs.readFileSync(filePath, 'utf8')
      const relativePath = path.relative(SRC_ROOT, filePath)
      const found: string[] = []
      if (relativePath === 'main/ai/cowork-logger.ts') {
        found.push(`${relativePath} keeps the legacy cowork logger wrapper`)
      }
      if (sourceText.includes('coworkLog(') || sourceText.includes('cowork-logger')) {
        found.push(`${relativePath} references the legacy cowork logger wrapper`)
      }
      return found
    })

    expect(offenders).toEqual([])
  })

  test('does not keep legacy logging and diagnostics entrypoints', () => {
    const offenders = collectSourceFiles(SRC_ROOT).flatMap((filePath) => {
      const sourceText = fs.readFileSync(filePath, 'utf8')
      const relativePath = path.relative(SRC_ROOT, filePath)
      const found: string[] = []

      if (relativePath === 'main/logger.ts') {
        found.push(`${relativePath} keeps the legacy main logger facade`)
      }
      if (relativePath === 'main/diagnostics.ts') {
        found.push(`${relativePath} keeps startup diagnostics outside diagnostics domain`)
      }
      if (relativePath === 'main/logging/diagnostics-bundle.ts') {
        found.push(`${relativePath} keeps diagnostics bundle inside logging platform`)
      }
      if (sourceText.includes("from './logger'") || sourceText.includes('from "./logger"')) {
        found.push(`${relativePath} imports the legacy main logger facade`)
      }
      if (sourceText.includes('logging/diagnostics-bundle')) {
        found.push(`${relativePath} imports diagnostics bundle from logging`)
      }
      if (sourceText.includes('electron-log/main')) {
        found.push(`${relativePath} imports electron-log/main directly`)
      }

      return found
    })

    expect(offenders).toEqual([])
  })
})
