import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

import { initDatabase } from '../../../src/main/data/db'
import { ImStore } from '../../../src/main/data/im-store'
import { ImGatewayManager } from '../../../src/main/im/im-gateway-manager'
import type { ImInstanceConfig } from '../../../src/main/im/types'

function buildFeishuAppSecretEnvRef(instanceId: string): string {
  return `\${PETCLAW_IM_FEISHU_${instanceId.replace(/-/g, '_').toUpperCase()}_APPSECRET}`
}

function buildFeishuAppSecretEnvName(instanceId: string): string {
  return `PETCLAW_IM_FEISHU_${instanceId.replace(/-/g, '_').toUpperCase()}_APPSECRET`
}

describe('ImGatewayManager OpenClaw config', () => {
  let db: Database.Database
  let manager: ImGatewayManager

  beforeEach(() => {
    db = new Database(':memory:')
    initDatabase(db)
    manager = new ImGatewayManager(new ImStore(db))
  })

  afterEach(() => {
    db.close()
  })

  it('should export enabled IM instances as OpenClaw channels without plaintext credentials', () => {
    const instance = manager.createInstance('feishu', { appSecret: 'secret-token' }, 'Feishu Bot')
    const config: ImInstanceConfig = {
      dmPolicy: 'open',
      groupPolicy: 'allowlist',
      allowFrom: ['team-a'],
      debug: true
    }
    manager.updateInstance(instance.id, {
      config,
      enabled: true
    })

    const channels = manager.toOpenclawChannelsConfig()
    const channel = channels[`feishu:${instance.id}`] as Record<string, unknown>

    expect(channel).toEqual({
      enabled: true,
      platform: 'feishu',
      name: 'Feishu Bot',
      dmPolicy: 'open',
      groupPolicy: 'allowlist',
      allowFrom: ['team-a'],
      debug: true,
      credentials: {
        appSecret: buildFeishuAppSecretEnvRef(instance.id)
      }
    })
    expect(JSON.stringify(channels)).not.toContain('secret-token')
  })

  it('should export instance default bindings', () => {
    const instance = manager.createInstance('feishu', { appSecret: 'secret-token' })
    manager.updateInstance(instance.id, {
      enabled: true,
      agentId: 'dir-agent',
      directoryPath: '/repo/a'
    })

    const result = manager.toOpenclawBindingsConfig()

    expect(result.bindings).toEqual([
      {
        agentId: 'dir-agent',
        match: {
          channel: `feishu:${instance.id}`
        }
      }
    ])
  })

  it('should collect IM secret env vars', () => {
    const instance = manager.createInstance('feishu', { appSecret: 'secret-token' })
    manager.updateInstance(instance.id, { enabled: true })

    const vars = manager.collectSecretEnvVars()

    expect(vars).toEqual({
      [buildFeishuAppSecretEnvName(instance.id)]: 'secret-token'
    })
  })
})
