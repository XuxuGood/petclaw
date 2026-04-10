import { describe, it, expect, afterEach } from 'vitest'
import * as net from 'net'
import * as fs from 'fs'
import { HookServer } from '../../../src/main/hooks/server'
import { HookEvent, HookEventType } from '../../../src/main/hooks/types'

describe('HookServer', () => {
  let server: HookServer

  afterEach(async () => {
    await server?.stop()
  })

  it('starts and listens on unix socket', async () => {
    server = new HookServer()
    const socketPath = await server.start()
    expect(fs.existsSync(socketPath)).toBe(true)
  })

  it('receives hook events from clients', async () => {
    const events: HookEvent[] = []
    server = new HookServer()
    server.onEvent((event) => events.push(event))
    const socketPath = await server.start()

    // Simulate a hook client sending an event
    const client = net.createConnection(socketPath)
    await new Promise<void>((resolve) => client.on('connect', resolve))

    const event: HookEvent = {
      type: HookEventType.ToolUse,
      tool: 'Claude Code',
      sessionId: 'test-123',
      data: { toolName: 'Read', status: 'running' }
    }
    client.write(JSON.stringify(event) + '\n')

    // Wait for event to be received
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(HookEventType.ToolUse)
    expect(events[0].tool).toBe('Claude Code')

    client.end()
  })

  it('handles multiple clients', async () => {
    const events: HookEvent[] = []
    server = new HookServer()
    server.onEvent((event) => events.push(event))
    const socketPath = await server.start()

    const client1 = net.createConnection(socketPath)
    const client2 = net.createConnection(socketPath)
    await Promise.all([
      new Promise<void>((r) => client1.on('connect', r)),
      new Promise<void>((r) => client2.on('connect', r))
    ])

    client1.write(
      JSON.stringify({ type: 'tool_use', tool: 'Claude Code', sessionId: 's1', data: {} }) + '\n'
    )
    client2.write(
      JSON.stringify({ type: 'tool_use', tool: 'Codex', sessionId: 's2', data: {} }) + '\n'
    )

    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    expect(events).toHaveLength(2)
    client1.end()
    client2.end()
  })

  it('cleans up socket file on stop', async () => {
    server = new HookServer()
    const socketPath = await server.start()
    expect(fs.existsSync(socketPath)).toBe(true)
    await server.stop()
    expect(fs.existsSync(socketPath)).toBe(false)
  })
})
