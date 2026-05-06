import fs from 'fs'

import { resolveUserDataPaths } from './user-data-paths'

export function resolveDatabasePath(paths: { userDataPath: string }): string {
  const nextDbPath = resolveUserDataPaths(paths.userDataPath).database

  fs.mkdirSync(paths.userDataPath, { recursive: true })

  return nextDbPath
}
