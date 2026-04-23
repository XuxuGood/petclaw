import fs from 'fs'
import path from 'path'

export function resolveDatabasePath(paths: {
  petclawHome: string
  legacyUserDataPath: string
}): string {
  const dataDir = path.join(paths.petclawHome, 'data')
  const nextDbPath = path.join(dataDir, 'petclaw.db')

  // Legacy paths to migrate from
  const legacyPaths = [
    path.join(paths.petclawHome, 'petclaw.db'), // old root location
    path.join(paths.legacyUserDataPath, 'petclaw.db') // old Electron userData
  ]

  fs.mkdirSync(dataDir, { recursive: true })

  if (!fs.existsSync(nextDbPath)) {
    for (const legacy of legacyPaths) {
      if (fs.existsSync(legacy)) {
        fs.renameSync(legacy, nextDbPath)
        // Also move WAL/SHM files if present
        for (const suffix of ['-wal', '-shm']) {
          const walFile = legacy + suffix
          if (fs.existsSync(walFile)) {
            fs.renameSync(walFile, nextDbPath + suffix)
          }
        }
        break
      }
    }
  }

  return nextDbPath
}
