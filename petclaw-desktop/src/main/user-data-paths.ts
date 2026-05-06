import path from 'path'

export interface UserDataPaths {
  root: string
  database: string
  openclawRoot: string
  openclawState: string
  openclawLogs: string
  openclawWorkspace: string
  skillsRoot: string
  logsRoot: string
  runtimesRoot: string
  pythonRuntimeRoot: string
  runtimeShimsRoot: string
  coworkShimBin: string
  mcpBridgeShimBin: string
}

export const PYTHON_RUNTIME_DIR_NAME = 'python-win'

export function resolveUserDataPaths(userDataPath: string): UserDataPaths {
  const openclawRoot = path.join(userDataPath, 'openclaw')
  const runtimesRoot = path.join(userDataPath, 'runtimes')
  const runtimeShimsRoot = path.join(userDataPath, 'runtime-shims')

  return {
    root: userDataPath,
    database: path.join(userDataPath, 'petclaw.db'),
    openclawRoot,
    openclawState: path.join(openclawRoot, 'state'),
    openclawLogs: path.join(openclawRoot, 'logs'),
    openclawWorkspace: path.join(openclawRoot, 'workspace'),
    skillsRoot: path.join(userDataPath, 'skills'),
    logsRoot: path.join(userDataPath, 'logs'),
    runtimesRoot,
    pythonRuntimeRoot: path.join(runtimesRoot, PYTHON_RUNTIME_DIR_NAME),
    runtimeShimsRoot,
    coworkShimBin: path.join(runtimeShimsRoot, 'cowork'),
    mcpBridgeShimBin: path.join(runtimeShimsRoot, 'mcp-bridge')
  }
}
