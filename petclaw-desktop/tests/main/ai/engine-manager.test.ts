import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import net from 'net'
import path from 'path'
import os from 'os'

import {
  parseJsonFile,
  findPath,
  isPortAvailable,
  isPortReachable
} from '../../../src/main/ai/engine-manager'

describe('parseJsonFile', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-engine-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('解析有效的 JSON 文件', () => {
    const filePath = path.join(tmpDir, 'test.json')
    fs.writeFileSync(filePath, JSON.stringify({ version: '1.0.0', name: 'test' }))
    const result = parseJsonFile<{ version: string; name: string }>(filePath)
    expect(result).toEqual({ version: '1.0.0', name: 'test' })
  })

  it('文件不存在时返回 null', () => {
    const result = parseJsonFile(path.join(tmpDir, 'missing.json'))
    expect(result).toBeNull()
  })

  it('JSON 格式无效时返回 null', () => {
    const filePath = path.join(tmpDir, 'bad.json')
    fs.writeFileSync(filePath, '{ broken json }}}')
    const result = parseJsonFile(filePath)
    expect(result).toBeNull()
  })

  it('解析嵌套 JSON 结构', () => {
    const filePath = path.join(tmpDir, 'nested.json')
    const data = { gateway: { mode: 'local', port: 18789 } }
    fs.writeFileSync(filePath, JSON.stringify(data))
    const result = parseJsonFile<typeof data>(filePath)
    expect(result?.gateway.mode).toBe('local')
    expect(result?.gateway.port).toBe(18789)
  })
})

describe('findPath', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-findpath-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('返回第一个存在的路径', () => {
    const existing = path.join(tmpDir, 'exists')
    fs.mkdirSync(existing)
    const result = findPath(['/nonexistent/path', existing, '/another/missing'])
    expect(result).toBe(existing)
  })

  it('所有路径不存在时返回 null', () => {
    const result = findPath(['/a/b/c', '/d/e/f'])
    expect(result).toBeNull()
  })

  it('空数组返回 null', () => {
    const result = findPath([])
    expect(result).toBeNull()
  })

  it('跳过空字符串候选项', () => {
    const existing = path.join(tmpDir, 'real')
    fs.mkdirSync(existing)
    const result = findPath(['', existing])
    expect(result).toBe(existing)
  })
})

describe('isPortAvailable', () => {
  it('空闲端口返回 true', async () => {
    // 使用 0 端口让系统分配一个空闲端口，然后关闭 server 后测试该端口
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as net.AddressInfo).port
    await new Promise<void>((resolve) => server.close(() => resolve()))

    const available = await isPortAvailable(port)
    expect(available).toBe(true)
  })

  it('被占用的端口返回 false', async () => {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as net.AddressInfo).port

    try {
      const available = await isPortAvailable(port)
      expect(available).toBe(false)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('isPortReachable', () => {
  it('监听中的端口可达', async () => {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as net.AddressInfo).port

    try {
      const reachable = await isPortReachable('127.0.0.1', port, 2000)
      expect(reachable).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('未监听的端口不可达', async () => {
    // 先获取一个空闲端口
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as net.AddressInfo).port
    await new Promise<void>((resolve) => server.close(() => resolve()))

    const reachable = await isPortReachable('127.0.0.1', port, 500)
    expect(reachable).toBe(false)
  })
})
