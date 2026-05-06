import { describe, expect, it } from 'vitest'
import path from 'path'

import { resolveUserDataPaths } from '../../src/main/user-data-paths'

describe('resolveUserDataPaths', () => {
  it('centralizes userData child directories', () => {
    const root = path.join('/tmp', 'PetClaw')
    const paths = resolveUserDataPaths(root)

    expect(paths).toEqual({
      root,
      database: path.join(root, 'petclaw.db'),
      openclawRoot: path.join(root, 'openclaw'),
      openclawState: path.join(root, 'openclaw', 'state'),
      openclawLogs: path.join(root, 'openclaw', 'logs'),
      openclawWorkspace: path.join(root, 'openclaw', 'workspace'),
      skillsRoot: path.join(root, 'skills'),
      logsRoot: path.join(root, 'logs'),
      runtimesRoot: path.join(root, 'runtimes'),
      pythonRuntimeRoot: path.join(root, 'runtimes', 'python-win'),
      runtimeShimsRoot: path.join(root, 'runtime-shims'),
      coworkShimBin: path.join(root, 'runtime-shims', 'cowork'),
      mcpBridgeShimBin: path.join(root, 'runtime-shims', 'mcp-bridge')
    })
  })
})
