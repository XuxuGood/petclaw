import fs from 'fs'
import path from 'path'

export function resolveDatabasePath(paths: {
  petclawHome: string
  legacyUserDataPath: string
}): string {
  const nextDbPath = path.join(paths.petclawHome, 'petclaw.db')
  const legacyDbPath = path.join(paths.legacyUserDataPath, 'petclaw.db')

  fs.mkdirSync(paths.petclawHome, { recursive: true })

  if (!fs.existsSync(nextDbPath) && fs.existsSync(legacyDbPath)) {
    fs.renameSync(legacyDbPath, nextDbPath)
  }

  return nextDbPath
}
