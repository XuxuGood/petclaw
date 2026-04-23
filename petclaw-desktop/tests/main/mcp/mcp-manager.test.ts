// tests/main/mcp/mcp-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase } from '../../../src/main/data/db'
import { McpManager } from '../../../src/main/mcp/mcp-manager'

describe('McpManager', () => {
  let db: Database.Database
  let manager: McpManager

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    manager = new McpManager(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should create an MCP server', () => {
    const server = manager.create({
      name: 'fs-server',
      description: 'File system server',
      enabled: true,
      transportType: 'stdio',
      config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] }
    })
    expect(server.id).toBeTruthy()
    expect(manager.get(server.id)?.name).toBe('fs-server')
  })

  it('should update an MCP server', () => {
    const server = manager.create({
      name: 'test',
      description: '',
      enabled: true,
      transportType: 'stdio',
      config: { command: 'node', args: [] }
    })
    manager.update(server.id, { description: 'updated' })
    expect(manager.get(server.id)?.description).toBe('updated')
  })

  it('should delete an MCP server', () => {
    const server = manager.create({
      name: 'del',
      description: '',
      enabled: true,
      transportType: 'stdio',
      config: { command: 'node', args: [] }
    })
    manager.delete(server.id)
    expect(manager.get(server.id)).toBeUndefined()
  })

  it('should toggle enabled', () => {
    const server = manager.create({
      name: 'toggle',
      description: '',
      enabled: true,
      transportType: 'stdio',
      config: { command: 'node', args: [] }
    })
    manager.setEnabled(server.id, false)
    expect(manager.get(server.id)?.enabled).toBe(false)
  })

  it('should emit change events', () => {
    let count = 0
    manager.on('change', () => {
      count++
    })
    manager.create({
      name: 'a',
      description: '',
      enabled: true,
      transportType: 'stdio',
      config: { command: 'x', args: [] }
    })
    expect(count).toBe(1)
  })

  it('should generate toOpenclawConfig', () => {
    manager.create({
      name: 'my-server',
      description: '',
      enabled: true,
      transportType: 'stdio',
      config: { command: 'npx', args: ['-y', 'mcp-server'] }
    })
    const config = manager.toOpenclawConfig()
    expect(config.entries['mcp-bridge'].config.servers['my-server']).toBeTruthy()
  })
})
